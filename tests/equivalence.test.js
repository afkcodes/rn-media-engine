// The anchored-conversion equivalence proofs, as repeatable tests.
//
// The claim being defended for each converted patch: changing the FORM changed
// nothing else. Applying the fork's shipped unified diff, or applying the
// anchored form, to a pristine mpv 0.41.0 tree must produce byte-identical
// trees — every file, no exceptions, no "modulo whitespace".
//
// This needs the pinned mpv source, so it downloads (once) into the workshop
// cache. Set WORKSHOP_SKIP_NETWORK_TESTS=1 to skip it; CI does not.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { anchoredPatchesMissingProof, patchesOwingProof, proveEquivalence } from '../tools/lib/equivalence.js';
import { clearWork } from '../tools/lib/cache.js';

const skip = process.env.WORKSHOP_SKIP_NETWORK_TESTS === '1' ? 'WORKSHOP_SKIP_NETWORK_TESTS=1' : false;

test('every anchored patch has a reference diff to be proven against', () => {
  // Offline, and deliberately separate from the proofs themselves: a converted
  // patch that quietly ships without its fixture would otherwise just mean one
  // fewer test running, which is the silent-skip failure this repo exists to
  // rule out.
  assert.deepEqual(anchoredPatchesMissingProof(), []);
});

for (const patchId of patchesOwingProof()) {
  test(`${patchId}: the anchored form produces the same tree as the diff the forks ship`, { skip, timeout: 600_000 }, async () => {
    const r = await proveEquivalence({ patchId });
    clearWork();
    assert.deepEqual(r.differences, [], `trees diverge:\n${r.differences.join('\n')}`);
    assert.ok(r.ok);
    assert.ok(r.files > 500, `only ${r.files} files compared — the tree looks wrong`);
  });
}
