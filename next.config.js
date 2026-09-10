/** @type {import('next').NextConfig} */

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:4000';

// `connect-src` is the load-bearing directive for this app — the agent screen
// opens a WebSocket and POSTs to the backend API. Whitelist only those.
//
// ── 'unsafe-eval' IS DEVELOPMENT-ONLY NOW (security review 2026-09-01, #8) ──
//
// MEASURED before removing it, on a clean `NODE_ENV=production next build`:
//
//   production client chunks (.next-build/static/chunks, 28 files):
//       0 occurrences of eval( or new Function(
//   development chunks (.next/static/chunks):
//     227 in main-app.js alone, plus 2 in webpack.js
//
// The 227 are webpack's `devtool: 'eval'` source maps, which exist only in a
// dev build. So what breaks if 'unsafe-eval' is removed outright is `next dev`
// — the app will not run locally — and nothing in production.
//
// It is therefore kept in development and dropped in production, which is the
// only combination that is both safe and workable.
//
// 'unsafe-inline' STAYS for now: Next injects inline bootstrap scripts and
// removing it needs per-request nonces, which needs proxy changes. That
// is a real remaining gap, recorded rather than pretended away.
const isProd = process.env.NODE_ENV === 'production';
const scriptSrc = isProd
  ? "script-src 'self' 'unsafe-inline'"
  : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

const csp = [
  "default-src 'self'",
  `connect-src 'self' ${apiUrl} ${wsUrl} https://api.deepgram.com wss://api.deepgram.com`,
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  scriptSrc,
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // The agent screen needs the mic. Block camera and geolocation outright.
  { key: 'Permissions-Policy', value: 'microphone=(self), camera=(), geolocation=(), payment=()' },
];


/**
 * ── THE BUILD DIRECTORY IS OPT-IN, NOT INFERRED (2026-09-11) ────────────────
 *
 * This was `NODE_ENV === 'production' ? '.next-build' : '.next'`, which breaks
 * EVERY hosted deployment: a host runs `next build` with NODE_ENV=production
 * and then looks for `.next`, so Vercel reported
 *
 *   The Next.js output directory ".next" was not found at "/vercel/path0/.next"
 *
 * The split directory exists for one LOCAL workflow, and a good one: `next
 * build` writing into `.next` while `next dev` is serving out of it replaces
 * the chunks the dev server has already handed to the browser, so every asset
 * 404s and the app never hydrates. But that is a deliberate act by someone at a
 * terminal, not a property of production — so it is now asked for explicitly.
 *
 *   npm run build         -> .next        (what every host expects)
 *   npm run build:local   -> .next-build  (safe beside a running dev server)
 */
const distDir = process.env.NEXT_DIST_DIR || '.next';

/**
 * ── STANDALONE OUTPUT IS OPT-IN TOO (2026-09-11) ────────────────────────────
 *
 * This was an unconditional `output: 'standalone'`. It exists for one thing: a
 * slim container image. Next traces which files the server actually needs,
 * writes that list to `.next/next-server.js.nft.json`, then copies just those
 * into `.next/standalone` so the image can ship without node_modules.
 *
 * A managed host runs its OWN tracing pass over the same build and rewrites
 * that directory as it goes, so the standalone step reaches for a manifest
 * that was there a moment earlier and is not there now:
 *
 *   ENOENT: no such file or directory, open
 *   '/vercel/path0/.next/next-server.js.nft.json'
 *
 * The admin portal never set `output` at all, which is exactly why it deployed
 * from the same commit while this one did not. Nothing in this repository
 * consumes `.next/standalone` — there is no Dockerfile here — so the flag was
 * costing a deployment and buying nothing. It is now asked for by the build
 * that needs it, the same way the build directory is.
 *
 *   npm run build                        -> a normal build, what hosts expect
 *   NEXT_OUTPUT=standalone npm run build -> .next/standalone, for a container
 */
const output = process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined;

const nextConfig = {
  distDir,
  // Strict mode intentionally OFF: under React 19 + Next 15.1.x the
  // double-invoke behavior trips Next's own `OuterLayoutRouter` invariant
  // on routes reached via a proxy redirect (e.g. unauth user hitting /
  // and being bounced to /login). Re-enable once we move off 15.1.x to a
  // version where the layout-router teardown race is fixed upstream.
  reactStrictMode: false,
  // Only when explicitly requested; see the note above.
  ...(output ? { output } : {}),
  async headers() {
    return [
      { source: '/(.*)', headers: securityHeaders },
    ];
  },
};

module.exports = nextConfig;
