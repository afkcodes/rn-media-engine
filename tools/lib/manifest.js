// Manifest loading + structural validation.
//
// The manifests are plain JSON on purpose: node reads them natively, nix reads
// them with builtins.fromJSON, and a shell script can get at them through node
// without either side growing a parser dependency. That was a hard requirement
// — the pins have to be consumable by depinfo.sh, packages.lock.nix and
// check-upstream.mjs at once.

import { readFileSync } from 'node:fs';
import { ENGINE_MANIFEST, FLAGS_MANIFEST, FORKS_MANIFEST, SERIES_MANIFEST } from './paths.js';

export class ManifestError extends Error {}

function read(file, label) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new ManifestError(`${label}: ${e.message}`);
  }
}

export function loadEngine() {
  const m = read(ENGINE_MANIFEST, 'manifest/engine.json');
  if (m.schema !== 1) throw new ManifestError(`manifest/engine.json: unsupported schema ${m.schema}`);
  if (!m.dependencies || typeof m.dependencies !== 'object') throw new ManifestError('manifest/engine.json: no `dependencies`');
  for (const [name, dep] of Object.entries(m.dependencies)) {
    if (!dep.pins || Object.keys(dep.pins).length === 0) throw new ManifestError(`engine.json: ${name} has no pins`);
    for (const [platform, pin] of Object.entries(dep.pins)) {
      if (!m.platforms.includes(platform)) throw new ManifestError(`engine.json: ${name} pins unknown platform "${platform}"`);
      for (const field of ['version', 'url', 'sha256', 'fetch', 'pinNote']) {
        if (!pin[field]) throw new ManifestError(`engine.json: ${name}.${platform} is missing \`${field}\``);
      }
      if (!['tarball', 'git-tag'].includes(pin.fetch)) throw new ManifestError(`engine.json: ${name}.${platform} has unknown fetch "${pin.fetch}"`);
      if (pin.fetch === 'git-tag' && !pin.ref) throw new ManifestError(`engine.json: ${name}.${platform} is fetch:git-tag but declares no \`ref\``);
    }
  }
  return m;
}

export function loadFlags() {
  const m = read(FLAGS_MANIFEST, 'manifest/flags.json');
  if (m.schema !== 1) throw new ManifestError(`manifest/flags.json: unsupported schema ${m.schema}`);
  for (const tool of ['ffmpeg', 'mpv']) {
    if (!m[tool]?.scopes) throw new ManifestError(`flags.json: no \`${tool}.scopes\``);
  }
  return m;
}

export function loadForks() {
  const m = read(FORKS_MANIFEST, 'manifest/forks.json');
  if (m.schema !== 1) throw new ManifestError(`manifest/forks.json: unsupported schema ${m.schema}`);
  for (const [name, fork] of Object.entries(m.forks ?? {})) {
    for (const field of ['repo', 'branch', 'platform', 'patchDir', 'defaultLocalPath']) {
      if (!fork[field]) throw new ManifestError(`forks.json: ${name} is missing \`${field}\``);
    }
    if (!fork.appliedBy?.default) throw new ManifestError(`forks.json: ${name} needs \`appliedBy.default\``);
    if (!fork.files || Object.keys(fork.files).length === 0) throw new ManifestError(`forks.json: ${name} maps no files`);
  }
  return m;
}

export function loadSeries() {
  const m = read(SERIES_MANIFEST, 'manifest/series.json');
  if (m.schema !== 1) throw new ManifestError(`manifest/series.json: unsupported schema ${m.schema}`);
  if (!m.series) throw new ManifestError('manifest/series.json: no `series`');
  return m;
}

/** Every (dep, platform) pair that has at least one patch, in manifest order. */
export function seriesEntries(series) {
  const out = [];
  for (const [dep, byPlatform] of Object.entries(series.series)) {
    for (const [platform, ids] of Object.entries(byPlatform)) {
      if (ids.length > 0) out.push({ dep, platform, ids });
    }
  }
  return out;
}

/** The pin a (dep, platform) pair resolves to, or null. */
export function pinFor(engine, dep, platform) {
  return engine.dependencies[dep]?.pins?.[platform] ?? null;
}
