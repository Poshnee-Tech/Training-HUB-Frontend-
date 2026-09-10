'use client';

import { create } from 'zustand';

/**
 * Auto-dial queue state. Lives in sessionStorage so a refresh mid-call
 * doesn't lose the trainee's progress through the queue.
 *
 * Intentionally separate from `call.store.ts`:
 *   - call.store.reset() runs whenever the URL session changes, which would
 *     wipe queue state we still need to drive the next session.
 *   - queue state is "recoverable UI state" (per code review), never the
 *     authoritative session state — server is.
 *
 * `activeSessionId` is the guard that prevents stale sessionStorage from
 * making a manual single-call run accidentally trip the queue lifecycle.
 */

const STORAGE_KEY = 'callsim:queue:v1';

export type QueueMode = 'idle' | 'running' | 'finishing' | 'done';

export interface QueueState {
  mode: QueueMode;
  assignmentIds: string[];
  cursor: number;                    // index of the assignment currently/just-now being run
  completedSessionIds: string[];     // sessions that already ran (for the summary URL)
  activeSessionId: string | null;    // session id the queue currently owns; null when idle/done

  start: (assignmentIds: string[], firstSessionId: string) => void;
  /**
   * Mark the current call done. Returns the fresh completedSessionIds list
   * so callers can build the summary URL without reading a stale closure.
   */
  markCurrentDone: (sessionId: string) => string[];
  /** Bump the cursor and bind the queue to the next session id. */
  advance: (nextSessionId: string) => void;
  /** Peek the next assignment id without mutating the store. */
  peekNext: () => string | null;
  setMode: (mode: QueueMode) => void;
  stop: () => void;
}

interface PersistedShape {
  mode: QueueMode;
  assignmentIds: string[];
  cursor: number;
  completedSessionIds: string[];
  activeSessionId: string | null;
}

function readPersisted(): PersistedShape | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedShape;
    // Defensive normalization — refusing to trust a `finishing` state across
    // a page reload is one of the explicit acceptance criteria. If we crashed
    // mid-advance, the queue is no longer mid-anything; demote to idle so the
    // user can restart cleanly.
    if (parsed.mode === 'finishing') {
      parsed.mode = 'idle';
      parsed.activeSessionId = null;
    }
    return parsed;
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

const initial: PersistedShape = readPersisted() ?? {
  mode: 'idle',
  assignmentIds: [],
  cursor: 0,
  completedSessionIds: [],
  activeSessionId: null,
};

export const useQueueStore = create<QueueState>((set, get) => ({
  ...initial,

  start: (assignmentIds, firstSessionId) => {
    const next: PersistedShape = {
      mode: 'running',
      assignmentIds,
      cursor: 0,
      completedSessionIds: [],
      activeSessionId: firstSessionId,
    };
    writePersisted(next);
    set(next);
  },

  markCurrentDone: (sessionId) => {
    const cur = get();
    const completed = cur.completedSessionIds.includes(sessionId)
      ? cur.completedSessionIds
      : [...cur.completedSessionIds, sessionId];
    const patch = { completedSessionIds: completed, activeSessionId: null };
    set(patch);
    writePersisted({
      mode: cur.mode,
      assignmentIds: cur.assignmentIds,
      cursor: cur.cursor,
      ...patch,
    });
    return completed;
  },

  advance: (nextSessionId) => {
    const cur = get();
    const nextCursor = cur.cursor + 1;
    const patch = {
      cursor: nextCursor,
      activeSessionId: nextSessionId,
      mode: 'running' as QueueMode,
    };
    set(patch);
    writePersisted({
      assignmentIds: cur.assignmentIds,
      completedSessionIds: cur.completedSessionIds,
      ...patch,
    });
  },

  peekNext: () => {
    const cur = get();
    return cur.assignmentIds[cur.cursor + 1] ?? null;
  },

  setMode: (mode) => {
    const cur = get();
    set({ mode });
    writePersisted({
      mode,
      assignmentIds: cur.assignmentIds,
      cursor: cur.cursor,
      completedSessionIds: cur.completedSessionIds,
      activeSessionId: cur.activeSessionId,
    });
  },

  stop: () => {
    clearPersisted();
    set({
      mode: 'idle',
      assignmentIds: [],
      cursor: 0,
      completedSessionIds: [],
      activeSessionId: null,
    });
  },
}));

/**
 * True only when the URL's sessionId matches the queue's owned session.
 * Manual single-call runs from the per-row Start button never satisfy this,
 * so they keep their old "end → /reports" behavior.
 */
export function isQueueOwnedSession(currentSessionId: string | null): boolean {
  if (!currentSessionId) return false;
  const q = useQueueStore.getState();
  return (q.mode === 'running' || q.mode === 'finishing') && q.activeSessionId === currentSessionId;
}
