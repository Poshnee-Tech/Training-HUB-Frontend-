'use client';

/**
 * "Best of the floor" clip sections, as an accordion.
 *
 * PRESENTATION CHANGED, PLAYBACK DID NOT.
 * This was a grid of card-players where each card exposed a hover-revealed
 * preview of up to three clips. Two problems: with five sections the grid
 * wrapped into a ragged block that dominated the page, and the preview cap
 * meant a section with six clips silently showed three. As stacked rows the
 * section list is scannable at a glance, an open section shows *every* clip it
 * has, and the whole block costs one row of height when nothing is open.
 *
 * The audio machinery below is unchanged: one shared <audio> element for the
 * whole list, so starting a clip stops whatever was playing and only one
 * recording can ever be audible. Media bytes are fetched through the shared
 * authenticated boundary and handed over as blob URLs, so playback
 * does not depend on the auth cookie riding a cross-origin subresource
 * request. Audio never starts on its own — every play is a click.
 */

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { authenticatedFetch, journey as journeyApi, type Clip, type ClipCategory } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { cn } from '@/lib/utils';

/** Per-section clip list, loaded lazily so each section reveals as it arrives. */
type PreviewState = { state: 'loading' | 'ready' | 'error'; clips: Clip[] };

export default function BestClips({
  /** Lets the dashboard raise the totals into its section heading and the sidebar badge. */
  onCounts,
}: {
  onCounts?: (totals: { sections: number; clips: number }) => void;
}) {
  const { token } = useAuthStore();
  const [categories, setCategories] = useState<ClipCategory[] | null>(null);
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({});
  const [openSlug, setOpenSlug] = useState<string | null>(null);

  // Single audio instance for the whole list — starting a clip replaces
  // whatever is loaded, so one source can never play over another.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobCache = useRef<Map<string, string>>(new Map());
  const currentSlugRef = useRef<string | null>(null);
  const [current, setCurrent] = useState<{ clipId: string; slug: string } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loadingClipId, setLoadingClipId] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<{ slug: string; message: string } | null>(null);

  useEffect(() => {
    if (!token) return;
    journeyApi
      .clipCategories(token)
      .then((r) => setCategories(r.data))
      .catch(() => setCategories([]));
  }, [token]);

  useEffect(() => {
    if (!token || categories === null) return;
    let cancelled = false;

    setPreviews((prev) => {
      const next = { ...prev };
      for (const category of categories) {
        next[category.slug] ??= { state: 'loading', clips: [] };
      }
      return next;
    });

    for (const category of categories) {
      journeyApi
        .clips(token, category.slug)
        .then((r) => {
          if (cancelled) return;
          setPreviews((prev) => ({ ...prev, [category.slug]: { state: 'ready', clips: r.data } }));
        })
        .catch(() => {
          if (cancelled) return;
          setPreviews((prev) => ({ ...prev, [category.slug]: { state: 'error', clips: [] } }));
        });
    }

    return () => { cancelled = true; };
  }, [token, categories]);

  // Report the real totals once they are known. `_count.clips` is what the
  // sections endpoint already returns, so the header can be honest before a
  // single clip list has come back.
  useEffect(() => {
    if (!categories || !onCounts) return;
    onCounts({
      sections: categories.length,
      clips: categories.reduce((sum, c) => sum + (c._count?.clips ?? 0), 0),
    });
  }, [categories, onCounts]);

  useEffect(() => {
    const cache = blobCache.current;
    return () => {
      cache.forEach((url) => URL.revokeObjectURL(url));
      cache.clear();
    };
  }, []);

  async function togglePlay(clip: Clip) {
    const audio = audioRef.current;
    if (!audio || !token) return;

    // Same clip → toggle pause. Anything else replaces it, which stops the
    // previous recording on the same element.
    if (current?.clipId === clip.id) {
      if (audio.paused) { void audio.play(); } else { audio.pause(); }
      return;
    }

    setLoadingClipId(clip.id);
    setAudioError(null);
    try {
      let url = blobCache.current.get(clip.id);
      if (!url) {
        const res = await authenticatedFetch(journeyApi.clipMediaUrl(clip.id), token);
        if (!res.ok) {
          throw new Error(
            res.status === 404
              ? 'This clip is no longer available.'
              : `Could not load this clip (${res.status}).`,
          );
        }
        const blob = await res.blob();
        url = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: clip.mimeType }));
        blobCache.current.set(clip.id, url);
      }
      audio.src = url;
      currentSlugRef.current = clip.category.slug;
      setCurrent({ clipId: clip.id, slug: clip.category.slug });
      await audio.play();
    } catch (err: any) {
      currentSlugRef.current = clip.category.slug;
      setCurrent(null);
      setAudioError({
        slug: clip.category.slug,
        message: err?.message || 'Could not play this clip.',
      });
    } finally {
      setLoadingClipId(null);
    }
  }

  if (categories === null) {
    return (
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="air-panel h-[62px] animate-pulse rounded-[14px] border" />
        ))}
      </div>
    );
  }

  if (categories.length === 0) {
    return (
      <div className="air-panel rounded-[14px] border p-5">
        <p className="text-[13.5px] leading-relaxed text-air-muted">
          No clip sections yet. Once your trainer adds them, they show up here.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        {categories.map((category, index) => (
          <ClipSection
            key={category.id}
            index={index}
            category={category}
            open={openSlug === category.slug}
            // One section open at a time: two expanded lists push the rest of
            // the page around and there is only one audio element anyway.
            onToggle={() => setOpenSlug((s) => (s === category.slug ? null : category.slug))}
            preview={previews[category.slug] ?? { state: 'loading', clips: [] }}
            currentClipId={current?.slug === category.slug ? current.clipId : null}
            playing={playing}
            loadingClipId={loadingClipId}
            error={audioError?.slug === category.slug ? audioError.message : null}
            onTogglePlay={togglePlay}
          />
        ))}
      </div>

      <audio
        ref={audioRef}
        className="hidden"
        onPlay={() => { setPlaying(true); setAudioError(null); }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => {
          setPlaying(false);
          setCurrent(null);
          setAudioError({
            slug: currentSlugRef.current ?? 'clips',
            message: 'Playback failed for this clip.',
          });
        }}
      />
    </>
  );
}

function ClipSection({
  index,
  category,
  open,
  onToggle,
  preview,
  currentClipId,
  playing,
  loadingClipId,
  error,
  onTogglePlay,
}: {
  index: number;
  category: ClipCategory;
  open: boolean;
  onToggle: () => void;
  preview: PreviewState;
  currentClipId: string | null;
  playing: boolean;
  loadingClipId: string | null;
  error: string | null;
  onTogglePlay: (clip: Clip) => void;
}) {
  const panelId = useId();

  // Prefer the loaded list, fall back to the count the sections endpoint sent.
  // Without the fallback the row reads "0 clips" for the second or so before
  // its own request lands.
  const count = preview.state === 'ready' ? preview.clips.length : (category._count?.clips ?? 0);

  return (
    <article className="air-panel floor-rise overflow-hidden rounded-[14px] border" style={{ animationDelay: `${index * 70}ms` }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="group grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-air-line/[0.05] sm:grid-cols-[240px_minmax(0,1fr)_auto_auto] sm:gap-6"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="floor-sunken grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full text-air-signal transition-all duration-200 group-hover:scale-110 group-hover:bg-air-signal group-hover:text-white">
            <PlayGlyph className="h-[11px] w-[11px] stroke-current" />
          </span>
          <span className="truncate text-[14.5px] font-semibold text-air-text">{category.name}</span>
        </span>

        {category.description ? (
          <span className="hidden truncate text-[13.5px] text-air-muted sm:block">
            {category.description}
          </span>
        ) : (
          <span className="hidden sm:block" />
        )}

        <span className="shrink-0 whitespace-nowrap font-mono-ui text-[11.5px] text-air-muted">
          <b className="font-bold text-air-amber">{count}</b> {count === 1 ? 'clip' : 'clips'}
        </span>

        <ChevronGlyph
          className={cn('h-4 w-4 shrink-0 stroke-air-faint transition-transform duration-200', open && 'rotate-180')}
        />
      </button>

      {/* Height animates through grid-template-rows rather than max-height, so
          a section with twelve clips and one with two both open at the same
          speed and neither is clipped by a guessed maximum. */}
      <div
        id={panelId}
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden">
          <div className="floor-rule border-t px-5 pb-5 pt-4">
            {preview.state === 'loading' && (
              <p className="px-3 py-2 text-[13px] text-air-muted">Loading clips…</p>
            )}

            {preview.state === 'error' && (
              <p className="px-3 py-2 text-[13px] text-air-live">
                Could not load this section&apos;s clips.
              </p>
            )}

            {preview.state === 'ready' && preview.clips.length === 0 && (
              <p className="px-3 py-2 text-[13px] text-air-muted">
                No clips in this section yet.
              </p>
            )}

            {error && (
              <p className="mb-2 rounded-[8px] border border-air-live/30 bg-air-live/[0.08] px-3 py-2 text-[12.5px] text-air-live">
                {error}
              </p>
            )}

            {preview.clips.map((clip) => {
              const isCurrent = currentClipId === clip.id;
              const isPlaying = isCurrent && playing;

              return (
                <button
                  key={clip.id}
                  type="button"
                  onClick={() => onTogglePlay(clip)}
                  aria-pressed={isPlaying}
                  className="flex w-full items-center gap-3 rounded-[8px] px-3 py-[9px] text-left text-[13.5px] text-air-text transition-colors hover:bg-air-line/[0.07]"
                >
                  <span
                    className={cn(
                      'grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full',
                      isPlaying ? 'bg-air-signal text-white' : 'floor-sunken text-air-signal',
                    )}
                  >
                    {loadingClipId === clip.id ? (
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    ) : isPlaying ? (
                      <PauseGlyph className="h-[11px] w-[11px] fill-current" />
                    ) : (
                      <PlayGlyph className="h-[11px] w-[11px] stroke-current" />
                    )}
                  </span>

                  <span className="min-w-0 truncate">{displayClipTitle(clip.title)}</span>

                  {clip.durationSeconds != null && (
                    <span className="ml-auto shrink-0 font-mono-ui text-[11px] text-air-faint">
                      {formatDuration(clip.durationSeconds)}
                    </span>
                  )}
                </button>
              );
            })}

            <Link
              href={`/clips?section=${encodeURIComponent(category.slug)}`}
              className="mt-2 inline-flex items-center gap-2 px-3 font-mono-ui text-[10.5px] font-bold uppercase tracking-[0.1em] text-air-signal"
            >
              Open the full section
              <ArrowGlyph className="h-[13px] w-[13px] stroke-current" />
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}

function displayClipTitle(title: string) {
  const cleaned = title
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return 'Practice clip';
  return cleaned.replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDuration(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function PlayGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z"
      />
    </svg>
  );
}

function PauseGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M6.75 5.25a.75.75 0 01.75.75v12a.75.75 0 01-1.5 0V6a.75.75 0 01.75-.75zm10.5 0a.75.75 0 01.75.75v12a.75.75 0 01-1.5 0V6a.75.75 0 01.75-.75z" />
    </svg>
  );
}

function ArrowGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
    </svg>
  );
}

function ChevronGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  );
}
