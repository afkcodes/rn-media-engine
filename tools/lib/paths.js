// Repo layout. One place that knows where anything lives.
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export const PATCHES_DIR = join(ROOT, 'patches');
export const MANIFEST_DIR = join(ROOT, 'manifest');
export const ENGINE_MANIFEST = join(MANIFEST_DIR, 'engine.json');
export const FLAGS_MANIFEST = join(MANIFEST_DIR, 'flags.json');
export const SERIES_MANIFEST = join(MANIFEST_DIR, 'series.json');
export const FORKS_MANIFEST = join(MANIFEST_DIR, 'forks.json');
export const TESTS_DIR = join(ROOT, 'tests');

/**
 * Cache root. Overridable so CI can point it at an actions/cache path and so a
 * developer can share one download cache between checkouts.
 */
export const CACHE = process.env.WORKSHOP_CACHE || join(ROOT, '.cache');
export const TARBALL_CACHE = join(CACHE, 'sources');
export const TREE_CACHE = join(CACHE, 'trees');

/**
 * Scratch trees live OUTSIDE the repository, always.
 *
 * `git apply` run from a subdirectory of a git work tree silently IGNORES
 * hunks whose paths fall outside that subdirectory — it exits 0 and changes
 * nothing. With the scratch trees under `.cache/` (inside this repo) that made
 * every git-format patch a silent no-op that `git apply --check` also blessed.
 * It was caught only because every patch application asserts its marker
 * afterwards; without that post-condition, `verify` would have printed a green
 * board for a tree nothing had touched.
 *
 * Two defences, because one silent no-op was enough: the work dir is outside
 * any repo by construction, and diffpatch.js refuses to run when it detects a
 * non-empty git prefix anyway.
 */
export const WORK_DIR = process.env.WORKSHOP_WORK || join(tmpdir(), `rn-media-engine-work-${process.getuid?.() ?? 0}`);

/** @param {string} abs */
export function rel(abs) {
  return relative(ROOT, abs).split('\\').join('/');
}
