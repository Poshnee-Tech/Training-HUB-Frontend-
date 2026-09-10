'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import TrainingFloorShell from '@/components/layout/TrainingFloorShell';
import { useAuthStore } from '@/store/auth.store';
import { sessions, evaluations, training } from '@/lib/api';

type EvalStatus = 'loading' | 'completed' | 'queued' | 'processing' | 'failed' | 'missing' | 'not_started' | 'unknown';
/**
 * Statuses the scoring worker is still going to move on from.
 *
 * `unknown` and `not_started` are terminal "we cannot tell" answers — polling
 * them forever accomplishes nothing, so they are not in here.
 */
const PENDING_STATUSES = ['queued', 'processing'];

/** Every 4s, and give up after two minutes. */
const POLL_INTERVAL_MS = 4000;
/**
 * How long the page keeps asking while the server says a job is queued or
 * processing. MEASURED (2026-09-11): a full evaluation with the voice-delivery
 * and accent assessments takes two to three minutes, and the previous bound
 * of two minutes (30 × 4 s) expired inside that window — the page then said
 * "This page updates on its own" while no longer asking, so a re-evaluation
 * looked as though it never arrived until a manual reload. The server's own
 * queue bounds a job (retries, then dead-letter → status 'failed'), so the
 * page only needs a generous ceiling against a job the server has lost track
 * of; when it is reached the page says so and offers a manual check.
 */
const MAX_POLL_ATTEMPTS = 225; // 15 minutes

/**
 * The backend's current scorecard envelope uses `fronterScorecard`; reports
 * written by the original scorecard integration used `result`. Read both so
 * old and new evaluations render through the strict-scorecard path instead of
 * silently falling back to the legacy five-category display.
 */
function readFronterScorecard(rawResponse: any) {
  if (rawResponse?.evaluator !== 'fronter-scorecard') return null;
  return rawResponse.fronterScorecard ?? rawResponse.result ?? null;
}

/**
 * The audio-measured KPIs, gathered into the section shape the voice panel
 * expects.
 *
 * Scorecard v9 merged Voice Delivery into Communication, so a lookup by
 * `sectionId === 'voice_delivery'` finds nothing on a v9 evaluation and the
 * panel silently disappears — no error, just a missing feature. Collecting by
 * KPI ID works on BOTH: the KPIs kept their ids across the merge, and older
 * evaluations still carry them inside the retired section.
 *
 * Null when none are present, which is what an evaluation written before the
 * voice layer existed looks like.
 */
const AUDIO_KPI_IDS = ['speech_clarity', 'speech_pacing', 'us_accent_match'];

function audioKpisAsSection(sections: any[] | undefined | null) {
  const kpis = (sections ?? [])
    .flatMap((section: any) => section?.kpis ?? [])
    .filter((kpi: any) => AUDIO_KPI_IDS.includes(kpi?.kpiId));
  if (kpis.length === 0) return null;

  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    sectionId: 'voice_delivery',
    title: 'Voice Delivery',
    score: round2(kpis.reduce((sum: number, k: any) => sum + (k.score ?? 0), 0)),
    maxScore: round2(kpis.reduce((sum: number, k: any) => sum + (k.maxScore ?? 0), 0)),
    kpis,
  };
}


function dispositionLabel(disposition: string | undefined): string {
  const labels: Record<string, string> = {
    dnc: 'Do not call',
    hangup_or_goodbye: 'Customer ended the call',
    refusal_to_continue: 'Not interested',
    callback_or_busy: 'Callback / busy',
    explicit_call_end: 'Customer ended the call',
    wrong_number: 'Wrong number',
    dead_air: 'Dead air',
    agent_disqualification: 'Disqualified',
  };
  return disposition ? labels[disposition] ?? disposition.replaceAll('_', ' ') : 'Normal call';
}

import { difficultyLabel, evaluationStatusCopy, productLabel, scoreBandLabel } from '@/lib/labels';
import { formatDuration, getScoreColor, getDifficultyColor, getCampaignColor, cn } from '@/lib/utils';
import { VoiceDelivery } from '@/components/report/VoiceDelivery';


/**
 * ── THE REPORT RENDERS THE SHARED COMPONENT, NOT A LOCAL COPY ───────────
 *
 * A stripped-down `VoiceDelivery` had been inlined here (previously lines
 * 217-399) and the import of the real component removed. The two then
 * drifted: `components/report/VoiceDelivery.tsx` grew the per-word coaching
 * list, the reference/own-voice playback buttons and the accent breakdown,
 * while this page kept rendering the older copy that had none of them.
 *
 * MEASURED: the admin panel showed "Words to coach" for session 5d503e91
 * while this report showed nothing for the same evaluation and the same
 * API payload — 10 word issues and 5 sound patterns were being fetched and
 * thrown away. Edits to the shared component had no effect here at all,
 * because nothing imported it: it had become dead code.
 *
 * One component, one place. If this page ever needs a different layout, it
 * takes a prop — it does not get a second implementation that silently
 * stops receiving fixes.
 */


function modeLabel(values: string[]): string {
  const counts = values
    .filter((v) => v && v !== 'unknown')
    .reduce<Record<string, number>>((acc, value) => {
      acc[value] = (acc[value] || 0) + 1;
      return acc;
    }, {});
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  return best ? best.charAt(0).toUpperCase() + best.slice(1) : 'Unknown';
}

function summarizeVoiceMetrics(metrics: any[]) {
  const turns = metrics.filter((m) => m && typeof m === 'object');
  if (turns.length === 0) return null;

  const wpms = turns.map((m) => Number(m.wpm)).filter((n) => Number.isFinite(n) && n > 0);
  const avgWpm = wpms.length ? Math.round(wpms.reduce((sum, n) => sum + n, 0) / wpms.length) : null;
  const avgSpeechRatio = Math.round(
    turns.reduce((sum, m) => sum + (Number(m.speechRatio) || 0), 0) / turns.length * 100,
  );
  const longPauses = turns.reduce((sum, m) => sum + (Number(m.longPauseCount) || 0), 0);
  const clippingTurns = turns.filter((m) => Number(m.clippingPct) > 0.01).length;
  const energy = modeLabel(turns.map((m) => String(m.energyLevel || 'unknown')));
  const pace = modeLabel(turns.map((m) => String(m.paceLevel || 'unknown')));

  let coachingLine = 'Delivery was in a healthy range for a practice call.';
  if (clippingTurns > 0) coachingLine = 'Mic level peaked on some turns. Lower input gain or speak slightly softer.';
  else if (avgWpm && avgWpm > 180) coachingLine = 'Pace was fast. Slow down slightly after key details.';
  else if (avgWpm && avgWpm < 110) coachingLine = 'Pace was slow. Keep momentum while staying clear.';
  else if (longPauses >= turns.length) coachingLine = 'Long pauses appeared between turns. Practice smoother transitions.';

  return {
    turnCount: turns.length,
    avgWpm,
    avgSpeechRatio,
    longPauses,
    clippingTurns,
    energy,
    pace,
    coachingLine,
  };
}

export default function ReportDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { token, loadFromStorage } = useAuthStore();
  const [session, setSession] = useState<any>(null);
  const [evaluation, setEvaluation] = useState<any>(null);
  const [transcript, setTranscript] = useState<any[]>([]);
  const [enrichedData, setEnrichedData] = useState<any>(null);
  const [coachingTips, setCoachingTips] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [evalStatus, setEvalStatus] = useState<EvalStatus>('loading');
  const [evalError, setEvalError] = useState<string | null>(null);
  const [enrichedStatus, setEnrichedStatus] = useState<string>('unknown');
  const [retrying, setRetrying] = useState(false);
  /** When the current wait for a score began — drives the elapsed counter on the progress card. */
  const [pendingSince, setPendingSince] = useState<number | null>(null);
  const [pendingElapsedS, setPendingElapsedS] = useState(0);
  const [activeTab, setActiveTab] = useState<'evaluation' | 'transcript' | 'coaching'>('evaluation');

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  /**
   * Ask the server where the scoring got to.
   *
   * Split out of the initial load so the poll below can call it on its own:
   * re-running the whole load every four seconds would refetch the session and
   * the transcript, which do not change while a score is being worked out.
   */
  const refreshEvaluation = useCallback(async () => {
    if (!token || !params.id) return;
    try {
      const statusRes = await evaluations.status(token, params.id as string);
      const next = statusRes.data.status as EvalStatus;
      setEvalStatus(next);
      if (statusRes.data.lastError) setEvalError(statusRes.data.lastError);
      if (statusRes.data.enrichedStatus) setEnrichedStatus(statusRes.data.enrichedStatus);

      if (next === 'completed') {
        const evalRes = await evaluations.get(token, params.id as string);
        setEvaluation(evalRes.data);

        // The written feedback is generated after the score, so it is fetched
        // here too — otherwise a report that arrives by polling shows numbers
        // with no coaching against them until the page is reloaded by hand.
        try {
          const [enrichedRes, tipsRes] = await Promise.all([
            training.enrichedReport(token, params.id as string),
            training.coachingTips(token, params.id as string),
          ]);
          setEnrichedData(enrichedRes.data);
          setEnrichedStatus('ready');
          setCoachingTips(tipsRes.data || []);
        } catch { /* still generating — the panel says so */ }
      }
    } catch {
      setEvalStatus('unknown');
    }
  }, [token, params.id]);

  /**
   * Poll while the score is being worked out.
   *
   * This page is where every call ends, and it used to sit on "we're scoring
   * your call" until the trainee thought to press a button. Now it checks for
   * itself and the score appears.
   *
   * Bounded: a job that genuinely never finishes stops being asked about after
   * two minutes rather than hammering the API for as long as the tab is open.
   * The attempt count is a ref so ticking it does not re-render the report.
   */
  const attemptsRef = useRef(0);

  const queueEvaluation = useCallback(async (replaceExisting: boolean) => {
    if (!token || !params.id || retrying) return;
    if (replaceExisting && !window.confirm(
      'Re-evaluating will replace the current report with a newly generated one. Continue?',
    )) return;

    setRetrying(true);
    try {
      await evaluations.retry(token, params.id as string);
      attemptsRef.current = 0;
      // The progress card lives on the evaluation tab; a re-evaluation started
      // from the transcript or coaching tab used to change nothing in view.
      setActiveTab('evaluation');
      setPendingSince(Date.now());
      // The previous report stays on screen, dimmed under the progress card,
      // until the new one replaces it; clearing it left a page with nothing
      // on it but a dot for two or three minutes.
      setEvalError(null);
      setEvalStatus('queued');
    } catch {
      setEvalError('Could not start evaluation. Please try again.');
    } finally {
      setRetrying(false);
    }
  }, [token, params.id, retrying]);

  // Elapsed time on the progress card, ticking once a second while a score is pending.
  useEffect(() => {
    if (!PENDING_STATUSES.includes(evalStatus)) { setPendingElapsedS(0); return; }
    const since = pendingSince ?? Date.now();
    if (pendingSince === null) setPendingSince(since);
    const id = setInterval(() => setPendingElapsedS(Math.floor((Date.now() - since) / 1000)), 1000);
    return () => clearInterval(id);
  }, [evalStatus, pendingSince]);

  useEffect(() => {
    if (!PENDING_STATUSES.includes(evalStatus)) return;
    if (attemptsRef.current >= MAX_POLL_ATTEMPTS) {
      // Stop claiming the page updates on its own once it no longer does.
      setEvalError('The score is taking longer than expected. Check again in a moment.');
      setEvalStatus('unknown');
      return;
    }

    const id = setTimeout(() => {
      attemptsRef.current += 1;
      void refreshEvaluation();
    }, POLL_INTERVAL_MS);

    return () => clearTimeout(id);
  }, [evalStatus, refreshEvaluation]);

  useEffect(() => {
    if (!token || !params.id) return;

    async function loadData() {
      try {
        const [sessionRes, transcriptRes] = await Promise.all([
          sessions.get(token!, params.id as string),
          sessions.transcript(token!, params.id as string),
        ]);
        setSession(sessionRes.data);
        setTranscript(transcriptRes.data);

        if (sessionRes.data.evaluation) {
          setEvaluation(sessionRes.data.evaluation);
          setEvalStatus('completed');
          // A re-evaluation may be running behind this report (a reload while
          // it was scoring): ask, so the progress card shows and polling runs
          // instead of the old report sitting there as if it were final.
          try {
            const statusRes = await evaluations.status(token!, params.id as string);
            if (PENDING_STATUSES.includes(statusRes.data.status)) {
              setEvalStatus(statusRes.data.status as EvalStatus);
              setPendingSince(statusRes.data.queuedAt ? new Date(statusRes.data.queuedAt).getTime() : Date.now());
            }
          } catch { /* the report is shown either way */ }
        } else {
          // No inline evaluation — check job status
          try {
            const statusRes = await evaluations.status(token!, params.id as string);
            setEvalStatus(statusRes.data.status as EvalStatus);
            if (statusRes.data.lastError) setEvalError(statusRes.data.lastError);
            if (statusRes.data.enrichedStatus) setEnrichedStatus(statusRes.data.enrichedStatus);
            // If status says completed but session.evaluation was null, try fetching eval
            if (statusRes.data.status === 'completed') {
              try {
                const evalRes = await evaluations.get(token!, params.id as string);
                setEvaluation(evalRes.data);
              } catch { /* race condition */ }
            }
          } catch {
            setEvalStatus('unknown');
          }
        }

        // Load enriched report (annotations + model responses)
        try {
          const [enrichedRes, tipsRes] = await Promise.all([
            training.enrichedReport(token!, params.id as string),
            training.coachingTips(token!, params.id as string),
          ]);
          setEnrichedData(enrichedRes.data);
          setEnrichedStatus('ready');
          setCoachingTips(tipsRes.data || []);
        } catch {
          // Enriched data not ready yet
        }
      } catch (err) {
        console.error('Failed to load report:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [token, params.id]);

  if (loading) {
    return (
      <TrainingFloorShell>
        <main className="mx-auto w-full max-w-[1480px] px-4 py-5 sm:px-7 lg:px-10 lg:py-7">
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin h-8 w-8 border-2 border-primary-600 border-t-transparent rounded-full" />
          </div>
        </main>
      </TrainingFloorShell>
    );
  }

  const scoreCalibration = evaluation?.rawResponse?.scoreCalibration;
  const fronterScorecard = readFronterScorecard(evaluation?.rawResponse);
  const traineeSummary = evaluation?.rawResponse?.evaluator === 'fronter-scorecard'
    ? evaluation.rawResponse.traineeSummary
    : null;
  /**
   * ── FORMAT IS CHOSEN BY `format`, NOT BY PRESENCE (owner ruling 2026-09-03)
   *
   * This used to be `dispositionHandling ? nonTransfer : transfer`, i.e. the
   * format was decided by whether a disposition happened to be inferred. That
   * is how session 5fb6c6b0 — an authored DNC — was graded on the TRANSFER
   * rubric: nothing matched the transcript regex, the value came out null, and
   * the ternary fell through.
   *
   * The backend now always reports a disposition for a real call and names the
   * format on it. A transfer call carries `format: 'transfer'` and must keep
   * the full scored rubric, so presence can no longer be the test.
   *
   * Older evaluations have no `format` field. They predate this and were, by
   * construction, only ever produced for non-transfer calls — so the fallback
   * preserves exactly what they rendered before.
   */
  /**
   * ── ONE SCORECARD, NOT TWO (owner ruling 2026-09-04) ───────────────────
   *
   * `format` used to route between two different documents: a transfer got
   * the scored sections and no outcome verdict, a non-transfer got the
   * verdict and NO SCORED SECTIONS AT ALL — communication and engagement
   * included. So the skills the owner most wants graded on a DNC call were
   * the ones the page threw away.
   *
   * "Two formats means a routing decision, and that routing decision has been
   * wrong three times in three different ways. One format with one code path
   * cannot route wrongly."
   *
   * The backend already scores every call the same way — verified on two live
   * sessions, one TRANSFERRED and one non-transfer, both returning the same
   * six sections — and already marks inapplicable items with `maxScore: 0`,
   * which removes them from the denominator so they are NOT scored as
   * failures. Nothing had to change there. The split was here.
   *
   * `dispositionHandling` is therefore now simply the disposition, always,
   * and every section renders on every call. `format` is left unread rather
   * than removed: older evaluations still carry it, and nothing should depend
   * on it again.
   */
  const dispositionHandling = fronterScorecard?.dispositionHandling ?? null;
  const confirmedGateIds = new Set<string>(
    (fronterScorecard?.score?.gate?.findings ?? [])
      .filter((finding: any) => finding.confirmed)
      .map((finding: any) => finding.gateId),
  );
  const abusiveLanguage = confirmedGateIds.has('abusive_language');
  const pressuredAfterStop = confirmedGateIds.has('pressure_after_refusal')
    || confirmedGateIds.has('ignored_dnc_request');
  const professionalismKpi = fronterScorecard?.score?.sections
    ?.find((section: any) => section.sectionId === 'communication')
    ?.kpis?.find((kpi: any) => kpi.kpiId === 'professionalism');
  const professionalismIssues = Number(
    professionalismKpi?.subChecks?.find((check: any) => check.subCheckId === 'issues')?.observed ?? 0,
  );
  const professionalConductPassed = !abusiveLanguage && professionalismIssues === 0;
  const reportSummary = fronterScorecard?.score?.callSummary
    || fronterScorecard?.observation?.call_summary
    || evaluation?.summary;
  const scoreSections = fronterScorecard
    ? fronterScorecard.score.sections.map((section: any) => ({
      label: section.title,
      score: section.maxScore > 0 ? Math.round(section.score / section.maxScore * 1000) / 10 : null,
      key: section.sectionId,
    }))
    : [
      { label: 'Opening', score: evaluation?.openingScore, key: 'opening' },
      { label: 'Communication', score: evaluation?.communicationScore, key: 'communication' },
      { label: 'Objection Handling', score: evaluation?.objectionScore, key: 'objectionHandling' },
      { label: 'Product Knowledge', score: evaluation?.knowledgeScore, key: 'productKnowledge' },
      { label: 'Closing', score: evaluation?.closingScore, key: 'closing' },
    ];
  const voiceMetrics = Array.isArray(session?.metadata?.agentTurnAudioMetrics)
    ? session.metadata.agentTurnAudioMetrics
    : [];
  const voiceSummary = summarizeVoiceMetrics(voiceMetrics);

  /**
   * ── TWO VOICE PANELS WOULD CONTRADICT EACH OTHER ──────────────────────
   *
   * `voiceSummary` is BROWSER telemetry: the mic's own view of a turn, sent
   * up from useWebSocket as `agent_turn_metrics`. Its WPM is measured over
   * turn DURATION and it calls 180+ "fast".
   *
   * `scoredVoice` is the backend's assessment of the recorded agent channel.
   * Its WPM is measured over SPOKEN time — silences excluded — and its
   * comfortable band runs to 200. The two therefore disagree on the same
   * call by construction, and a report that says "Pace: fast" beside
   * "Pacing: comfortable" teaches an agent to trust neither.
   *
   * So exactly one of them owns pace. When the scored section is present it
   * wins — it is the number that carries points — and the telemetry panel
   * drops to what only it can see: microphone level and clipping. When there
   * is no scored voice (an older evaluation, or a call with no usable audio)
   * the telemetry panel renders in full exactly as it did before.
   */
  // Complete Fronter evaluations keep voice inside the strict scorecard.
  // Incomplete calls preserve their existing score and store the same analysis
  // at the raw-response root so voice coaching is still available.
  const scoringInProgress = PENDING_STATUSES.includes(evalStatus);
  /**
   * ── THE BREAKDOWN IS A PERMISSION (owner ruling 2026-09-11) ──────────────
   *
   * Read from the RESPONSE, not from a separate settings request: the server
   * withholds the fields and marks what it sent, so the page can never draw a
   * breakdown it was not given, and can never claim one is missing when it is
   * there. The score, the call's own details and the trainee's own transcript
   * stay; everything the QA scorecard produced is the supervisor's to release.
   */
  const detailWithheld = evaluation?.detailWithheld === true;
  const scoredVoice = fronterScorecard?.voice ?? evaluation?.rawResponse?.voice ?? null;
  const voiceSection = audioKpisAsSection(fronterScorecard?.score?.sections);
  const hasScoredVoice = Boolean(scoredVoice?.applicable && scoredVoice?.azure);
  const accentClassification = evaluation?.rawResponse?.accentClassification;

  return (
    <TrainingFloorShell>
      <main className="mx-auto w-full max-w-[1480px] px-4 py-5 sm:px-7 lg:px-10 lg:py-7">
        {/* Header */}
        <div className="mb-7">
          <div className="mb-3 flex items-center justify-between">
            <button onClick={() => router.push('/reports')} className="inline-flex items-center rounded-lg px-2.5 py-1.5 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900">
              &larr; Back to Reports
            </button>
            {evaluation && (
              <div className="flex items-center gap-2 print:hidden">
                {/* Re-scoring is a QA action: offered only to someone who can
                    see what the score is made of. */}
                {!detailWithheld && (
                <button
                  type="button"
                  onClick={() => void queueEvaluation(true)}
                  disabled={retrying || scoringInProgress}
                  className="btn-secondary rounded-xl border-gray-200 bg-white text-xs shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {retrying ? 'Starting…' : scoringInProgress ? 'Re-evaluating…' : 'Re-evaluate'}
                </button>
                )}
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="btn-secondary flex items-center gap-1.5 rounded-xl border-gray-200 bg-white text-xs shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18.75 12h.008v.008h-.008V12Zm-12 0h.008v.008H6.75V12Z" />
                </svg>
                  Export PDF
                </button>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-gray-950 sm:text-[28px]">
              {session?.scenario?.name || 'Call report'}
            </h1>
            <div className="flex flex-wrap gap-2">
              {session?.scenario && (
                <>
                  <span className={`badge rounded-full px-2.5 py-1 text-[11px] font-semibold ${getCampaignColor(session.scenario.campaign)}`}>
                    {productLabel(session.scenario.campaign)}
                  </span>
                  <span className={`badge rounded-full px-2.5 py-1 text-[11px] font-semibold ${getDifficultyColor(session.scenario.difficulty)}`}>
                    {difficultyLabel(session.scenario.difficulty)}
                  </span>
                </>
              )}
              {session?.agentRole && (
                <span className={`badge rounded-full px-2.5 py-1 text-[11px] font-semibold ${session.agentRole === 'FRONTER' ? 'bg-purple-50 text-purple-700 ring-1 ring-purple-100' : 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100'}`}>
                  {session.agentRole}
                </span>
              )}
            </div>
          </div>
          {session?.durationSeconds && (
            <p className="mt-2 text-sm text-gray-500">Duration: <span className="font-medium text-gray-700">{formatDuration(session.durationSeconds)}</span></p>
          )}
        </div>

        {/* A re-evaluation in progress, with the previous report still below.
          * Rendered whenever the server says a job is queued or processing —
          * after the click, and after a reload mid-scoring alike. */}
        {evaluation && scoringInProgress && (
          <div className="card mb-7 rounded-2xl border border-blue-200 bg-blue-50/60 py-8 text-center shadow-sm" role="status" aria-live="polite" data-testid="evaluation-progress">
            <div className="mb-3 flex justify-center">
              <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-blue-600 border-t-transparent" aria-hidden />
            </div>
            <div className="font-medium text-blue-700">{evaluationStatusCopy(evalStatus).title}</div>
            <p className="mx-auto mt-1 max-w-md text-sm text-gray-600">{evaluationStatusCopy(evalStatus).body}</p>
            <p className="mx-auto mt-2 max-w-md text-xs text-gray-500">
              {evalStatus === 'processing' ? 'Scoring now' : 'Waiting for a scoring slot'} · {`${Math.floor(pendingElapsedS / 60)}:${String(pendingElapsedS % 60).padStart(2, '0')}`} elapsed · the previous report is shown below until the new one is ready.
            </p>
          </div>
        )}

        {/* The score, alone, when the breakdown is your trainer's to release. */}
        {evaluation && detailWithheld && (
          <div className={cn('card mb-7 rounded-2xl border border-gray-200/80 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.05)]', scoringInProgress && 'opacity-50')} data-testid="score-only">
            <div className="flex flex-col items-center py-6 text-center">
              <div className={`text-6xl font-semibold tracking-[-0.04em] ${getScoreColor(evaluation.overallScore)}`}>
                {evaluation.overallScore}%
              </div>
              <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">
                Your score for this call
              </div>
              {/* Says WHY there is nothing else here. Without this line a
                  score on its own reads as a broken page. */}
              <p className="mt-4 max-w-md text-sm leading-6 text-gray-500">
                The detailed QA breakdown for this call is kept by your trainer. Ask them to walk
                you through it, or read back through the call transcript below.
              </p>
            </div>
          </div>
        )}

        {/* Score Overview */}
        {evaluation && !detailWithheld && (
          <div className={cn('card mb-7 rounded-2xl border border-gray-200/80 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.05)]', scoringInProgress && 'opacity-50')}>
            <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-gray-100 bg-gradient-to-r from-gray-50/90 via-white to-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              {/* One title for every call — see the routing note above. */}
              <h2 className="text-base font-semibold tracking-tight text-gray-900 sm:text-lg">
                {fronterScorecard ? 'Official Fronter scorecard' : 'Your score'}
              </h2>
              <div className="flex items-start gap-5 text-right sm:gap-7">
                {/* The outcome verdict now sits BESIDE the score on every
                    call, instead of replacing it on some of them. */}
                {dispositionHandling && (
                  <div>
                    <div className={`text-xl font-semibold tracking-tight sm:text-2xl ${dispositionHandling.handledCorrectly ? 'text-emerald-600' : 'text-amber-700'}`}>
                      {dispositionHandling.handledCorrectly ? 'Handled well' : 'Needs review'}
                    </div>
                    <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">
                      {dispositionHandling.label ?? dispositionLabel(dispositionHandling.disposition)}
                    </div>
                  </div>
                )}
                <div>
                  <div className={`text-4xl font-semibold tracking-[-0.04em] sm:text-[42px] ${getScoreColor(evaluation.overallScore)}`}>
                    {evaluation.overallScore}%
                  </div>
                  <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">
                    {fronterScorecard
                      ? fronterScorecard.score.rating.replaceAll('_', ' ')
                      : `${scoreBandLabel(evaluation.overallScore, scoreCalibration?.band)} call`}
                  </div>
                </div>
              </div>
            </div>

            {dispositionHandling && (
              <div>
                <p className="mb-3 text-sm leading-6 text-gray-600">{dispositionHandling.reason}</p>
                {dispositionHandling.criteria ? (
                  <p className="mb-5 text-sm leading-6 text-gray-500">
                    <span className="font-semibold text-gray-700">What good handling looks like here: </span>
                    {dispositionHandling.criteria}
                  </p>
                ) : null}
                {/*
                  THE MISS, NAMED. Measured defect: a call whose customer
                  disclosed employer coverage — a disqualifier — was graded
                  NOT_INTERESTED and told the trainee "Handled well". When the
                  three recorded facts disagree, the scorecard now says so in
                  the fronter's own terms instead of congratulating him.
                */}
                {dispositionHandling.mismatches && dispositionHandling.mismatches.length > 0 ? (
                  <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3.5">
                    <div className="mb-1 text-sm font-semibold text-amber-900">Disposition</div>
                    <ul className="list-disc pl-5 text-sm text-amber-900">
                      {dispositionHandling.mismatches.map((line: string, i: number) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    {
                      label: 'Overall handling',
                      passed: dispositionHandling.handledCorrectly,
                      detail: dispositionHandling.handledCorrectly ? 'The outcome was respected.' : 'The outcome or a safety rule was mishandled.',
                    },
                    {
                      label: 'Professional conduct',
                      passed: professionalConductPassed,
                      detail: abusiveLanguage
                        ? 'Directed abuse, a threat, or sexual language was confirmed.'
                        : professionalismIssues > 0
                          ? `${professionalismIssues} professionalism issue${professionalismIssues === 1 ? '' : 's'} found, such as rudeness, slang, or talking down.`
                          : 'No abuse, rudeness, slang, or talking down was found.',
                    },
                    {
                      label: 'Respect after refusal',
                      passed: !pressuredAfterStop,
                      detail: pressuredAfterStop ? 'The agent pressured or continued after a stop request.' : 'No improper pressure after the outcome was found.',
                    },
                    {
                      label: 'Compliance',
                      passed: fronterScorecard.score.gate.applied === 'none',
                      detail: fronterScorecard.score.gate.applied === 'none' ? 'No serious compliance issue was confirmed.' : 'A compliance issue needs review.',
                    },
                  ].map((check) => (
                    <div key={check.label} className={`rounded-xl border px-3.5 py-3.5 transition-all hover:-translate-y-0.5 hover:shadow-sm ${check.passed ? 'border-emerald-100 bg-emerald-50/55' : 'border-amber-100 bg-amber-50/65'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-gray-900">{check.label}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${check.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>
                          {check.passed ? 'Pass' : 'Review'}
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs leading-5 text-gray-600">{check.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Score Bars with Category Insights */}
            {/* Every section, every call. N/A items carry maxScore 0. */}
            <div className="mt-6 space-y-4 rounded-2xl border border-gray-100 bg-gray-50/40 p-4 sm:p-5">
              {scoreSections.map((item: any) => {
                const insights = fronterScorecard ? null : evaluation.rawResponse?.categoryInsights?.[item.key];
                const isApplicable = typeof item.score === 'number';
                return (
                <div key={item.label}>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">{item.label}</span>
                    <span className={`text-sm font-bold ${isApplicable ? getScoreColor(item.score) : 'text-gray-500'}`}>
                      {isApplicable ? `${item.score}%` : 'N/A'}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200/80">
                    <div
                      className={`h-2 rounded-full transition-all duration-500 ${
                        !isApplicable ? 'bg-gray-300' :
                        item.score >= 80 ? 'bg-green-500' :
                        item.score >= 60 ? 'bg-yellow-500' : 'bg-red-500'
                      }`}
                      style={{ width: isApplicable ? `${item.score}%` : '100%' }}
                    />
                  </div>
                  {!isApplicable && (
                    <p className="mt-1 text-xs text-gray-500">
                      Not scored because this call ended before that work became appropriate.
                    </p>
                  )}
                  {insights && (
                    <div className="mt-2 ml-1 space-y-1">
                      <p className="text-xs text-gray-600">
                        <span className="font-semibold text-gray-700">Insight:</span> {insights.insight}
                      </p>
                      <p className="text-xs text-primary-700 bg-primary-50 rounded px-2 py-1 inline-block">
                        <span className="font-semibold">Tip:</span> {insights.tip}
                      </p>
                    </div>
                  )}
                </div>
              );
              })} 
            </div>

            {fronterScorecard ? (
              <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-gray-100 bg-white px-3.5 py-3 shadow-sm">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400">Observable score</div>
                  <div className="text-sm font-semibold text-gray-900">
                    {fronterScorecard.score.rawScore} / {fronterScorecard.score.observableMaxScore}
                  </div>
                </div>
                <div className="rounded-xl border border-gray-100 bg-white px-3.5 py-3 shadow-sm">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400">Important call issue</div>
                  <div className="text-sm font-semibold text-gray-900">
                    {fronterScorecard.score.gate.applied === 'none' ? 'No serious issue found' : 'Needs attention'}
                  </div>
                </div>
                <div className="rounded-xl border border-gray-100 bg-white px-3.5 py-3 shadow-sm">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400">Scorecard version</div>
                  <div className="text-sm font-semibold text-gray-900">{fronterScorecard.meta.evaluationVersion}</div>
                </div>
              </div>
            ) : scoreCalibration && (
              <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-gray-100 bg-white px-3.5 py-3 shadow-sm">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400">How this rates</div>
                  <div className="text-sm font-semibold text-gray-900">
                    {scoreBandLabel(evaluation.overallScore, scoreCalibration.band)}
                  </div>
                </div>
                <div className="rounded-xl border border-gray-100 bg-white px-3.5 py-3 shadow-sm">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400">Adjusted for</div>
                  <div className="text-sm font-semibold text-gray-900">
                    {difficultyLabel(scoreCalibration.difficulty || session?.scenario?.difficulty) }
                  </div>
                </div>
                <div className="rounded-xl border border-gray-100 bg-white px-3.5 py-3 shadow-sm">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400">What we looked at</div>
                  <div className="text-sm font-semibold text-gray-900">
                    Opening, trust, discovery, product, next step
                  </div>
                </div>
              </div>
            )}

            {/* Next Best Action */}
            {!fronterScorecard && evaluation.rawResponse?.nextBestAction && (
              <div className="mt-5 rounded-xl border border-primary-100 bg-primary-50/65 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-white text-primary-600 shadow-sm ring-1 ring-primary-100">
                    <svg className="h-4 w-4 text-primary-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-primary-900">Next Best Action</p>
                    <p className="text-sm text-primary-800 mt-0.5">{evaluation.rawResponse.nextBestAction}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {traineeSummary && !detailWithheld && (
          <section className="mb-7 rounded-2xl border border-amber-100 bg-amber-50/55 px-4 py-4 shadow-sm sm:px-5">
            <h2 className="text-base font-semibold tracking-tight text-amber-950">What to improve</h2>
            <p className="mt-1 text-sm text-amber-900">{traineeSummary.headline}</p>
            {traineeSummary.mistakes?.length > 0 && (
              <ul className="mt-3 space-y-2">
                {traineeSummary.mistakes.map((mistake: string, index: number) => (
                  <li key={`${mistake}-${index}`} className="flex gap-2 text-sm text-amber-950">
                    <span className="mt-0.5 font-semibold" aria-hidden>!</span>
                    <span>{mistake}</span>
                  </li>
                ))}
              </ul>
            )}
            {traineeSummary.nextSteps?.length > 0 && (
              <div className="mt-4 border-t border-amber-200 pt-3">
                <h3 className="text-xs font-semibold uppercase text-amber-800">Practice next</h3>
                <ul className="mt-2 space-y-1.5">
                  {traineeSummary.nextSteps.map((step: string, index: number) => (
                    <li key={`${step}-${index}`} className="text-sm text-amber-950">{step}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {/* Scored from the recorded agent channel. Renders its own
            "not assessed" card when the audio could not be measured, so a
            missing recording explains itself instead of leaving a gap. */}
        {!detailWithheld && (
          <VoiceDelivery
            voice={scoredVoice}
            section={voiceSection}
            accentClassification={accentClassification}
            token={token}
            sessionId={params.id as string}
          />
        )}

        {voiceSummary && !hasScoredVoice && !detailWithheld && (
          <div className="card mb-7 rounded-2xl border border-gray-200/80 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.05)]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold tracking-tight text-gray-900 sm:text-lg">Voice Delivery</h2>
              <span className="text-xs text-gray-500">{voiceSummary.turnCount} measured turns</span>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {/* Pace and long pauses are owned by the scored section above
                  whenever it exists — see the note on `hasScoredVoice`. */}
              {!hasScoredVoice && (
                <div className="rounded-xl border border-gray-100 bg-white px-3.5 py-3 shadow-sm">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400">Pace</div>
                  <div className="text-lg font-semibold tracking-tight text-gray-900">
                    {voiceSummary.avgWpm ? `${voiceSummary.avgWpm} WPM` : 'Unknown'}
                  </div>
                  <div className="text-xs text-gray-500">{voiceSummary.pace}</div>
                </div>
              )}
              <div className="rounded-xl border border-gray-100 bg-white px-3.5 py-3 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400">Energy</div>
                <div className="text-lg font-semibold tracking-tight text-gray-900">{voiceSummary.energy}</div>
                <div className="text-xs text-gray-500">mic level</div>
              </div>
              <div className="rounded-xl border border-gray-100 bg-white px-3.5 py-3 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400">Speech Ratio</div>
                <div className="text-lg font-semibold tracking-tight text-gray-900">{voiceSummary.avgSpeechRatio}%</div>
                <div className="text-xs text-gray-500">voice vs silence</div>
              </div>
              {!hasScoredVoice && (
                <div className="rounded-xl border border-gray-100 bg-white px-3.5 py-3 shadow-sm">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400">Long Pauses</div>
                  <div className="text-lg font-semibold tracking-tight text-gray-900">{voiceSummary.longPauses}</div>
                  <div className="text-xs text-gray-500">700ms+</div>
                </div>
              )}
              <div className="rounded-xl border border-gray-100 bg-white px-3.5 py-3 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400">Clipping</div>
                <div className="text-lg font-semibold tracking-tight text-gray-900">{voiceSummary.clippingTurns}</div>
                <div className="text-xs text-gray-500">loud turns</div>
              </div>
            </div>
            <p className="mt-3 text-sm text-gray-600">
              {hasScoredVoice
                ? 'Recording quality only — a hot mic or heavy clipping can make speech harder to score fairly.'
                : voiceSummary.coachingLine}
            </p>
          </div>
        )}

        {/* Tabs. With the breakdown closed there is only the transcript to
            switch to, so the bar is dropped rather than left with a selected
            tab over an empty pane. */}
        {!detailWithheld && (
        <div className="mb-6 flex w-fit gap-1 rounded-xl border border-gray-200/80 bg-gray-100/80 p-1 shadow-sm">
          <button
            onClick={() => setActiveTab('evaluation')}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${
              activeTab === 'evaluation' ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200/70' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            Your score
          </button>
          <button
            onClick={() => setActiveTab('transcript')}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${
              activeTab === 'transcript' ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200/70' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            Call transcript
          </button>
          {coachingTips.length > 0 && !detailWithheld && (
            <button
              onClick={() => setActiveTab('coaching')}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                activeTab === 'coaching' ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200/70' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              Coaching tips
            </button>
          )}
        </div>
        )}

        {activeTab === 'evaluation' && evaluation && !detailWithheld && (<>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* Strengths */}
            <div className="card rounded-2xl border border-gray-200/80 bg-white shadow-sm transition-shadow hover:shadow-md">
              <h3 className="text-sm font-semibold text-green-700 mb-3 flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-green-500" />
                Strengths
              </h3>
              <ul className="space-y-2">
                {evaluation.strengths?.map((s: string, i: number) => (
                  <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                    <span className="text-green-500 mt-0.5">+</span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>

            {/* Weaknesses */}
            <div className="card rounded-2xl border border-gray-200/80 bg-white shadow-sm transition-shadow hover:shadow-md">
              <h3 className="text-sm font-semibold text-red-700 mb-3 flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-red-500" />
                Areas for Improvement
              </h3>
              <ul className="space-y-2">
                {evaluation.weaknesses?.map((w: string, i: number) => (
                  <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                    <span className="text-red-500 mt-0.5">-</span>
                    {w}
                  </li>
                ))}
              </ul>
            </div>

            {/* Suggestions */}
            <div className="card rounded-2xl border border-gray-200/80 bg-white shadow-sm transition-shadow hover:shadow-md">
              <h3 className="text-sm font-semibold text-blue-700 mb-3 flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-blue-500" />
                Suggestions
              </h3>
              <ul className="space-y-2">
                {evaluation.suggestions?.map((s: string, i: number) => (
                  <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                    <span className="text-blue-500 mt-0.5">&bull;</span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>

            {/* Summary */}
            <div className="card rounded-2xl border border-gray-200/80 bg-white shadow-sm md:col-span-3">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Summary</h3>
              <p className="whitespace-pre-line text-gray-600">{reportSummary}</p>
            </div>
          </div>

          {fronterScorecard && (
            <section className="mt-8">
              <details className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-sm">
                <summary className="cursor-pointer bg-gray-50/70 px-4 py-3.5 text-base font-semibold text-gray-900 transition-colors hover:bg-gray-100">
                  Scorecard evidence
                </summary>
                <div className="border-t border-gray-200 p-4">
                  {fronterScorecard.score.gate.applied !== 'none' && (
                    <div className="mb-4 border-l-4 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-900">
                      Compliance gate: {fronterScorecard.score.gate.applied.replaceAll('_', ' ')}. {[
                        ...fronterScorecard.score.gate.confirmedCritical,
                        ...fronterScorecard.score.gate.confirmedMajor,
                      ].join(', ')}
                    </div>
                  )}
                  <div className="divide-y divide-gray-200 border-y border-gray-200">
                    {fronterScorecard.score.sections.map((section: any) => (
                      <details key={section.sectionId} className="group py-3">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-gray-800">
                          <span>{section.title}</span>
                          <span>{section.maxScore > 0 ? `${section.score} / ${section.maxScore}` : 'N/A'}</span>
                        </summary>
                        <div className="mt-3 space-y-3">
                          {section.kpis.map((kpi: any) => (
                            <div key={kpi.kpiId} className="border-l-2 border-gray-200 pl-3">
                              <div className="flex items-center justify-between text-sm font-medium text-gray-700">
                                <span>{kpi.title}</span><span>{kpi.maxScore > 0 ? `${kpi.score} / ${kpi.maxScore}` : 'N/A'}</span>
                              </div>
                              <div className="mt-2 space-y-2">
                                {kpi.subChecks.map((check: any) => (
                                  <div key={check.subCheckId} className="text-xs text-gray-600">
                                    <div className="flex justify-between gap-4"><span>{check.subCheckId.replaceAll('_', ' ')}</span><span>{check.maxScore > 0 ? `${check.score} / ${check.maxScore}` : 'N/A'}</span></div>
                                    <p className="mt-0.5">{check.reason}</p>
                                    {check.evidence?.length > 0 && <p className="mt-0.5 text-gray-500">Evidence: {check.evidence.join(' | ')}</p>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                          </div>
                      </details>
                    ))}
                  </div>
                </div>
              </details>
            </section>
          )}

          {/* Model Responses — "What a top performer would say" */}
          {enrichedData?.modelResponses?.length > 0 && (
            <div className="mt-8">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <svg className="h-5 w-5 text-purple-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342" />
                </svg>
                What a Top Performer Would Say
              </h2>
              <div className="space-y-4">
                {enrichedData.modelResponses.map((mr: any, i: number) => (
                  <div key={i} className="card rounded-2xl border border-gray-200/80 border-l-4 border-l-purple-400 bg-white shadow-sm">
                    <div className="text-xs font-medium text-purple-600 mb-2 uppercase">{mr.category}</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="rounded-xl border border-red-100 bg-red-50/55 p-3.5">
                        <div className="text-xs font-semibold text-red-700 mb-1">You said:</div>
                        <p className="text-sm text-red-900">{mr.agentSaid}</p>
                      </div>
                      <div className="rounded-xl border border-emerald-100 bg-emerald-50/55 p-3.5">
                        <div className="text-xs font-semibold text-green-700 mb-1">Top performer would say:</div>
                        <p className="text-sm text-green-900">{mr.idealResponse}</p>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-2 italic">{mr.explanation}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>)}

        {/* No score yet.
         *
         * This used to be four hand-written branches whose wording drifted
         * apart ("Evaluation Queued", "Evaluating...", "Evaluation Failed",
         * "Evaluation is being processed"). It is now one panel driven by
         * `evaluationStatusCopy`, so every state is phrased the same way and
         * every state offers the trainee something to do. */}
        {activeTab === 'evaluation' && !evaluation && (() => {
          const copy = evaluationStatusCopy(evalStatus);
          const needsAction = copy.tone === 'bad';

          const inProgress = PENDING_STATUSES.includes(evalStatus);
          const elapsed = `${Math.floor(pendingElapsedS / 60)}:${String(pendingElapsedS % 60).padStart(2, '0')}`;

          return (
            <div className="card rounded-2xl border border-gray-200/80 bg-white py-12 text-center shadow-sm" role="status" aria-live="polite" data-testid="evaluation-progress">
              {/* A visible spinner while the score is being produced: the
                * pulsing dot read as "nothing is happening" during a two- to
                * three-minute re-evaluation. */}
              {inProgress && (
                <div className="mb-4 flex justify-center">
                  <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-blue-600 border-t-transparent" aria-hidden />
                </div>
              )}
              <div className={cn('mb-2 inline-flex items-center gap-2', needsAction ? 'text-red-600' : 'text-blue-600')}>
                {!inProgress && (
                  <span
                    className={cn('h-3 w-3 rounded-full', needsAction ? 'bg-red-500' : 'bg-blue-500 animate-pulse')}
                    aria-hidden
                  />
                )}
                <span className="font-medium">{copy.title}</span>
              </div>

              <p className="mx-auto max-w-md text-gray-500">{copy.body}</p>
              {inProgress && (
                <p className="mx-auto mt-2 max-w-md text-xs text-gray-400">
                  {evalStatus === 'processing' ? 'Scoring now' : 'Waiting for a scoring slot'} · {elapsed} elapsed
                </p>
              )}

              {/* WHY IT FAILED, WHEN THERE IS A WHY.
                * `lastError` is the evaluator's own reason, carried by
                * /api/evaluations/session/:id/status. It was fetched into
                * state on four paths and never rendered, so a trainee whose
                * call would not score was told only that something went wrong,
                * and their trainer had nothing to relay. Shown only alongside
                * the retry, and kept visually quiet: it is a diagnostic, not
                * the headline. */}
              {needsAction && evalError && (
                <p className="mx-auto mt-3 max-w-md break-words font-mono text-[11px] leading-relaxed text-gray-400">
                  {evalError}
                </p>
              )}

              {needsAction ? (
                <button
                  onClick={() => void queueEvaluation(false)}
                  disabled={retrying}
                  className="btn-primary mt-5"
                >
                  {retrying ? 'Starting…' : 'Score this call'}
                </button>
              ) : PENDING_STATUSES.includes(evalStatus) ? (
                // The page is polling, so there is nothing to press. Saying so
                // is the point: the old button implied the score would not
                // arrive unless the trainee did something.
                <p className="mt-5 text-sm text-gray-500">
                  This page updates on its own — no need to refresh.
                </p>
              ) : (
                // 'unknown' and 'not_started' are not polled: nothing is coming
                // that we know about, so a manual check is all that is left.
                <button onClick={() => window.location.reload()} className="btn-secondary mt-5">
                  Check again
                </button>
              )}
            </div>
          );
        })()}

        {/* Enriched data status */}
        {evaluation && enrichedStatus === 'generating' && !enrichedData && !detailWithheld && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-sm text-blue-700">
            <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
            We&apos;re still preparing your detailed feedback. Check back in a moment.
          </div>
        )}

        {(activeTab === 'transcript' || detailWithheld) && (
          <div className="card rounded-2xl border border-gray-200/80 bg-white shadow-sm transition-shadow hover:shadow-md">
            <div className="custom-scrollbar max-h-[600px] space-y-4 overflow-y-auto pr-1">
              {transcript.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No messages in this session.</p>
              ) : (
                transcript.map((msg: any, i: number) => {
                  // Find annotations for this message
                  const annotations = enrichedData?.transcriptAnnotations?.filter(
                    (a: any) => a.messageIndex === i
                  ) || [];

                  const annotationColors: Record<string, string> = {
                    great_move: 'border-green-400 bg-green-50',
                    good_recovery: 'border-green-400 bg-green-50',
                    missed_opportunity: 'border-amber-400 bg-amber-50',
                    lost_customer: 'border-red-400 bg-red-50',
                    key_moment: 'border-blue-400 bg-blue-50',
                  };

                  const annotationIcons: Record<string, string> = {
                    great_move: 'text-green-600',
                    good_recovery: 'text-green-600',
                    missed_opportunity: 'text-amber-600',
                    lost_customer: 'text-red-600',
                    key_moment: 'text-blue-600',
                  };

                  return (
                    <div key={msg.id || i}>
                      <div className={`flex ${msg.role === 'AGENT' ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={cn(
                            'max-w-[72%] rounded-2xl px-4 py-3 shadow-sm',
                            msg.role === 'AGENT'
                              ? 'bg-primary-600 text-white rounded-br-md'
                              : msg.role === 'SYSTEM'
                              ? 'bg-gray-200 text-gray-600 italic'
                              : 'bg-gray-50 text-gray-900 rounded-bl-md ring-1 ring-gray-200',
                            annotations.length > 0 ? 'ring-2 ring-offset-1 ring-opacity-60' : '',
                            annotations.length > 0 && annotations[0].annotationType === 'great_move' ? 'ring-green-400' :
                            annotations.length > 0 && annotations[0].annotationType === 'good_recovery' ? 'ring-green-400' :
                            annotations.length > 0 && annotations[0].annotationType === 'missed_opportunity' ? 'ring-amber-400' :
                            annotations.length > 0 && annotations[0].annotationType === 'lost_customer' ? 'ring-red-400' :
                            annotations.length > 0 ? 'ring-blue-400' : ''
                          )}
                        >
                          <div className="text-xs font-medium mb-1 opacity-70">
                            {msg.role === 'AGENT' ? 'Agent' : msg.role === 'CUSTOMER' ? 'Customer' : 'System'}
                          </div>
                          <p className="text-sm">{msg.content}</p>
                        </div>
                      </div>
                      {/* Annotations */}
                      {annotations.map((ann: any, j: number) => (
                        <div
                          key={j}
                          className={cn(
                            'mx-8 mt-1 mb-2 rounded-lg px-3 py-2 text-xs border-l-3',
                            annotationColors[ann.annotationType] || 'border-gray-400 bg-gray-50'
                          )}
                        >
                          <span className={cn('font-bold', annotationIcons[ann.annotationType] || 'text-gray-600')}>
                            {ann.label}
                          </span>
                          <span className="text-gray-600 ml-2">{ann.explanation}</span>
                        </div>
                      ))}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Coaching Tips Tab */}
        {activeTab === 'coaching' && (
          <div className="card rounded-2xl border border-gray-200/80 bg-white shadow-sm transition-shadow hover:shadow-md">
            <div className="space-y-3">
              {coachingTips.map((tip: any, i: number) => (
                <div
                  key={i}
                  className={cn(
                    'rounded-xl border px-4 py-3.5 shadow-sm',
                    tip.priority === 'high'
                      ? 'border-red-100 bg-red-50/55'
                      : tip.priority === 'medium'
                      ? 'border-amber-100 bg-amber-50/55'
                      : 'border-emerald-100 bg-emerald-50/55'
                  )}
                >
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-700 uppercase">{tip.tipType}</span>
                    <span className="text-xs text-gray-400">Turn {tip.turnNumber}</span>
                  </div>
                  <p className="text-sm text-gray-800">{tip.content}</p>
                </div>
              ))}
              {coachingTips.length === 0 && (
                <p className="text-gray-500 text-center py-8">No coaching tips were generated for this session.</p>
              )}
            </div>
          </div>
        )}
      </main>
    </TrainingFloorShell>
  );
}
