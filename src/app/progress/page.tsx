'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import TrainingFloorShell from '@/components/layout/TrainingFloorShell';
import RecentCalls from '@/components/dashboard/RecentCalls';
import {
  HeadsetProgress,
  LearningSnapshot,
} from '@/components/dashboard/RailCards';
import { useAuthStore } from '@/store/auth.store';
import {
  evaluations,
  journey as journeyApi,
  sessions,
  type JourneyMap,
} from '@/lib/api';

export default function ProgressPage() {
  return (
    <TrainingFloorShell>
      <ProgressBody />
    </TrainingFloorShell>
  );
}

function ProgressBody() {
  const { token, authResolved, loadFromStorage } = useAuthStore();

  const [journey, setJourney] = useState<JourneyMap | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [recentSessions, setRecentSessions] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  const load = useCallback(async () => {
    if (!token) {
      if (authResolved) {
        setError('We could not restore your sign-in. Please sign in again.');
        setLoading(false);
      }
      return;
    }

    const hasExistingData = !!journey || !!stats || recentSessions.length > 0;

    if (hasExistingData) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError(null);

    try {
      const [journeyResult, statsResult, sessionsResult] = await Promise.all([
        journeyApi.me(token),
        evaluations.myStats(token),
        sessions.list(token, { limit: '10' }),
      ]);

      setJourney(journeyResult.data);
      setStats(statsResult.data);
      setRecentSessions(sessionsResult.data);
    } catch (err: any) {
      setError(err.message || 'We could not load your progress.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, authResolved, journey, stats, recentSessions.length]);

  useEffect(() => {
    void load();
    // The initial fetch should react to auth state, not to the data it populates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, authResolved]);

  return (
    <main className="w-full min-w-0 px-6 py-7 pb-12 lg:px-8">
      <div className="mx-auto w-full max-w-[1500px]">
        {/* Header */}
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1.5 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-air-signal shadow-[0_0_10px_rgb(var(--air-signal))]" />
              <span className="font-mono-ui text-[10.5px] font-bold uppercase tracking-[0.12em] text-air-faint">
                Your training
              </span>
            </div>

            <h1 className="font-display text-[28px] font-extrabold tracking-[-0.035em] text-air-text">
              My Progress
            </h1>

            <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-air-muted">
              See what you have completed, how your scores are moving, and what
              happened in your most recent practice calls.
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

        {loading ? (
          <ProgressSkeleton />
        ) : error && !journey && !stats && recentSessions.length === 0 ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : (
          <>
            {error && (
              <div
                role="alert"
                className="mb-5 flex items-start justify-between gap-4 rounded-2xl border border-air-live/30 bg-air-live/[0.08] px-4 py-3.5"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-air-live/10 text-[12px] font-bold text-air-live">
                    !
                  </span>
                  <p className="min-w-0 text-[13px] font-medium leading-relaxed text-air-live">
                    {error}
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

            <div
              className={`grid gap-4 transition-opacity duration-200 xl:grid-cols-[300px_minmax(0,1fr)] ${
                refreshing ? 'opacity-60' : 'opacity-100'
              }`}
              aria-busy={refreshing}
            >
              {/* Progress rail */}
              <aside className="flex min-w-0 flex-col gap-3">
                <div className="flex items-center justify-between gap-3 px-1">
                  <div>
                    <h2 className="text-[14px] font-bold text-air-text">
                      Training snapshot
                    </h2>
                    <p className="mt-0.5 text-[11.5px] text-air-muted">
                      Where you are and how you are doing.
                    </p>
                  </div>
                </div>

                {journey ? (
                  <HeadsetProgress journey={journey} />
                ) : (
                  <MissingPanel
                    title="Training plan unavailable"
                    description="Your training journey could not be loaded right now."
                  />
                )}

                <LearningSnapshot stats={stats} />
              </aside>

              {/* Recent calls */}
              <section className="min-w-0">
                <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="text-[18px] font-bold tracking-[-0.015em] text-air-text">
                      Recent Practice Calls
                    </h2>
                    <p className="mt-0.5 text-[12.5px] text-air-muted">
                      Your latest ten sessions, newest first.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-air-line/30 bg-air-line/[0.06] px-2.5 py-1 font-mono-ui text-[9.5px] font-bold uppercase tracking-[0.08em] text-air-faint">
                      {recentSessions.length} shown
                    </span>

                    <Link
                      href="/reports"
                      className="group inline-flex items-center gap-1.5 rounded-xl border border-air-line/30 bg-air-line/[0.04] px-3 py-2 text-[12.5px] font-semibold text-air-signal transition hover:border-air-signal/40 hover:bg-air-signal/[0.06]"
                    >
                      View all reports
                      <ArrowGlyph className="h-3.5 w-3.5 stroke-current transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </div>
                </div>

                {recentSessions.length > 0 ? (
                  <div className="min-w-0">
                    <RecentCalls sessions={recentSessions} />
                  </div>
                ) : (
                  <div className="air-panel flex min-h-[260px] flex-col items-center justify-center rounded-[18px] border border-dashed px-6 text-center">
                    <div className="grid h-12 w-12 place-items-center rounded-2xl border border-air-line/30 bg-air-line/[0.06] text-air-signal">
                      <HeadsetGlyph className="h-5 w-5 stroke-current" />
                    </div>

                    <h3 className="mt-4 text-[15px] font-bold text-air-text">
                      No practice calls yet
                    </h3>

                    <p className="mt-1.5 max-w-md text-[12.5px] leading-relaxed text-air-muted">
                      Once you complete your first practice call, its result and
                      evaluation will appear here automatically.
                    </p>
                  </div>
                )}
              </section>
            </div>

            <div className="air-panel mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-[11.5px] leading-relaxed text-air-muted">
              <span>
                Progress updates automatically after completed training activity.
              </span>
              <span>
                Full call evaluations remain available in Reports.
              </span>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function ProgressSkeleton() {
  return (
    <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="space-y-3">
        {[0, 1].map((item) => (
          <div
            key={item}
            className="air-panel h-[230px] animate-pulse rounded-[18px] border p-5"
          >
            <div className="h-4 w-32 rounded bg-air-line/20" />
            <div className="mt-5 h-24 rounded-2xl bg-air-line/[0.08]" />
            <div className="mt-4 h-3 w-2/3 rounded bg-air-line/15" />
          </div>
        ))}
      </aside>

      <div className="air-panel min-h-[480px] animate-pulse rounded-[18px] border p-5">
        <div className="h-5 w-44 rounded bg-air-line/20" />
        <div className="mt-6 space-y-3">
          {[0, 1, 2, 3, 4].map((item) => (
            <div
              key={item}
              className="h-[68px] rounded-2xl bg-air-line/[0.08]"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="air-panel flex min-h-[360px] flex-col items-center justify-center rounded-[20px] border px-6 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl border border-air-live/25 bg-air-live/[0.08] text-air-live">
        <AlertGlyph className="h-5 w-5 stroke-current" />
      </div>

      <h2 className="mt-4 text-[16px] font-bold text-air-text">
        We could not load your progress
      </h2>

      <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-air-muted">
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

function MissingPanel({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="air-panel rounded-[18px] border border-dashed p-5">
      <h3 className="text-[13.5px] font-bold text-air-text">{title}</h3>
      <p className="mt-1 text-[12px] leading-relaxed text-air-muted">
        {description}
      </p>
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

function ArrowGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} {...S} strokeWidth={2.2}>
      {d('M5 12h14M13 6l6 6-6 6')}
    </svg>
  );
}

function HeadsetGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} {...S}>
      {d('M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v6H5a1 1 0 0 1-1-1v-5Zm16 0h-3v6h2a1 1 0 0 0 1-1v-5Z')}
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
