'use client';

/**
 * The narration player used by the product-knowledge guides (ACA + Medicare).
 *
 * DESIGN. This is a Best Practice Clips card: same `bean-*` theme, same
 * collapsed-by-default row that expands on the chevron, same accent hairline
 * that lights when the card is open or playing, same gradient play button,
 * waveform scrubber and time readouts. An agent moving between the clips
 * library and a knowledge topic meets one audio control, not two — the
 * waveform itself is the shared component both surfaces render.
 *
 * The card carries two controls the clips library has no use for: restart, and
 * a speed cycle. Narration is replayed and skimmed on a live call floor, which
 * a one-off practice clip is not.
 *
 * Protected media (admin-uploaded recordings) never reaches the element as a
 * URL: it is fetched here with the auth header and handed over as a blob, so
 * the `<audio>` element and the CSP (`media-src 'self' blob:`) never see the
 * storage-backed route.
 *
 * IMPORTANT — the element carries NO `src` prop on purpose. React re-sets the
 * attribute on every render where the prop value changes, and re-setting `src`
 * while a `play()` request is pending aborts it (`AbortError: The play()
 * request was interrupted by a new load request` — the loadProtectedMedia()
 * fetch updates state, React re-renders, the new src attribute issues a second
 * load, and the pending play() dies). Src is therefore assigned imperatively
 * in play() and nowhere else.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Waveform, fmtTime, rgb, waveBars } from '@/components/audio/Waveform';
import { useAuthStore } from '@/store/auth.store';
import { authenticatedFetch } from '@/lib/api';

/**
 * Only one clip plays at a time. A guide screen can carry several players
 * (the ACA script screen has three), and starting one has to stop whichever
 * was already talking — so the element that owns playback is tracked here
 * rather than in any single player.
 */
let nowPlaying: HTMLAudioElement | null = null;

const SPEEDS = [1, 1.25, 1.5, 0.75];

const PROTECTED_MARKER = '/api/journey/knowledge/recordings/';

/** Narration has no category, so it takes the library's brand accent. */
const ACCENT = 'var(--bean-brand)';

export function AudioNote({
  src,
  title,
  durationSeconds,
}: {
  src: string;
  title: string;
  /**
   * The clip's length, from the server.
   *
   * The audio is auth-protected, so its `src` is only attached when play is
   * pressed — the element cannot report a duration before that. Without this
   * the row showed a placeholder that never resolved, which read as broken.
   */
  durationSeconds?: number | null;
}) {
  const { token } = useAuthStore();
  const ref = useRef<HTMLAudioElement>(null);
  const blobUrlRef = useRef<string | null>(null);
  // The resolved playable URL once bytes are on hand — null before the first
  // fetch for protected media. Kept as state only as a "media is loaded" cache:
  // the element's src is set imperatively, never through this value.
  const [playableSrc, setPlayableSrc] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [at, setAt] = useState(0);
  const [len, setLen] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [failed, setFailed] = useState(false);

  const protectedMedia = src.includes(PROTECTED_MARKER);
  const bars = useMemo(() => waveBars(src), [src]);

  // Reset when the caller swaps the clip this player is bound to. The guides
  // key their players by clip so this rarely fires, but a reused element must
  // not carry the previous clip's blob.
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setPlayableSrc(null);
    setPlaying(false);
    setLoading(false);
    setAt(0);
    setLen(0);
    setFailed(false);
  }, [src]);

  // Stop this clip if the screen changes underneath it.
  useEffect(() => () => {
    const el = ref.current;
    if (!el) return;
    el.pause();
    if (nowPlaying === el) nowPlaying = null;
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
  }, []);

  async function loadProtectedMedia(): Promise<string | null> {
    if (!protectedMedia) return src;
    if (playableSrc) return playableSrc;
    if (!token || loading) return null;

    setLoading(true);
    setFailed(false);
    try {
      const res = await authenticatedFetch(src, token);
      if (!res.ok) throw new Error(`Could not load audio (${res.status})`);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      setPlayableSrc(url);
      return url;
    } catch {
      setFailed(true);
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function togglePlay() {
    const el = ref.current;
    if (!el) return;
    if (el.paused) {
      const resolvedSrc = await loadProtectedMedia();
      if (!resolvedSrc) return;
      if (el.getAttribute('src') !== resolvedSrc) {
        el.setAttribute('src', resolvedSrc);
        el.load();
      }
      if (nowPlaying && nowPlaying !== el) nowPlaying.pause();
      nowPlaying = el;
      el.play().catch(() => setFailed(true));
    } else {
      el.pause();
    }
  }

  /** Starting from the collapsed row opens the card, so the transport is visible
   *  for whatever is talking. Pausing leaves the card however the agent left it. */
  function playFromHeader() {
    if (!playing) setOpen(true);
    void togglePlay();
  }

  function restart() {
    const el = ref.current;
    if (!el) return;
    el.currentTime = 0;
    setAt(0);
  }

  function cycleSpeed() {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (ref.current) ref.current.playbackRate = next;
  }

  function seekTo(fraction: number) {
    const el = ref.current;
    if (!el || !len) return;
    el.currentTime = Math.min(1, Math.max(0, fraction)) * len;
    setAt(el.currentTime);
  }

  const pct = len ? at / len : 0;

  return (
    <div className="bean-scope font-body text-bean-ink">
      <audio
        ref={ref}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setAt(0); }}
        onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setLen(e.currentTarget.duration)}
        onError={() => setFailed(true)}
      />

      <article
        className={`bean-card relative overflow-hidden rounded-[18px] border transition duration-150 ${
          open ? 'shadow-[0_0_0_1px_var(--acc-soft)]' : ''
        }`}
        style={{ ['--acc' as string]: rgb(ACCENT), ['--acc-soft' as string]: rgb(ACCENT, 0.25) }}
      >
        <span
          className={`absolute inset-x-0 top-0 h-[3px] transition-opacity duration-200 ${
            open || playing ? 'opacity-100' : 'opacity-0'
          }`}
          style={{ background: `linear-gradient(90deg, ${rgb(ACCENT)}, ${rgb(ACCENT, 0.53)})` }}
          aria-hidden
        />

        <div className="flex items-start gap-3 p-5">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="min-w-0 flex-1 text-left"
          >
            <div className="mb-1 break-words font-display text-[16.5px] font-bold tracking-[-0.01em]">
              {failed ? 'Audio unavailable' : title}
            </div>
            <div className="font-mono-ui text-[10px] tracking-[0.03em] text-bean-faint">
              {loading
                ? 'loading…'
                : failed
                  ? 'could not load'
                  // `len` is the element's own reading once it has played, which
                  // is authoritative; the server's value covers everything before
                  // that. Neither exists for a clip whose format we cannot parse,
                  // and then the line simply says what it is.
                  // fmtTime(0) is "0:00", which would state a length we do not
                  // have — so the value is chosen first, and only formatted if
                  // there is one. A clip whose format we cannot parse says what
                  // it is rather than claiming to be empty.
                  : (len || durationSeconds) ? fmtTime(len || durationSeconds || 0) : 'audio'}
            </div>
          </button>

          <div className="flex shrink-0 flex-col items-end gap-2.5">
            <span
              className="whitespace-nowrap rounded-full border px-2.5 py-[5px] font-mono-ui text-[8.5px] font-bold uppercase tracking-[0.1em]"
              style={{ color: rgb(ACCENT), background: rgb(ACCENT, 0.12), borderColor: rgb(ACCENT, 0.26) }}
            >
              Listen
            </span>

            {/* Play from the collapsed row too — the common case is one tap to
                hear it, not one tap to reveal a transport and a second to use it. */}
            <button
              type="button"
              onClick={playFromHeader}
              disabled={failed}
              aria-label={playing ? `Pause ${title}` : `Play ${title}`}
              className="grid h-[29px] w-[29px] place-items-center rounded-[9px] border border-transparent text-bean-faint transition hover:border-bean-line hover:bg-bean-card2 hover:text-bean-brand disabled:opacity-50"
            >
              {playing
                ? <PauseGlyph className="h-[13px] w-[13px] fill-current" />
                : <PlayGlyph className="h-[13px] w-[13px] fill-current" />}
            </button>
          </div>

          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-label={open ? 'Collapse' : 'Expand'}
            className={`pt-0.5 text-bean-faint transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          >
            <ChevronGlyph className="h-4 w-4 stroke-current" />
          </button>
        </div>

        <div
          className="overflow-hidden px-5 transition-all duration-300 ease-out"
          style={{ maxHeight: open ? 200 : 0, opacity: open ? 1 : 0, paddingBottom: open ? 20 : 0 }}
        >
          <div className="flex items-center gap-3.5 border-t border-dashed border-bean-line pt-4">
            <button
              type="button"
              onClick={togglePlay}
              disabled={failed || loading}
              aria-label={playing ? `Pause ${title}` : `Play ${title}`}
              className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-full transition hover:scale-105 disabled:opacity-60"
              style={{ background: `linear-gradient(135deg, ${rgb(ACCENT)}, ${rgb(ACCENT, 0.65)})` }}
            >
              {loading ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : playing ? (
                <PauseGlyph className="h-[18px] w-[18px] fill-white" />
              ) : (
                <PlayGlyph className="h-[18px] w-[18px] fill-white" />
              )}
            </button>

            <div className="min-w-0 flex-1">
              <Waveform
                bars={bars}
                pct={pct}
                accent={ACCENT}
                isPlaying={playing}
                label={`Seek ${title}`}
                onSeek={seekTo}
              />
              <div className="mt-1.5 flex justify-between font-mono-ui text-[10px] tracking-[0.04em] text-bean-faint">
                <span style={{ color: at > 0 ? rgb(ACCENT) : undefined }}>{fmtTime(at)}</span>
                <span>{len ? fmtTime(len) : '-'}</span>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={restart}
                aria-label={`Restart ${title}`}
                className="grid h-[29px] w-[29px] place-items-center rounded-[9px] border border-transparent text-bean-faint transition hover:border-bean-line hover:bg-bean-card2 hover:text-bean-brand"
              >
                <RestartGlyph className="h-[15px] w-[15px] stroke-current" />
              </button>
              <button
                type="button"
                onClick={cycleSpeed}
                aria-label={`Playback speed, currently ${speed} times`}
                className="rounded-[9px] border border-bean-line px-2 py-1.5 font-mono-ui text-[10px] font-bold text-bean-muted transition hover:text-bean-brand"
              >
                {speed}×
              </button>
            </div>
          </div>
        </div>
      </article>
    </div>
  );
}

// Glyphs, drawn the same way the clips library draws them.
const S = { fill: 'none', strokeWidth: 1.9, viewBox: '0 0 24 24', 'aria-hidden': true } as const;
const p = (d: string) => <path strokeLinecap="round" strokeLinejoin="round" d={d} />;

const ChevronGlyph = ({ className }: { className?: string }) => <svg className={className} {...S}>{p('M19.5 8.25l-7.5 7.5-7.5-7.5')}</svg>;
const RestartGlyph = ({ className }: { className?: string }) => <svg className={className} {...S}>{p('M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3')}</svg>;
const PlayGlyph = ({ className }: { className?: string }) => <svg className={className} viewBox="0 0 24 24" aria-hidden><path d="M8 5v14l11-7z" /></svg>;
const PauseGlyph = ({ className }: { className?: string }) => <svg className={className} viewBox="0 0 24 24" aria-hidden><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>;
