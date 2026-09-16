'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import TrainingFloorShell from '@/components/layout/TrainingFloorShell';
import { useAuthStore } from '@/store/auth.store';
import { assignments as assignmentsApi, sessions, calls, dialer, BREAK_REASONS, type DialerQueueState } from '@/lib/api';
import { useQueueStore } from '@/store/queue.store';
import { unlockAudioContext } from '@/hooks/useWebSocket';

export default function MyAssignmentsPage() {
  const router = useRouter();
  const { token, loadFromStorage } = useAuthStore();
  const [assignmentsList, setAssignmentsList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [callsInQueue, setCallsInQueue] = useState<number | null>(null);
  // A single-agent call still open on the server (e.g. claimed as the agent
  // left the queue). "Start my queue" resumes it, even with nothing queued.
  const [openQueueSessionId, setOpenQueueSessionId] = useState<string | null>(null);
  // The break taken from the call screen, which sends the agent here.
  const [activeBreak, setActiveBreak] = useState<DialerQueueState['activeBreak']>(null);
  const [nextCustomerName, setNextCustomerName] = useState<string | null>(null);
  // From the server, so the page and the rule always agree.
  const [breakMaxSeconds, setBreakMaxSeconds] = useState(60 * 60);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [startingQueue, setStartingQueue] = useState(false);
  const [shuffling, setShuffling] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);

  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showNotice(kind: 'info' | 'error', text: string) {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice({ kind, text });
    noticeTimer.current = setTimeout(() => setNotice(null), 5000);
  }

  // Only fronter/closer calls are listed; single calls are reached through the queue.
  const dualAssignments = assignmentsList.filter((a) => a.flowType === 'DUAL');

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  // Break clock. A break closes on its own at the limit; past it, re-check the
  // server quietly every 10 s until the break is gone. Keyed on the break's
  // id, so a re-check that returns the same break (a browser clock running
  // ahead of the server's) does not restart the clock or flash a spinner.
  const breakId = activeBreak?.id ?? null;
  const breakStartedAt = activeBreak?.startedAt ?? null;
  useEffect(() => {
    if (!breakId || !breakStartedAt) return;
    const endsAt = new Date(breakStartedAt).getTime() + breakMaxSeconds * 1000;
    let lastCheck = 0;
    const t = setInterval(() => {
      const now = Date.now();
      setClockNow(now);
      if (now >= endsAt + 2000 && now - lastCheck >= 10000) {
        lastCheck = now;
        loadAssignments(true);
      }
    }, 1000);
    return () => clearInterval(t);
    // loadAssignments is redefined each render; the break is what matters here.
  }, [breakId, breakStartedAt, breakMaxSeconds]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!token) return;
    loadAssignments();
  }, [token]);

  /** `quiet`: refresh without the loading spinner (background re-checks). */
  async function loadAssignments(quiet = false) {
    if (!quiet) setLoading(true);
    try {
      const [res, queue] = await Promise.all([
        assignmentsApi.my(token!),
        dialer.queue(token!).catch(() => null),
      ]);
      setAssignmentsList(res.data);
      setCallsInQueue(queue ? queue.data.callsInQueue : null);
      setOpenQueueSessionId(queue && !queue.data.openSessionIsDual ? queue.data.openSessionId : null);
      setActiveBreak(queue ? queue.data.activeBreak : null);
      setNextCustomerName(queue ? queue.data.nextCustomerName : null);
      if (queue) setBreakMaxSeconds(queue.data.breakMaxSeconds);
    } catch (err) {
      console.error('Failed to load assignments:', err);
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  /**
   * START MY QUEUE — the calls dial back to back from the call screen. The
   * server picks the next call; this click is also the gesture that lets the
   * customer's audio play, so it is unlocked here, before any await.
   */
  async function handleStartQueue() {
    if (!token || startingQueue) return;
    unlockAudioContext();
    setStartingQueue(true);
    try {
      // Starting the queue is the agent saying READY.
      await dialer.endBreak(token);
      let sessionId: string;
      if (openQueueSessionId) {
        // Pressing "Resume open call" is the agent choosing to take it here.
        sessionId = openQueueSessionId;
      } else {
        try {
          const res = await sessions.startNext(token);
          if (!res.data) {
            showNotice('info', 'No calls are waiting in your queue.');
            loadAssignments();
            return;
          }
          sessionId = res.data.id;
        } catch (err) {
          // A call opened since the list loaded: offer it instead of losing it.
          await loadAssignments();
          throw err;
        }
      }
      // Back from a break mid-run: keep the run, so the summary at the end
      // still lists the calls taken before the break.
      const queue = useQueueStore.getState();
      if (queue.mode === 'running') queue.advance(sessionId);
      else queue.start(sessionId);
      router.push(`/call?sessionId=${sessionId}`);
    } catch (err: any) {
      showNotice('error', err.message);
    } finally {
      setStartingQueue(false);
    }
  }

  /** End a break when there is nothing left to call. */
  async function handleEndBreak() {
    if (!token) return;
    try {
      await dialer.endBreak(token);
      await loadAssignments();
    } catch (err: any) {
      showNotice('error', err.message);
    }
  }

  async function handleShuffle() {
    if (!token || shuffling) return;
    setShuffling(true);
    try {
      const res = await dialer.shuffle(token);
      setNextCustomerName(res.data.nextCustomerName);
      showNotice('info', res.data.shuffled > 1 ? 'Queue shuffled.' : 'Nothing to shuffle.');
      await loadAssignments();
    } catch (err: any) {
      showNotice('error', err.message);
    } finally {
      setShuffling(false);
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
        // Started: a single call taken by hand ends any queue run in this tab.
        useQueueStore.getState().stop();
        router.push(`/call?sessionId=${res.data.session.id}&callId=${res.data.call.id}`);
      } else if (assignment.flowType === 'DUAL' && assignment.agentRole === 'VERIFIER') {
        // Verifier needs a callId — auto-linked when fronter transfers
        if (!assignment.callId) {
          showNotice('error', 'No call is ready for verification yet. The fronter must complete and transfer their call first.');
          return;
        }
        const res = await calls.startVerifier(token, assignment.callId, assignment.id);
        // Started: a single call taken by hand ends any queue run in this tab.
        useQueueStore.getState().stop();
        router.push(`/call?sessionId=${res.data.session.id}&callId=${assignment.callId}`);
      } else {
        // SINGLE flow — one agent, no transfer.
        const res = await sessions.start(token, assignment.id);
        // Started: a single call taken by hand ends any queue run in this tab.
        useQueueStore.getState().stop();
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
              Your trainer&apos;s calls are waiting in your queue. Start calling when you are ready.
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

        {/* ── THE DIALER (owner ruling 2026-09-16) ─────────────────────────────
          * Before a call the agent sees how many calls are waiting, the next
          * customer's NAME, and a way to start taking them — no age, mood,
          * scenario, difficulty or description (the server does not send
          * them). The single-call cards and their filters were removed. */}
        {loading ? (
          <div className="flex items-center justify-center py-14">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-air-signal border-t-transparent" />
          </div>
        ) : (
          <div className="air-panel mx-auto flex max-w-xl flex-col items-center rounded-[22px] border px-6 py-10 text-center backdrop-blur-md">
            {activeBreak && (
              <div className="mb-6 w-full rounded-[14px] border border-air-amber/40 bg-air-amber/10 px-4 py-3" role="status">
                <span className="block font-mono-ui text-[10px] font-bold uppercase tracking-[0.1em] text-air-amber">
                  On break · {BREAK_REASONS.find((r) => r.value === activeBreak.reason)?.label ?? 'Break'}
                </span>
                <span className="mt-1 block font-display text-[30px] font-extrabold tabular-nums leading-none text-air-text">
                  {(() => {
                    const sec = Math.max(0, Math.floor((clockNow - new Date(activeBreak.startedAt).getTime()) / 1000));
                    const h = Math.floor(sec / 3600);
                    const mm = String(Math.floor((sec % 3600) / 60)).padStart(h ? 2 : 1, '0');
                    const ss = String(sec % 60).padStart(2, '0');
                    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
                  })()}
                </span>
                <span className="mt-1.5 block text-[12px] text-air-muted">
                  Breaks end automatically after {Math.round(breakMaxSeconds / 60)} minutes.
                </span>
              </div>
            )}
            <span className="font-mono-ui text-[10.5px] font-bold uppercase tracking-[0.12em] text-air-faint">Calls in Queue</span>
            <span className="mt-2 font-display text-[64px] font-extrabold leading-none tracking-[-0.04em] text-air-text">
              {callsInQueue ?? '—'}
            </span>
            <p className="mt-3 max-w-sm text-[13px] leading-relaxed text-air-muted">
              {!openQueueSessionId && nextCustomerName && callsInQueue !== 0 && (
                <span className="mb-1 block text-air-text">Next customer: <span className="font-semibold">{nextCustomerName}</span></span>
              )}
              {openQueueSessionId
                ? 'You have a call still open. Resume it, and the queue continues after it.'
                : activeBreak && callsInQueue !== 0
                  ? 'Press Start calling when you are back. Your break ends and the next call dials.'
                : callsInQueue === 0
                  ? 'No calls waiting. Your trainer will assign more.'
                  : 'Calls connect one after another. Take a break from the call screen whenever you need one.'}
            </p>
            <div className="mt-6 flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row">
              <button
                type="button"
                onClick={handleStartQueue}
                disabled={startingQueue || callsInQueue === null || (callsInQueue === 0 && !openQueueSessionId)}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-air-signal to-air-signal-bright px-7 py-3 text-[14px] font-bold text-white shadow-[0_0_22px_rgb(var(--air-signal)/0.35)] transition-all duration-150 hover:-translate-y-px disabled:translate-y-0 disabled:opacity-50 disabled:shadow-none"
              >
                {startingQueue ? 'Dialing…' : openQueueSessionId ? '▶ Resume open call' : '▶ Start calling'}
              </button>
              {activeBreak && callsInQueue === 0 && !openQueueSessionId && (
                <button
                  type="button"
                  onClick={handleEndBreak}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-air-line/30 px-5 py-3 text-[13px] font-semibold text-air-text transition hover:border-air-line/50"
                >
                  End break
                </button>
              )}
              <button
                type="button"
                onClick={handleShuffle}
                disabled={shuffling || callsInQueue === null || callsInQueue < 2}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-air-line/30 px-5 py-3 text-[13px] font-semibold text-air-muted transition hover:border-air-line/50 hover:text-air-text disabled:opacity-50"
                title="Shuffle the order your queued calls will dial in"
              >
                {shuffling ? 'Shuffling…' : '⇄ Shuffle'}
              </button>
            </div>
          </div>
        )}

        {/* Fronter / closer calls cannot be queued — each depends on another
          * agent — so they keep a start button, still with no customer detail. */}
        {!loading && dualAssignments.length > 0 && (
          <div className="mx-auto mt-6 max-w-xl">
            <span className="mb-2 block font-mono-ui text-[10px] font-bold uppercase tracking-[0.1em] text-air-faint">Team calls</span>
            <div className="flex flex-col gap-2">
              {dualAssignments.map((assignment) => (
                <div key={assignment.id} className="air-panel flex items-center justify-between gap-3 rounded-[14px] border px-4 py-3">
                  <span className="text-[13px] font-semibold text-air-text">
                    {assignment.agentRole === 'VERIFIER' ? 'Closer call' : 'Fronter call'}
                    {assignment.scenario?.personaName && (
                      <span className="font-normal text-air-muted"> · {assignment.scenario.personaName}</span>
                    )}
                  </span>
                  <button
                    onClick={() => handleStartCall(assignment)}
                    disabled={startingId === assignment.id}
                    className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-air-signal to-air-signal-bright px-4 py-2 text-[12.5px] font-bold text-white transition hover:-translate-y-px disabled:translate-y-0 disabled:opacity-50"
                  >
                    {startingId === assignment.id ? 'Starting...' : assignment.agentRole === 'VERIFIER' ? 'Start Closer Call' : 'Start Fronter Call'}
                  </button>
                </div>
              ))}
            </div>
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