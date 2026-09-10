'use client';

/**
 * Agent Best Practice Clips library.
 *
 * This mirrors the admin library's browsing/listening design while keeping the
 * agent surface intentionally limited: agents can filter, search, play, seek,
 * expand, and save clips locally. Admin-only actions such as upload, copy,
 * move, hide, and delete are not rendered here and no admin endpoints are used.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import TrainingFloorShell from '@/components/layout/TrainingFloorShell';
import { Waveform, fmtTime, rgb, waveBars } from '@/components/audio/Waveform';
import { useAuthStore } from '@/store/auth.store';
import { authenticatedFetch, journey as journeyApi, type Clip, type ClipCategory } from '@/lib/api';
import { formatDate } from '@/lib/utils';

const SAVED_STORAGE_KEY = 'callsim.agent.savedClips';
const ACCENTS = [
  'var(--clip-acc-1)',
  'var(--clip-acc-2)',
  'var(--clip-acc-3)',
  'var(--clip-acc-4)',
  'var(--clip-acc-5)',
  'var(--clip-acc-6)',
] as const;

function fmtSize(bytes: number): string {
  if (!bytes) return '-';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function displayClipTitle(title: string): string {
  const cleaned = title
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return 'Practice clip';
  return cleaned.replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Descriptions are authored as free text — sometimes already bulleted,
 * sometimes one paragraph. Either way the card shows them as pointers, so an
 * agent can scan what a clip demonstrates instead of reading a block.
 */
function descriptionPoints(description: string): string[] {
  const lines = description
    .split(/\r?\n+/)
    .map((line) => line.replace(/^\s*(?:[-\u2013\u2014\u2022*]|\d+[.)])\s+/, '').trim())
    .filter(Boolean);

  if (lines.length > 1) return lines;

  const single = lines[0] ?? '';
  if (!single) return [];

  // A single paragraph becomes one pointer per sentence.
  const sentences = single
    .split(/(?<=[.!?;])\s+(?=["'(\u201C]?[A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  return sentences.length > 1 ? sentences : [single];
}

export default function ClipsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ClipsLibrary />
    </Suspense>
  );
}

function ClipsLibrary() {
  const searchParams = useSearchParams();
  const { token, loadFromStorage } = useAuthStore();
  const [clips, setClips] = useState<Clip[]>([]);
  const [categories, setCategories] = useState<ClipCategory[]>([]);
  const [filter, setFilter] = useState<string>(() => searchParams.get('section') ?? 'all');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobCache = useRef<Map<string, string>>(new Map());
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SAVED_STORAGE_KEY);
      if (raw) setSaved(new Set(JSON.parse(raw)));
    } catch {}
  }, []);

  useEffect(() => {
    const cache = blobCache.current;
    return () => { cache.forEach((url) => URL.revokeObjectURL(url)); cache.clear(); };
  }, []);

  useEffect(() => {
    if (!token) return;
    journeyApi.clipCategories(token).then((r) => setCategories(r.data)).catch(() => {});
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const section = filter === 'all' || filter === 'saved' ? undefined : filter;
      const res = await journeyApi.clips(token, section);
      setClips(res.data);
    } catch (err: any) {
      setError(err.message || 'Could not load the clips library');
    } finally {
      setLoading(false);
    }
  }, [token, filter]);

  useEffect(() => { load(); }, [load]);

  function persistSaved(next: Set<string>) {
    setSaved(next);
    try {
      window.localStorage.setItem(SAVED_STORAGE_KEY, JSON.stringify([...next]));
    } catch {}
  }

  const accentOf = useMemo(() => {
    const map = new Map(categories.map((c, i) => [c.slug, ACCENTS[i % ACCENTS.length]]));
    return (slug: string) => map.get(slug) ?? ACCENTS[0];
  }, [categories]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clips.filter((clip) => {
      if (filter === 'saved' && !saved.has(clip.id)) return false;
      if (q && !displayClipTitle(clip.title).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [clips, filter, query, saved]);

  const grouped = useMemo(() => {
    if (filter !== 'all') return null;
    return categories
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((cat) => ({ cat, items: visible.filter((clip) => clip.category.slug === cat.slug) }))
      .filter((group) => group.items.length > 0);
  }, [categories, filter, visible]);

  const allExpanded = visible.length > 0 && visible.every((clip) => expanded.has(clip.id));
  const currentClip = clips.find((clip) => clip.id === currentId) ?? null;

  async function togglePlay(clip: Clip) {
    const audio = audioRef.current;
    if (!audio || !token) return;

    if (currentId === clip.id) {
      if (audio.paused) { void audio.play(); } else { audio.pause(); }
      return;
    }

    setLoadingId(clip.id);
    setError('');
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
      setCurrentId(clip.id);
      setPosition(0);
      setDuration(0);
      await audio.play();
    } catch (err: any) {
      setError(err.message || 'Could not play this clip.');
    } finally {
      setLoadingId(null);
    }
  }

  function seekTo(fraction: number) {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.min(1, Math.max(0, fraction)) * audio.duration;
  }

  return (
    <TrainingFloorShell>
      <main className="bean-scope relative min-h-[calc(100vh-70px)] overflow-x-clip bg-bean-bg font-body text-bean-ink antialiased">
        <div className="bean-glow pointer-events-none absolute inset-0 z-0" aria-hidden />
        <div className="bean-grid pointer-events-none absolute inset-0 z-0 opacity-50" aria-hidden />
        <div className="relative z-10 w-full px-6 py-7 pb-28 lg:px-8">
          <div className="mx-auto w-full max-w-[1500px]">
            <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-bean-brand" />
                  <span className="font-mono-ui text-[10.5px] font-bold uppercase tracking-[0.12em] text-bean-faint">
                    Listening library
                  </span>
                </div>

                <h1 className="font-display text-[28px] font-extrabold tracking-[-0.035em] text-bean-ink">
                  Example Calls
                </h1>

                <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-bean-muted">
                  Listen to strong call examples, review transcripts, and save the clips you want
                  to revisit during training.
                </p>
              </div>

              <span className="inline-flex items-center gap-1.5 rounded-full border border-bean-gold/[0.28] bg-bean-gold/[0.12] px-3 py-1.5 font-mono-ui text-[9.5px] font-bold uppercase tracking-[0.09em] text-bean-gold">
                <LockGlyph className="h-3 w-3 stroke-bean-gold" />
                Always open
              </span>
            </header>

          {error && (
            <div className="mb-4 flex items-start justify-between gap-4 rounded-xl border border-bean-live/40 bg-bean-live/10 px-4 py-3">
              <p className="text-sm font-medium text-bean-live">{error}</p>
              <button onClick={() => setError('')} className="text-sm text-bean-live">Dismiss</button>
            </div>
          )}

          <div className="bean-card mb-5 rounded-[18px] border p-3.5">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="Clip sections">
                <Tab on={filter === 'all'} count={clips.length} onClick={() => setFilter('all')}>
                  All clips
                </Tab>

                {categories
                  .slice()
                  .sort((a, b) => a.sortOrder - b.sortOrder)
                  .map((cat) => (
                    <Tab
                      key={cat.id}
                      on={filter === cat.slug}
                      count={cat._count?.clips ?? 0}
                      onClick={() => setFilter(cat.slug)}
                    >
                      {cat.name}
                    </Tab>
                  ))}

                <Tab on={filter === 'saved'} count={saved.size} onClick={() => setFilter('saved')}>
                  Saved
                </Tab>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <div className="relative min-w-[220px] max-w-[380px] flex-1">
                  <SearchGlyph className="pointer-events-none absolute left-3.5 top-1/2 h-[15px] w-[15px] -translate-y-1/2 stroke-bean-faint" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search clips..."
                    aria-label="Search clips"
                    className="bean-card w-full rounded-xl border py-2.5 pl-[39px] pr-9 text-[13px] text-bean-ink outline-none transition placeholder:text-bean-faint focus:border-bean-brand"
                  />

                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery('')}
                      aria-label="Clear clip search"
                      className="absolute right-2.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-lg text-bean-faint transition hover:bg-bean-card2 hover:text-bean-ink"
                    >
                      <CloseGlyph className="h-3 w-3 stroke-current" />
                    </button>
                  )}
                </div>

                <span className="font-mono-ui text-[9.5px] font-bold uppercase tracking-[0.08em] text-bean-faint">
                  {visible.length} shown
                </span>

                <button
                  type="button"
                  onClick={() => {
                    const next = new Set(expanded);
                    visible.forEach((clip) =>
                      allExpanded ? next.delete(clip.id) : next.add(clip.id),
                    );
                    setExpanded(next);
                  }}
                  className="bean-card ml-auto inline-flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-[12.5px] font-semibold text-bean-ink transition hover:border-bean-line2"
                >
                  <FolderGlyph className="h-[14px] w-[14px] stroke-current" />
                  {allExpanded ? 'Collapse all' : 'Expand all'}
                </button>
              </div>
            </div>
          </div>

          {loading ? (
            <LoadingState />
          ) : visible.length === 0 ? (
            <EmptyState clipsEmpty={clips.length === 0} savedFilter={filter === 'saved'} />
          ) : grouped ? (
            grouped.map(({ cat, items }) => (
              <section key={cat.id} className="mb-6" style={{ ['--acc' as string]: rgb(accentOf(cat.slug)) }}>
                <SectionHeader title={cat.name} count={items.length} accent={accentOf(cat.slug)} />
                <ClipGrid
                  items={items}
                  accentOf={accentOf}
                  expanded={expanded}
                  setExpanded={setExpanded}
                  saved={saved}
                  persistSaved={persistSaved}
                  currentId={currentId}
                  playing={playing}
                  position={position}
                  duration={duration}
                  loadingId={loadingId}
                  togglePlay={togglePlay}
                  seekTo={seekTo}
                />
              </section>
            ))
          ) : (
            <section className="mb-6">
              <SectionHeader
                title={filter === 'saved' ? 'Saved clips' : categories.find((c) => c.slug === filter)?.name ?? 'Clips'}
                count={visible.length}
                accent={filter === 'saved' ? 'var(--bean-gold)' : accentOf(filter)}
              />
              <ClipGrid
                items={visible}
                accentOf={accentOf}
                expanded={expanded}
                setExpanded={setExpanded}
                saved={saved}
                persistSaved={persistSaved}
                currentId={currentId}
                playing={playing}
                position={position}
                duration={duration}
                loadingId={loadingId}
                togglePlay={togglePlay}
                seekTo={seekTo}
              />
            </section>
          )}
          </div>
        </div>

        <audio
          ref={audioRef}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onError={() => setError('Playback failed for this clip.')}
          className="hidden"
        />

        {currentClip && (
          <NowPlaying
            clip={currentClip}
            sectionName={currentClip.category.name}
            playing={playing}
            position={position}
            duration={duration}
            onToggle={() => togglePlay(currentClip)}
            onSeek={seekTo}
            onClose={() => {
              audioRef.current?.pause();
              setCurrentId(null);
            }}
          />
        )}
      </main>
    </TrainingFloorShell>
  );
}

function ClipGrid(props: Omit<ClipCardProps, 'clip'> & { items: Clip[] }) {
  return (
    <div className="grid gap-3.5 lg:grid-cols-2">
      {props.items.map((clip) => (
        <ClipCard key={clip.id} clip={clip} {...props} />
      ))}
    </div>
  );
}

type ClipCardProps = {
  clip: Clip;
  accentOf: (slug: string) => string;
  expanded: Set<string>;
  setExpanded: (next: Set<string>) => void;
  saved: Set<string>;
  persistSaved: (next: Set<string>) => void;
  currentId: string | null;
  playing: boolean;
  position: number;
  duration: number;
  loadingId: string | null;
  togglePlay: (clip: Clip) => void;
  seekTo: (fraction: number) => void;
};

function ClipCard({
  clip, accentOf, expanded, setExpanded, saved, persistSaved,
  currentId, playing, position, duration, loadingId, togglePlay, seekTo,
}: ClipCardProps) {
  const accent = accentOf(clip.category.slug);
  const isOpen = expanded.has(clip.id);
  const isCurrent = currentId === clip.id;
  const isPlaying = isCurrent && playing;
  const bars = useMemo(() => waveBars(clip.id), [clip.id]);
  const pct = isCurrent && duration > 0 ? position / duration : 0;
  const title = displayClipTitle(clip.title);
  const points = useMemo(() => descriptionPoints(clip.description ?? ''), [clip.description]);
  const [view, setView] = useState<'audio' | 'transcript'>('audio');

  function setOpen(open: boolean) {
    const next = new Set(expanded);
    if (open) next.add(clip.id); else next.delete(clip.id);
    setExpanded(next);
  }

  return (
    <article
      className={`bean-card relative overflow-hidden rounded-[18px] border transition duration-150 hover:-translate-y-[3px] ${
        isOpen ? 'shadow-[0_0_0_1px_var(--acc-soft)]' : ''
      }`}
      style={{ ['--acc' as string]: rgb(accent), ['--acc-soft' as string]: rgb(accent, 0.25) }}
    >
      <span
        className={`absolute inset-x-0 top-0 h-[3px] transition-opacity duration-200 ${
          isOpen || isPlaying ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ background: `linear-gradient(90deg, ${rgb(accent)}, ${rgb(accent, 0.53)})` }}
        aria-hidden
      />

      <div className="p-4">
        <div className="flex items-start gap-3">
        <button onClick={() => setOpen(!isOpen)} aria-expanded={isOpen} className="min-w-0 flex-1 text-left">
          <div className="mb-1 break-words font-display text-[16.5px] font-bold tracking-[-0.01em]">
            {title}
          </div>
          <div className="font-mono-ui text-[10px] tracking-[0.03em] text-bean-faint">
            {clip.mimeType} / {fmtSize(clip.sizeBytes)}
            {clip.durationSeconds != null && ` / ${fmtTime(clip.durationSeconds)}`}
          </div>
          <div className="mt-0.5 font-mono-ui text-[10px] tracking-[0.03em] text-bean-faint">
            added {formatDate(clip.createdAt)}
          </div>
        </button>

        {/* One flush-right cluster: the tag, the star and the chevron share a
            single row so nothing reserves dead width beside the title. */}
        <div className="flex shrink-0 items-center gap-1">
          <span
            className="max-w-[110px] truncate whitespace-nowrap rounded-full border px-2.5 py-[5px] font-mono-ui text-[8.5px] font-bold uppercase tracking-[0.1em]"
            style={{ color: rgb(accent), background: rgb(accent, 0.12), borderColor: rgb(accent, 0.26) }}
          >
            {clip.category.name}
          </span>

          <IconBtn
            label={saved.has(clip.id) ? 'Remove from saved' : 'Save clip'}
            active={saved.has(clip.id)}
            onClick={() => {
              const next = new Set<string>(saved);
              if (next.has(clip.id)) next.delete(clip.id); else next.add(clip.id);
              persistSaved(next);
            }}
          >
            <StarGlyph className="h-[15px] w-[15px]" filled={saved.has(clip.id)} />
          </IconBtn>

          <button
            onClick={() => setOpen(!isOpen)}
            aria-label={isOpen ? 'Collapse' : 'Expand'}
            className={`grid h-[29px] w-[29px] place-items-center rounded-[9px] text-bean-faint transition duration-200 hover:text-bean-ink ${isOpen ? 'rotate-180' : ''}`}
          >
            <ChevronGlyph className="h-4 w-4 stroke-current" />
          </button>
        </div>
        </div>

        {/* Full-width so the text is not squeezed into a narrow column beside
            the action cluster. */}
        {points.length > 0 && (
          <ul className="mt-2.5 space-y-1">
            {points.map((point, i) => (
              <li key={i} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-bean-muted">
                <span
                  className="mt-[7px] h-[3.5px] w-[3.5px] shrink-0 rounded-full"
                  style={{ background: rgb(accent, 0.8) }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">{point}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div
        className="overflow-hidden px-4 transition-all duration-300 ease-out"
        style={{ maxHeight: isOpen ? (view === 'transcript' ? 400 : 200) : 0, opacity: isOpen ? 1 : 0, paddingBottom: isOpen ? 16 : 0 }}
      >
        <div className="border-t border-dashed border-bean-line pt-4">
          {clip.transcript && (
            <div className="mb-3.5 flex items-center gap-1.5">
              <PanelTab on={view === 'audio'} onClick={() => setView('audio')}>Audio</PanelTab>
              <PanelTab on={view === 'transcript'} onClick={() => setView('transcript')}>Transcript</PanelTab>
              <button
                onClick={() => togglePlay(clip)}
                disabled={loadingId === clip.id}
                aria-label={isPlaying ? `Pause ${title}` : `Play ${title}`}
                className="ml-auto grid h-[30px] w-[30px] place-items-center rounded-full transition hover:scale-105 disabled:opacity-60"
                style={{ background: `linear-gradient(135deg, ${rgb(accent)}, ${rgb(accent, 0.65)})` }}
              >
                {loadingId === clip.id ? (
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : isPlaying ? (
                  <PauseGlyph className="h-3.5 w-3.5 fill-white" />
                ) : (
                  <PlayGlyph className="h-3.5 w-3.5 fill-white" />
                )}
              </button>
            </div>
          )}

          {view === 'audio' || !clip.transcript ? (
            <div className="flex items-center gap-3.5">
          <button
            onClick={() => togglePlay(clip)}
            disabled={loadingId === clip.id}
            aria-label={isPlaying ? `Pause ${title}` : `Play ${title}`}
            className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-full transition hover:scale-105 disabled:opacity-60"
            style={{ background: `linear-gradient(135deg, ${rgb(accent)}, ${rgb(accent, 0.65)})` }}
          >
            {loadingId === clip.id ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : isPlaying ? (
              <PauseGlyph className="h-[18px] w-[18px] fill-white" />
            ) : (
              <PlayGlyph className="h-[18px] w-[18px] fill-white" />
            )}
          </button>

          <div className="min-w-0 flex-1">
            <Waveform
              bars={bars}
              pct={pct}
              accent={accent}
              isPlaying={isPlaying}
              label={`Seek ${title}`}
              onSeek={(next) => {
                if (!isCurrent) { togglePlay(clip); return; }
                seekTo(next);
              }}
            />
            <div className="mt-1.5 flex justify-between font-mono-ui text-[10px] tracking-[0.04em] text-bean-faint">
              <span style={{ color: isCurrent ? rgb(accent) : undefined }}>{fmtTime(isCurrent ? position : 0)}</span>
              <span>{isCurrent && duration ? fmtTime(duration) : clip.durationSeconds != null ? fmtTime(clip.durationSeconds) : '-'}</span>
            </div>
          </div>
        </div>
          ) : (
            <TranscriptView transcript={clip.transcript} />
          )}
        </div>
      </div>
    </article>
  );
}

function NowPlaying({ clip, sectionName, playing, position, duration, onToggle, onSeek, onClose }: any) {
  const pct = duration > 0 ? (position / duration) * 100 : 0;
  return (
    /**
     * ── THE PLAYER BELONGS TO THE PAGE, NOT THE WHOLE WINDOW ───────────────
     *
     * `inset-x-0` pinned it to both edges of the VIEWPORT, and its z-index sits
     * above the sidebar's, so the bar was drawn across the navigation — over
     * the account row at the foot of it. The shell's sidebar is a fixed 64
     * (256px) column and every page is offset by the same amount, so the bar
     * starts where the content starts and ends where the content ends.
     */
    <div className="pointer-events-none fixed bottom-0 left-64 right-0 z-[70]">
      <div className="mx-auto mb-3 w-full max-w-[1500px] px-6 lg:px-8">
        <div className="bean-card pointer-events-auto flex items-center gap-3 rounded-[16px] border px-4 py-3 backdrop-blur-xl">
          <span className="hidden shrink-0 items-center gap-2 rounded-lg border border-bean-live/40 bg-bean-live/[0.08] px-2.5 py-1.5 font-mono-ui text-[9px] font-bold tracking-[0.2em] text-bean-live sm:inline-flex">
            <i className="h-[7px] w-[7px] rounded-full bg-bean-live animate-bean-blink" />
            ON AIR
          </span>

          <button
            onClick={onToggle}
            aria-label={playing ? 'Pause' : 'Play'}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-bean-brand to-bean-brand-bright"
          >
            {playing ? <PauseGlyph className="h-[17px] w-[17px] fill-white" /> : <PlayGlyph className="h-[17px] w-[17px] fill-white" />}
          </button>

          <div className="hidden w-[160px] min-w-0 shrink-0 md:block">
            <b className="block truncate text-[13.5px] font-bold">{displayClipTitle(clip.title)}</b>
            <span className="block truncate font-mono-ui text-[9.5px] uppercase tracking-[0.06em] text-bean-faint">
              {sectionName}
            </span>
          </div>

          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div
              role="slider"
              tabIndex={0}
              aria-label="Seek"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(pct)}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                onSeek((e.clientX - r.left) / r.width);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight') onSeek(pct / 100 + 0.05);
                if (e.key === 'ArrowLeft') onSeek(pct / 100 - 0.05);
              }}
              className="relative h-1.5 flex-1 cursor-pointer overflow-hidden rounded-full"
              style={{ background: 'var(--bean-wave-idle)' }}
            >
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-bean-brand-bright to-bean-brand"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="whitespace-nowrap font-mono-ui text-[11px] text-bean-muted">
              <span className="text-bean-brand">{fmtTime(position)}</span> / {fmtTime(duration)}
            </span>
          </div>

          <button onClick={onClose} aria-label="Close player" className="shrink-0 p-1.5 text-bean-faint transition hover:text-bean-ink">
            <CloseGlyph className="h-4 w-4 stroke-current" />
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ title, count, accent }: { title: string; count: number; accent: string }) {
  return (
    <header className="mb-3 flex items-center gap-3 border-b border-bean-line pb-2.5">
      {/* No leading dash — the section's colour rides on the count chip, and
          the title carries the emphasis on its own. */}
      <h2 className="font-display text-[18px] font-extrabold leading-tight tracking-[-0.02em]">{title}</h2>
      <span
        className="ml-auto shrink-0 rounded-full border px-[11px] py-1 font-mono-ui text-[10.5px] font-bold uppercase tracking-[0.08em]"
        style={{ color: rgb(accent), background: rgb(accent, 0.1), borderColor: rgb(accent, 0.28) }}
      >
        {count} clip{count === 1 ? '' : 's'}
      </span>
    </header>
  );
}

function Tab({ on, count, onClick, children }: any) {
  return (
    <button
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[12.5px] font-semibold transition ${
        on
          ? 'border-transparent bg-gradient-to-r from-bean-brand to-bean-brand-bright text-white'
          : 'bean-card text-bean-muted hover:text-bean-ink'
      }`}
    >
      {children}
      <span className={`rounded-full px-2 py-0.5 font-mono-ui text-[10px] font-bold ${on ? 'bg-white/25 text-white' : 'bg-bean-card2 text-bean-muted'}`}>
        {count}
      </span>
    </button>
  );
}

function IconBtn({ label, onClick, children, active }: any) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`grid h-[29px] w-[29px] place-items-center rounded-[9px] border border-transparent transition ${
        active
          ? 'text-bean-gold'
          : 'text-bean-faint hover:border-bean-line hover:bg-bean-card2 hover:text-bean-brand'
      }`}
    >
      {children}
    </button>
  );
}

function PanelTab({ on, onClick, children }: any) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full border px-3 py-1 font-mono-ui text-[10px] font-bold uppercase tracking-[0.1em] transition ${
        on
          ? 'border-transparent bg-gradient-to-r from-bean-brand to-bean-brand-bright text-white'
          : 'border-bean-line bg-bean-card text-bean-muted hover:text-bean-ink'
      }`}
    >
      {children}
    </button>
  );
}

/** The stored transcript is a "Speaker N" dialogue — turn it into readable entries. */
function TranscriptView({ transcript }: any) {
  const entries = useMemo(() => {
    const out: { speaker: string; text: string }[] = [];
    let speaker = '';
    let parts: string[] = [];
    const flush = () => {
      if (speaker && parts.some((p) => p.trim())) out.push({ speaker, text: parts.join(' ').trim() });
      parts = [];
    };
    for (const raw of String(transcript).split('\n')) {
      const m = raw.match(/^Speaker\s+(\d+)\s*$/i);
      if (m) { flush(); speaker = `Speaker ${m[1]}`; }
      else if (raw.trim()) parts.push(raw.trim());
    }
    flush();
    return out;
  }, [transcript]);

  if (entries.length === 0) {
    return (
      <p className="py-2 font-mono-ui text-[11px] tracking-[0.04em] text-bean-faint">
        No transcription yet.
      </p>
    );
  }

  // The card's expand animation runs on a fixed max-height, so a long
  // transcript has to scroll inside its own box rather than be clipped by it.
  return (
    <div className="bean-scroll max-h-[300px] space-y-2.5 overflow-y-auto overscroll-contain pr-1.5">
      {entries.map((e, i) => (
        <div key={i} className="flex items-start gap-2.5">
          <span className="mt-px shrink-0 rounded-full border border-bean-line bg-bean-card2 px-2 py-0.5 font-mono-ui text-[9px] font-bold uppercase tracking-[0.1em] text-bean-muted">
            {e.speaker}
          </span>
          <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-bean-ink">{e.text}</p>
        </div>
      ))}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-bean-brand border-t-transparent" />
    </div>
  );
}

function EmptyState({ clipsEmpty, savedFilter }: { clipsEmpty: boolean; savedFilter: boolean }) {
  return (
    <div className="bean-card rounded-[18px] border border-dashed py-12 text-center font-mono-ui text-[12.5px] tracking-[0.04em] text-bean-faint">
      <NoteGlyph className="mx-auto mb-3.5 h-9 w-9 stroke-bean-faint opacity-60" />
      {clipsEmpty
        ? 'No clips are available yet.'
        : savedFilter
          ? 'No saved clips yet.'
          : 'No clips match this filter.'}
    </div>
  );
}

const S = { fill: 'none', strokeWidth: 1.9, viewBox: '0 0 24 24', 'aria-hidden': true } as const;
const p = (d: string) => <path strokeLinecap="round" strokeLinejoin="round" d={d} />;

const LockGlyph = ({ className }: any) => <svg className={className} {...S}>{p('M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75M6.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z')}</svg>;
const SearchGlyph = ({ className }: any) => <svg className={className} {...S}>{p('M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z')}</svg>;
const FolderGlyph = ({ className }: any) => <svg className={className} {...S}>{p('M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776')}</svg>;
const NoteGlyph = ({ className }: any) => <svg className={className} {...S} strokeWidth={1.5}>{p('M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z')}</svg>;
const ChevronGlyph = ({ className }: any) => <svg className={className} {...S}>{p('M19.5 8.25l-7.5 7.5-7.5-7.5')}</svg>;
const CloseGlyph = ({ className }: any) => <svg className={className} {...S} strokeWidth={2.5}>{p('M6 18L18 6M6 6l12 12')}</svg>;
const PlayGlyph = ({ className }: any) => <svg className={className} viewBox="0 0 24 24" aria-hidden><path d="M8 5v14l11-7z" /></svg>;
const PauseGlyph = ({ className }: any) => <svg className={className} viewBox="0 0 24 24" aria-hidden><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>;
const StarGlyph = ({ className, filled }: any) => (
  <svg className={className} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.9} aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
  </svg>
);
