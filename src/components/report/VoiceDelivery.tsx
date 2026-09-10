'use client';

/**
 * Voice Delivery — the scored audio section of the report.
 * ────────────────────────────────────────────────────────
 *
 * Reads `fronterScorecard.voice`, which the backend fills from the agent's own
 * audio channel: Azure supplies pronunciation, fluency and prosody; pace,
 * pauses, fillers, talk/listen and interruptions are computed from word
 * timings. Points are already assigned by the backend — nothing here scores
 * anything, it only renders what came back.
 *
 * Azure pronunciation remains a clarity/intelligibility measure. The separate
 * US Accent Match score is supplied by the backend from Modulate time-series
 * windows; this component never calculates either score.
 *
 * ── WHY THE WORD LIST CARRIES NO POINTS ───────────────────────────────────
 *
 * The Pronunciation sub-check already scores the call-level aggregate. The
 * per-word list is the EXPLANATION behind that number, so an agent can see
 * which words cost them the mark instead of being told "82/100" and left to
 * guess. Scoring the words as well would count the same evidence twice.
 */

import { useEffect, useRef, useState } from 'react';
import { evaluations, pronunciation } from '@/lib/api';

interface PhonemeIssue {
  ipa: string;
  description: string;
  accuracy: number;
}

interface WordIssue {
  word: string;
  referenceIpa?: string;
  rawAccuracy: number;
  adjustedAccuracy: number;
  wrongPercent: number;
  errorType: string;
  atMs: number;
  durationMs: number;
  turnId: number | null;
  worstPhonemes: PhonemeIssue[];
  shouldSound: string;
  coaching: string;
}

interface SoundPattern {
  ipa: string;
  description: string;
  wordCount: number;
  averageAccuracy: number;
  examples: string[];
}

export interface VoiceAnalysis {
  applicable: boolean;
  reason: string | null;
  azure: {
    accuracy: number;
    fluency: number;
    prosody: number;
    pronunciation: number;
    completeness: number;
  } | null;
  strictness?: {
    profile: string;
    label: string;
    scores: {
      accuracy: number;
      fluency: number;
      prosody: number;
      pronunciation: number;
      completeness: number;
    };
  } | null;
  pace: { wordsPerMinute: number | null; wordCount: number; speakingSeconds: number; spanSeconds: number } | null;
  pauses: { longPauseCount: number; longestPauseMs: number; totalPauseMs: number } | null;
  fillers: { count: number; perMinute: number | null; occurrences: Array<{ word: string; atMs: number }> } | null;
  talkListen: { agentSpeakingSeconds: number; customerSpeakingSeconds: number; agentTalkRatio: number | null } | null;
  interruptions: { count: number; occurrences: Array<{ atMs: number; overlapMs: number }> } | null;
  behavior?: {
    applicable: boolean;
    findings: Array<{
      kind: string;
      startMs: number;
      endMs: number;
      turnId: number | null;
      confidence: 'medium' | 'high';
      signals: string[];
      coaching: string;
    }>;
  } | null;
  wordIssues: WordIssue[];
  soundPatterns: SoundPattern[];
  audioDurationSeconds: number;
  locale: string;
}

interface ScoredSubCheck {
  subCheckId: string;
  score: number;
  maxScore: number;
  observed: unknown;
  reason: string;
}

interface ScoredKpi {
  kpiId: string;
  title: string;
  score: number;
  maxScore: number;
  subChecks: ScoredSubCheck[];
}

interface ScoredSection {
  sectionId: string;
  title: string;
  score: number;
  maxScore: number;
  kpis: ScoredKpi[];
}

export interface AccentClassification {
  overallAccent?: string;
  /** Backward-compatible read for evaluations saved before Phase 1. */
  accent?: string;
  usAccentMatch?: number | null;
  accentBreakdown?: Record<string, number> | null;
  time_series?: Array<{ start_ms: number; duration_ms: number; accent: string }>;
}

/** Human wording for the five scored sub-checks and their enum values. */
const SUB_CHECK_LABELS: Record<string, string> = {
  pronunciation_clarity: 'Pronunciation clarity',
  speech_fluency: 'Fluency',
  speech_prosody: 'Natural delivery',
  speech_pacing: 'Pacing',
  us_accent_match: 'US accent match',
};

const VALUE_LABELS: Record<string, string> = {
  clear: 'Clear',
  mostly_clear: 'Mostly clear',
  sometimes_unclear: 'Sometimes unclear',
  hard_to_follow: 'Hard to follow',
  smooth: 'Smooth',
  mostly_smooth: 'Mostly smooth',
  halting: 'Halting',
  natural: 'Natural',
  acceptable: 'Acceptable',
  flat: 'Flat',
  comfortable: 'Comfortable',
  too_fast: 'Too fast',
  too_slow: 'Too slow',
  '85_100': '85–100%',
  '70_84_9': '70–84.9%',
  '50_69_9': '50–69.9%',
  '30_49_9': '30–49.9%',
  // Scorecard v11 subdivided the old flat zero; every band needs its wording.
  '20_29_9': '20–29.9%',
  '10_19_9': '10–19.9%',
  '5_9_9': '5–9.9%',
  below_5: 'Below 5%',
  below_30: 'Below 30%',
  'n/a': 'Not assessed',
};

/**
 * The fillers actually counted, most frequent first — "yeah x4 · actually x2".
 *
 * The count alone invites "which words?", and a metric a reader cannot check
 * is one they stop believing. Ordinary words are only counted in filler
 * POSITIONS (see computeFillers on the backend), so naming them is what makes
 * the number auditable rather than assertive.
 */
function fillerSummary(fillers: { occurrences?: Array<{ word: string }> } | null | undefined): string | null {
  const occurrences = fillers?.occurrences ?? [];
  if (occurrences.length === 0) return null;
  const counts = new Map<string, number>();
  for (const item of occurrences) counts.set(item.word, (counts.get(item.word) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([word, n]) => (n > 1 ? `${word} \u00d7${n}` : word))
    .join(' \u00b7 ');
}

/** mm:ss from a millisecond offset into the recording. */
function timestamp(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function scoreTone(score: number, maxScore: number): string {
  if (maxScore <= 0) return 'text-gray-400';
  const ratio = score / maxScore;
  if (ratio >= 0.8) return 'text-green-600';
  if (ratio >= 0.5) return 'text-amber-600';
  return 'text-red-600';
}

function accentLabel(label: string): string {
  return label.replaceAll('_', ' ');
}

/** Modulate observations; all scoring arrives precomputed by the backend. */
function AccentCoaching({ analysis }: { analysis: AccentClassification | null | undefined }) {
  const overallAccent = analysis?.overallAccent ?? analysis?.accent;
  if (!overallAccent) return null;

  const match = typeof analysis?.usAccentMatch === 'number'
    ? `${analysis.usAccentMatch.toFixed(1)}%`
    : 'N/A';
  const breakdown = analysis?.accentBreakdown
    ? Object.entries(analysis.accentBreakdown)
    : [];

  return (
    <div className="mt-5 border-t border-gray-200 pt-4">
      <h3 className="text-sm font-semibold text-gray-800">Accent analysis</h3>
      <p className="mt-0.5 text-xs text-gray-500">
        US Accent Match uses American-labelled windows for 2 Voice Delivery points. Overall accent and the breakdown remain coaching details.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-gray-50 px-3 py-2">
          <div className="text-xs font-semibold uppercase text-gray-500">Overall accent</div>
          <div className="font-bold text-gray-900">{accentLabel(overallAccent)}</div>
        </div>
        <div className="rounded-lg bg-gray-50 px-3 py-2">
          <div className="text-xs font-semibold uppercase text-gray-500">Target accent</div>
          <div className="font-bold text-gray-900">American</div>
        </div>
        <div className="rounded-lg bg-gray-50 px-3 py-2">
          <div className="text-xs font-semibold uppercase text-gray-500">US accent match</div>
          <div className="font-bold text-gray-900">{match}</div>
          <div className="text-xs text-gray-500">American-labelled windows</div>
        </div>
      </div>
      {breakdown.length > 0 && (
        <p className="mt-2 text-xs text-gray-500">
          Window breakdown:{' '}
          {breakdown.map(([label, percent]) => `${accentLabel(label)} ${percent.toFixed(1)}%`).join(' · ')}
        </p>
      )}
    </div>
  );
}

/**
 * A wrong-percentage bar. Wider and redder means further off.
 *
 * `wrongPercent` rather than accuracy because the list is a list of PROBLEMS:
 * "42% off" states the size of the gap the agent has to close, where "58%
 * accurate" invites reading a low number as a grade of the person.
 */
function WrongBar({ percent }: { percent: number }) {
  const width = Math.max(4, Math.min(100, percent));
  const tone = percent >= 60 ? 'bg-red-500' : percent >= 40 ? 'bg-amber-500' : 'bg-yellow-400';
  return (
    <div className="h-1.5 w-full rounded-full bg-gray-100">
      <div className={`h-1.5 rounded-full ${tone}`} style={{ width: `${width}%` }} />
    </div>
  );
}

export function VoiceDelivery({
  voice,
  section,
  accentClassification,
  token,
  sessionId,
}: {
  voice: VoiceAnalysis | null | undefined;
  section: ScoredSection | null | undefined;
  accentClassification?: AccentClassification | null;
  token?: string | null;
  sessionId?: string | null;
}) {
  /**
   * OPEN BY DEFAULT.
   *
   * The per-word list is the most actionable thing on this page — which word,
   * how far off, how to say it, and the two playback buttons. Collapsed, it
   * rendered as a thin grey bar that reads as an empty section, and the
   * feature was reported as missing while the data was present all along.
   * Still collapsible; it just no longer hides itself.
   */
  const [wordsOpen, setWordsOpen] = useState(true);
  const [showAllWords, setShowAllWords] = useState(false);
  const [playingClip, setPlayingClip] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => {
    audioRef.current?.pause();
    audioRef.current = null;
  }, []);

  async function playClip(key: string, load: () => Promise<string>): Promise<void> {
    setPlaybackError(null);
    setPlayingClip(key);
    try {
      const src = await load();
      audioRef.current?.pause();
      const audio = new Audio();
      audioRef.current = audio;
      audio.onerror = () => {
        setPlayingClip(null);
        const code = audio.error?.code;
        setPlaybackError(code ? `Could not play this audio clip (media error ${code}).` : 'Could not play this audio clip.');
      };
      audio.onended = () => setPlayingClip(null);
      audio.src = src;
      audio.load();
      await new Promise<void>((resolve, reject) => {
        if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
          resolve();
          return;
        }
        const onReady = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error('The browser could not decode the audio response.'));
        };
        const cleanup = () => {
          audio.removeEventListener('canplay', onReady);
          audio.removeEventListener('error', onError);
        };
        audio.addEventListener('canplay', onReady, { once: true });
        audio.addEventListener('error', onError, { once: true });
      });
      await audio.play();
    } catch (error) {
      setPlayingClip(null);
      setPlaybackError((error as Error).message || 'Could not play this audio clip.');
    }
  }

  // Nothing measured and nothing scored — render nothing rather than an empty
  // card. An evaluation from before this feature existed has neither.
  if (!voice && !section && !accentClassification) return null;

  const subChecks = (section?.kpis ?? []).flatMap((kpi) => kpi.subChecks);
  const notAssessed = !voice?.applicable || !voice?.azure;
  const accentScore = subChecks.find((check) => check.subCheckId === 'us_accent_match');

  /**
   * A call with no usable audio says WHY.
   *
   * The backend already removed these 8 points from the denominator, so the
   * agent was not marked down — but a silent blank reads as a failure, and
   * this is the one place that can say "the recorder, not you".
   */
  if (notAssessed) {
    return (
      <div className="card mb-8">
        <div className="mb-2 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">Voice Delivery</h2>
          {section && section.maxScore > 0 ? (
            <div className={`shrink-0 text-2xl font-bold ${scoreTone(section.score, section.maxScore)}`}>
              {section.score}
              <span className="text-sm font-medium text-gray-400"> / {section.maxScore}</span>
            </div>
          ) : (
            <span className="text-xs font-medium text-gray-500">Not assessed</span>
          )}
        </div>
        <p className="text-sm text-gray-600">
          Azure delivery measurements were unavailable, so those checks were left out of the applicable maximum.
        </p>
        {accentScore && (
          <div className="mt-4 max-w-xs rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <div className="text-xs font-semibold uppercase text-gray-500">US accent match</div>
            <div className="mt-0.5 text-lg font-bold text-gray-900">
              {VALUE_LABELS[String(accentScore.observed)] ?? 'Not assessed'}
            </div>
            <div className={`text-xs font-medium ${scoreTone(accentScore.score, accentScore.maxScore)}`}>
              {accentScore.maxScore > 0 ? `${accentScore.score} / ${accentScore.maxScore} pts` : 'Not assessed'}
            </div>
          </div>
        )}
        <AccentCoaching analysis={accentClassification} />
      </div>
    );
  }

  const azure = voice!.azure!;
  const marked = voice!.strictness?.scores ?? azure;
  const pace = voice!.pace;
  const words = voice!.wordIssues ?? [];
  const patterns = voice!.soundPatterns ?? [];
  const visibleWords = showAllWords ? words : words.slice(0, 5);
  const talkRatio = voice!.talkListen?.agentTalkRatio;
  const behaviorFindings = voice!.behavior?.findings ?? [];

  return (
    <div className="card mb-8">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Voice Delivery</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            Measured from your side of the call only — how clearly you would be understood.
          </p>
        </div>
        {section && section.maxScore > 0 && (
          <div className={`shrink-0 text-2xl font-bold ${scoreTone(section.score, section.maxScore)}`}>
            {section.score}
            <span className="text-sm font-medium text-gray-400"> / {section.maxScore}</span>
          </div>
        )}
      </div>

      {/* ── The five scored sub-checks ── */}
      {subChecks.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
          {subChecks.map((check) => {
            // A boolean check ("kept an appropriate voice", evidence by absence)
            // rendered as a dash: `true` is not a string. Say what was found.
            const observed = typeof check.observed === 'string' ? check.observed
              : check.observed === true ? (check.maxScore > 0 && check.score >= check.maxScore ? 'No issues found' : 'Yes')
              : check.observed === false ? 'Needs attention'
              : '';
            return (
              <div key={check.subCheckId} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <div className="text-xs font-semibold uppercase text-gray-500">
                  {SUB_CHECK_LABELS[check.subCheckId] ?? check.subCheckId.replaceAll('_', ' ')}
                </div>
                <div className="mt-0.5 text-lg font-bold text-gray-900">
                  {VALUE_LABELS[observed] ?? (observed || '—')}
                </div>
                <div className={`text-xs font-medium ${scoreTone(check.score, check.maxScore)}`}>
                  {check.maxScore > 0 ? `${check.score} / ${check.maxScore} pts` : 'Not assessed'}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Measurements that carry no points ── */}
      {/* Incomplete calls have voice coaching but intentionally have no voice
          points. Show Azure's observations without inventing a frontend score. */}
      {subChecks.length === 0 && (
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            ['Pronunciation clarity', marked.pronunciation],
            ['Fluency', marked.fluency],
            ['Natural delivery', marked.prosody],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <div className="text-xs font-semibold uppercase text-gray-500">{label}</div>
              <div className="mt-0.5 text-lg font-bold text-gray-900">{value} / 100</div>
              <div className="text-xs font-medium text-gray-500">Coaching only</div>
            </div>
          ))}
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
        <div>
          <div className="text-xs font-semibold uppercase text-gray-500">Speaking rate</div>
          <div className="font-bold text-gray-900">{pace?.wordsPerMinute ? `${pace.wordsPerMinute} wpm` : '—'}</div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase text-gray-500">Long pauses</div>
          <div className="font-bold text-gray-900">{voice!.pauses?.longPauseCount ?? '—'}</div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase text-gray-500">Filler words</div>
          <div className="font-bold text-gray-900">{voice!.fillers?.count ?? '—'}</div>
          {fillerSummary(voice!.fillers) && (
            <div className="mt-0.5 text-[11px] leading-tight text-gray-500">{fillerSummary(voice!.fillers)}</div>
          )}
        </div>
        <div>
          <div className="text-xs font-semibold uppercase text-gray-500">You talked</div>
          <div className="font-bold text-gray-900">
            {typeof talkRatio === 'number' ? `${Math.round(talkRatio * 100)}%` : '—'}
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase text-gray-500">Talked over</div>
          <div className="font-bold text-gray-900">{voice!.interruptions?.count ?? '—'}</div>
        </div>
      </div>
      <p className="mb-5 text-xs text-gray-500">
        These five are shown for coaching and carry no points.{' '}
        {/* The strictness PROFILE NAME is deliberately not shown. It is an
            internal marking setting shared with the pronunciation-practice
            module, and a word like "Exam" reads on a call report as a claim
            about the kind of assessment rather than a label for the number.
            Both figures are still printed, so nothing is hidden. */}
        {voice!.strictness
          ? `Adjusted marks: pronunciation ${marked.pronunciation}, fluency ${marked.fluency}, prosody ${marked.prosody}. Azure raw: ${azure.pronunciation}, ${azure.fluency}, ${azure.prosody}.`
          : `Azure scores: pronunciation ${azure.pronunciation}, fluency ${azure.fluency}, prosody ${azure.prosody} (out of 100).`}
      </p>

      {behaviorFindings.length > 0 && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <h3 className="text-sm font-semibold text-amber-950">Voice behavior to review</h3>
          <p className="mt-0.5 text-xs text-amber-800">
            These are sustained measurements from your recorded audio, not guesses from the transcript.
          </p>
          <div className="mt-3 space-y-2">
            {behaviorFindings.map((finding, index) => (
              <div key={`${finding.kind}-${finding.startMs}-${index}`} className="rounded-md border border-amber-200 bg-white px-3 py-2 text-xs text-gray-700">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold text-gray-900">{finding.kind.replaceAll('_', ' ')}</span>
                  <span className="text-gray-500">{timestamp(finding.startMs)}–{timestamp(finding.endMs)} · {finding.confidence} confidence</span>
                </div>
                <p className="mt-1">{finding.coaching}</p>
                {finding.signals.length > 0 && <p className="mt-1 text-gray-500">{finding.signals.join(' ')}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      <AccentCoaching analysis={accentClassification} />

      {/* ── Per-word coaching ── */}
      {words.length > 0 && (
        <div className="mb-5 overflow-hidden rounded-lg border border-gray-200">
          <button
            type="button"
            aria-expanded={wordsOpen}
            onClick={() => setWordsOpen((open) => !open)}
            className="flex w-full items-center justify-between gap-3 bg-gray-50 px-3 py-3 text-left hover:bg-gray-100"
          >
            <span className="text-sm font-semibold text-gray-800">Words to work on</span>
            <span className="flex items-center gap-2 text-xs font-medium text-gray-500">
              {words.length} {words.length === 1 ? 'word' : 'words'}
              <svg
                className={`h-4 w-4 transition-transform ${wordsOpen ? 'rotate-180' : ''}`}
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path fillRule="evenodd" d="M5.22 7.47a.75.75 0 0 1 1.06 0L10 11.19l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 8.53a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
              </svg>
            </span>
          </button>
          {wordsOpen && (
            <div className="border-t border-gray-200 p-3">
              <div className="space-y-3">
            {visibleWords.map((issue, index) => (
              <div key={`${issue.word}-${issue.atMs}-${index}`} className="rounded-lg border border-gray-200 px-3 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold text-gray-900">&ldquo;{issue.word}&rdquo;</span>
                  <span className="shrink-0 text-xs font-medium text-gray-500">
                    {issue.wrongPercent}% off
                    {issue.turnId !== null && <> &middot; turn {issue.turnId}</>}
                    {' '}&middot; {timestamp(issue.atMs)}
                  </span>
                </div>
                <div className="mt-1.5"><WrongBar percent={issue.wrongPercent} /></div>
                {issue.worstPhonemes.length > 0 && (
                  <p className="mt-1.5 text-xs text-gray-600">
                    The {issue.worstPhonemes[0].description} sound came out unclear.
                  </p>
                )}
                {issue.shouldSound && (
                  <p className="mt-0.5 text-xs text-gray-600">
                    Say it: <span className="font-mono font-semibold text-gray-800">{issue.shouldSound}</span>
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!token || playingClip === `reference-${issue.atMs}`}
                    onClick={() => void playClip(
                      `reference-${issue.atMs}`,
                      () => pronunciation.audio(token!, issue.word, {
                        ipa: issue.referenceIpa || undefined,
                      }),
                    )}
                    className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:border-primary-400 hover:text-primary-700 disabled:opacity-50"
                  >
                    {playingClip === `reference-${issue.atMs}` ? 'Playing…' : 'Hear correct'}
                  </button>
                  <button
                    type="button"
                    disabled={!token || !sessionId || playingClip === `agent-${issue.atMs}`}
                    onClick={() => void playClip(
                      `agent-${issue.atMs}`,
                      () => evaluations.voiceWordAudio(
                        token!,
                        sessionId!,
                        issue.atMs,
                        issue.durationMs,
                      ),
                    )}
                    className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:border-primary-400 hover:text-primary-700 disabled:opacity-50"
                  >
                    {playingClip === `agent-${issue.atMs}` ? 'Playing…' : 'Hear your voice'}
                  </button>
                </div>
              </div>
            ))}
              </div>
              {playbackError && <p className="mt-2 text-xs text-red-600">{playbackError}</p>}
              {words.length > 5 && (
                <button
                  type="button"
                  onClick={() => setShowAllWords((open) => !open)}
                  className="mt-2 text-xs font-semibold text-gray-600 underline"
                >
                  {showAllWords ? 'Show fewer' : `Show all ${words.length} words`}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Sound patterns: one lesson, not fourteen problems ── */}
      {patterns.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-gray-800">Sounds to practise</h3>
          <p className="mb-2 text-xs text-gray-500">
            The same sound was unclear across several different words — practising the sound fixes all of them at once.
          </p>
          <div className="space-y-2">
            {patterns.map((pattern) => (
              <div key={pattern.ipa} className="rounded-lg bg-gray-50 px-3 py-2 text-xs">
                <span className="font-semibold text-gray-800">{pattern.description}</span>
                <span className="text-gray-500">
                  {' '}&mdash; unclear in {pattern.wordCount} words: {pattern.examples.join(', ')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
