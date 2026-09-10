'use client';

/**
 * Agent dashboard — the training floor.
 *
 * Layout/UX only. Journey access and lock state remain server-owned:
 *   GET /api/journey/me
 *
 * This page renders stage.locked / stage.lockReason exactly as received.
 */

import { useCallback, useEffect, useState } from 'react';
import TrainingFloorShell, {
  useNavCounts,
} from '@/components/layout/TrainingFloorShell';
import SignalLine from '@/components/dashboard/SignalLine';
import BestClips from '@/components/dashboard/BestClips';
import { NextStopCard } from '@/components/dashboard/RailCards';
import { useAuthStore } from '@/store/auth.store';
import {
  journey as journeyApi,
  type JourneyMap as JourneyMapData,
} from '@/lib/api';

export default function DashboardPage() {
  return (
    <TrainingFloorShell>
      <DashboardBody />
    </TrainingFloorShell>
  );
}

function DashboardBody() {
  const { token, user, authResolved, loadFromStorage } = useAuthStore();
  const { setCounts } = useNavCounts();

  const [journey, setJourney] = useState<JourneyMapData | null>(null);
  const [journeyError, setJourneyError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [clipTotals, setClipTotals] = useState<{
    sections: number;
    clips: number;
  } | null>(null);

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  const load = useCallback(async () => {
    if (!token) {
      if (authResolved) {
        setJourneyError(
          'We couldn’t restore your sign-in. Please sign in again.',
        );
        setLoading(false);
      }
      return;
    }

    if (journey) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setJourneyError(null);

    try {
      const res = await journeyApi.me(token);
      setJourney(res.data);
    } catch (err: any) {
      setJourneyError(
        err.message || 'We couldn’t load your training plan.',
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, authResolved, journey]);

  useEffect(() => {
    if (!token && !authResolved) return;
    void load();
    // Initial fetch follows auth state only. `journey` is intentionally
    // excluded so receiving data does not immediately trigger another request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, authResolved]);

  const onClipCounts = useCallback(
    (totals: { sections: number; clips: number }) => {
      setClipTotals(totals);

      setCounts({
        '/clips': totals.clips > 0 ? totals.clips : undefined,
      });
    },
    [setCounts],
  );

  const nextStage =
    journey?.stages.find(
      (stage) => stage.slug === journey.nextStageSlug,
    ) ?? null;

  const remaining = journey
    ? Math.max(0, journey.gatedCount - journey.completedCount)
    : 0;

  const gatedCount = journey?.gatedCount ?? 0;
  const completedCount = journey?.completedCount ?? 0;

  const progressPercent =
    gatedCount > 0
      ? Math.min(
          100,
          Math.max(0, Math.round((completedCount / gatedCount) * 100)),
        )
      : 0;

  return (
    <main className="w-full min-w-0 px-6 py-7 pb-12 lg:px-8">
      <div className="mx-auto w-full max-w-[1500px]">
        {/* Header */}
        <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-air-signal shadow-[0_0_10px_rgb(var(--air-signal))]" />
              <span className="font-mono-ui text-[10.5px] font-bold uppercase tracking-[0.12em] text-air-faint">
                Training floor
              </span>
            </div>

            <h1 className="font-display text-[28px] font-extrabold tracking-[-0.035em] text-air-text">
              Welcome back, {user?.firstName ?? 'agent'}
            </h1>

            <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-air-muted">
              {journey && remaining > 0
                ? `You have ${remaining} ${
                    remaining === 1 ? 'step' : 'steps'
                  } left before you are ready for real calls.`
                : journey && gatedCount > 0
                  ? 'Your required training steps are complete. You are ready for real calls.'
                  : 'Work through your training plan and each completed step will unlock what comes next.'}
            </p>
          </div>

          {!loading && (
            <button
              type="button"
              onClick={() => void load()}
              disabled={refreshing}
              className="air-panel inline-flex min-h-10 items-center gap-2 rounded-xl border px-4 py-2.5 text-[12.5px] font-semibold text-air-muted transition hover:border-air-line/40 hover:text-air-text disabled:opacity-50"
            >
              <RefreshGlyph
                className={`h-4 w-4 stroke-current ${
                  refreshing ? 'animate-spin' : ''
                }`}
              />
              {refreshing ? 'Updating' : 'Refresh'}
            </button>
          )}
        </header>

        {/* Compact progress strip */}
        {!loading && journey && (
          <section className="air-panel mb-4 rounded-[18px] border px-4 py-3.5">
            <div className="flex flex-wrap items-center gap-4">
              <div className="min-w-[160px]">
                <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-air-faint">
                  Required training
                </div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="font-display text-[20px] font-extrabold text-air-text">
                    {completedCount}
                  </span>
                  <span className="text-[12px] text-air-muted">
                    of {gatedCount} complete
                  </span>
                </div>
              </div>

              <div className="min-w-[220px] flex-1">
                <div className="h-2 overflow-hidden rounded-full bg-air-line/15">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-air-signal to-air-cyan transition-[width] duration-500"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>

              <span className="shrink-0 rounded-full border border-air-line/30 bg-air-line/[0.05] px-2.5 py-1 font-mono-ui text-[9.5px] font-bold uppercase tracking-[0.08em] text-air-muted">
                {progressPercent}% complete
              </span>
            </div>
          </section>
        )}

        {journeyError && journey && (
          <div
            role="alert"
            className="mb-5 flex items-start justify-between gap-4 rounded-2xl border border-air-live/30 bg-air-live/[0.08] px-4 py-3.5"
          >
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-air-live/10 text-[12px] font-bold text-air-live">
                !
              </span>
              <p className="min-w-0 text-[13px] font-medium leading-relaxed text-air-live">
                {journeyError}
              </p>
            </div>

            <button
              type="button"
              onClick={() => void load()}
              className="shrink-0 text-[12px] font-semibold text-air-live"
            >
              Retry
            </button>
          </div>
        )}

        {/* Workspace */}
        <div
          className={`grid items-start gap-4 transition-opacity duration-200 xl:grid-cols-[minmax(0,1fr)_300px] xl:gap-4 ${
            refreshing ? 'opacity-60' : 'opacity-100'
          }`}
          aria-busy={refreshing}
        >
          {/* Main column */}
          <div className="flex min-w-0 flex-col gap-6">
            <section id="journey" className="scroll-mt-20">
              <SectionHead
                eyebrow="Your route"
                title="Training Plan"
                blurb="Finish each required step to unlock the next one. Reference material remains available throughout."
                aside={
                  journey && gatedCount > 0
                    ? `${completedCount}/${gatedCount} complete`
                    : undefined
                }
              />

              {loading ? (
                <JourneySkeleton />
              ) : journeyError && !journey ? (
                <TrainingError
                  message={journeyError}
                  onRetry={() => void load()}
                />
              ) : journey ? (
                <SignalLine stages={journey.stages} />
              ) : null}
            </section>

            <section id="clips" className="scroll-mt-20">
              <SectionHead
                eyebrow="Listen and learn"
                title="Example Calls"
                blurb="Hear how strong agents handle real conversations, objections, and call flow."
                aside={
                  clipTotals
                    ? `${clipTotals.clips} ${
                        clipTotals.clips === 1 ? 'example' : 'examples'
                      } · ${clipTotals.sections} ${
                        clipTotals.sections === 1 ? 'section' : 'sections'
                      }`
                    : undefined
                }
              />

              <BestClips onCounts={onClipCounts} />
            </section>
          </div>

          {/* Right rail */}
          <aside className="flex min-w-0 flex-col gap-3 max-xl:grid max-xl:[grid-template-columns:repeat(auto-fit,minmax(280px,1fr))] max-xl:items-start xl:sticky xl:top-[82px]">
            <div className="px-1">
              <h2 className="text-[13px] font-bold text-air-text">
                What’s next
              </h2>
              <p className="mt-0.5 text-[11.5px] text-air-muted">
                Your next available action.
              </p>
            </div>

            {nextStage && !nextStage.locked ? (
              <NextStopCard stage={nextStage} />
            ) : journey && gatedCount > 0 && remaining === 0 ? (
              <RailMessage
                title="Required training complete"
                description="You have finished the required training route."
                tone="success"
              />
            ) : !loading && journey ? (
              <RailMessage
                title="No next step available yet"
                description="Complete the currently open training step to continue."
              />
            ) : null}
          </aside>
        </div>
      </div>
    </main>
  );
}

function SectionHead({
  eyebrow,
  title,
  blurb,
  aside,
  action,
}: {
  eyebrow?: string;
  title: string;
  blurb: string;
  aside?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-5 gap-y-2">
      <div>
        {eyebrow && (
          <p className="mb-1 font-mono-ui text-[9.5px] font-bold uppercase tracking-[0.12em] text-air-faint">
            {eyebrow}
          </p>
        )}

        <h2 className="text-[18px] font-bold leading-[1.25] tracking-[-0.014em] text-air-text">
          {title}
        </h2>

        <p className="mt-1 max-w-[66ch] text-[12.5px] leading-relaxed text-air-muted">
          {blurb}
        </p>
      </div>

      {action ??
        (aside ? (
          <span className="shrink-0 rounded-full border border-air-line/30 bg-air-line/[0.05] px-2.5 py-1 font-mono-ui text-[9.5px] font-bold uppercase tracking-[0.08em] text-air-faint">
            {aside}
          </span>
        ) : null)}
    </div>
  );
}

function JourneySkeleton() {
  return (
    <div className="air-panel rounded-[18px] border p-5">
      <div className="space-y-3">
        {[0, 1, 2, 3, 4].map((item) => (
          <div
            key={item}
            className="flex items-center gap-3 rounded-2xl border border-air-line/15 p-3"
          >
            <div className="h-9 w-9 animate-pulse rounded-full bg-air-line/15" />
            <div className="flex-1">
              <div className="h-3.5 w-1/3 animate-pulse rounded bg-air-line/20" />
              <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-air-line/10" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrainingError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="air-panel flex min-h-[280px] flex-col items-center justify-center rounded-[18px] border px-6 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl border border-air-live/25 bg-air-live/[0.08] text-air-live">
        <AlertGlyph className="h-5 w-5 stroke-current" />
      </div>

      <h3 className="mt-4 text-[15px] font-bold text-air-text">
        We couldn’t load your training plan
      </h3>

      <p className="mt-1.5 max-w-md text-[12.5px] leading-relaxed text-air-muted">
        {message}
      </p>

      <button
        type="button"
        onClick={onRetry}
        className="mt-5 inline-flex items-center gap-2 rounded-xl bg-air-signal px-4 py-2.5 text-[12.5px] font-bold text-white transition hover:brightness-110"
      >
        <RefreshGlyph className="h-4 w-4 stroke-current" />
        Try again
      </button>
    </div>
  );
}

function RailMessage({
  title,
  description,
  tone = 'neutral',
}: {
  title: string;
  description: string;
  tone?: 'neutral' | 'success';
}) {
  const toneClass =
    tone === 'success'
      ? 'border-air-mint/25 bg-air-mint/[0.06]'
      : 'border-air-line/25 bg-air-line/[0.04]';

  return (
    <div className={`air-panel rounded-[18px] border p-4 ${toneClass}`}>
      <div className="flex items-start gap-3">
        <span
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl ${
            tone === 'success'
              ? 'bg-air-mint/10 text-air-mint'
              : 'bg-air-line/[0.08] text-air-muted'
          }`}
        >
          {tone === 'success' ? (
            <CheckGlyph className="h-4 w-4 stroke-current" />
          ) : (
            <LockGlyph className="h-4 w-4 stroke-current" />
          )}
        </span>

        <div>
          <h3 className="text-[13px] font-bold text-air-text">{title}</h3>
          <p className="mt-1 text-[11.75px] leading-relaxed text-air-muted">
            {description}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── glyphs ────────────────────────────────────────────────── */

const S = {
  fill: 'none',
  strokeWidth: 1.9,
  viewBox: '0 0 24 24',
  'aria-hidden': true,
} as const;

const d = (path: string) => (
  <path strokeLinecap="round" strokeLinejoin="round" d={path} />
);

function RefreshGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} {...S}>
      {d('M20 6v5h-5M4 18v-5h5M18.4 9A7 7 0 0 0 6.2 6.2L4 8M5.6 15A7 7 0 0 0 17.8 17.8L20 16')}
    </svg>
  );
}

function AlertGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} {...S}>
      {d('M12 9v4m0 4h.01M10.3 3.7 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z')}
    </svg>
  );
}

function CheckGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} {...S} strokeWidth={2.2}>
      {d('m5 12 4 4L19 6')}
    </svg>
  );
}

function LockGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} {...S}>
      {d('M7 10V8a5 5 0 0 1 10 0v2M5 10h14v10H5z')}
    </svg>
  );
}
