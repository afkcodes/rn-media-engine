// The manifests and patch declarations must be loadable and internally
// consistent without touching the network. This is the fast half of
// `workshop verify`, so a broken declaration fails in milliseconds rather than
// after a source download.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadEngine, loadFlags, loadSeries, seriesEntries, pinFor } from '../tools/lib/manifest.js';
import { checkEngineDivergence, checkFlagDivergence, checkLgplInvariant } from '../tools/lib/divergence.js';
import { loadAllPatches, listPatchIds } from '../tools/lib/patches.js';
import { readDiff } from '../tools/lib/diffpatch.js';

test('every manifest loads and validates', () => {
  assert.ok(loadEngine().dependencies.mpv);
  assert.ok(loadFlags().ffmpeg.scopes.shared.audio.length > 0);
  assert.ok(loadSeries().series.mpv);
});

test('every patch declaration loads and validates', () => {
  const patches = loadAllPatches();
  assert.equal(patches.length, listPatchIds().length);
  assert.ok(patches.length >= 10);
});

test('no cross-platform divergence is undeclared, and no declaration is stale', () => {
  const { findings } = checkEngineDivergence(loadEngine());
  assert.deepEqual(findings, [], findings.map((f) => `${f.id}: ${f.message}`).join('\n'));
});

test('no platform-only configure flag is undeclared, and no declaration is stale', () => {
  const { findings } = checkFlagDivergence(loadFlags());
  assert.deepEqual(findings, [], findings.map((f) => `${f.id}: ${f.message} ${f.detail ?? ''}`).join('\n'));
});

test('the LGPL invariant holds across every recorded flag scope', () => {
  const { findings } = checkLgplInvariant(loadFlags());
  assert.deepEqual(findings, [], findings.map((f) => `${f.id}: ${f.message}`).join('\n'));
});

test('every patch named by a series exists, targets that dependency, and runs on that platform', () => {
  const series = loadSeries();
  const byId = new Map(loadAllPatches().map((p) => [p.id, p]));
  for (const { dep, platform, ids } of seriesEntries(series)) {
    for (const id of ids) {
      const p = byId.get(id);
      assert.ok(p, `series ${dep}/${platform} names unknown patch ${id}`);
      assert.ok(p.deps.includes(dep), `${id} is in the ${dep} series but declares deps ${p.deps.join(',')}`);
      assert.ok(p.platforms.includes(platform), `${id} is in the ${platform} series but declares platforms ${p.platforms.join(',')}`);
      assert.equal(p.status, 'active', `${id} is ${p.status} and must not be in a series`);
    }
  }
});

test('every dependency a series patches has a pin for that platform', () => {
  const engine = loadEngine();
  for (const { dep, platform } of seriesEntries(loadSeries())) {
    assert.ok(pinFor(engine, dep, platform), `no pin for ${dep}/${platform}`);
  }
});

test('every active patch is reachable from at least one series', () => {
  // A patch nothing applies is a patch nothing verifies. Both forks have had
  // exactly that; the point of a declared series is that it cannot happen
  // quietly.
  const series = loadSeries();
  const used = new Set(seriesEntries(series).flatMap((e) => e.ids));
  for (const p of loadAllPatches()) {
    if (p.status !== 'active') continue;
    assert.ok(used.has(p.id), `${p.id} is active but appears in no series`);
  }
});

test('a reserved slot carries a TODO and no payload', () => {
  for (const p of loadAllPatches().filter((x) => x.status === 'reserved')) {
    assert.ok(p.todo && p.todo.length > 40, `${p.id} must explain what it is reserving and why`);
    assert.equal(p.transforms.length, 0);
    assert.equal(p.diffFile, null);
  }
});

test('every marker discriminates: present in the post-image, absent from the pre-image', () => {
  for (const p of loadAllPatches()) {
    if (p.status !== 'active') continue;
    if (p.kind === 'diff') {
      const { preImage, postImage } = readDiff(p.diffFile);
      assert.ok(postImage.includes(p.marker), `${p.id}: marker absent from the post-image`);
      assert.ok(!preImage.includes(p.marker), `${p.id}: marker present in the pre-image`);
    } else {
      assert.ok(p.transforms.some((t) => t.patched.includes(p.marker)), `${p.id}: marker in no patched text`);
      assert.ok(!p.transforms.some((t) => t.pristine.includes(p.marker)), `${p.id}: marker in a pristine anchor`);
    }
  }
});

test('every patch documents itself', () => {
  for (const p of loadAllPatches()) {
    assert.ok(p.docsFile, `${p.id} has no docs.md`);
    assert.ok(p.summary.length > 20 && !p.summary.includes('TODO'), `${p.id} has no real summary`);
  }
});
