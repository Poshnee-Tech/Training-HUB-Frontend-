'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import TrainingFloorShell from '@/components/layout/TrainingFloorShell';
import { useAuthStore } from '@/store/auth.store';
import { useQueueStore } from '@/store/queue.store';
import { sessions, evaluations } from '@/lib/api';
import { formatDuration, getCampaignColor, getDifficultyColor } from '@/lib/utils';

// Backend evaluation status names — keep these EXACT, they are the contract
// from /api/evaluations/session/:id/status. See evaluations.controller.ts.
type EvalStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'missing'
  | 'not_started'
  | 'unknown';

interface Row {
  sessionId: string;
  loaded: boolean;
  loadError?: string;
  scenarioName?: string;
  campaign?: string;
  difficulty?: string;
  personaName?: string;
  durationSeconds?: number;
  evalStatus: EvalStatus;
  overallScore?: number | null;
  lastError?: string | null;
  scoreFetchAttempted?: boolean;       // true once we've tried evaluations.get to plug a missing score
  pollGiveUp?: boolean;                // true after the poll cap; treated as terminal in the UI
  lastPollError?: string | null;       // last error from a rejected status() poll (for tooltip)
}

// Only states the worker is actively going to transition out of are "pending".
// `unknown` and `not_started` are terminal "we don't know" / "nothing scheduled"
// states — polling them indefinitely accomplishes nothing.
const PENDING_STATUSES: EvalStatus[] = ['queued', 'processing'];

// Belt-and-suspenders cap: if a `processing` job genuinely never resolves
// (worker died, etc.) stop polling after ~2 minutes so the page doesn't
// hammer the API forever. The trainee can still open the report directly.
const MAX_POLL_ATTEMPTS = 30; // 30 × 4s = 120s
const POLL_INTERVAL_MS = 4000;

function isPending(row: Row): boolean {
  if (row.pollGiveUp) return false;
  if (PENDING_STATUSES.includes(row.evalStatus)) return true;
  // Re-enter the bounded retry path when an earlier status() call failed —
  // covers the initial-load transient failure that would otherwise leave the
  // row stuck on `unknown` forever with no UX signal that anything was wrong.
  if (row.lastPollError) return true;
  return false;
}

export default function QueueSummaryPage() {
  return (
    <Suspense fallback={<div className="p-8">Loading…</div>}>
      <QueueSummaryInner />
    </Suspense>
  );
}

function QueueSummaryInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { token, loadFromStorage } = useAuthStore();
  const ids = (params.get('ids') || '').split(',').filter(Boolean);
  const [rows, setRows] = useState<Row[]>(
    ids.map((id) => ({ sessionId: id, loaded: false, evalStatus: 'unknown' as EvalStatus })),
  );
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Per-session poll attempt counter, kept in a ref so it isn't a render dep.
  const pollAttemptsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  // Initial bulk load — Promise.allSettled so one bad row doesn't blank the page.
  useEffect(() => {
    if (!token || ids.length === 0) return;
    let cancelled = false;
    (async () => {
      const results = await Promise.allSettled(
        ids.map(async (id) => {
          // Settle the status call separately so a transient failure here
          // doesn't blank the whole row — but DO surface it via lastPollError
          // so the bounded retry loop can pick the row back up.
          const [sRes, eRes] = await Promise.allSettled([
            sessions.get(token, id),
            evaluations.status(token, id),
          ]);
          if (sRes.status === 'rejected') throw sRes.reason;
          const s = sRes.value;
          const e = eRes.status === 'fulfilled' ? eRes.value : null;
          const initialPollError = eRes.status === 'rejected'
            ? (eRes.reason?.message || 'Could not reach evaluation status endpoint')
            : null;
          return {
            sessionId: id,
            loaded: true,
            scenarioName: s.data?.scenario?.name,
            campaign: s.data?.scenario?.campaign,
            difficulty: s.data?.scenario?.difficulty,
            personaName: s.data?.scenario?.personaName,
            durationSeconds: s.data?.durationSeconds ?? 0,
            evalStatus: (e?.data?.status ?? 'unknown') as EvalStatus,
            overallScore: e?.data?.overallScore ?? null,
            lastError: e?.data?.lastError ?? null,
            lastPollError: initialPollError,
          } as Row;
        }),
      );
      if (cancelled) return;
      setRows(
        results.map((r, i) => {
          if (r.status === 'fulfilled') return r.value;
          return {
            sessionId: ids[i],
            loaded: true,
            loadError: r.reason?.message || 'Could not load',
            evalStatus: 'unknown' as EvalStatus,
          };
        }),
      );
    })();
    return () => { cancelled = true; };
    // intentionally only react to token + ids string identity
  }, [token, ids.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll only the still-pending rows. Drop each as it transitions; stop
  // polling a row once it hits the attempt cap (treated as terminal).
  // Counter MUST bump per pending row regardless of whether the request
  // fulfilled — otherwise a row whose status() keeps rejecting would never
  // age toward the cap and we'd poll it forever.
  const pollPending = useCallback(async () => {
    if (!token) return;
    const pending = rows.filter((r) => r.loaded && isPending(r));
    if (pending.length === 0) return;

    // Bump attempt counters BEFORE the request so rejections count too.
    for (const r of pending) {
      pollAttemptsRef.current.set(r.sessionId, (pollAttemptsRef.current.get(r.sessionId) ?? 0) + 1);
    }

    const settled = await Promise.allSettled(
      pending.map(async (r) => {
        const e = await evaluations.status(token, r.sessionId);
        return { id: r.sessionId, status: e.data?.status as EvalStatus, score: e.data?.overallScore ?? null, lastError: e.data?.lastError ?? null };
      }),
    );
    type FulfilledUpdate = { status: EvalStatus; score: number | null; lastError: string | null };
    const fulfilledById = new Map<string, FulfilledUpdate>();
    const rejectedById = new Map<string, string>();
    for (let i = 0; i < settled.length; i++) {
      const id = pending[i].sessionId;
      const r = settled[i];
      if (r.status === 'fulfilled') {
        fulfilledById.set(id, { status: r.value.status, score: r.value.score, lastError: r.value.lastError });
      } else {
        rejectedById.set(id, r.reason?.message || 'Could not reach evaluation status endpoint');
      }
    }

    setRows((prev) =>
      prev.map((r) => {
        const fulfilled = fulfilledById.get(r.sessionId);
        const rejectedMsg = rejectedById.get(r.sessionId);
        if (!fulfilled && !rejectedMsg) return r;       // not in this poll batch

        const attempts = pollAttemptsRef.current.get(r.sessionId) ?? 0;
        if (fulfilled) {
          const giveUp = attempts >= MAX_POLL_ATTEMPTS && PENDING_STATUSES.includes(fulfilled.status);
          return {
            ...r,
            evalStatus: fulfilled.status,
            overallScore: fulfilled.score,
            lastError: fulfilled.lastError,
            lastPollError: null,
            pollGiveUp: giveUp,
          };
        }
        // Rejected: keep current evalStatus, surface the error, and give up
        // once the attempt cap is hit so we stop hammering a broken endpoint.
        const giveUp = attempts >= MAX_POLL_ATTEMPTS;
        return {
          ...r,
          lastPollError: rejectedMsg ?? r.lastPollError ?? null,
          pollGiveUp: giveUp ? true : r.pollGiveUp,
        };
      }),
    );
  }, [token, rows]);

  // Completed-without-score race: the eval row exists and status flipped
  // before overallScore was hydrated by the controller's response. Mirror
  // the report page and call evaluations.get() once. If THAT also fails,
  // keep the row as "completed" with no score and don't keep polling —
  // the trainee can open the full report.
  useEffect(() => {
    if (!token) return;
    const needsScoreFetch = rows.filter(
      (r) => r.loaded && r.evalStatus === 'completed' && r.overallScore == null && !r.scoreFetchAttempted,
    );
    if (needsScoreFetch.length === 0) return;
    let cancelled = false;
    (async () => {
      const updates = await Promise.allSettled(
        needsScoreFetch.map(async (r) => {
          const ev = await evaluations.get(token, r.sessionId);
          return { id: r.sessionId, score: ev.data?.overallScore ?? null };
        }),
      );
      if (cancelled) return;
      const byId = new Map<string, number | null>();
      for (let i = 0; i < updates.length; i++) {
        const u = updates[i];
        const id = needsScoreFetch[i].sessionId;
        // Mark attempted whether or not it succeeded — never re-poll.
        byId.set(id, u.status === 'fulfilled' ? u.value.score : null);
      }
      setRows((prev) =>
        prev.map((r) =>
          byId.has(r.sessionId)
            ? { ...r, scoreFetchAttempted: true, overallScore: byId.get(r.sessionId) ?? r.overallScore ?? null }
            : r,
        ),
      );
    })();
    return () => { cancelled = true; };
  }, [token, rows]);

  useEffect(() => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    const stillPending = rows.some((r) => r.loaded && isPending(r));
    if (!stillPending) return;
    pollTimerRef.current = setTimeout(pollPending, POLL_INTERVAL_MS);
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [rows, pollPending]);

  const completedCount = rows.filter((r) => r.evalStatus === 'completed').length;
  const pendingCount = rows.filter((r) => isPending(r)).length;
  // Capped rows aren't "pending" (we stopped polling them) but they're not
  // resolved either. Use this for trainee-facing aggregate copy so the header
  // doesn't claim "All evaluations finished" while a row says Status unreachable.
  const unresolvedCount = rows.filter((r) => isPending(r) || r.pollGiveUp).length;
  const avgScore = (() => {
    const scored = rows.filter((r) => typeof r.overallScore === 'number') as Array<Row & { overallScore: number }>;
    if (scored.length === 0) return null;
    return Math.round((scored.reduce((acc, r) => acc + r.overallScore, 0) / scored.length) * 10) / 10;
  })();

  function handleDone() {
    useQueueStore.getState().stop();
    router.push('/scenarios');
  }

  if (ids.length === 0) {
    return (
      <TrainingFloorShell>
        <main className="mx-auto w-full max-w-[1600px] p-4 sm:px-8 lg:px-12 lg:py-8">
          <div className="card text-center py-16">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">No completed calls to summarize</h2>
            <button onClick={handleDone} className="btn-primary mt-4">Back to Assignments</button>
          </div>
        </main>
      </TrainingFloorShell>
    );
  }

  return (
    <TrainingFloorShell>
      <main className="mx-auto w-full max-w-[1600px] p-4 sm:px-8 lg:px-12 lg:py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Queue Summary</h1>
            <p className="text-gray-500 mt-1">
              {ids.length} call{ids.length === 1 ? '' : 's'} completed.{' '}
              {(() => {
                const cappedCount = unresolvedCount - pendingCount;
                if (unresolvedCount === 0) return 'All evaluations finished.';
                if (pendingCount > 0 && cappedCount > 0) {
                  return `${pendingCount} eval${pendingCount === 1 ? '' : 's'} still running, ${cappedCount} unresolved.`;
                }
                if (pendingCount > 0) {
                  return `${pendingCount} eval${pendingCount === 1 ? '' : 's'} still running…`;
                }
                return `${cappedCount} eval${cappedCount === 1 ? '' : 's'} unresolved — open the report${cappedCount === 1 ? '' : 's'} for status.`;
              })()}
            </p>
          </div>
          <button onClick={handleDone} className="btn-primary">Done</button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Stat label="Total Calls" value={ids.length} />
          <Stat label="Evaluated" value={completedCount} />
          <Stat label="Unresolved" value={unresolvedCount} />
          <Stat label="Avg Score" value={avgScore !== null ? `${avgScore}` : '·'} />
        </div>

        <div className="card overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Scenario</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Campaign</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Difficulty</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Persona</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Duration</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Score</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {rows.map((r, i) => (
                <tr key={r.sessionId} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">
                    {r.loaded ? (r.scenarioName || '·') : <span className="text-gray-400">Loading…</span>}
                    <div className="text-xs text-gray-400">#{i + 1}</div>
                  </td>
                  <td className="px-6 py-4">
                    {r.campaign && <span className={`badge ${getCampaignColor(r.campaign)}`}>{r.campaign.replace('_', ' ')}</span>}
                  </td>
                  <td className="px-6 py-4">
                    {r.difficulty && <span className={`badge ${getDifficultyColor(r.difficulty)}`}>{r.difficulty}</span>}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-700">{r.personaName || '·'}</td>
                  <td className="px-6 py-4 text-sm text-gray-700">{r.durationSeconds != null ? formatDuration(r.durationSeconds) : '—'}</td>
                  <td className="px-6 py-4">
                    <ScoreCell row={r} />
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => router.push(`/reports/${r.sessionId}`)}
                      className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                    >
                      View report →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </TrainingFloorShell>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card">
      <div className="text-xs uppercase text-gray-500">{label}</div>
      <div className="text-2xl font-bold text-gray-900 mt-1">{value}</div>
    </div>
  );
}

function ScoreCell({ row }: { row: Row }) {
  if (!row.loaded) return <span className="text-gray-400">…</span>;
  if (row.loadError) return <span className="text-red-500 text-xs">{row.loadError}</span>;
  // We capped polling for this row — show "taking longer" so the user knows
  // we stopped, and they can still open the report. If the cap was hit because
  // status() kept rejecting, surface that error in the tooltip.
  if (row.pollGiveUp) {
    const tooltip = row.lastPollError
      ? `Could not reach evaluation status endpoint after multiple attempts: ${row.lastPollError}. Open the report to check status.`
      : 'Evaluation is taking longer than expected. Open the report to check status.';
    return (
      <span className="badge bg-yellow-100 text-yellow-700" title={tooltip}>
        {row.lastPollError ? 'Status unreachable' : 'Still running…'}
      </span>
    );
  }
  switch (row.evalStatus) {
    case 'completed':
      if (typeof row.overallScore === 'number') {
        return <span className="badge bg-green-100 text-green-700">{row.overallScore.toFixed(1)}</span>;
      }
      // completed but no score — either we haven't run the fetch yet, or the
      // fetch ran and returned null. Show distinct text for each.
      return row.scoreFetchAttempted
        ? <span className="badge bg-gray-100 text-gray-600" title="Evaluation completed but no score returned. Check the full report.">Score unavailable</span>
        : <span className="badge bg-blue-100 text-blue-700">Loading score…</span>;
    case 'queued':
      return <span className="badge bg-gray-100 text-gray-600">Queued</span>;
    case 'processing':
      return <span className="badge bg-blue-100 text-blue-700">Evaluating…</span>;
    case 'failed':
      return <span className="badge bg-red-100 text-red-700" title={row.lastError ?? undefined}>Eval failed</span>;
    case 'missing':
      return <span className="badge bg-yellow-100 text-yellow-700">Missing</span>;
    case 'not_started':
      return <span className="badge bg-gray-100 text-gray-600">Not started</span>;
    case 'unknown':
    default:
      return <span className="badge bg-gray-100 text-gray-600">…</span>;
  }
}
