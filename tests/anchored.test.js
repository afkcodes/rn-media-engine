// The anchored engine's contract, tested where it matters: the failure modes.
//
// ales-drnz's patchers have no tests at all, and the defect this format exists
// to fix — `if pristine in text: replace(...)`, which applies a SUBSET of call
// sites and still writes the marker — is exactly the kind of bug that only a
// test for the negative case catches.

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, beforeEach, afterEach } from 'node:test';
import { applyAnchored, inspectAnchored, countOccurrences, AnchoredError } from '../tools/lib/anchored.js';

let tree;
beforeEach(() => {
  tree = mkdtempSync(join(tmpdir(), 'workshop-anchored-'));
});
afterEach(() => {
  rmSync(tree, { recursive: true, force: true });
});

const write = (rel, text) => {
  mkdirSync(join(tree, rel, '..'), { recursive: true });
  writeFileSync(join(tree, rel), text);
};
const read = (rel) => readFileSync(join(tree, rel), 'utf8');

const patch = (transforms, marker = 'MARK') => ({ id: 'test-patch', marker, transforms });

test('countOccurrences counts non-overlapping matches', () => {
  assert.equal(countOccurrences('aaaa', 'aa'), 2);
  assert.equal(countOccurrences('abcabc', 'abc'), 2);
  assert.equal(countOccurrences('abc', 'z'), 0);
  assert.equal(countOccurrences('abc', ''), 0);
});

test('a clean apply replaces exactly and reports the transform count', () => {
  write('a.c', 'int x;\nint y;\n');
  const p = patch([{ file: 'a.c', pristine: 'int y;', patched: 'int y; // MARK', expectCount: 1 }]);
  const r = applyAnchored(tree, p);
  assert.equal(r.result, 'applied');
  assert.equal(read('a.c'), 'int x;\nint y; // MARK\n');
});

test('expectCount is exact: fewer matches than declared is a hard failure', () => {
  write('a.c', 'call();\n');
  const p = patch([{ file: 'a.c', pristine: 'call();', patched: 'call(); // MARK', expectCount: 2 }]);
  assert.throws(() => applyAnchored(tree, p), AnchoredError);
  assert.equal(read('a.c'), 'call();\n', 'the tree must be untouched after a rejection');
});

test('expectCount is exact: MORE matches than declared is also a hard failure', () => {
  // This is the ales-drnz defect in its purest form: an anchor that used to
  // match once now matches three times because upstream duplicated a call site.
  // Replacing all three, or silently replacing one, are both wrong.
  write('a.c', 'call();\ncall();\ncall();\n');
  const p = patch([{ file: 'a.c', pristine: 'call();', patched: 'call(); // MARK', expectCount: 1 }]);
  assert.throws(() => applyAnchored(tree, p), /did not match/);
  assert.equal(read('a.c'), 'call();\ncall();\ncall();\n');
});

test('a multi-transform patch is ATOMIC: one bad anchor writes nothing at all', () => {
  write('a.c', 'good anchor\n');
  write('b.c', 'the anchor upstream moved\n');
  const p = patch([
    { file: 'a.c', pristine: 'good anchor', patched: 'good anchor MARK', expectCount: 1 },
    { file: 'b.c', pristine: 'anchor that is gone', patched: 'MARK', expectCount: 1 },
  ]);
  assert.throws(() => applyAnchored(tree, p), AnchoredError);
  assert.equal(read('a.c'), 'good anchor\n', 'the first transform must not have been written');
  assert.equal(read('b.c'), 'the anchor upstream moved\n');
});

test('re-applying is a clean skip, not a double-apply', () => {
  write('a.c', 'int y;\n');
  const p = patch([{ file: 'a.c', pristine: 'int y;', patched: 'int y; // MARK', expectCount: 1 }]);
  applyAnchored(tree, p);
  const again = applyAnchored(tree, p);
  assert.equal(again.result, 'skipped');
  assert.equal(read('a.c'), 'int y; // MARK\n');
});

test('a PARTIALLY patched tree is an error, never a skip', () => {
  // The marker is present (transform 1 landed) but transform 2 did not. This is
  // precisely the state ales-drnz's patchers can leave behind and then report as
  // "Already patched".
  write('a.c', 'one MARK\n');
  write('b.c', 'two\n');
  const p = patch([
    { file: 'a.c', pristine: 'one', patched: 'one MARK', expectCount: 1 },
    { file: 'b.c', pristine: 'two', patched: 'two MARK', expectCount: 1 },
  ]);
  const report = inspectAnchored(tree, p);
  assert.equal(report.state, 'partial');
  assert.match(report.reason, /PARTIALLY PATCHED TREE/);
  assert.throws(() => applyAnchored(tree, p), /PARTIALLY PATCHED TREE/);
});

test('an applied transform with no marker anywhere is also "partially patched"', () => {
  write('a.c', 'one PATCHED\n');
  write('b.c', 'two\n');
  const p = patch([
    { file: 'a.c', pristine: 'one', patched: 'one PATCHED', expectCount: 1 },
    { file: 'b.c', pristine: 'two', patched: 'two MARK', expectCount: 1 },
  ]);
  assert.equal(inspectAnchored(tree, p).state, 'partial');
});

test('anchors are reported individually as found / moved / gone', () => {
  write('a.c', 'here\n');
  write('b.c', 'dup\ndup\n');
  write('c.c', 'nothing relevant\n');
  const p = patch([
    { file: 'a.c', pristine: 'here', patched: 'here MARK', expectCount: 1 },
    { file: 'b.c', pristine: 'dup', patched: 'dup MARK', expectCount: 1 },
    { file: 'c.c', pristine: 'vanished', patched: 'MARK', expectCount: 1 },
    { file: 'missing.c', pristine: 'x', patched: 'MARK', expectCount: 1 },
  ]);
  const states = inspectAnchored(tree, p).anchors.map((a) => a.state);
  assert.deepEqual(states, ['found', 'moved', 'gone', 'missing-file']);
});

test('a marker that the patch does not actually introduce is rejected at apply time', () => {
  write('a.c', 'int y;\n');
  const p = patch([{ file: 'a.c', pristine: 'int y;', patched: 'int z;', expectCount: 1 }], 'NEVER_WRITTEN');
  assert.throws(() => applyAnchored(tree, p), /marker .* is not present in the patched result/);
  assert.equal(read('a.c'), 'int y;\n');
});

test('overlapping transforms on one file are caught before anything is written', () => {
  write('a.c', 'alpha beta\n');
  const p = patch([
    { file: 'a.c', pristine: 'alpha beta', patched: 'alpha MARK', expectCount: 1 },
    { file: 'a.c', pristine: 'beta', patched: 'beta MARK', expectCount: 1 },
  ]);
  assert.throws(() => applyAnchored(tree, p), /overlapping anchors/);
  assert.equal(read('a.c'), 'alpha beta\n');
});
