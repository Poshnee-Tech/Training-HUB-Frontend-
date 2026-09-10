'use client';

/**
 * The agent's last practice sessions, as a table.
 *
 * WHAT CHANGED
 * This was a stack of two-line rows carrying a name, a date and — when one
 * existed — a score. Everything else the endpoint already returns was thrown
 * away. `GET /api/sessions` includes the scenario's campaign, the session
 * status and `durationSeconds` on every row, which is the difference between
 * "you practised something on Tuesday" and "you ran a 7-minute hard Medicare
 * call and it hasn't been scored yet".
 *
 * NO NEW REQUEST. Same call, same params, same fields — the previous layout
 * simply did not render most of them.
 *
 * Columns drop from the right as the viewport narrows, so the persona and the
 * outcome — the two a trainee actually scans for — survive to the smallest
 * width.
 */

import Link from 'next/link';
import { productLabel } from '@/lib/labels';
import { cn } from '@/lib/utils';

type Session = {
  id: string;
  createdAt: string;
  status?: string | null;
  durationSeconds?: number | null;
  scenario?: { name?: string | null; campaign?: string | null; difficulty?: string | null } | null;
  evaluation?: { overallScore?: number | null } | null;
};

export default function RecentCalls({ sessions }: { sessions: Session[] }) {
  return (
    <div className="air-panel floor-rise overflow-hidden rounded-[14px] border">
      <div className="floor-sunken hidden grid-cols-[minmax(0,2fr)_140px_150px_110px_96px_20px] items-center gap-6 border-b border-air-line/15 px-5 py-3 md:grid">
        <Th>Customer</Th>
        <Th className="max-xl:hidden">Product</Th>
        <Th>Date</Th>
        <Th>Score</Th>
        <Th className="text-right">Duration</Th>
        <span />
      </div>

      {sessions.map((session) => (
        <Link
          key={session.id}
          href={`/reports/${session.id}`}
          className={cn(
            'group floor-rule grid items-center gap-4 border-b px-5 py-4 transition-colors last:border-b-0 hover:bg-air-line/[0.06]',
            'grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,2fr)_140px_150px_110px_96px_20px] md:gap-6',
          )}
        >
          <span className="truncate text-[14.5px] font-semibold text-air-text">
            {session.scenario?.name ?? 'Practice call'}
          </span>

          <Cell className="max-md:hidden max-xl:hidden">
            {productLabel(session.scenario?.campaign)}
          </Cell>

          <Cell className="max-md:hidden">{formatWhen(session.createdAt)}</Cell>

          <Outcome session={session} />

          <Cell className="text-right max-md:hidden">
            {formatDuration(session.durationSeconds)}
          </Cell>

          <ChevronIcon className="hidden h-4 w-4 shrink-0 -rotate-90 justify-self-end stroke-air-faint transition-transform duration-150 group-hover:translate-x-1 md:block" />
        </Link>
      ))}
    </div>
  );
}

/**
 * The result of a call, in one cell.
 *
 * A score when there is one, otherwise the session's own status in plain
 * words. The distinction matters: "Unscored" and "0%" look nothing alike to a
 * trainee, and the old row showed nothing at all when a score was missing,
 * which read as a rendering gap rather than as a call still waiting on the
 * evaluator.
 */
function Outcome({ session }: { session: Session }) {
  const score = session.evaluation?.overallScore;

  if (score != null) {
    return (
      <span
        className={cn(
          'justify-self-start whitespace-nowrap font-mono-ui text-[13.5px] font-bold',
          score >= 80 ? 'text-air-mint' : score >= 60 ? 'text-air-amber' : 'text-air-live',
        )}
      >
        {Math.round(score)}%
      </span>
    );
  }

  return (
    <span className="floor-sunken justify-self-start whitespace-nowrap rounded-full border border-air-line/20 px-[9px] py-[3px] font-mono-ui text-[10px] uppercase tracking-[0.08em] text-air-muted">
      {outcomeLabel(session.status)}
    </span>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <span className={cn('font-mono-ui text-[10.5px] uppercase tracking-[0.11em] text-air-faint', className)}>
      {children}
    </span>
  );
}

function Cell({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <span className={cn('truncate font-mono-ui text-[11.5px] text-air-muted', className)}>
      {children}
    </span>
  );
}

/**
 * What to show in the score column when there is no score.
 *
 * Deliberately not the shared `sessionStatusLabel`: in this column a finished
 * call has not been scored *yet*, and "Finished" would read as the outcome
 * rather than as the reason a number is missing.
 */
function outcomeLabel(status?: string | null): string {
  switch (status) {
    case 'ACTIVE':
    case 'IN_PROGRESS':
      return 'On the call';
    case 'WAITING':
      return 'Waiting';
    case 'ABANDONED':
      return 'Left early';
    default:
      return 'Not scored yet';
  }
}

/** `Aug 12, 08:53 PM` — the mock's format, and short enough for the column. */
function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Em dash rather than 0:00 when the session never recorded a duration. */
function formatDuration(seconds?: number | null): string {
  if (seconds == null || seconds <= 0) return '—';
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
