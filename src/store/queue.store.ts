'use client';

import { create } from 'zustand';
import type { BreakReason } from '@/lib/api';

/**
 * Dialer queue state for this browser tab. Lives in sessionStorage so a
 * refresh mid-run keeps the list of calls taken and a break asked for.
 *
 * The SERVER owns the queue itself: what the next call is, how many are left,
 * and whether the agent is on a break (`/api/agents/queue`,
 * `/api/sessions/start-next`). This store only remembers what the run needs
 * that the server does not: which calls this run has taken (for the summary
 * page) and a break asked for during a live call, to take once it closes.
 *
 * Intentionally separate from `call.store.ts`: call.store.reset() runs
 * whenever the URL session changes, which would wipe this.
 *
 * `activeSessionId` is the guard that stops stale sessionStorage from making
 * a manual single-call run behave like a queue call.
 */

const STORAGE_KEY = 'callsim:queue:v2';

export type QueueMode = 'idle' | 'running';

interface PersistedShape {
  mode: QueueMode;
  completedSessionIds: string[];      // calls this run has finished, in order (the summary URL)
  activeSessionId: string | null;     // the queue call on the line; null between calls
  pendingBreakReason: BreakReason | null; // break asked for during a call, taken after it closes
  /**
   * A queue call whose end request failed, with the disposition the agent
   * picked, so RETRY — even after a reload — records their answer.
   */
  failedEnd: { sessionId: string; disposition?: string } | null;
}

export interface QueueState extends PersistedShape {
  start: (firstSessionId: string) => void;
  /**
   * Mark the current call done. Returns the fresh completedSessionIds list so
   * callers can build the summary URL without reading a stale closure.
   */
  markCurrentDone: (sessionId: string) => string[];
  /** Bind the queue to the call that just dialed. */
  advance: (nextSessionId: string) => void;
  setPendingBreak: (reason: BreakReason | null) => void;
  setFailedEnd: (failed: { sessionId: string; disposition?: string } | null) => void;
  stop: () => void;
}

const EMPTY: PersistedShape = {
  mode: 'idle',
  completedSessionIds: [],
  activeSessionId: null,
  pendingBreakReason: null,
  failedEnd: null,
};

function readPersisted(): PersistedShape | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedShape>;
    if (parsed.mode !== 'running') return null;
    return {
      mode: 'running',
      completedSessionIds: Array.isArray(parsed.completedSessionIds) ? parsed.completedSessionIds : [],
      activeSessionId: typeof parsed.activeSessionId === 'string' ? parsed.activeSessionId : null,
      pendingBreakReason: parsed.pendingBreakReason ?? null,
      failedEnd: parsed.failedEnd && typeof parsed.failedEnd.sessionId === 'string' ? parsed.failedEnd : null,
    };
  } catch {
    return null;
  }
}

function writePersisted(state: PersistedShape): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

function clearPersisted(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {}
}

function snapshot(s: PersistedShape): PersistedShape {
  return {
    mode: s.mode,
    completedSessionIds: s.completedSessionIds,
    activeSessionId: s.activeSessionId,
    pendingBreakReason: s.pendingBreakReason,
    failedEnd: s.failedEnd,
  };
}

export const useQueueStore = create<QueueState>((set, get) => {
  const commit = (patch: Partial<PersistedShape>) => {
    set(patch);
    writePersisted(snapshot(get()));
  };

  return {
    ...(readPersisted() ?? EMPTY),

    start: (firstSessionId) => {
      commit({ ...EMPTY, mode: 'running', activeSessionId: firstSessionId });
    },

    markCurrentDone: (sessionId) => {
      const cur = get();
      const completed = cur.completedSessionIds.includes(sessionId)
        ? cur.completedSessionIds
        : [...cur.completedSessionIds, sessionId];
      commit({ completedSessionIds: completed, activeSessionId: null });
      return completed;
    },

    advance: (nextSessionId) => {
      commit({ mode: 'running', activeSessionId: nextSessionId });
    },

    setPendingBreak: (reason) => {
      commit({ pendingBreakReason: reason });
    },

    setFailedEnd: (failed) => {
      commit({ failedEnd: failed });
    },

    stop: () => {
      clearPersisted();
      set({ ...EMPTY });
    },
  };
});

// ── HAS THIS PAGE HAD A CLICK? ──────────────────────────────────────────────
// Browsers only let audio start without a click once the page has had one.
// `navigator.userActivation` answers that directly; where it is missing
// (Safari before 16.4) a click or key seen since this bundle loaded stands in.
// This module is loaded by the assignments page too, so the click on
// "Start my queue" is seen before the call screen exists.
let gestureSeen = false;
if (typeof document !== 'undefined') {
  const seen = () => { gestureSeen = true; };
  document.addEventListener('pointerdown', seen, { capture: true, once: true });
  document.addEventListener('keydown', seen, { capture: true, once: true });
}

export function pageHasHadUserGesture(): boolean {
  if (typeof navigator === 'undefined') return false;
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return activation ? activation.hasBeenActive : gestureSeen;
}

/**
 * True when the URL's session belongs to the running queue: the call on the
 * line, or one this run already finished (the agent is between calls).
 * Manual single-call runs never satisfy this, so they keep their
 * "end → /reports" behaviour.
 */
export function isQueueSession(sessionId: string | null): boolean {
  if (!sessionId) return false;
  const q = useQueueStore.getState();
  return q.mode === 'running'
    && (q.activeSessionId === sessionId || q.completedSessionIds.includes(sessionId));
}
