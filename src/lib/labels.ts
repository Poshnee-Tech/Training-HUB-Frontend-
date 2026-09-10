/**
 * Every word the trainee reads, in one place.
 *
 * WHY THIS FILE EXISTS
 * The API speaks in wire values — `MED_ALERT`, `AWAITING_REVIEW`, `queued`.
 * Those are contracts, not copy, and they were previously being printed
 * straight to the screen (or hand-formatted differently on each page, so
 * `MED_ALERT` read as "MED ALERT" on one page and "Med alert" on another).
 *
 * Everything here maps a wire value to a phrase a first-week agent
 * understands. Nothing here is sent back to the server, and no caller should
 * ever compare against these strings — always branch on the wire value and
 * label it at the point of render.
 *
 * HOUSE STYLE
 *   · Say what the trainee would say. "Practice call", not "session".
 *   · Never shout. "Try again", not "FAILED".
 *   · A status is a fact about the work, never a verdict on the person.
 *   · Keep the words the job actually uses — Fronter, Verifier, ACA,
 *     Medicare. Those are the curriculum, not jargon to translate away.
 */

/* ── products ─────────────────────────────────────────────── */

/**
 * `campaign` on the wire. Called "product" everywhere a trainee can see it —
 * "campaign" is dialer vocabulary that means nothing on day one.
 */
const PRODUCT_LABELS: Record<string, string> = {
  ACA: 'ACA',
  MEDICARE: 'Medicare',
  MED_ALERT: 'Medical Alert',
};

export function productLabel(campaign?: string | null): string {
  if (!campaign) return '—';
  return PRODUCT_LABELS[campaign] ?? titleCase(campaign);
}

/* ── difficulty ───────────────────────────────────────────── */

const DIFFICULTY_LABELS: Record<string, string> = {
  EASY: 'Easy',
  MEDIUM: 'Medium',
  HARD: 'Hard',
};

export function difficultyLabel(difficulty?: string | null): string {
  if (!difficulty) return '—';
  return DIFFICULTY_LABELS[difficulty] ?? titleCase(difficulty);
}

/* ── a practice call's own status ─────────────────────────── */

const SESSION_STATUS_LABELS: Record<string, string> = {
  COMPLETED: 'Finished',
  ACTIVE: 'On the call',
  IN_PROGRESS: 'On the call',
  WAITING: 'Waiting',
  ABANDONED: 'Left early',
};

export function sessionStatusLabel(status?: string | null): string {
  if (!status) return 'Not scored yet';
  return SESSION_STATUS_LABELS[status] ?? titleCase(status);
}

/* ── training steps ───────────────────────────────────────── */

/* ── scoring ──────────────────────────────────────────────── */

/**
 * The band shown beside a score. `band` is the server's own calibration when
 * it sent one; the numeric thresholds are the fallback and are unchanged from
 * the previous inline version.
 */
export function scoreBandLabel(score: number, band?: string): string {
  if (band === 'incomplete') return 'Incomplete';
  if (band === 'exceptional' || score > 90) return 'Excellent';
  if (band === 'good' || score >= 85) return 'Good';
  if (band === 'normal' || score >= 60) return 'Solid';
  return 'Needs work';
}

/**
 * What to show while a call is being scored, or when scoring did not happen.
 *
 * `tone` lets the caller pick a colour without re-deriving the meaning:
 *   pending — work is happening, nothing is wrong
 *   bad     — something needs a person to act
 */
export type EvaluationTone = 'pending' | 'bad';

export interface EvaluationCopy {
  title: string;
  body: string;
  tone: EvaluationTone;
}

export function evaluationStatusCopy(status: string): EvaluationCopy {
  switch (status) {
    case 'queued':
      return {
        title: 'Evaluation in progress',
        // MEASURED (2026-09-11): with the voice-delivery and accent checks a
        // full score takes two to three minutes, not "less than a minute".
        body: 'Your call is being scored. This takes two to three minutes with the voice and accent checks — your feedback will appear here.',
        tone: 'pending',
      };
    case 'processing':
      return {
        title: 'Evaluation in progress',
        body: 'Your call is being scored right now. This takes two to three minutes with the voice and accent checks — your feedback will appear here.',
        tone: 'pending',
      };
    case 'failed':
      return {
        title: 'We couldn’t score this call',
        body: 'Something went wrong on our side. Try again below, and tell your trainer if it keeps happening.',
        tone: 'bad',
      };
    case 'missing':
      return {
        title: 'This call wasn’t scored',
        body: 'No scoring was started for this call. You can start it below, or ask your trainer.',
        tone: 'bad',
      };
    default:
      return {
        title: 'We’re scoring your call',
        body: 'Check back in a moment — this page will show your feedback once it’s ready.',
        tone: 'pending',
      };
  }
}

/* ── helpers ──────────────────────────────────────────────── */

/** `MED_ALERT` -> `Med alert`. Last resort for a value this file doesn't know. */
function titleCase(value: string): string {
  const words = value.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
