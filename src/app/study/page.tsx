'use client';

/**
 * Study — product-knowledge material on its own page.
 *
 * Same journey endpoint and same filtering rules:
 *   GET /api/journey/me
 *
 * Only always-available knowledge modules are shown here. The clips library
 * stays on its own page.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import TrainingFloorShell from '@/components/layout/TrainingFloorShell';
import StudyModules from '@/components/dashboard/StudyModules';
import { useAuthStore } from '@/store/auth.store';
import {
  journey as journeyApi,
  type JourneyMap,
} from '@/lib/api';

export default function StudyPage() {
  return (
    <TrainingFloorShell>
      <StudyBody />
    </TrainingFloorShell>
  );
}

function StudyBody() {
  const { token, authResolved, loadFromStorage } = useAuthStore();

  const [journey, setJourney] = useState<JourneyMap | null>(null);
  /**
   * Each guide's real topic list, for the chips on the cards.
   *
   * Fetched rather than written here: the card used to carry a hand-kept copy
   * of the topics, which drifted the moment the guides became admin-owned.
   */
  const [topicsByCampaign, setTopicsByCampaign] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  const load = useCallback(async () => {
    if (!token) {
      if (authResolved) {
        setError('We couldn’t restore your sign-in. Please sign in again.');
        setLoading(false);
      }
      return;
    }

    if (journey) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError(null);

    try {
      const res = await journeyApi.me(token);
      setJourney(res.data);

      // One call per knowledge module the agent actually has. The chips are a
      // nicety, so a campaign that fails to load simply shows none rather than
      // failing the page around it.
      const campaigns = [
        ...new Set(
          res.data.stages
            .filter((s) => s.kind === 'KNOWLEDGE' && s.knowledgeCampaign)
            .map((s) => s.knowledgeCampaign as 'ACA' | 'MEDICARE'),
        ),
      ];
      const loaded = await Promise.all(
        campaigns.map(async (campaign) => {
          try {
            const k = await journeyApi.knowledge(token, campaign);
            return [campaign, (k.data.topics ?? []).map((t) => t.label)] as const;
          } catch {
            return [campaign, [] as string[]] as const;
          }
        }),
      );
      setTopicsByCampaign(Object.fromEntries(loaded));
    } catch (err: any) {
      setError(err.message || 'We couldn’t load your study material.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, authResolved, journey]);

  useEffect(() => {
    if (!token && !authResolved) return;
    void load();
    // Fetch follows auth state only; journey is excluded so receiving data
    // does not immediately trigger another request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, authResolved]);

  const studyStages = useMemo(
    () =>
      (journey?.stages ?? [])
        .filter(
          (stage) =>
            stage.alwaysAvailable &&
            stage.kind !== 'CLIPS_LIBRARY',
        )
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [journey],
  );

  return (
    <main className="w-full min-w-0 px-6 py-7 pb-12 lg:px-8">
      <div className="mx-auto w-full max-w-[1500px]">
        {/* Header */}
        <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1.5 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-air-signal shadow-[0_0_10px_rgb(var(--air-signal))]" />
              <span className="font-mono-ui text-[10.5px] font-bold uppercase tracking-[0.12em] text-air-faint">
                Knowledge library
              </span>
            </div>

            <h1 className="font-display text-[28px] font-extrabold tracking-[-0.035em] text-air-text">
              Study
            </h1>

            <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-air-muted">
              Review product knowledge whenever you need it. These modules
              stay available throughout training and never lock.
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

        {error && journey && (
          <div
            role="alert"
            className="mb-4 flex items-start justify-between gap-4 rounded-2xl border border-air-live/30 bg-air-live/[0.08] px-4 py-3.5"
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

        {loading ? (
          <StudySkeleton />
        ) : error && !journey ? (
          <ErrorState
            message={error}
            onRetry={() => void load()}
          />
        ) : studyStages.length > 0 ? (
          <div
            className={`transition-opacity duration-200 ${
              refreshing ? 'opacity-60' : 'opacity-100'
            }`}
            aria-busy={refreshing}
          >
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-bold tracking-[-0.01em] text-air-text">
                  Study Modules
                </h2>
                <p className="mt-0.5 text-[12.5px] text-air-muted">
                  Open any module and return to it whenever you need a refresher.
                </p>
              </div>

              <span className="rounded-full border border-air-line/30 bg-air-line/[0.05] px-2.5 py-1 font-mono-ui text-[9.5px] font-bold uppercase tracking-[0.08em] text-air-faint">
                {studyStages.length}{' '}
                {studyStages.length === 1 ? 'module' : 'modules'}
              </span>
            </div>

            <StudyModules stages={studyStages} topicsByCampaign={topicsByCampaign} />

            <div className="air-panel mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-[11.5px] leading-relaxed text-air-muted">
              <span>
                Study material stays available even while other training steps are locked.
              </span>

              <Link
                href="/dashboard"
                className="group inline-flex items-center gap-1.5 font-semibold text-air-signal"
              >
                Back to my plan
                <ArrowGlyph className="h-3.5 w-3.5 stroke-current transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          </div>
        ) : (
          <EmptyState />
        )}
      </div>
    </main>
  );
}

function StudySkeleton() {
  return (
    <div className="space-y-3">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <div className="h-4 w-32 animate-pulse rounded bg-air-line/20" />
          <div className="mt-2 h-3 w-64 animate-pulse rounded bg-air-line/10" />
        </div>

        <div className="h-6 w-20 animate-pulse rounded-full bg-air-line/10" />
      </div>

      {[0, 1, 2, 3].map((item) => (
        <div
          key={item}
          className="air-panel h-[110px] animate-pulse rounded-[18px] border p-5"
        >
          <div className="h-4 w-1/3 rounded bg-air-line/20" />
          <div className="mt-3 h-3 w-2/3 rounded bg-air-line/10" />
          <div className="mt-4 h-7 w-24 rounded-xl bg-air-line/10" />
        </div>
      ))}
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
    <div className="air-panel flex min-h-[320px] flex-col items-center justify-center rounded-[20px] border px-6 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl border border-air-live/25 bg-air-live/[0.08] text-air-live">
        <AlertGlyph className="h-5 w-5 stroke-current" />
      </div>

      <h2 className="mt-4 text-[15px] font-bold text-air-text">
        We couldn’t load your study material
      </h2>

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

function EmptyState() {
  return (
    <div className="air-panel flex min-h-[320px] flex-col items-center justify-center rounded-[20px] border border-dashed px-6 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl border border-air-line/30 bg-air-line/[0.05] text-air-signal">
        <BookGlyph className="h-5 w-5 stroke-current" />
      </div>

      <h2 className="mt-4 text-[15px] font-bold text-air-text">
        No study material yet
      </h2>

      <p className="mt-1.5 max-w-md text-[12.5px] leading-relaxed text-air-muted">
        Your trainer hasn&apos;t published any product knowledge yet.
        It will appear here as soon as it becomes available.
      </p>

      <Link
        href="/dashboard"
        className="mt-5 inline-flex items-center gap-2 rounded-xl border border-air-line/30 bg-air-line/[0.04] px-4 py-2.5 text-[12.5px] font-semibold text-air-signal transition hover:border-air-signal/40 hover:bg-air-signal/[0.06]"
      >
        Back to my plan
        <ArrowGlyph className="h-3.5 w-3.5 stroke-current" />
      </Link>
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
  <path
    strokeLinecap="round"
    strokeLinejoin="round"
    d={path}
  />
);

function RefreshGlyph({
  className,
}: {
  className?: string;
}) {
  return (
    <svg className={className} {...S}>
      {d(
        'M20 6v5h-5M4 18v-5h5M18.4 9A7 7 0 0 0 6.2 6.2L4 8M5.6 15A7 7 0 0 0 17.8 17.8L20 16',
      )}
    </svg>
  );
}

function ArrowGlyph({
  className,
}: {
  className?: string;
}) {
  return (
    <svg
      className={className}
      {...S}
      strokeWidth={2.2}
    >
      {d('M5 12h14M13 6l6 6-6 6')}
    </svg>
  );
}

function BookGlyph({
  className,
}: {
  className?: string;
}) {
  return (
    <svg className={className} {...S}>
      {d(
        'M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5v-16ZM20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5A2.5 2.5 0 0 1 20 21.5v-16Z',
      )}
    </svg>
  );
}

function AlertGlyph({
  className,
}: {
  className?: string;
}) {
  return (
    <svg className={className} {...S}>
      {d(
        'M12 9v4m0 4h.01M10.3 3.7 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z',
      )}
    </svg>
  );
}
