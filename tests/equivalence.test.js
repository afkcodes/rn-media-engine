// The 003-pcm-tap equivalence proof, as a repeatable test.
//
// The claim being defended: converting the shipped unified diff into anchored
// transforms changed the FORM and nothing else. Applying either one to a
// pristine mpv 0.41.0 tree must produce byte-identical trees — all 832 files,
// no exceptions, no "modulo whitespace".
//
// This needs the pinned mpv source, so it downloads (once) into the workshop
// cache. Set WORKSHOP_SKIP_NETWORK_TESTS=1 to skip it; CI does not.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { proveEquivalence } from '../tools/lib/equivalence.js';
import { clearWork } from '../tools/lib/cache.js';

test(
  '003-pcm-tap: the anchored form produces the same tree as the diff both forks ship',
  { skip: process.env.WORKSHOP_SKIP_NETWORK_TESTS === '1' ? 'WORKSHOP_SKIP_NETWORK_TESTS=1' : false, timeout: 600_000 },
  async () => {
    const r = await proveEquivalence();
    clearWork();
    assert.deepEqual(r.differences, [], `trees diverge:\n${r.differences.join('\n')}`);
    assert.ok(r.ok);
    assert.ok(r.files > 500, `only ${r.files} files compared — the tree looks wrong`);
  },
);
