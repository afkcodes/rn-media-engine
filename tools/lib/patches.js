// Patch discovery, loading and validation.
//
// A patch is a DIRECTORY named `NNN-<name>` containing `patch.json` (the
// declaration), `docs.md` (why it exists, its provenance, and what to re-check
// on a bump) and its payload — a `.diff`, or `fragments/` holding the exact
// pristine/patched anchor text.
//
// The number is stable identity, NOT apply order: the darwin fork applies its
// export-list patch before the libass strip while the android fork has no
// export-list patch at all, so no single numbering can encode both orders.
// Order is declared, per dependency and per platform, in manifest/series.json.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PATCHES_DIR } from './paths.js';
import { readDiff } from './diffpatch.js';

export const PLATFORMS = ['android', 'darwin'];
export const VARIANTS = ['audio', 'video'];
export const KINDS = ['anchored', 'diff'];

export class PatchError extends Error {}

/** Directory names, sorted — `NNN-<name>` and nothing else. */
export function listPatchIds() {
  if (!existsSync(PATCHES_DIR)) return [];
  return readdirSync(PATCHES_DIR)
    .filter((n) => /^\d{3}-[a-z0-9][a-z0-9-]*$/.test(n) && statSync(join(PATCHES_DIR, n)).isDirectory())
    .sort();
}

function req(obj, key, id, kind = 'string') {
  const v = obj[key];
  const ok = kind === 'array' ? Array.isArray(v) && v.length > 0 : typeof v === kind && String(v).length > 0;
  if (!ok) throw new PatchError(`${id}/patch.json: missing or invalid \`${key}\``);
  return v;
}

/**
 * @typedef {{
 *   id: string, dir: string, kind: 'anchored'|'diff', status: 'active'|'reserved',
 *   marker: string, deps: string[], platforms: string[], variants: string[],
 *   summary: string, docsFile: string|null, diffFile: string|null,
 *   transforms: {file:string,pristine:string,patched:string,expectCount:number,note?:string}[],
 *   assets: {from:string,to:string}[], files: string[],
 *   verification: {mode:'series'|'declared-only', reason?: string},
 *   scope: 'shared'|'android'|'darwin',
 * }} Patch
 */

/** @param {string} id @returns {Patch} */
export function loadPatch(id) {
  const dir = join(PATCHES_DIR, id);
  const jsonPath = join(dir, 'patch.json');
  if (!existsSync(jsonPath)) throw new PatchError(`${id}: no patch.json`);
  let raw;
  try {
    raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    throw new PatchError(`${id}/patch.json: ${e.message}`);
  }
  if (raw.id !== id) throw new PatchError(`${id}/patch.json: \`id\` is "${raw.id}" but the directory is "${id}"`);

  const status = raw.status ?? 'active';
  if (!['active', 'reserved'].includes(status)) throw new PatchError(`${id}: unknown status "${status}"`);

  const deps = req(raw, 'deps', id, 'array');
  const platforms = req(raw, 'platforms', id, 'array');
  for (const p of platforms) if (!PLATFORMS.includes(p)) throw new PatchError(`${id}: unknown platform "${p}"`);
  const variants = raw.variants ?? VARIANTS;
  for (const v of variants) if (!VARIANTS.includes(v)) throw new PatchError(`${id}: unknown variant "${v}"`);
  const summary = req(raw, 'summary', id);
  const docsFile = existsSync(join(dir, 'docs.md')) ? join(dir, 'docs.md') : null;
  const scope = platforms.length === PLATFORMS.length ? 'shared' : platforms[0];

  /** @type {Patch} */
  const patch = {
    id,
    dir,
    kind: raw.kind,
    status,
    marker: raw.marker ?? '',
    deps,
    platforms,
    variants,
    summary,
    docsFile,
    diffFile: null,
    transforms: [],
    assets: (raw.assets ?? []).map((a) => ({ from: a.from, to: a.to })),
    files: [],
    verification: raw.verification ?? { mode: 'series' },
    scope,
    // Rendering options exist purely to reproduce the bytes the forks carry
    // today (tools/lib/render.js). `asymmetry` is prose about how the OTHER
    // platform solves the same problem, surfaced in the generated fork header.
    // `markers` are the strings a SHIPPED artifact must contain to prove the
    // patch survived stripping; it defaults to the single apply-time marker.
    render: raw.render ?? {},
    asymmetry: raw.asymmetry ?? null,
    markers: raw.markers ?? null,
    markersNote: raw.markersNote ?? null,
  };

  if (status === 'reserved') {
    // A reserved slot declares intent and nothing else. It must not carry a
    // payload, or it would silently be a real patch that nothing applies.
    if (raw.kind || raw.transforms || raw.diff) throw new PatchError(`${id}: a reserved slot must not declare kind/transforms/diff`);
    if (!raw.todo) throw new PatchError(`${id}: a reserved slot must declare \`todo\``);
    patch.todo = raw.todo;
    return patch;
  }

  if (!KINDS.includes(raw.kind)) throw new PatchError(`${id}: \`kind\` must be one of ${KINDS.join(', ')}`);
  req(raw, 'marker', id);

  if (raw.kind === 'diff') {
    const diffName = req(raw, 'diff', id);
    const diffFile = join(dir, diffName);
    if (!existsSync(diffFile)) throw new PatchError(`${id}: diff \`${diffName}\` not found`);
    patch.diffFile = diffFile;
    const { files, preImage, postImage } = readDiff(diffFile);
    patch.files = files;
    // The marker has to PROVE application: present in what the diff leaves
    // behind, absent from what it expects to find. A marker that fails either
    // half cannot tell a patched tree from a pristine one.
    if (!postImage.includes(patch.marker)) {
      throw new PatchError(`${id}: marker \`${patch.marker}\` does not appear in the post-image of ${diffName}`);
    }
    if (preImage.includes(patch.marker)) {
      throw new PatchError(`${id}: marker \`${patch.marker}\` also appears in the PRE-image of ${diffName} — it cannot distinguish a patched tree`);
    }
  } else {
    const transforms = req(raw, 'transforms', id, 'array');
    patch.transforms = transforms.map((t, i) => {
      const where = `${id}/transforms[${i}]`;
      if (typeof t.file !== 'string' || !t.file) throw new PatchError(`${where}: missing \`file\``);
      const expectCount = t.expectCount;
      if (!Number.isInteger(expectCount) || expectCount < 1) throw new PatchError(`${where}: \`expectCount\` must be a positive integer`);
      const text = (inlineKey, fileKey) => {
        const inline = t[inlineKey];
        const rel = t[fileKey];
        if (typeof inline === 'string' && typeof rel === 'string') throw new PatchError(`${where}: declares both \`${inlineKey}\` and \`${fileKey}\``);
        if (typeof inline === 'string') return inline;
        if (typeof rel !== 'string') throw new PatchError(`${where}: needs \`${inlineKey}\` or \`${fileKey}\``);
        const p = join(dir, rel);
        if (!existsSync(p)) throw new PatchError(`${where}: fragment \`${rel}\` not found`);
        return readFileSync(p, 'utf8');
      };
      const pristine = text('pristine', 'pristineFile');
      const patched = text('patched', 'patchedFile');
      if (pristine === patched) throw new PatchError(`${where}: pristine and patched are identical`);
      if (!pristine) throw new PatchError(`${where}: pristine anchor is empty`);
      return { file: t.file, pristine, patched, expectCount, note: t.note };
    });
    patch.files = [...new Set(patch.transforms.map((t) => t.file))].sort();
    if (!patch.transforms.some((t) => t.patched.includes(patch.marker))) {
      throw new PatchError(`${id}: marker \`${patch.marker}\` does not appear in any transform's patched text`);
    }
    if (patch.transforms.some((t) => t.pristine.includes(patch.marker))) {
      throw new PatchError(`${id}: marker \`${patch.marker}\` appears in a PRISTINE anchor — it cannot distinguish a patched tree`);
    }
  }

  for (const a of patch.assets) {
    if (!existsSync(join(dir, a.from))) throw new PatchError(`${id}: asset \`${a.from}\` not found`);
  }
  // Shipped-artifact markers. An EMPTY list is allowed — plenty of patches
  // leave no greppable string, and 002's whole content is deletion — but it
  // must say why, or `verify-artifacts` would silently check nothing for it.
  if (patch.markers === null) {
    patch.markers = patch.marker ? [patch.marker] : [];
  } else if (!Array.isArray(patch.markers)) {
    throw new PatchError(`${id}: \`markers\` must be an array`);
  } else if (patch.markers.length === 0 && !patch.markersNote) {
    throw new PatchError(`${id}: \`markers\` is empty and no \`markersNote\` explains why — never a silent gap`);
  }
  if (!['series', 'declared-only'].includes(patch.verification.mode)) {
    throw new PatchError(`${id}: unknown verification mode "${patch.verification.mode}"`);
  }
  if (patch.verification.mode === 'declared-only' && !patch.verification.reason) {
    // ales-drnz's strongest idea, borrowed: an N/A cell must carry its reason.
    throw new PatchError(`${id}: verification mode "declared-only" must state a \`reason\` — never a silent gap`);
  }
  return patch;
}

/** Every patch, validated. @returns {Patch[]} */
export function loadAllPatches() {
  return listPatchIds().map(loadPatch);
}

/**
 * Copy a patch's assets into a source tree before it is applied.
 *
 * This is the "large additions live as real files" rule: the darwin export-list
 * patch only wires `rn-media-mpv.exp` into meson.build's link_args; the list
 * itself is a reviewable file, not diff hunks.
 */
export function installAssets(tree, patch) {
  for (const a of patch.assets) {
    mkdirSync(dirname(join(tree, a.to)), { recursive: true });
    copyFileSync(join(patch.dir, a.from), join(tree, a.to));
  }
  return patch.assets.map((a) => a.to);
}
