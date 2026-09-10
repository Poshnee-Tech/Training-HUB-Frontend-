'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import TrainingFloorShell from '@/components/layout/TrainingFloorShell';
import { useAuthStore } from '@/store/auth.store';
import { assignments as assignmentsApi, sessions, calls } from '@/lib/api';
import { difficultyLabel, productLabel } from '@/lib/labels';

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

export default function MyAssignmentsPage() {
  const router = useRouter();
  const { token, loadFromStorage } = useAuthStore();
  const [assignmentsList, setAssignmentsList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [filterCampaign, setFilterCampaign] = useState('ALL');
  const [filterDifficulty, setFilterDifficulty] = useState('ALL');
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);

  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showNotice(kind: 'info' | 'error', text: string) {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice({ kind, text });
    noticeTimer.current = setTimeout(() => setNotice(null), 5000);
  }

  const visibleAssignments = assignmentsList.filter((a) => {
    if (filterCampaign !== 'ALL' && a.scenario?.campaign !== filterCampaign) return false;
    if (filterDifficulty !== 'ALL' && a.scenario?.difficulty !== filterDifficulty) return false;
    return true;
  });

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  useEffect(() => {
    if (!token) return;
    loadAssignments();
  }, [token]);

  async function loadAssignments() {
    setLoading(true);
    try {
      const res = await assignmentsApi.my(token!);
      setAssignmentsList(res.data);
    } catch (err) {
      console.error('Failed to load assignments:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleStartCall(assignment: any) {
    if (!token) return;
    setStartingId(assignment.id);
    try {
      // Dispatch is gated on flowType (the source of truth on the backend),
      // NOT agentRole. agentRole defaults to FRONTER for every assignment —
      // including SINGLE-flow ones — so checking agentRole alone routes
      // single-agent assignments into the dual-agent endpoint and trips
      // the backend's "not configured for the dual-agent flow" guard.
      if (assignment.flowType === 'DUAL' && assignment.agentRole === 'FRONTER') {
        const res = await calls.startFronter(token, assignment.id);
        router.push(`/call?sessionId=${res.data.session.id}&callId=${res.data.call.id}`);
      } else if (assignment.flowType === 'DUAL' && assignment.agentRole === 'VERIFIER') {
        // Verifier needs a callId — auto-linked when fronter transfers
        if (!assignment.callId) {
          showNotice('error', 'No call is ready for verification yet. The fronter must complete and transfer their call first.');
          return;
        }
        const res = await calls.startVerifier(token, assignment.callId, assignment.id);
        router.push(`/call?sessionId=${res.data.session.id}&callId=${assignment.callId}`);
      } else {
        // SINGLE flow — one agent, no transfer.
        const res = await sessions.start(token, assignment.id);
        router.push(`/call?sessionId=${res.data.id}`);
      }
    } catch (err: any) {
      showNotice('error', err.message);
    } finally {
      setStartingId(null);
    }
  }

  async function clearOpenSessions() {
    if (!token) return;
    try {
      const res = await sessions.clearAll(token);
      if (res.data.cleared > 0) {
        showNotice('info', `Reset ${res.data.cleared} stuck call${res.data.cleared === 1 ? '' : 's'}. You can start a new one now.`);
        loadAssignments();
      } else {
        showNotice('info', 'Nothing to reset — none of your calls are stuck.');
      }
    } catch (err: any) {
      showNotice('error', err.message);
    }
  }

  function formatSchedule(assignment: any) {
    const date = new Date(assignment.scheduledDate).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    });
    if (assignment.scheduledHour !== null && assignment.scheduledHour !== undefined) {
      const hour = assignment.scheduledHour;
      const ampm = hour >= 12 ? 'PM' : 'AM';
      const h = hour % 12 || 12;
      return `${date} at ${h}:00 ${ampm}`;
    }
    return date;
  }

  return (
    <TrainingFloorShell>
      <main className="w-full min-w-0 px-6 py-7 pb-12 lg:px-8">
        <div className="mx-auto w-full max-w-[1500px]">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1.5 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-air-signal shadow-[0_0_10px_rgb(var(--air-signal))]" />
              <span className="font-mono-ui text-[10.5px] font-bold uppercase tracking-[0.12em] text-air-faint">
                Assigned work
              </span>
            </div>

            <h1 className="font-display text-[28px] font-extrabold tracking-[-0.035em] text-air-text">
              Your Assigned Calls
            </h1>

            <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-air-muted">
              Practice calls your trainer has assigned to you. Filter the list and start the next call when you are ready.
            </p>
          </div>
          <button
            onClick={clearOpenSessions}
            className="air-panel inline-flex min-h-10 items-center gap-2 rounded-xl border px-4 py-2.5 text-[12.5px] font-semibold text-air-muted transition hover:border-air-line/40 hover:text-air-text"
          >
            <svg className="h-4 w-4 stroke-current" fill="none" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
            </svg>
            Reset stuck calls
          </button>
        </header>

        {/* Filters */}
        {!loading && assignmentsList.length > 0 && (
          <div className="air-panel mb-5 flex flex-wrap items-end gap-3 rounded-[18px] border p-3.5">
            <label className="block">
              <span className="mb-1.5 block font-mono-ui text-[10px] font-bold uppercase tracking-[0.1em] text-air-faint">Product</span>
              <select
                className="air-panel min-w-[190px] rounded-xl border bg-air-bg2 px-3.5 py-2.5 text-[13px] text-air-text outline-none transition focus:border-air-signal/40"
                value={filterCampaign}
                onChange={(e) => setFilterCampaign(e.target.value)}
              >
                <option value="ALL">All products</option>
                <option value="ACA">ACA</option>
                <option value="MEDICARE">Medicare</option>
                <option value="MED_ALERT">Medical Alert</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block font-mono-ui text-[10px] font-bold uppercase tracking-[0.1em] text-air-faint">Difficulty</span>
              <select
                className="air-panel min-w-[190px] rounded-xl border bg-air-bg2 px-3.5 py-2.5 text-[13px] text-air-text outline-none transition focus:border-air-signal/40"
                value={filterDifficulty}
                onChange={(e) => setFilterDifficulty(e.target.value)}
              >
                <option value="ALL">All difficulties</option>
                <option value="EASY">Easy</option>
                <option value="MEDIUM">Medium</option>
                <option value="HARD">Hard</option>
              </select>
            </label>
            {(filterCampaign !== 'ALL' || filterDifficulty !== 'ALL') && (
              <button
                type="button"
                onClick={() => { setFilterCampaign('ALL'); setFilterDifficulty('ALL'); }}
                className="rounded-xl px-3 py-2.5 text-[12.5px] font-semibold text-air-muted transition hover:bg-air-line/[0.06] hover:text-air-signal-bright"
              >
                Clear filters
              </button>
            )}
            <div className="ml-auto pb-2.5 font-mono-ui text-[9.5px] font-bold uppercase tracking-[0.08em] text-air-faint">
              Showing {visibleAssignments.length} of {assignmentsList.length}
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-14">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-air-signal border-t-transparent" />
          </div>
        ) : assignmentsList.length === 0 ? (
          <div className="air-panel rounded-[20px] border border-dashed px-6 py-12 text-center backdrop-blur-md">
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-[16px] border border-air-line/25 bg-air-line/10">
              <svg className="h-6 w-6 stroke-air-faint" fill="none" viewBox="0 0 24 24" strokeWidth={1.4} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z" />
              </svg>
            </div>
            <h2 className="font-display text-[17px] font-extrabold tracking-[-0.02em] text-air-text">Nothing assigned yet</h2>
            <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-air-muted">
              Your trainer hasn&apos;t set you any practice calls yet. Check back later, or ask your supervisor.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleAssignments.length === 0 ? (
              <div className="air-panel col-span-full rounded-[20px] border border-dashed px-6 py-10 text-center text-[12.5px] text-air-faint backdrop-blur-md">
                No assigned calls match these filters.
              </div>
            ) : null}
            {visibleAssignments.map((assignment) => (
              <div key={assignment.id} className="air-panel flex flex-col rounded-[18px] border p-5 backdrop-blur-md transition-all duration-200 hover:border-air-line/50 hover:shadow-[0_20px_45px_-28px_rgb(var(--air-signal)/0.45)]">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono-ui text-[10px] font-bold uppercase tracking-[0.08em] ${campaignChip(assignment.scenario.campaign)}`}>
                      {productLabel(assignment.scenario.campaign)}
                    </span>
                    <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono-ui text-[10px] font-bold uppercase tracking-[0.08em] ${difficultyChip(assignment.scenario.difficulty)}`}>
                      {difficultyLabel(assignment.scenario.difficulty)}
                    </span>
                  </div>
                  {/* Role badge is only meaningful when the assignment is part
                      of the dual-agent flow. For SINGLE assignments the
                      agentRole field is FRONTER by default but the role
                      label would be misleading. */}
                  {assignment.flowType === 'DUAL' && assignment.agentRole && (
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-air-cyan/35 bg-air-cyan/10 px-2.5 py-1 font-mono-ui text-[10px] font-bold uppercase tracking-[0.08em] text-air-cyan">
                      {assignment.agentRole}
                    </span>
                  )}
                </div>

                <h3 className="mb-1.5 font-display text-[17px] font-extrabold tracking-[-0.02em] text-air-text">
                  {assignment.scenario.name}
                </h3>

                {assignment.scenario.description && (
                  <p className="mb-3 flex-1 text-[12.5px] leading-relaxed text-air-muted">
                    {assignment.scenario.description}
                  </p>
                )}

                {/* Persona info */}
                <div className="air-hairline mb-3 border-t pt-3">
                  <div className="grid grid-cols-2 gap-x-3 gap-y-3 text-[12.5px] text-air-muted">
                    <div>
                      <span className="font-mono-ui text-[9.5px] font-bold uppercase tracking-[0.1em] text-air-faint">Customer</span>
                      <p className="mt-0.5 font-semibold text-air-text">{assignment.scenario.personaName}</p>
                    </div>
                    <div>
                      <span className="font-mono-ui text-[9.5px] font-bold uppercase tracking-[0.1em] text-air-faint">Age</span>
                      <p className="mt-0.5 font-semibold text-air-text">{assignment.scenario.personaAge}</p>
                    </div>
                    <div className="col-span-2">
                      <span className="font-mono-ui text-[9.5px] font-bold uppercase tracking-[0.1em] text-air-faint">Mood</span>
                      <p className="mt-0.5 font-semibold text-air-text">{assignment.scenario.personaMood}</p>
                    </div>
                  </div>
                </div>

                {/* Schedule */}
                <div className="mb-3 flex items-center gap-2.5 rounded-xl border border-air-signal/25 bg-air-signal/[0.08] px-3.5 py-2.5 text-[12.5px] font-medium text-air-signal-bright">
                  <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
                  </svg>
                  <span className="font-semibold">{formatSchedule(assignment)}</span>
                </div>

                {/* Admin notes */}
                {assignment.notes && (
                  <div className="mb-3 rounded-xl border border-air-line/25 bg-air-line/[0.07] px-3.5 py-2.5 text-[12px] italic leading-relaxed text-air-muted">
                    Note from your trainer: {assignment.notes}
                  </div>
                )}

                <button
                  onClick={() => handleStartCall(assignment)}
                  disabled={startingId === assignment.id}
                  className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-air-signal to-air-signal-bright px-4 py-2.5 text-[13px] font-bold text-white shadow-[0_0_22px_rgb(var(--air-signal)/0.35)] transition-all duration-150 hover:-translate-y-px hover:shadow-[0_0_30px_rgb(var(--air-signal)/0.5)] disabled:translate-y-0 disabled:opacity-50 disabled:shadow-none"
                >
                  {startingId === assignment.id ? 'Starting...' :
                    assignment.flowType === 'DUAL' && assignment.agentRole === 'VERIFIER' ? 'Start Closer Call' :
                    assignment.flowType === 'DUAL' && assignment.agentRole === 'FRONTER' ? 'Start Fronter Call' :
                    'Start Call'}
                </button>
              </div>
            ))}
          </div>
        )}
        </div>
      </main>

      {notice && (
        <div className="fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4" role="status">
          <div
            className={`pointer-events-auto flex max-w-lg items-start gap-3 rounded-xl border px-4 py-3 text-[13.5px] font-medium shadow-[0_24px_50px_-24px_rgba(0,0,0,0.55)] backdrop-blur-xl ${
              notice.kind === 'error'
                ? 'border-air-live/40 bg-air-live/15 text-air-live'
                : 'border-air-signal/35 bg-air-signal/15 text-air-text'
            }`}
          >
            <span className="min-w-0 flex-1 leading-relaxed">{notice.text}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="Dismiss"
              className="shrink-0 rounded-md px-1.5 py-0.5 text-air-muted transition-colors hover:bg-air-line/10 hover:text-air-text"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </TrainingFloorShell>
  );
}