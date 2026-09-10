'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import TrainingFloorShell from '@/components/layout/TrainingFloorShell';
import { useAuthStore } from '@/store/auth.store';
import { sessions, evaluations } from '@/lib/api';
import { difficultyLabel, productLabel, sessionStatusLabel } from '@/lib/labels';
import { formatDate, formatDuration } from '@/lib/utils';

function campaignChip(campaign?: string) {
  switch (campaign) {
    case 'ACA': return 'border-air-signal/35 bg-air-signal/10 text-air-signal-bright';
    case 'MEDICARE': return 'border-air-amber/40 bg-air-amber/12 text-air-amber';
    case 'MED_ALERT': return 'border-air-live/35 bg-air-live/10 text-air-live';
    default: return 'border-air-line/30 bg-air-line/10 text-air-muted';
  }
}

function difficultyChip(difficulty?: string) {
  switch (difficulty) {
    case 'EASY': return 'border-air-signal/35 bg-air-signal/10 text-air-signal-bright';
    case 'MEDIUM': return 'border-air-amber/40 bg-air-amber/12 text-air-amber';
    default: return 'border-air-live/35 bg-air-live/10 text-air-live';
  }
}

function statusChip(status?: string) {
  switch (status) {
    case 'COMPLETED': return 'border-air-amber/40 bg-air-amber/12 text-air-amber';
    case 'ACTIVE': return 'border-air-signal/35 bg-air-signal/10 text-air-signal-bright';
    default: return 'border-air-line/30 bg-air-line/10 text-air-faint';
  }
}

function scoreChip(score: number) {
  if (score >= 80) return 'border-air-amber/40 bg-air-amber/12 text-air-amber';
  if (score >= 60) return 'border-air-signal/35 bg-air-signal/10 text-air-signal-bright';
  return 'border-air-live/35 bg-air-live/10 text-air-live';
}

const PENDING_EVALUATION_STATUSES = new Set(['queued', 'processing']);

export default function ReportsPage() {
  const { token, loadFromStorage } = useAuthStore();
  const [sessionsList, setSessionsList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<any>(null);
  const [evaluationStatuses, setEvaluationStatuses] = useState<Record<string, string>>({});

  // Filters
  const [campaign, setCampaign] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [scoreMin, setScoreMin] = useState('');
  const [scoreMax, setScoreMax] = useState('');

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  const loadSessions = useCallback(async (showLoading = true) => {
    if (!token) return;
    if (showLoading) setLoading(true);
    try {
      const res = await sessions.list(token, {
        page: String(page),
        limit: '15',
        ...(campaign && { campaign }),
        ...(difficulty && { difficulty }),
        ...(status && { status }),
        ...(search && { search }),
        ...(scoreMin && { scoreMin }),
        ...(scoreMax && { scoreMax }),
      });
      setSessionsList(res.data);
      setPagination(res.pagination);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [token, page, campaign, difficulty, status, search, scoreMin, scoreMax]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  useEffect(() => {
    const unscoredCompletedSessions = sessionsList.filter(
      (session) => session.status === 'COMPLETED' && !session.evaluation,
    );
    if (!token || unscoredCompletedSessions.length === 0) return;

    let cancelled = false;
    void Promise.all(
      unscoredCompletedSessions.map(async (session) => {
        try {
          const response = await evaluations.status(token, session.id);
          return [session.id, response.data.status] as const;
        } catch {
          return [session.id, 'unknown'] as const;
        }
      }),
    ).then((statuses) => {
      if (cancelled) return;
      setEvaluationStatuses((current) => ({ ...current, ...Object.fromEntries(statuses) }));
    });

    return () => { cancelled = true; };
  }, [token, sessionsList]);

  const hasPendingEvaluation = sessionsList.some(
    (session) => PENDING_EVALUATION_STATUSES.has(evaluationStatuses[session.id] || ''),
  );

  useEffect(() => {
    if (!hasPendingEvaluation) return;

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void loadSessions(false);
    };
    const intervalId = window.setInterval(refreshWhenVisible, 4000);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [hasPendingEvaluation, loadSessions]);

  // Reset to page 1 when filters change
  function applyFilter(setter: (v: string) => void, value: string) {
    setter(value);
    setPage(1);
  }

  return (
    <TrainingFloorShell>
      <main className="w-full min-w-0 px-6 py-7 pb-12 lg:px-8">
        <div className="mx-auto w-full max-w-[1500px]">
        <header className="mb-5">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-air-signal shadow-[0_0_10px_rgb(var(--air-signal))]" />
            <span className="font-mono-ui text-[10.5px] font-bold uppercase tracking-[0.12em] text-air-faint">
              Session history
            </span>
          </div>

          <h1 className="font-display text-[28px] font-extrabold tracking-[-0.035em] text-air-text">
            Your Call History
          </h1>

          <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-air-muted">
            Review every practice call, filter your history, and open a report to see how each session scored.
          </p>
        </header>

        {/* Filters */}
        <div className="air-panel mb-5 rounded-[18px] border p-3.5 backdrop-blur-md">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="mb-1.5 block font-mono-ui text-[10px] font-bold uppercase tracking-[0.1em] text-air-faint">Search</span>
              <input
                type="text"
                placeholder="Scenario name..."
                value={search}
                onChange={(e) => applyFilter(setSearch, e.target.value)}
                className="air-panel min-w-[210px] rounded-xl border bg-air-bg2 px-3.5 py-2.5 text-[13px] text-air-text outline-none transition placeholder:text-air-faint focus:border-air-signal/40"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block font-mono-ui text-[10px] font-bold uppercase tracking-[0.1em] text-air-faint">Product</span>
              <select value={campaign} onChange={(e) => applyFilter(setCampaign, e.target.value)} className="air-panel min-w-[160px] rounded-xl border bg-air-bg2 px-3.5 py-2.5 text-[13px] text-air-text outline-none transition focus:border-air-signal/40">
                <option value="">All</option>
                <option value="ACA">ACA</option>
                <option value="MEDICARE">Medicare</option>
                <option value="MED_ALERT">Medical Alert</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block font-mono-ui text-[10px] font-bold uppercase tracking-[0.1em] text-air-faint">Difficulty</span>
              <select value={difficulty} onChange={(e) => applyFilter(setDifficulty, e.target.value)} className="air-panel min-w-[160px] rounded-xl border bg-air-bg2 px-3.5 py-2.5 text-[13px] text-air-text outline-none transition focus:border-air-signal/40">
                <option value="">All</option>
                <option value="EASY">Easy</option>
                <option value="MEDIUM">Medium</option>
                <option value="HARD">Hard</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block font-mono-ui text-[10px] font-bold uppercase tracking-[0.1em] text-air-faint">Status</span>
              <select value={status} onChange={(e) => applyFilter(setStatus, e.target.value)} className="air-panel min-w-[160px] rounded-xl border bg-air-bg2 px-3.5 py-2.5 text-[13px] text-air-text outline-none transition focus:border-air-signal/40">
                <option value="">All</option>
                <option value="COMPLETED">Finished</option>
                <option value="ACTIVE">On the call</option>
                <option value="WAITING">Waiting</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block font-mono-ui text-[10px] font-bold uppercase tracking-[0.1em] text-air-faint">Min score</span>
              <input
                type="number" min="0" max="100" placeholder="0"
                value={scoreMin}
                onChange={(e) => applyFilter(setScoreMin, e.target.value)}
                className="air-panel w-24 rounded-xl border bg-air-bg2 px-3 py-2.5 text-[13px] text-air-text outline-none transition placeholder:text-air-faint focus:border-air-signal/40"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block font-mono-ui text-[10px] font-bold uppercase tracking-[0.1em] text-air-faint">Max score</span>
              <input
                type="number" min="0" max="100" placeholder="100"
                value={scoreMax}
                onChange={(e) => applyFilter(setScoreMax, e.target.value)}
                className="air-panel w-24 rounded-xl border bg-air-bg2 px-3 py-2.5 text-[13px] text-air-text outline-none transition placeholder:text-air-faint focus:border-air-signal/40"
              />
            </label>
            {(campaign || difficulty || status || search || scoreMin || scoreMax) && (
              <button
                onClick={() => {
                  setCampaign(''); setDifficulty(''); setStatus('');
                  setSearch(''); setScoreMin(''); setScoreMax('');
                  setPage(1);
                }}
                className="rounded-xl px-3 py-2.5 text-[12.5px] font-semibold text-air-muted transition hover:bg-air-line/[0.06] hover:text-air-signal-bright"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-14">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-air-signal border-t-transparent" />
          </div>
        ) : (
          <>
            <div className="air-panel overflow-hidden rounded-[20px] border backdrop-blur-md">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left">
                  <thead>
                    <tr className="air-hairline border-b font-mono-ui text-[10px] font-bold uppercase tracking-[0.12em] text-air-faint">
                      <th className="px-5 py-3.5">Practice call</th>
                      <th className="px-5 py-3.5">Product</th>
                      <th className="px-5 py-3.5">Difficulty</th>
                      <th className="px-5 py-3.5">Duration</th>
                      <th className="px-5 py-3.5">Score</th>
                      <th className="px-5 py-3.5">Date</th>
                      <th className="px-5 py-3.5">Status</th>
                      <th className="px-5 py-3.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessionsList.map((session, i) => (
                      <tr key={session.id} className={`transition-colors hover:bg-air-line/[0.07] ${i > 0 ? 'air-hairline border-t' : ''}`}>
                        <td className="px-5 py-3.5 text-[13px] font-semibold text-air-text">
                          {session.scenario?.name || 'Practice call'}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono-ui text-[10px] font-bold uppercase tracking-[0.08em] ${campaignChip(session.scenario?.campaign)}`}>
                            {productLabel(session.scenario?.campaign)}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono-ui text-[10px] font-bold uppercase tracking-[0.08em] ${difficultyChip(session.scenario?.difficulty)}`}>
                            {difficultyLabel(session.scenario?.difficulty)}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 font-mono-ui text-[12px] text-air-muted">
                          {session.durationSeconds ? formatDuration(session.durationSeconds) : '\u2014'}
                        </td>
                        <td className="px-5 py-3.5">
                          {session.evaluation ? (
                            <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono-ui text-[10.5px] font-bold ${scoreChip(session.evaluation.overallScore)}`}>
                              {session.evaluation.overallScore}%
                            </span>
                          ) : session.status === 'COMPLETED' ? (
                            <EvalStatusBadge status={evaluationStatuses[session.id] || 'loading'} />
                          ) : (
                            <span className="text-[12.5px] text-air-faint">--</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 font-mono-ui text-[12px] text-air-muted">
                          {formatDate(session.createdAt)}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono-ui text-[10px] font-bold uppercase tracking-[0.08em] ${statusChip(session.status)}`}>
                            {sessionStatusLabel(session.status)}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <Link
                            href={`/reports/${session.id}`}
                            className="inline-flex items-center gap-1.5 text-[13px] font-bold text-air-signal-bright transition-colors hover:text-air-cyan"
                          >
                            View
                            <svg className="h-3.5 w-3.5 stroke-current" fill="none" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                            </svg>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {sessionsList.length === 0 && (
                <div className="py-11 text-center text-[12.5px] text-air-faint">
                  {campaign || difficulty || status || search || scoreMin || scoreMax
                    ? 'No calls match your filters.'
                    : 'No calls yet. Make a practice call and it will show up here.'}
                </div>
              )}
            </div>

            {/* Pagination */}
            {pagination && pagination.pages > 1 && (
              <div className="air-panel mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[16px] border px-4 py-3">
                <p className="font-mono-ui text-[12px] text-air-faint">
                  Page {pagination.page} of {pagination.pages} ({pagination.total} total)
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(page - 1)}
                    disabled={page === 1}
                    className="air-panel inline-flex items-center rounded-xl border px-3.5 py-2 text-[12px] font-semibold text-air-muted transition hover:border-air-line/40 hover:text-air-text disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPage(page + 1)}
                    disabled={page >= pagination.pages}
                    className="air-panel inline-flex items-center rounded-xl border px-3.5 py-2 text-[12px] font-semibold text-air-muted transition hover:border-air-line/40 hover:text-air-text disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        </div>
      </main>
    </TrainingFloorShell>
  );
}

function EvalStatusBadge({ status }: { status: string }) {

  const colors: Record<string, string> = {
    queued: 'border-air-amber/40 bg-air-amber/12 text-air-amber',
    processing: 'border-air-amber/40 bg-air-amber/12 text-air-amber',
    completed: 'border-air-amber/40 bg-air-amber/12 text-air-amber',
    failed: 'border-air-live/35 bg-air-live/10 text-air-live',
    missing: 'border-air-line/30 bg-air-line/10 text-air-faint',
    loading: 'border-air-line/30 bg-air-line/10 text-air-faint',
  };

  const labels: Record<string, string> = {
    queued: 'Scoring',
    processing: 'Scoring',
    completed: 'Scored',
    failed: 'Not scored',
    missing: 'Not scored',
    not_started: 'Not scored',
    loading: '…',
    unknown: 'Not scored',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono-ui text-[10px] font-bold uppercase tracking-[0.08em] ${colors[status] || 'border-air-line/30 bg-air-line/10 text-air-faint'}`}
    >
      {status === 'processing' && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-air-amber" />
      )}
      {labels[status] || status}
    </span>
  );
}
