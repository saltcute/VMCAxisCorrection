import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// src/ and dist/ sit at the same depth, so these resolve the same from either.
const packageDir = resolve(import.meta.dirname, '..');
const repoRoot = resolve(packageDir, '../..');

export function configDir(): string {
  return resolve(process.env.CONFIG_DIR ?? resolve(repoRoot, 'data'));
}

/** Static web build: `public/` next to dist (Docker image) or the web package's build output. */
export function publicDir(): string | null {
  const candidates = [
    process.env.PUBLIC_DIR,
    resolve(packageDir, 'public'),
    resolve(repoRoot, 'packages/web/dist'),
  ].filter((p): p is string => !!p);
  return candidates.find((p) => existsSync(resolve(p, 'index.html'))) ?? null;
}
