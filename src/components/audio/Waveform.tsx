'use client';

/**
 * The clip waveform — the seek control every audio surface in the agent app
 * uses: the Best Practice Clips library and the product-knowledge narration.
 *
 * The bars are not real audio analysis. Decoding every clip to draw a true
 * waveform would mean downloading all of them on mount, so the shape is
 * generated from a seed string instead: same clip, same silhouette, every
 * render and every session. It reads as a waveform and behaves as a scrubber,
 * which is all it is asked to do.
 *
 * Lives here rather than in either page so the two cannot drift apart — a
 * clip and a narration clip should look and seek identically.
 */

export const BAR_COUNT = 40;

/** `rgb(channels)` or `rgb(channels / alpha)` from a `"r g b"` channel string. */
export function rgb(channels: string, alpha?: number): string {
  return alpha == null ? `rgb(${channels})` : `rgb(${channels} / ${alpha})`;
}

/** Stable bar heights (28–99%) for a seed — the same seed always draws the same shape. */
export function waveBars(seed: string): number[] {
  let x = 0;
  for (let i = 0; i < seed.length; i++) x = (x * 31 + seed.charCodeAt(i)) >>> 0;
  const out: number[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out.push(28 + (x % 72));
  }
  return out;
}

/** `m:ss`, and `0:00` for anything not yet known. */
export function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const whole = Math.floor(s);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function Waveform({
  bars, pct, accent, isPlaying, label, onSeek,
}: {
  bars: number[];
  /** Progress, 0–1. */
  pct: number;
  /** Accent as an `"r g b"` channel string or a `var(--token)` reference. */
  accent: string;
  isPlaying: boolean;
  label: string;
  onSeek: (fraction: number) => void;
}) {
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct * 100)}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onSeek((e.clientX - r.left) / r.width);
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') onSeek(pct + 0.05);
        if (e.key === 'ArrowLeft') onSeek(pct - 0.05);
      }}
      className="flex h-9 cursor-pointer items-center gap-[2.5px]"
    >
      {bars.map((h, i) => {
        const done = i / BAR_COUNT <= pct;
        const head = isPlaying && Math.floor(pct * BAR_COUNT) === i;
        return (
          <span
            key={i}
            className="min-w-[2px] flex-1 rounded-full"
            style={{
              height: `${h}%`,
              background: head
                ? 'rgb(var(--bean-gold))'
                : done
                  ? `linear-gradient(180deg, ${rgb(accent, 0.7)}, ${rgb(accent)})`
                  : 'var(--bean-wave-idle)',
              boxShadow: head ? '0 0 8px rgb(var(--bean-gold))' : undefined,
            }}
          />
        );
      })}
    </div>
  );
}
