// The artifact matrix's pure logic. Everything here is offline: the categories
// that need a real binary are exercised by `workshop verify-artifacts` itself,
// but the expectations they compare against, and the matrix's own shape rules,
// are checkable without downloading a release.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CATEGORIES } from '../tools/lib/artifacts/categories/index.js';
import { darwinExpected, expectedExportSets } from '../tools/lib/export-lists.js';
import { loadAllPatches } from '../tools/lib/patches.js';

test('the darwin export expectation is the ld64 list itself: 54 names', () => {
  const d = darwinExpected();
  assert.equal(d.size, 54);
  assert.ok(d.has('mpv_create'));
  assert.ok(d.has('mpv_get_time_ns'));
  // The list is exact, not a wildcard — that is the whole point of it.
  assert.ok(!d.has('mpv_lavc_set_java_vm'), 'the Android-only export must not be in the Apple list');
});

test('the android expectation is DERIVED: the darwin 54 plus the one Android export', () => {
  const { android, darwin } = expectedExportSets();
  assert.equal(darwin.size, 54);
  assert.equal(android.size, 55);
  assert.ok(android.has('mpv_lavc_set_java_vm'));
  // Nothing else may differ; the 55-vs-54 delta is exactly one symbol.
  const extra = [...android].filter((n) => !darwin.has(n));
  assert.deepEqual(extra, ['mpv_lavc_set_java_vm']);
});

test('the category matrix is FIXED and every category is well formed', () => {
  assert.ok(CATEGORIES.length >= 10);
  const ids = CATEGORIES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'category ids must be unique');
  for (const c of CATEGORIES) {
    assert.equal(typeof c.title, 'string');
    assert.equal(typeof c.run, 'function');
  }
});

test('every patch declares artifact markers, or says why it has none', () => {
  // "Never a silent gap": an empty marker list is fine — 002's whole content is
  // deletion — but only with a stated reason, and the loader enforces it. This
  // asserts the repo actually satisfies that, not just that the rule exists.
  for (const p of loadAllPatches()) {
    if (p.status !== 'active') continue;
    assert.ok(Array.isArray(p.markers), `${p.id} has no markers array`);
    if (p.markers.length === 0) {
      assert.ok(p.markersNote && p.markersNote.length > 40, `${p.id} has no markers and no usable markersNote`);
    }
  }
});

test('a category returning `na` always carries a reason', () => {
  // Enforced structurally: the renderer prints the detail for every cell, so an
  // empty one would be a visibly blank reason. Check the contract holds for a
  // slice that applies to none of the platform-specific categories.
  const slice = { platform: 'darwin', label: 'test', binary: '/dev/null', kind: 'macho', role: 'spot', carries: [], assetName: 'x', assetSize: 1 };
  const ctx = { patches: [], expectedExports: expectedExportSets(), previous: null, previousError: 'none for this test' };
  for (const c of CATEGORIES) {
    const r = c.run(slice, ctx);
    assert.ok(['pass', 'fail', 'na', 'info'].includes(r.state), `${c.id} returned state ${r.state}`);
    assert.ok(r.detail && r.detail.length > 0, `${c.id} returned an empty detail`);
  }
});
