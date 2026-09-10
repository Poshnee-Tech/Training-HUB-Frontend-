import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve('src');
const allowed = resolve('src/lib/api.ts');
const sourceExtensions = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const rawAuthHeader = [
  /\bauthorization\s*:/i,
  /\[['"]authorization['"]\]\s*=/i,
  /\.authorization\s*=/i,
  /\.set\(\s*['"]authorization['"]/i,
];

function filesIn(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesIn(path) : [path];
  });
}

const violations = filesIn(root)
  .filter((path) => sourceExtensions.test(path) && resolve(path) !== allowed)
  .flatMap((path) => {
    const lines = readFileSync(path, 'utf8').split('\n');
    return lines.flatMap((line, index) => rawAuthHeader.some((pattern) => pattern.test(line))
      ? [`${relative(process.cwd(), path)}:${index + 1}: raw Authorization header; use authenticatedFetch()`]
      : []);
  });

if (violations.length > 0) {
  process.stderr.write(`${violations.join('\n')}\n`);
  process.exitCode = 1;
}
