// The anchored-transform engine.
//
// A transform is an exact-substring replacement against a named PRISTINE
// anchor. There is no fuzz, no line number and no hunk: upstream churn
// elsewhere in the file is free, and a moved anchor is a hard error naming the
// file, never a silent skip.
//
// The contract is deliberately stricter than the prior art it is modelled on
// (ales-drnz/libmpv-scripts). Theirs applies a subset of call sites with
// `if pristine in text: replace(...)` and still writes the file-level marker,
// so a moved anchor produces a HALF-PATCHED tree that reports success. Here:
//
//   * every transform declares `expectCount` and must match EXACTLY that many
//     times, or the whole patch fails;
//   * the patch is validated as a unit and only then written, so a failure
//     leaves the tree untouched — partial application is unreachable;
//   * the marker is checked against the transforms rather than trusted: marker
//     present but not every transform applied is "partially patched tree",
//     which is an error, not a skip.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Non-overlapping occurrence count. @param {string} hay @param {string} needle */
export function countOccurrences(hay, needle) {
  if (!needle) return 0;
  let n = 0;
  let i = 0;
  for (;;) {
    const j = hay.indexOf(needle, i);
    if (j < 0) return n;
    n++;
    i = j + needle.length;
  }
}

/**
 * @typedef {'found'|'moved'|'gone'|'applied'|'missing-file'} AnchorState
 * @typedef {{ file: string, index: number, state: AnchorState, pristineCount: number,
 *             patchedCount: number, expectCount: number, note?: string }} AnchorReport
 * @typedef {'appliable'|'applied'|'partial'|'anchors-lost'} PatchState
 */

/**
 * Read-only examination of a tree. This is what both `verify` (before it
 * writes) and `dry-run` (which never writes) are built on.
 *
 * @param {string} tree
 * @param {{ id: string, marker: string, transforms: {file: string, pristine: string, patched: string, expectCount: number, note?: string}[] }} patch
 * @returns {{ state: PatchState, anchors: AnchorReport[], markerPresent: boolean, reason: string }}
 */
export function inspectAnchored(tree, patch) {
  /** @type {Map<string,string|null>} */
  const files = new Map();
  const read = (f) => {
    if (!files.has(f)) {
      const p = join(tree, f);
      files.set(f, existsSync(p) ? readFileSync(p, 'utf8') : null);
    }
    return files.get(f);
  };

  /** @type {AnchorReport[]} */
  const anchors = patch.transforms.map((t, index) => {
    const text = read(t.file);
    if (text === null) {
      return { file: t.file, index, state: 'missing-file', pristineCount: 0, patchedCount: 0, expectCount: t.expectCount, note: t.note };
    }
    const patchedCount = countOccurrences(text, t.patched);
    const pristineCount = countOccurrences(text, t.pristine);
    /** @type {AnchorState} */
    let state;
    if (patchedCount === t.expectCount) state = 'applied';
    else if (pristineCount === t.expectCount) state = 'found';
    else if (pristineCount > 0 || patchedCount > 0) state = 'moved';
    else state = 'gone';
    return { file: t.file, index, state, pristineCount, patchedCount, expectCount: t.expectCount, note: t.note };
  });

  const markerPresent = [...new Set(patch.transforms.map((t) => t.file))].some((f) => (read(f) ?? '').includes(patch.marker));
  const applied = anchors.filter((a) => a.state === 'applied').length;
  const found = anchors.filter((a) => a.state === 'found').length;

  if (markerPresent && applied === anchors.length) {
    return { state: 'applied', anchors, markerPresent, reason: `marker \`${patch.marker}\` present and all ${applied} transforms verified applied` };
  }
  if (markerPresent) {
    return {
      state: 'partial',
      anchors,
      markerPresent,
      reason: `PARTIALLY PATCHED TREE: marker \`${patch.marker}\` is present but only ${applied}/${anchors.length} transforms are applied`,
    };
  }
  if (applied > 0) {
    return {
      state: 'partial',
      anchors,
      markerPresent,
      reason: `PARTIALLY PATCHED TREE: ${applied}/${anchors.length} transforms are already applied but the marker \`${patch.marker}\` is absent`,
    };
  }
  if (found === anchors.length) {
    return { state: 'appliable', anchors, markerPresent, reason: `all ${found} anchors matched exactly` };
  }
  const lost = anchors.filter((a) => a.state !== 'found');
  return {
    state: 'anchors-lost',
    anchors,
    markerPresent,
    reason:
      `${lost.length}/${anchors.length} anchor(s) did not match: ` +
      lost.map((a) => `${a.file}#${a.index} ${a.state}${a.state === 'moved' ? ` (${a.pristineCount}x, want ${a.expectCount})` : ''}`).join(', '),
  };
}

/**
 * Apply a patch atomically. Validates every transform first and only then
 * writes, so a rejected patch leaves the tree exactly as it found it.
 *
 * @returns {{ result: 'applied'|'skipped', reason: string, anchors: AnchorReport[] }}
 * @throws {AnchoredError} on anything that is not a clean apply or a clean skip
 */
export function applyAnchored(tree, patch) {
  const report = inspectAnchored(tree, patch);
  if (report.state === 'applied') return { result: 'skipped', reason: report.reason, anchors: report.anchors };
  if (report.state !== 'appliable') throw new AnchoredError(`${patch.id}: ${report.reason}`, report);

  // Phase 1: build every new file body in memory.
  /** @type {Map<string,string>} */
  const staged = new Map();
  for (const t of patch.transforms) {
    const current = staged.get(t.file) ?? readFileSync(join(tree, t.file), 'utf8');
    const n = countOccurrences(current, t.pristine);
    if (n !== t.expectCount) {
      // Reachable when two transforms on one file overlap — a patch-authoring
      // bug, and one that must never reach the disk.
      throw new AnchoredError(
        `${patch.id}: transform ${t.file}#${patch.transforms.indexOf(t)} matched ${n} times after earlier transforms on the same file (expected ${t.expectCount}) — overlapping anchors`,
        report,
      );
    }
    staged.set(t.file, current.split(t.pristine).join(t.patched));
  }

  // Phase 2: the marker must actually be in the result, or "already patched"
  // can never be detected on a re-run and idempotence is a lie.
  if (![...staged.values()].some((v) => v.includes(patch.marker))) {
    throw new AnchoredError(`${patch.id}: marker \`${patch.marker}\` is not present in the patched result — the marker does not prove application`, report);
  }

  // Phase 3: write.
  for (const [file, text] of staged) writeFileSync(join(tree, file), text);
  return { result: 'applied', reason: `${patch.transforms.length} transform(s) applied`, anchors: report.anchors };
}

export class AnchoredError extends Error {
  constructor(message, report) {
    super(message);
    this.name = 'AnchoredError';
    this.report = report;
  }
}
