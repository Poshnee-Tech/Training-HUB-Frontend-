'use client';

/**
 * "Your track to going live" — the gated journey as a column of stations.
 *
 * The presentation is new; the data contract is identical and nothing here
 * recomputes a lock. Every value still comes from the server's resolved
 * journey (`GET /api/journey/me`):
 *
 *   stage.status        LOCKED | AVAILABLE | IN_PROGRESS | AWAITING_REVIEW | PASSED | FAILED
 *   stage.locked        whether it may be opened at all
 *   stage.lockReason    plain-language "why", shown on locked stations
 *   stage.blockers[]    unlocked but not startable (e.g. no customers assigned)
 *   stage.bestScorePct / passThresholdPct / attemptsUsed / attemptsRemaining
 *
 * Only gated stages appear here. Always-available reference material renders
 * separately as study modules, so it can never read as locked.
 *
 * LAYOUT
 * The node now sits *inside* the card rather than in a gutter beside it, and
 * the connector is a short rule between cards. That buys back the ~70px gutter
 * the old rail cost on every row — which is what makes room for the stats to
 * sit on the right of each station instead of wrapping underneath it. All four
 * stat slots are always rendered, blank ones merely hidden, so the numbers line
 * up vertically down the whole track instead of shifting per station.
 */

import Link from 'next/link';
import type { JourneyStage } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Where each stage kind sends the agent. Unchanged. */
export function stageHref(stage: JourneyStage): string {
  switch (stage.kind) {
    case 'KNOWLEDGE':
      return `/knowledge/${(stage.knowledgeCampaign ?? 'ACA').toLowerCase()}`;
    case 'QUIZ':
      return `/quiz/${stage.slug}`;
    case 'MOCK_CALL':
      return '/mock-call';
    case 'CLIPS_LIBRARY':
      return '/clips';
    default:
      return '/dashboard';
  }
}

/** Two-letter node code, e.g. "Q1", "GT", "MC". */
function nodeCode(stage: JourneyStage, index: number): string {
  if (stage.kind === 'MOCK_CALL') return 'MC';
  if (stage.slug === 'grand-test') return 'GT';
  if (stage.kind === 'QUIZ') return `Q${index + 1}`;
  return String(index + 1);
}

export default function SignalLine({ stages }: { stages: JourneyStage[] }) {
  const gated = stages.filter((s) => !s.alwaysAvailable).sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <ol className="flex flex-col gap-4" role="list">
      {gated.map((stage, index) => (
        <Station
          key={stage.id}
          stage={stage}
          code={nodeCode(stage, index)}
          first={index === 0}
          delay={index * 90}
        />
      ))}
      <Terminal
        allCleared={gated.length > 0 && gated.every((s) => s.status === 'PASSED')}
        delay={gated.length * 90}
      />
    </ol>
  );
}

/**
 * The rule joining a station to the one above it.
 *
 * Solid once the signal has reached this far, dashed while the station is
 * still out of reach — the same distinction the node colours make, carried
 * through the line so the track reads as a route at a glance.
 */
function connector(reached: boolean, first: boolean): string {
  if (first) return '';
  return cn(
    "before:absolute before:left-[39px] before:top-[-17px] before:h-4 before:w-0 before:content-['']",
    reached
      ? 'before:border-l-2 before:border-solid before:border-air-amber/50'
      : 'before:border-l-2 before:border-dashed before:border-air-line/30',
  );
}

function Station({
  stage,
  code,
  first,
  delay,
}: {
  stage: JourneyStage;
  code: string;
  first: boolean;
  delay: number;
}) {
  const passed = stage.status === 'PASSED';
  const failed = stage.status === 'FAILED';
  // Handed in, waiting on a marker. Not a pass and not a failure — and not
  // something the agent can act on, so the station is not offered again.
  const marking = stage.status === 'AWAITING_REVIEW';

  // A locked station must not be a link. A disabled-looking control that still
  // navigates is exactly the failure this design avoids. A station awaiting
  // marking is the same case: reopening it would offer a second sitting of a
  // paper already handed in.
  const interactive = !stage.locked && !marking;

  return (
    <li
      className={cn(
        'floor-rise relative grid items-start gap-x-6 gap-y-4 rounded-[14px] border p-6',
        'grid-cols-[32px_minmax(0,1fr)] xl:grid-cols-[32px_minmax(0,1fr)_auto]',
        stage.locked ? 'floor-sunken border-air-line/15' : 'air-panel',
        // A locked station does not lift: nothing happens if you click it, and
        // a card that reacts to the pointer is a card that promises it will.
        !stage.locked &&
          'transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-air-line/35',
        connector(passed || !stage.locked, first),
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <Node stage={stage} code={code} passed={passed} failed={failed} />

      <div className="min-w-0 max-w-[60ch]">
        <div className="mb-1 flex flex-wrap items-center gap-3">
          <h3
            className={cn(
              'text-[16.5px] font-bold tracking-[-0.008em]',
              stage.locked ? 'text-air-faint' : 'text-air-text',
            )}
          >
            {stage.title}
          </h3>

          {passed ? (
            <Tag tone="done">Passed</Tag>
          ) : marking ? (
            <Tag tone="here">With your trainer</Tag>
          ) : failed ? (
            <Tag tone="bad">Try again</Tag>
          ) : stage.locked ? (
            <Tag tone="locked">Locked</Tag>
          ) : (
            <Tag tone="here">Do this next</Tag>
          )}

          {stage.kind === 'MOCK_CALL' && <Tag tone="locked">Final step</Tag>}
        </div>

        <p
          className={cn(
            'mb-4 text-[14px] leading-relaxed',
            stage.locked ? 'text-air-faint' : 'text-air-muted',
          )}
        >
          {stage.description}
        </p>

        {/* Unlocked but not startable — a different problem from a lock, and
            said differently so the agent knows who to chase. */}
        {!stage.locked &&
          stage.blockers.map((blocker) => (
            <p
              key={blocker}
              className="mb-4 flex items-start gap-2 rounded-[9px] border border-air-amber/25 bg-air-amber/[0.08] px-3 py-[7px] text-[12px] text-air-amber"
            >
              <WarnIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {blocker}
            </p>
          ))}

        {marking && (
          <p className="mb-4 flex items-start gap-2 rounded-[9px] border border-air-amber/25 bg-air-amber/[0.08] px-3 py-[7px] text-[12px] text-air-amber">
            <WarnIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            You&apos;ve handed this in. Your trainer is marking your written answers. Your result
            and the next step open once that&apos;s done.
          </p>
        )}

        {failed && stage.attemptsRemaining === 0 && (
          <p className="mb-4 flex items-start gap-2 rounded-[9px] border border-air-live/30 bg-air-live/[0.08] px-3 py-[7px] text-[12px] text-air-live">
            <WarnIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            You&apos;ve used all your attempts. Ask your trainer to reopen this step.
          </p>
        )}

        {interactive ? (
          <Link
            href={stageHref(stage)}
            className={cn(
              'group/btn inline-flex items-center justify-center gap-2 rounded-full px-[18px] py-2.5 text-[14px] font-semibold transition-all duration-150',
              passed
                ? 'floor-rule border text-air-signal hover:bg-air-line/[0.08]'
                : 'bg-air-signal text-white hover:-translate-y-px hover:bg-air-signal-bright hover:shadow-[0_10px_28px_-10px_rgb(var(--air-signal)/0.8)]',
            )}
          >
            {passed ? 'Review this step' : 'Start this step'}
            <ArrowIcon className="h-3.5 w-3.5 transition-transform duration-150 group-hover/btn:translate-x-1" />
          </Link>
        ) : (
          // The lock reason IS the label. A greyed "Begin station" tells the
          // agent nothing; "Pass the Grand Test to unlock" tells them the way
          // through, and it comes from the server rather than being guessed here.
          <span className="floor-sunken inline-flex items-center gap-2 rounded-full border border-dashed border-air-line/25 px-[18px] py-2.5 text-[13.5px] font-medium text-air-faint">
            {marking ? 'Waiting on your trainer' : (stage.lockReason ?? 'Locked')}
          </span>
        )}
      </div>

      <StationStats stage={stage} />
    </li>
  );
}

function Node({
  stage,
  code,
  passed,
  failed,
}: {
  stage: JourneyStage;
  code: string;
  passed: boolean;
  failed: boolean;
}) {
  const here = !stage.locked && !passed && stage.status !== 'AWAITING_REVIEW';

  return (
    <span
      className={cn(
        'relative mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full font-mono-ui text-[10px] font-bold tracking-[0.04em]',
        passed
          ? 'bg-air-amber text-white'
          : failed
            ? 'bg-air-live text-white'
            : here
              ? 'bg-air-signal text-white'
              : 'floor-sunken border border-air-line/20 text-air-faint',
      )}
      aria-hidden
    >
      {passed ? <CheckIcon className="h-3.5 w-3.5" /> : code}

      {/* Only the station you can actually act on pulses — it is the page's
          one "do this next" marker, and a second pulsing node would spend the
          signal. Sits behind the label via a negative inset ring. */}
      {here && (
        <span
          className="absolute -inset-1 rounded-full border-2 border-air-signal animate-air-ripple"
          aria-hidden
        />
      )}
    </span>
  );
}

/**
 * Four fixed stat slots per station.
 *
 * Slots a stage does not define are rendered and hidden rather than dropped,
 * so every station's "Best score" sits on the same vertical no matter which
 * other fields the server sent. `visibility: hidden` keeps the column width;
 * `display: none` would collapse it and reintroduce the ragged edge.
 */
function StationStats({ stage }: { stage: JourneyStage }) {
  return (
    <dl
      className={cn(
        'floor-rule grid grid-cols-2 gap-y-4 border-t pt-4 sm:grid-cols-4',
        'col-span-full xl:col-span-1 xl:grid-cols-[repeat(4,92px)] xl:gap-y-0 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0',
      )}
    >
      <Stat
        label="Best score"
        value={stage.bestScorePct != null ? `${stage.bestScorePct}%` : null}
        empty="None yet"
        good={stage.bestScorePct != null && stage.passThresholdPct != null && stage.bestScorePct >= stage.passThresholdPct}
      />
      <Stat label="Attempts" value={String(stage.attemptsUsed)} />
      <Stat
        label="Pass mark"
        value={stage.passThresholdPct != null ? `${stage.passThresholdPct}%` : undefined}
      />
      <Stat
        label="Retakes left"
        value={stage.attemptsAllowed != null ? String(stage.attemptsRemaining ?? 0) : undefined}
      />
    </dl>
  );
}

function Stat({
  label,
  value,
  empty,
  good,
}: {
  label: string;
  /** `undefined` hides the slot but keeps its column; `null` means "no value yet". */
  value?: string | null;
  empty?: string;
  good?: boolean;
}) {
  return (
    <div className={cn('min-w-0', value === undefined && 'invisible')} aria-hidden={value === undefined}>
      {value === null ? (
        <dd className="whitespace-nowrap font-mono-ui text-[12.5px] leading-[1.2] text-air-faint">{empty}</dd>
      ) : (
        <dd
          className={cn(
            'whitespace-nowrap font-mono-ui text-[19px] font-bold leading-[1.2] tracking-[-0.01em]',
            good ? 'text-air-mint' : 'text-air-text',
          )}
        >
          {value ?? '—'}
        </dd>
      )}
      <dt className="mt-1 font-mono-ui text-[10.5px] uppercase tracking-[0.11em] text-air-faint">
        {label}
      </dt>
    </div>
  );
}

/** End of the line. Not a stage — nothing is gated behind it. */
function Terminal({ allCleared, delay }: { allCleared: boolean; delay: number }) {
  return (
    <li
      className={cn(
        'floor-rise relative grid grid-cols-[32px_minmax(0,1fr)] items-start gap-x-6 rounded-[14px] border border-dashed p-6',
        allCleared ? 'border-air-live/40 bg-air-live/[0.07]' : 'border-air-line/25',
        connector(allCleared, false),
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <span
        className={cn(
          'mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full',
          allCleared ? 'bg-air-live text-white' : 'floor-sunken border border-air-line/20 text-air-faint',
        )}
        aria-hidden
      >
        <HeadsetIcon className="h-3.5 w-3.5" />
      </span>

      <div className="min-w-0 max-w-[60ch]">
        <div className="mb-1 flex flex-wrap items-center gap-3">
          <h3 className="text-[16.5px] font-bold tracking-[-0.008em] text-air-text">Taking live calls</h3>
          {allCleared ? (
            <span className="inline-flex items-center gap-2 rounded-full border border-air-live/50 bg-air-live/10 px-3 py-[3px] font-mono-ui text-[9.5px] font-bold uppercase tracking-[0.14em] text-air-live">
              <i className="h-[6px] w-[6px] rounded-full bg-air-live animate-air-blink" />
              Ready
            </span>
          ) : (
            <Tag tone="locked">Not yet</Tag>
          )}
        </div>
        <p className="text-[14px] leading-relaxed text-air-muted">
          {allCleared
            ? "You've finished your training. You're ready to take real calls."
            : "Finish every step above and you're ready to take real calls."}
        </p>
      </div>
    </li>
  );
}

function Tag({ tone, children }: { tone: 'done' | 'here' | 'locked' | 'bad'; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full border px-[9px] py-[3px] font-mono-ui text-[9.5px] uppercase tracking-[0.1em]',
        tone === 'done' && 'border-air-mint/35 text-air-mint',
        tone === 'here' && 'floor-sunken border-air-signal/35 text-air-signal',
        tone === 'bad' && 'border-air-live/35 text-air-live',
        tone === 'locked' && 'border-air-line/20 text-air-faint',
      )}
    >
      {children}
    </span>
  );
}

/* ── icons ────────────────────────────────────────────────── */

const S = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

function CheckIcon({ className }: { className?: string }) {
  return <svg className={className} {...S} strokeWidth={3}><path d="M20 6 9 17l-5-5" /></svg>;
}
function ArrowIcon({ className }: { className?: string }) {
  return <svg className={className} {...S} strokeWidth={2.4}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
}
function WarnIcon({ className }: { className?: string }) {
  return (
    <svg className={className} {...S} strokeWidth={2}>
      <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    </svg>
  );
}
function HeadsetIcon({ className }: { className?: string }) {
  return (
    <svg className={className} {...S} strokeWidth={2}>
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3ZM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3Z" />
    </svg>
  );
}
