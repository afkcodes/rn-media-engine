// Series orchestration: turn (dependency, platform, variant) into an ordered
// list of patches, apply them to a scratch tree, and report per patch.
//
// Both `verify` and `dry-run` are this function with a different source tree
// and a different tolerance for failure.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyAnchored, inspectAnchored, AnchoredError } from './anchored.js';
import { applyDiff, inspectDiff, DiffError } from './diffpatch.js';
import { installAssets } from './patches.js';

/**
 * The patches that actually run for one (dep, platform, variant), in order.
 * @returns {import('./patches.js').Patch[]}
 */
export function resolveSeries(series, patchesById, dep, platform, variant) {
  const ids = series.series?.[dep]?.[platform] ?? [];
  return ids
    .map((id) => {
      const p = patchesById.get(id);
      if (!p) throw new Error(`manifest/series.json names patch "${id}", which does not exist`);
      return p;
    })
    .filter((p) => p.status === 'active' && p.variants.includes(variant) && p.deps.includes(dep) && p.platforms.includes(platform));
}

/**
 * Group the variants of a platform by the series they produce, so a dependency
 * whose audio and video series are identical is verified once and reported as
 * "audio, video" rather than run twice.
 */
export function variantGroups(series, patchesById, dep, platform) {
  const variants = series.variantsByPlatform?.[platform] ?? ['audio'];
  /** @type {Map<string, {variants: string[], patches: import('./patches.js').Patch[]}>} */
  const groups = new Map();
  for (const variant of variants) {
    const patches = resolveSeries(series, patchesById, dep, platform, variant);
    const key = patches.map((p) => p.id).join('>');
    if (!groups.has(key)) groups.set(key, { variants: [], patches });
    groups.get(key).variants.push(variant);
  }
  return [...groups.values()].filter((g) => g.patches.length > 0);
}

/** Is the patch's marker present anywhere in the files it claims to touch? */
function markerPresent(tree, patch) {
  return patch.files.some((f) => {
    const p = join(tree, f);
    return existsSync(p) && readFileSync(p, 'utf8').includes(patch.marker);
  });
}

/**
 * @typedef {{ id: string, kind: string, result: 'applied'|'skipped'|'failed',
 *             reason: string, anchors?: import('./anchored.js').AnchorReport[] }} PatchResult
 */

/**
 * Apply a series to `tree`, in order.
 *
 * @param {{ stopOnFailure?: boolean }} [opt] `verify` stops (a series is a
 *   sequence and a later patch's anchors may only exist because an earlier one
 *   ran); `dry-run` continues, because "which of the five broke" is the report.
 * @returns {PatchResult[]}
 */
export function applySeries(tree, patches, opt = {}) {
  const stopOnFailure = opt.stopOnFailure ?? true;
  /** @type {PatchResult[]} */
  const results = [];
  for (const patch of patches) {
    try {
      installAssets(tree, patch);
      let r;
      if (patch.kind === 'anchored') {
        const a = applyAnchored(tree, patch);
        r = { id: patch.id, kind: patch.kind, result: a.result, reason: a.reason, anchors: a.anchors };
      } else {
        const d = applyDiff(tree, patch.diffFile, patch.id);
        r = { id: patch.id, kind: patch.kind, result: d.result, reason: d.reason };
      }
      // Post-condition, for both kinds: the marker must now be in the tree.
      // For diffs this is the ONLY static proof the patch landed — `git apply`
      // reports success, not presence.
      if (!markerPresent(tree, patch)) {
        r = { ...r, result: 'failed', reason: `applied, but the marker \`${patch.marker}\` is not present in ${patch.files.join(', ')}` };
      }
      results.push(r);
      if (r.result === 'failed' && stopOnFailure) break;
    } catch (e) {
      results.push({
        id: patch.id,
        kind: patch.kind,
        result: 'failed',
        reason: e instanceof AnchoredError || e instanceof DiffError ? e.message : `${e.name}: ${e.message}`,
        anchors: e instanceof AnchoredError ? e.report?.anchors : undefined,
      });
      if (stopOnFailure) break;
    }
  }
  return results;
}

/**
 * Read-only: what WOULD happen, per patch and per anchor. Never writes, so it
 * cannot report on a patch whose anchors only exist after an earlier patch in
 * the series ran — those come back as `anchors-lost` and the report says so.
 */
export function inspectSeries(tree, patches) {
  return patches.map((patch) => {
    if (patch.kind === 'anchored') {
      const r = inspectAnchored(tree, patch);
      return { id: patch.id, kind: patch.kind, state: r.state, reason: r.reason, anchors: r.anchors };
    }
    const r = inspectDiff(tree, patch.diffFile);
    return { id: patch.id, kind: patch.kind, state: r.state, reason: r.reason, anchors: undefined };
  });
}
