// The 003-pcm-tap equivalence proof.
//
// Converting a shipped unified diff into anchored transforms is only safe if
// the two produce the SAME TREE. Not "the same intent", not "the same hunks" —
// the same bytes. So the conversion carries its own proof:
//
//   tree A = pristine mpv 0.41.0 + tests/fixtures/003-pcm-tap.reference.diff
//            (the exact file both forks ship today, copied verbatim)
//   tree B = pristine mpv 0.41.0 + patches/003-pcm-tap applied by the workshop's
//            own anchored engine
//   assert: A and B are byte-identical, every file, no exceptions
//
// This runs in `workshop verify` and as a node:test case, so the claim is
// re-checked on every CI run rather than asserted once in a commit message.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { applyAnchored } from './anchored.js';
import { applyDiff } from './diffpatch.js';
import { pristineTree, scratchCopy } from './cache.js';
import { loadEngine } from './manifest.js';
import { loadPatch } from './patches.js';
import { TESTS_DIR } from './paths.js';

/** relative path -> sha256 of contents, for every regular file in `root`. */
function fingerprint(root) {
  /** @type {Map<string,string>} */
  const out = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) {
        out.set(relative(root, abs).split('\\').join('/'), createHash('sha256').update(readFileSync(abs)).digest('hex'));
      }
    }
  };
  walk(root);
  return out;
}

/**
 * @returns {Promise<{ ok: boolean, files: number, differences: string[], detail: string }>}
 */
export async function proveEquivalence({ patchId = '003-pcm-tap' } = {}) {
  const engine = loadEngine();
  const pin = engine.dependencies.mpv.pins.darwin;
  const tree = await pristineTree({ name: 'mpv', version: pin.version, url: pin.url, sha256: pin.sha256 });

  const patch = loadPatch(patchId);
  if (patch.kind !== 'anchored') throw new Error(`${patchId} is kind "${patch.kind}"; the equivalence proof is about the anchored conversion`);

  const referenceDiff = join(TESTS_DIR, 'fixtures', `${patchId}.reference.diff`);

  const a = scratchCopy(tree, `equiv-${patchId}-reference`);
  applyDiff(a, referenceDiff, `${patchId} (reference diff)`);

  const b = scratchCopy(tree, `equiv-${patchId}-anchored`);
  applyAnchored(b, patch);

  const fa = fingerprint(a);
  const fb = fingerprint(b);
  /** @type {string[]} */
  const differences = [];
  for (const [path, hash] of fa) {
    if (!fb.has(path)) differences.push(`only in reference tree: ${path}`);
    else if (fb.get(path) !== hash) differences.push(`differs: ${path}`);
  }
  for (const path of fb.keys()) if (!fa.has(path)) differences.push(`only in anchored tree: ${path}`);

  return {
    ok: differences.length === 0,
    files: fa.size,
    differences,
    detail:
      differences.length === 0
        ? `${fa.size} files identical between the reference diff and the anchored form (mpv ${pin.version})`
        : `${differences.length} difference(s) across ${fa.size} files`,
  };
}
