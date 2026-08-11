// Source acquisition: download once, verify the checksum, extract once, and
// hand out cheap copies.
//
// The checksum is not optional decoration. `verify` exists to prove that the
// patch series applies to THE bytes the forks build, and a tarball fetched
// without a checksum proves nothing about those bytes. The only path that may
// skip it is `dry-run` against a candidate version, which by definition has no
// pin yet — and it says so, loudly, every time.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, cpSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import { download } from './http.js';
import { sha256File } from './sha256.js';
import { TARBALL_CACHE, TREE_CACHE, WORK_DIR } from './paths.js';

export class SourceError extends Error {}

function ensure(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A filesystem-safe key for a (name, version) pair. */
function key(name, version) {
  return `${name}-${version}`.replace(/[^A-Za-z0-9._-]/g, '_');
}

/**
 * Fetch a tarball into the cache and check it.
 *
 * @param {{name: string, version: string, url: string, sha256: string|null}} spec
 * @param {{ allowUnpinned?: boolean }} [opt]
 * @returns {Promise<{ file: string, sha256: string, fromCache: boolean }>}
 */
export async function fetchTarball(spec, opt = {}) {
  ensure(TARBALL_CACHE);
  // The URL's own basename keeps `.tar.gz` vs `.tar.xz` visible to the
  // extractor, and the key keeps two versions of one dep from colliding.
  const ext = /\.tar\.(gz|xz|bz2)$/.exec(spec.url)?.[0] ?? '.tar.gz';
  const file = join(TARBALL_CACHE, `${key(spec.name, spec.version)}${ext}`);

  let fromCache = existsSync(file);
  if (!fromCache) {
    const res = await download(spec.url, file);
    if (!res.ok) {
      if (existsSync(file)) unlinkSync(file);
      throw new SourceError(`could not download ${spec.name} ${spec.version}: ${res.error}\n  url: ${spec.url}`);
    }
  }

  const actual = await sha256File(file);
  if (spec.sha256) {
    if (actual !== spec.sha256) {
      // A cached file that no longer matches is either a corrupt download or a
      // pin that moved; either way keeping it would poison every later run.
      unlinkSync(file);
      throw new SourceError(
        `checksum mismatch for ${spec.name} ${spec.version}\n` +
          `  url:      ${spec.url}\n  expected: ${spec.sha256}\n  actual:   ${actual}\n` +
          '  the cached file has been removed; re-run to re-download',
      );
    }
  } else if (!opt.allowUnpinned) {
    throw new SourceError(`${spec.name} ${spec.version} has no sha256 in manifest/engine.json and unpinned fetches are not allowed here`);
  }
  return { file, sha256: actual, fromCache };
}

/**
 * Extract a tarball into the tree cache and return the extracted root.
 * Archives are assumed to have a single top-level directory (every source we
 * pin does); anything else is an error rather than a guess.
 */
export function extract(tarball, name, version) {
  ensure(TREE_CACHE);
  const dest = join(TREE_CACHE, key(name, version));
  if (existsSync(dest) && readdirSync(dest).length > 0) return dest;
  rmSync(dest, { recursive: true, force: true });
  const staging = `${dest}.staging`;
  rmSync(staging, { recursive: true, force: true });
  ensure(staging);
  try {
    execFileSync('tar', ['-xf', tarball, '-C', staging], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    rmSync(staging, { recursive: true, force: true });
    throw new SourceError(`could not extract ${basename(tarball)}: ${e.stderr?.toString().trim() || e.message}`);
  }
  const entries = readdirSync(staging);
  if (entries.length !== 1) {
    rmSync(staging, { recursive: true, force: true });
    throw new SourceError(`${basename(tarball)} does not have exactly one top-level directory (found ${entries.length})`);
  }
  cpSync(join(staging, entries[0]), dest, { recursive: true });
  rmSync(staging, { recursive: true, force: true });
  return dest;
}

/** Download + verify + extract in one call. */
export async function pristineTree(spec, opt = {}) {
  const { file } = await fetchTarball(spec, opt);
  return extract(file, spec.name, spec.version);
}

/**
 * A disposable writable copy of a pristine tree. Callers mutate it freely; the
 * cached pristine tree is never touched.
 */
export function scratchCopy(treeDir, label) {
  ensure(WORK_DIR);
  const dest = join(WORK_DIR, label.replace(/[^A-Za-z0-9._-]/g, '_'));
  rmSync(dest, { recursive: true, force: true });
  cpSync(treeDir, dest, { recursive: true });
  return dest;
}

export function clearWork() {
  rmSync(WORK_DIR, { recursive: true, force: true });
}
