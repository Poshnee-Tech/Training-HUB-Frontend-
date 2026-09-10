'use client';

/**
 * Audio/video player for a training clip.
 *
 * The media route is authenticated, and an <audio src="..."> element cannot
 * attach custom request headers — it can only ride on cookies. Relying on that
 * made playback depend on a chain of things all holding at once: the auth
 * cookie surviving a cross-origin subresource request, CORS echoing the exact
 * origin with credentials, and the browser not discarding the response under
 * Cross-Origin-Resource-Policy. When any link failed the element still
 * rendered, but reported a duration of 0:00 — a silent failure with no error.
 *
 * So the bytes are fetched through the shared authenticated request boundary
 * and handed to the element as a blob: URL. A blob is same-origin
 * to the page, so CORS, CORP and cookie policy stop applying entirely, and a
 * failure surfaces as a real error message instead of a dead player.
 *
 * Loading is deferred until the agent presses play: a section can hold twenty
 * clips, and fetching every one on mount would pull megabytes nobody asked for.
 * The trade-off is that a clip is downloaded whole rather than streamed in
 * ranges — fine for reference clips of this size, and the reason the route
 * still advertises range support for any future streaming use.
 */

import { useEffect, useRef, useState } from 'react';
import { authenticatedFetch, journey as journeyApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

export default function ClipPlayer({
  clipId,
  mimeType,
  className = '',
}: {
  clipId: string;
  mimeType: string;
  className?: string;
}) {
  const { token } = useAuthStore();
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Blob URLs are held by the document until explicitly revoked; without this
  // every clip an agent opens would leak its bytes for the life of the tab.
  const urlRef = useRef<string | null>(null);
  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  const isVideo = mimeType.startsWith('video/');

  async function load() {
    if (!token || loading) return;
    setLoading(true);
    setError(null);

    try {
      const res = await authenticatedFetch(journeyApi.clipMediaUrl(clipId), token);

      if (!res.ok) {
        throw new Error(
          res.status === 404
            ? 'This clip is no longer available.'
            : `Could not load this clip (${res.status}).`,
        );
      }

      const blob = await res.blob();
      // Some stores return a generic content type; force the type recorded on
      // the clip row so the browser picks the right decoder.
      const typed = blob.type ? blob : new Blob([blob], { type: mimeType });

      const url = URL.createObjectURL(typed);
      urlRef.current = url;
      setSrc(url);
    } catch (err: any) {
      setError(err.message || 'Could not load this clip.');
    } finally {
      setLoading(false);
    }
  }

  if (error) {
    return (
      <div className={className}>
        <p className="text-sm text-red-600">{error}</p>
        <button
          onClick={() => { setError(null); load(); }}
          className="mt-1 text-sm font-medium text-primary-600 hover:text-primary-700"
        >
          Try again
        </button>
      </div>
    );
  }

  if (src) {
    return isVideo ? (
      <video controls autoPlay preload="auto" className={`w-full rounded-lg bg-gray-900 ${className}`}>
        <source src={src} type={mimeType} />
        Your browser cannot play this clip.
      </video>
    ) : (
      <audio controls autoPlay preload="auto" className={`w-full ${className}`}>
        <source src={src} type={mimeType} />
        Your browser cannot play this clip.
      </audio>
    );
  }

  return (
    <button
      onClick={load}
      disabled={loading}
      className={`inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-60 ${className}`}
    >
      {loading ? (
        <>
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
          Loading…
        </>
      ) : (
        <>
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" />
          </svg>
          Play {isVideo ? 'video' : 'audio'}
        </>
      )}
    </button>
  );
}
