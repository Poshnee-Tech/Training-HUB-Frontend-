#!/usr/bin/env node
/**
 * Run `next` from the directory's REAL on-disk casing.
 * ────────────────────────────────────────────────────
 *
 * ── THE FAILURE THIS FIXES (measured 2026-09-04) ──────────────────────────
 *
 * `npm run build` failed on EVERY page — all 15 — with:
 *
 *     Error [InvariantError]: Invariant: Expected workStore to be
 *     initialized. This is a bug in Next.js.
 *
 * It is not a bug in Next.js, and nothing in this app's code caused it. It was
 * proved by elimination: the build still failed with a bare `module.exports =
 * {}` config, with a minimal root layout, with the proxy removed, with
 * `output: 'standalone'` removed and with `reactStrictMode` flipped. It then
 * succeeded, unchanged, when run from a differently-spelled path.
 *
 * ── WHY ───────────────────────────────────────────────────────────────────
 *
 * NTFS is case-INSENSITIVE but case-PRESERVING. This folder is `Frontend` on
 * disk; every script and habit enters it as `frontend`. Both open the same
 * directory, so nothing looks wrong:
 *
 *     process.cwd()                   C:\...\Traning\frontend
 *     fs.realpathSync.native(cwd)     C:\...\Traning\Frontend
 *
 * The bundler keys its module graph by PATH STRING, so those two spellings are
 * two different modules. Next's internals get loaded TWICE — including the
 * AsyncLocalStorage that holds the work store. The copy the renderer reads
 * from is not the copy the prerenderer wrote to, so the store comes back empty
 * and the invariant fires.
 *
 * That is why it reports as an internal framework bug, and why it reproduces
 * on one machine and not another: it is a property of the checkout, not the
 * code.
 *
 * ── WHY A WRAPPER AND NOT next.config.js ──────────────────────────────────
 *
 * `process.chdir()` inside next.config.js DOES NOT WORK — measured. Next has
 * already resolved the project directory by the time it loads the config, so
 * the correction lands too late to affect module resolution. The admin panel
 * carries that in-config guard and it is fine there only because that folder's
 * casing already matches.
 *
 * The chdir has to happen before the Next CLI is loaded at all, which is what
 * this file is for: correct the cwd, then hand off.
 *
 * ── THE ALTERNATIVE ───────────────────────────────────────────────────────
 *
 * Renaming the directory on disk to `frontend` would remove the mismatch at
 * source and make this file unnecessary. That is a better fix and a more
 * disruptive one — it invalidates open terminals and running dev servers — so
 * it is left as a decision rather than done here. This wrapper is correct
 * either way: when the casing already agrees, the chdir is a no-op.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const before = process.cwd();

try {
  const canonical = fs.realpathSync.native(before);
  if (canonical !== before) {
    process.chdir(canonical);
    // Reported, not silent: a build that quietly relocates itself is worse to
    // debug than one that says so, and this line is the evidence the fix is
    // doing something on the machine that needed it.
    console.log(`[next-canonical-cwd] ${before} -> ${canonical}`);
  }
} catch (err) {
  // A failure to canonicalise must not stop the build. It only means we are
  // back to the previous behaviour, which is what every other checkout has.
  console.warn(`[next-canonical-cwd] could not canonicalise cwd: ${err && err.message}`);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('[next-canonical-cwd] expected a next subcommand, e.g. "dev" or "build".');
  process.exit(1);
}

/**
 * Resolve the Next CLI from this package rather than shelling out to `npx`:
 * one fewer process, and no chance of picking up a different Next.
 */
const nextBin = path.join(__dirname, '..', 'node_modules', 'next', 'dist', 'bin', 'next');

const { spawn } = require('child_process');
const child = spawn(process.execPath, [nextBin, ...args], {
  stdio: 'inherit',
  cwd: process.cwd(),
});

child.on('exit', (code, signal) => {
  // Preserve the signal case so Ctrl-C on `dev` still reads as an interrupt
  // rather than a clean exit.
  if (signal) process.kill(process.pid, signal);
  else process.exit(code === null ? 1 : code);
});

child.on('error', (err) => {
  console.error(`[next-canonical-cwd] failed to start next: ${err && err.message}`);
  process.exit(1);
});
