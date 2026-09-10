'use client';

/**
 * The three cards in the dashboard's right rail.
 *
 * Grouped in one file because they only ever appear together, in this order,
 * as one sticky column: what to do next, how far along you are, and how you
 * have been doing. Splitting them into three files would spread one idea
 * across three imports.
 *
 * WHAT MOVED HERE AND WHY
 * "Next stop" used to be a full-bleed hero banner across the top of the page,
 * which pushed the actual track — the thing the page is about — below the
 * fold. In the rail it stays visible while the agent scrolls the track, which
 * is when they are most likely to act on it. Progress and the practice stats
 * moved for the same reason: they are reference, not content.
 *
 * Every value is the same server field the previous layout read. Nothing here
 * computes a lock, a threshold or an estimate.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { JourneyMap, JourneyStage } from '@/lib/api';
import { stageHref } from './SignalLine';

/* ── next stop ────────────────────────────────────────────── */

/**
 * Bar heights for the decorative waveform under the call to action.
 *
 * A fixed pattern, not random: `Math.random()` here would give the server and
 * the client two different sets of heights and hydration would mismatch.
 */
const WAVE = [14, 26, 40, 58, 72, 60, 48, 74, 52, 38, 52, 44, 28, 18, 32, 46, 24, 36, 20, 30];

export function NextStopCard({ stage }: { stage: JourneyStage }) {
  return (
    <article className="air-panel floor-rise overflow-hidden rounded-[14px] border border-l-[3px] border-l-air-signal">
      <div className="p-5">
        <span className="mb-3 block font-mono-ui text-[10.5px] uppercase tracking-[0.11em] text-air-amber">
          Do this next
        </span>

        <h2 className="mb-2 text-[21px] font-bold leading-[1.25] tracking-[-0.014em] text-air-text">
          {stage.title}
        </h2>
        <p className="mb-5 text-[14px] leading-relaxed text-air-muted">{stage.description}</p>

        {/* Only facts the journey API actually returns. There is deliberately
            no "~25 min" estimate: the endpoint exposes no duration, and
            printing an invented one to a trainee is fabricated data. */}
        <dl className="mb-5 flex flex-col gap-2">
          {stage.passThresholdPct != null && (
            <Fact label="Pass mark" value={`${stage.passThresholdPct}%`} />
          )}
          {stage.attemptsAllowed != null && (
            <Fact
              label="Attempts left"
              value={`${stage.attemptsRemaining ?? 0} of ${stage.attemptsAllowed}`}
            />
          )}
          {stage.bestScorePct != null && (
            <Fact label="Your best" value={`${stage.bestScorePct}%`} />
          )}
        </dl>

        <Link
          href={stageHref(stage)}
          className="group flex w-full items-center justify-center gap-2 rounded-full bg-air-signal px-[18px] py-2.5 text-[14px] font-semibold text-white shadow-[0_0_0_rgb(var(--air-signal)/0)] transition-all duration-150 hover:-translate-y-px hover:bg-air-signal-bright hover:shadow-[0_10px_28px_-10px_rgb(var(--air-signal)/0.8)]"
        >
          {stage.kind === 'QUIZ' ? 'Start the test' : 'Start this step'}
          <ArrowIcon className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-1" />
        </Link>
      </div>

      {/* Live signal. Each bar runs the same scaleY loop offset by its index,
          which is what reads as a travelling wave rather than twenty bars
          breathing in unison. Decorative, so it carries aria-hidden and the
          reduced-motion rule in globals.css stops it dead. */}
      <div
        className="floor-rule floor-sunken flex h-20 items-center justify-center gap-[3px] border-t px-4"
        aria-hidden
      >
        {WAVE.map((h, i) => (
          <i
            key={i}
            className="block w-[3px] origin-center rounded-sm bg-gradient-to-b from-air-cyan to-air-signal opacity-70 animate-air-bar"
            style={{ height: h, animationDelay: `${i * 0.07}s` }}
          />
        ))}
      </div>
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between font-mono-ui text-[11.5px] text-air-muted">
      <dt>{label}</dt>
      <dd className="font-bold text-air-text">{value}</dd>
    </div>
  );
}

/* ── headset progress ─────────────────────────────────────── */

/**
 * Progress ring plus the station checklist beneath it.
 *
 * The ring is SVG rather than the conic-gradient `.air-ring` the old card
 * used, because at 52px a conic gradient renders a visibly stepped edge and
 * cannot take a round cap. Same two numbers drive it — `completedCount` and
 * `gatedCount`, straight from the server.
 *
 * The checklist shows the gated stations plus the terminal, so the rail and
 * the track below always tell the same story about where the agent is.
 */
export function HeadsetProgress({ journey }: { journey: JourneyMap }) {
  const gated = journey.stages
    .filter((s) => !s.alwaysAvailable)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const pct = journey.gatedCount === 0
    ? 0
    : Math.round((journey.completedCount / journey.gatedCount) * 100);

  const R = 21;
  const C = 2 * Math.PI * R;
  const allCleared = gated.length > 0 && gated.every((s) => s.status === 'PASSED');

  // The arc sweeps up to its value on mount rather than appearing already
  // drawn. The transition on `stroke-dashoffset` can only fire if the offset
  // actually changes, so the first paint has to be an empty ring — hence the
  // state flip in an effect rather than rendering the final value outright.
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <article className="air-panel floor-rise rounded-[14px] border p-5" style={{ animationDelay: '90ms' }}>
      <div className="mb-4 flex items-center gap-4">
        <div className="relative h-[52px] w-[52px] shrink-0">
          <svg width="52" height="52" className="-rotate-90" aria-hidden>
            <circle cx="26" cy="26" r={R} fill="none" stroke="rgb(var(--air-line) / 0.2)" strokeWidth="4.5" />
            <circle
              cx="26"
              cy="26"
              r={R}
              fill="none"
              stroke="rgb(var(--air-amber))"
              strokeWidth="4.5"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={drawn ? C * (1 - pct / 100) : C}
              style={{ transition: 'stroke-dashoffset .8s cubic-bezier(.2,.8,.2,1)' }}
            />
          </svg>
          <span className="absolute inset-0 grid place-items-center font-mono-ui text-[12px] font-bold text-air-signal">
            {pct}%
          </span>
        </div>

        <div className="min-w-0">
          <h3 className="text-[16.5px] font-bold tracking-[-0.008em] text-air-text">Your progress</h3>
          <p className="mt-0.5 font-mono-ui text-[10.5px] uppercase tracking-[0.11em] text-air-muted">
            {journey.completedCount} of {journey.gatedCount} steps done
          </p>
        </div>
      </div>

      <ol className="floor-rule flex flex-col gap-2 border-t pt-4">
        {gated.map((stage) => (
          <Step
            key={stage.id}
            label={stage.title}
            done={stage.status === 'PASSED'}
            here={stage.slug === journey.nextStageSlug}
          />
        ))}
        <Step label="Taking live calls" done={allCleared} here={false} />
      </ol>
    </article>
  );
}

function Step({ label, done, here }: { label: string; done: boolean; here: boolean }) {
  return (
    <li
      className={`flex items-center gap-3 text-[13.5px] ${
        here ? 'font-semibold text-air-text' : 'text-air-muted'
      }`}
    >
      <span
        className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border transition-colors duration-300 ${
          done
            ? 'border-air-amber bg-air-amber text-white'
            : here
              ? 'border-air-signal shadow-[inset_0_0_0_3px_rgb(var(--air-signal))] animate-air-blink'
              : 'floor-sunken border-air-line/20'
        }`}
        aria-hidden
      >
        {done && (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" className="h-2.5 w-2.5">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
      </span>
      {label}
    </li>
  );
}

/* ── learning snapshot ────────────────────────────────────── */

/**
 * The practice stats, as a compact definition list rather than the four large
 * tiles they used to be.
 *
 * A stat with no data says so in words. Rendering "0%" for an agent who has
 * never been scored reads as a bad score rather than as no score, which is the
 * one thing a trainee should never be told by mistake.
 */
/** One scored call, as `GET /api/evaluations/my-stats` returns it. */
interface ScorePoint {
  score: number;
  date: string;
}

/**
 * Practice stats.
 *
 * THREE OF THESE FOUR NUMBERS WERE BLANK
 * The card asked for `averageScore`, `bestScore` and `sessionsThisWeek`.
 * The endpoint sends none of those. It sends `averageScores` — plural, an
 * object with a score per skill — plus `scoreHistory`, every scored call with
 * its date. So the lookups came back undefined and the card told an agent with
 * 150 scored calls that they had none.
 *
 * Best score and this week are not sent at all; both are derived here from
 * `scoreHistory`, which is the whole set rather than a sample.
 */
export function LearningSnapshot({ stats }: { stats: any }) {
  const history: ScorePoint[] = Array.isArray(stats?.scoreHistory) ? stats.scoreHistory : [];

  const avg: number | null = stats?.averageScores?.overall ?? null;
  const best: number | null = history.length
    ? history.reduce((hi, p) => (p.score > hi ? p.score : hi), history[0].score)
    : null;

  // Counts calls SCORED in the last seven days, which is what the endpoint can
  // actually tell us — a call made yesterday and not yet scored is not in here.
  // The label says "scored" rather than "calls" so the number is not read as
  // something it isn't.
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const thisWeek = history.filter((p) => new Date(p.date).getTime() >= weekAgo).length;

  return (
    <article className="air-panel floor-rise rounded-[14px] border p-5" style={{ animationDelay: '180ms' }}>
      <h4 className="mb-4 text-[13.5px] font-bold text-air-text">Your learning so far</h4>

      <dl className="flex flex-col">
        <Snap label="Practice calls" value={stats?.totalSessions ?? 0} />
        <Snap
          label="Average score"
          value={avg != null ? `${Math.round(avg)}%` : null}
          empty="No scored calls yet"
          tone={avg != null ? scoreTone(avg) : undefined}
        />
        <Snap
          label="Best score"
          value={best != null ? `${Math.round(best)}%` : null}
          empty="No scored calls yet"
          tone={best != null ? scoreTone(best) : undefined}
        />
        <Snap label="Scored this week" value={thisWeek} unit={thisWeek === 1 ? 'call' : 'calls'} />
      </dl>
    </article>
  );
}

function Snap({
  label,
  value,
  unit,
  empty,
  tone,
}: {
  label: string;
  value: string | number | null;
  unit?: string;
  empty?: string;
  tone?: string;
}) {
  return (
    <div className="floor-rule flex items-baseline justify-between gap-4 border-b py-3 last:border-b-0 last:pb-0">
      <dt className="font-mono-ui text-[10.5px] uppercase tracking-[0.11em] text-air-faint">{label}</dt>
      <dd className="text-right">
        {value === null ? (
          <span className="text-[12.5px] text-air-faint">{empty}</span>
        ) : (
          <span className={`font-mono-ui text-[20px] font-bold tracking-[-0.01em] ${tone ?? 'text-air-text'}`}>
            {value}
            {unit && <small className="ml-1.5 text-[12px] font-normal text-air-muted">{unit}</small>}
          </span>
        )}
      </dd>
    </div>
  );
}

/**
 * Score colour for the floor.
 *
 * `getScoreColor` in lib/utils returns fixed 600-weight greens and yellows,
 * which fall below comfortable contrast on the dark background. These resolve
 * to the themed tokens instead. Same thresholds — presentation only.
 */
function scoreTone(score: number): string {
  if (score >= 80) return 'text-air-mint';
  if (score >= 60) return 'text-air-amber';
  return 'text-air-live';
}

function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
