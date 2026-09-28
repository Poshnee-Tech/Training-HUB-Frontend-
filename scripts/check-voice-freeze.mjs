import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// 2026-09-26 local review: identity-tagged stop/progress, bounded cached playheads,
// drain-before-recovery reporting and reason-aware transcript replay. Not release approval.
const file = new URL('../src/hooks/useWebSocket.ts', import.meta.url);
const expected = '9a161ff734b9ea6defbc94f7e202d0fae8f891119e1148b1793190b641c3c72a';
const actual = createHash('sha256').update(readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
assert.equal(actual, expected, 'Playback hook changed: review behavior and update its freeze with a reason.');
console.log('Frontend playback freeze passed.');
