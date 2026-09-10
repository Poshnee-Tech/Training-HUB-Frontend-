import { NextRequest, NextResponse } from 'next/server';

/**
 * Server-side route guard. The real auth signal is the httpOnly cookie set
 * by the backend at /api/auth/login (`callsim_auth`). We don't verify the
 * JWT cryptographically here — the API rejects 401 anyway — but we do
 * prevent rendering protected pages without the cookie, which closes the
 * flash-of-content window and stops unauthenticated users from probing
 * client-side route shells.
 */

const PUBLIC_PATHS = ['/', '/login'];

// Static asset prefixes Next.js handles itself.
const STATIC_PREFIXES = ['/_next', '/favicon', '/api', '/worklets'];

/**
 * Anything with a file extension is a static asset in /public, not a page.
 *
 * These have to be let through or they never load for a signed-out visitor —
 * and the obvious case is not the only one. next/image optimises by fetching
 * the original from this same server, so a gated /foo.png makes the optimiser
 * receive the login page instead of an image and fail the request outright.
 * The hero screenshot on the marketing page went blank in exactly that way.
 */
const ASSET_EXT = /\.(?:png|jpe?g|gif|svg|webp|avif|ico|mp3|wav|m4a|woff2?|ttf|otf|txt|xml|webmanifest)$/i;

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  if (ASSET_EXT.test(pathname)) return true;
  return STATIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export function proxy(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  /**
   * The agent portal's own session cookie, with the legacy shared name as a
   * fallback for sessions created before per-portal naming (owner ruling
   * 2026-09-03 — see Backend/src/routes/auth/portal-session.ts).
   *
   * Gating on the shared name alone would send an agent to /login the moment
   * an admin logged in on the same host, because the two overwrote each other.
   */
  const hasAuth = req.cookies.get('callsim_auth_agent') ?? req.cookies.get('callsim_auth');
  if (!hasAuth) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    // Preserve where they were trying to go for post-login redirect.
    if (pathname !== '/') url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Run proxy on every page request. We exclude /api inside the matcher
  // because the backend (separate origin) is the real API; if you later mount
  // an internal Next API route, add cookie-based gating there too.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|worklets/|public/).*)'],
};
