// Rendering a patch to a unified diff body.
//
// `kind: diff` patches ARE a diff body — it is returned verbatim, so syncing
// them can never alter a byte. `kind: anchored` patches are materialised: apply
// the transforms to a pristine tree and diff.
//
// Two normalisations, both because git's own output carries noise that is not
// part of the patch:
//
//   * `index <blob>..<blob> <mode>` lines are dropped. They name blob hashes of
//     a tree that only ever existed in a scratch directory, so they are
//     meaningless to anyone applying the patch, and `git apply` ignores them.
//   * hunk headers optionally lose their trailing function context. This is
//     per-patch and exists for one reason, stated plainly: the two anchored
//     patches the forks carry today were produced by different tooling — 003's
//     hunk headers carry `@@ ... @@ static void process_plane(...)` and 004's
//     are bare — and the first sync must not rewrite a single byte of either
//     body. Once both files are generated the flag can go.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { installAssets } from './patches.js';
import { pristineTree, scratchCopy } from './cache.js';
import { applyAnchored } from './anchored.js';
import { applySeries, resolveSeries } from './apply.js';
import { loadAllPatches } from './patches.js';
import { loadSeries, pinFor } from './manifest.js';

const INDEX_LINE = /^index [0-9a-f]+\.\.[0-9a-f]+( \d+)?$/;
const HUNK_HEADER = /^(@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@)(.*)$/;

/**
 * `git diff --no-index`, with the scratch paths rewritten to the tree-relative
 * one and the noise removed.
 */
function diffOneFile(a, b, rel, { hunkFuncContext }) {
  let text;
  try {
    execFileSync('git', ['diff', '--no-index', '--no-color', '--src-prefix=a/', '--dst-prefix=b/', '--', a, b], { encoding: 'utf8' });
    return ''; // exit 0 => identical
  } catch (e) {
    if (e.status !== 1) throw new Error(`git diff --no-index failed for ${rel}: ${e.stderr?.toString().trim() ?? e.message}`);
    text = e.stdout.toString();
  }
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const out = [];
  for (const raw of text.split('\n')) {
    if (INDEX_LINE.test(raw)) continue;
    let line = raw
      .replace(new RegExp(`^diff --git a${esc(a)} b${esc(b)}$`), `diff --git a/${rel} b/${rel}`)
      .replace(new RegExp(`^--- (a${esc(a)}|/dev/null)$`), a === '/dev/null' ? '--- /dev/null' : `--- a/${rel}`)
      .replace(new RegExp(`^\\+\\+\\+ b${esc(b)}$`), `+++ b/${rel}`);
    if (!hunkFuncContext) {
      const m = HUNK_HEADER.exec(line);
      if (m) line = m[1];
    }
    out.push(line);
  }
  return out.join('\n');
}

/**
 * The diff body for a patch, byte-stable: no timestamps, no blob hashes, and
 * files emitted in the patch's own declaration order.
 *
 * @param {import('./patches.js').Patch} patch
 * @param {{ engine: object }} ctx
 * @returns {Promise<string>} ends with exactly one newline
 */
export async function renderBody(patch, { engine }) {
  if (patch.status === 'reserved') throw new Error(`${patch.id}: a reserved slot has no body to render`);
  if (patch.kind === 'diff') {
    const body = readFileSync(patch.diffFile, 'utf8');
    return body.endsWith('\n') ? body : `${body}\n`;
  }

  const dep = patch.deps[0];
  const pin = pinFor(engine, dep, 'darwin') ?? pinFor(engine, dep, 'android');
  if (!pin) throw new Error(`${patch.id}: no pin for ${dep}`);
  const pristine = await pristineTree({ name: dep, version: pin.version, url: pin.url, sha256: pin.sha256 });

  // The BASE the hunk line numbers are counted from.
  //
  // A patch late in a series sees a file that earlier patches have already
  // grown, so its hunk headers are only correct at its own position. The forks'
  // two anchored patches disagree about this — 003's fork copy was generated
  // against a pristine tree, 004's against a tree with 002 and 003 already
  // applied (which is why its command.c hunks sit ~70 lines lower). Declaring
  // which base a patch was cut against is what lets the first sync reproduce
  // both byte-for-byte; once both files are generated this can be normalised.
  const base = patch.render?.base === 'series' ? await seriesBase(patch, pristine, engine) : pristine;

  const work = scratchCopy(base, `render-${patch.id}`);
  installAssets(work, patch);
  applyAnchored(work, patch);

  const opts = { hunkFuncContext: patch.render?.hunkFuncContext !== false };
  const ordered = [...new Set(patch.transforms.map((t) => t.file))];
  const parts = [];
  for (const rel of ordered) parts.push(diffOneFile(join(base, rel), join(work, rel), rel, opts));
  for (const a of patch.assets) parts.push(diffOneFile('/dev/null', join(work, a.to), a.to, opts));

  const body = parts.filter(Boolean).join('');
  return body.endsWith('\n') ? body : `${body}\n`;
}

/**
 * A tree with every patch that PRECEDES this one already applied, so the
 * rendered hunk headers are the ones valid at this patch's position in the
 * series.
 *
 * The platform is the first one the patch declares that actually lists it in a
 * series, and the variant is `audio` — the fullest series, and the one both
 * shipped artifacts are built from. Rendering is therefore deterministic and
 * caller-independent: `render-diff` and `sync` produce the same bytes.
 */
async function seriesBase(patch, pristine, engine) {
  const series = loadSeries();
  const byId = new Map(loadAllPatches().map((p) => [p.id, p]));
  const dep = patch.deps[0];
  const platform = patch.platforms.find((pl) => (series.series?.[dep]?.[pl] ?? []).includes(patch.id));
  if (!platform) throw new Error(`${patch.id}: render.base is "series" but the patch is in no ${dep} series`);

  const full = resolveSeries(series, byId, dep, platform, 'audio');
  const idx = full.findIndex((p) => p.id === patch.id);
  const preceding = idx < 0 ? [] : full.slice(0, idx);
  if (preceding.length === 0) return pristine;

  const base = scratchCopy(pristine, `render-base-${patch.id}`);
  const results = applySeries(base, preceding, { stopOnFailure: true });
  const failed = results.filter((r) => r.result === 'failed');
  if (failed.length) {
    throw new Error(`${patch.id}: could not build the series base — ${failed.map((f) => `${f.id}: ${f.reason}`).join('; ')}`);
  }
  return base;
}
