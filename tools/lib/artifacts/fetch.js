// Release assets: list, download, cache.
//
// Artifacts are immutable once released, so a downloaded asset is cached under
// its tag forever and re-runs cost nothing. Unlike source tarballs there is no
// pin to check them against — the whole point of this command is to find out
// what the release actually contains — so the sha256 is REPORTED rather than
// asserted, and that difference is stated in the matrix.

import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { gh, download } from '../http.js';
import { CACHE } from '../paths.js';

export const ARTIFACT_CACHE = join(CACHE, 'artifacts');

export class ArtifactError extends Error {}

/** @returns {Promise<{name: string, size: number, url: string}[]>} */
export async function listAssets(repo, tag) {
  const r = await gh(`/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`);
  if (!r.ok) throw new ArtifactError(`could not read ${repo}@${tag}: ${r.error}`);
  return (r.data.assets ?? []).map((a) => ({ name: a.name, size: a.size, url: a.browser_download_url }));
}

/** The release published immediately before `tag`, for the size comparison. */
export async function previousTag(repo, tag) {
  const r = await gh(`/repos/${repo}/releases?per_page=30`);
  if (!r.ok) return { ok: false, error: r.error };
  const list = (r.data ?? []).filter((x) => !x.draft);
  const i = list.findIndex((x) => x.tag_name === tag);
  if (i < 0) return { ok: false, error: `${tag} not found in the last ${list.length} releases` };
  const prev = list[i + 1];
  return prev ? { ok: true, tag: prev.tag_name } : { ok: false, error: `${tag} is the oldest release` };
}

/** Download every asset matching `pattern` into the cache; returns local paths. */
export async function fetchAssets(repo, tag, pattern) {
  const dir = join(ARTIFACT_CACHE, repo.replace('/', '__'), tag);
  mkdirSync(dir, { recursive: true });
  const assets = (await listAssets(repo, tag)).filter((a) => pattern.test(a.name));
  if (assets.length === 0) throw new ArtifactError(`${repo}@${tag} has no asset matching ${pattern}`);
  const out = [];
  for (const a of assets) {
    const dest = join(dir, a.name);
    if (!existsSync(dest)) {
      const res = await download(a.url, dest);
      if (!res.ok) throw new ArtifactError(`could not download ${a.name}: ${res.error}`);
    }
    out.push({ ...a, path: dest });
  }
  return out;
}

/** Unpack a .jar/.zip into `dest` (idempotent). */
export function unzipTo(archive, dest) {
  if (existsSync(dest) && readdirSync(dest).length > 0) return dest;
  mkdirSync(dest, { recursive: true });
  try {
    execFileSync('unzip', ['-qo', archive, '-d', dest], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    throw new ArtifactError(`could not unzip ${archive}: ${e.stderr?.toString().trim() ?? e.message}`);
  }
  return dest;
}
