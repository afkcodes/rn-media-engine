// `workshop render-diff` — show any patch as a unified diff, whatever its
// canonical form is.
//
// The one real cost of the anchored format is that a reviewer cannot read a
// patch as a diff any more; they have to read a data file and imagine the
// result. This command removes that cost: it materialises the effective diff by
// applying the patch to a pristine tree and diffing. Review always sees a diff,
// and the diff is generated from the thing that actually runs rather than being
// a second copy that can drift.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPatch, listPatchIds, installAssets } from '../lib/patches.js';
import { loadEngine, pinFor } from '../lib/manifest.js';
import { applyAnchored } from '../lib/anchored.js';
import { pristineTree, scratchCopy, clearWork } from '../lib/cache.js';

export function help() {
  return [
    'workshop render-diff — materialise a patch as a unified diff.',
    '',
    'Usage: ./workshop render-diff <patch-id> [options]',
    '',
    'For `kind: diff` patches this prints the canonical file unchanged.',
    'For `kind: anchored` patches it applies the transforms to a pristine, pinned',
    'source tree and diffs the result — so what you review is generated from the',
    'thing that actually runs, not from a second copy that can drift out of sync.',
    '',
    'Options:',
    '  --platform <p>   which platform\'s pin to render against (default: darwin,',
    '                   falling back to whichever platform has a pin)',
    '  --help           this text',
    '',
    `Patches: ${listPatchIds().join(', ')}`,
  ].join('\n');
}

export async function run({ flags, positional }) {
  const id = positional[0];
  if (!id) {
    console.error('workshop render-diff: name a patch\n');
    console.error(help());
    return 1;
  }
  const patch = loadPatch(id);
  if (patch.status === 'reserved') {
    console.error(`workshop render-diff: ${id} is a RESERVED slot with no payload yet.`);
    console.error(patch.todo);
    return 1;
  }

  if (patch.kind === 'diff') {
    process.stdout.write(readFileSync(patch.diffFile, 'utf8'));
    return 0;
  }

  const engine = loadEngine();
  const dep = patch.deps[0];
  const platform = typeof flags.platform === 'string' ? flags.platform : patch.platforms.includes('darwin') ? 'darwin' : patch.platforms[0];
  const pin = pinFor(engine, dep, platform);
  if (!pin) {
    console.error(`workshop render-diff: no pin for ${dep}/${platform} in manifest/engine.json`);
    return 1;
  }

  const tree = await pristineTree({ name: dep, version: pin.version, url: pin.url, sha256: pin.sha256 });
  const work = scratchCopy(tree, `render-${id}`);
  installAssets(work, patch);
  applyAnchored(work, patch);

  const out = [
    [
      `# Rendered by \`workshop render-diff ${id}\` against ${dep} ${pin.version} (${platform} pin).`,
      `# GENERATED — the canonical form is patches/${id}/patch.json + fragments/.`,
      '',
      '',
    ].join('\n'),
  ];
  // Declaration order, not alphabetical. A patch's transforms are written in
  // the order that tells its story — for 004 that is loadfile.c first, which is
  // the whole point of the patch — while `patch.files` is sorted for lookups.
  // This also makes the rendered output line up with the diff the forks ship.
  const ordered = [...new Set(patch.transforms.map((t) => t.file))];
  for (const rel of ordered) {
    out.push(diffFile(join(tree, rel), join(work, rel), rel));
  }
  for (const a of patch.assets) {
    out.push(diffFile('/dev/null', join(work, a.to), a.to));
  }
  process.stdout.write(out.filter(Boolean).join(''));

  if (!flags.keep) clearWork();
  return 0;
}

/** `git diff --no-index`, with the temp paths rewritten to the tree-relative one. */
function diffFile(a, b, rel) {
  let text = '';
  try {
    execFileSync('git', ['diff', '--no-index', '--no-color', '--src-prefix=a/', '--dst-prefix=b/', '--', a, b], { encoding: 'utf8' });
    return ''; // exit 0 means identical
  } catch (e) {
    // git diff --no-index exits 1 when the files differ, which is the case we want.
    if (e.status !== 1) throw new Error(`git diff --no-index failed for ${rel}: ${e.stderr?.toString().trim() ?? e.message}`);
    text = e.stdout.toString();
  }
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text
    .replace(new RegExp(`^diff --git a${esc(a)} b${esc(b)}$`, 'm'), `diff --git a/${rel} b/${rel}`)
    .replace(new RegExp(`^--- (a${esc(a)}|/dev/null)$`, 'm'), a === '/dev/null' ? '--- /dev/null' : `--- a/${rel}`)
    .replace(new RegExp(`^\\+\\+\\+ b${esc(b)}$`, 'm'), `+++ b/${rel}`);
}
