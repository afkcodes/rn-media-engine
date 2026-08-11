// The sync generator's contract. Byte-stability is the load-bearing property:
// a generator whose output churns cannot be a `--check` gate, because every run
// would report drift.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAllPatches } from '../tools/lib/patches.js';
import { loadEngine, loadForks } from '../tools/lib/manifest.js';
import { generateForkFile, generatedMarker, patchesForFork, prosePartsFrom, splitForkFile, unmappedForPlatform } from '../tools/lib/fork-sync.js';

const skip = process.env.WORKSHOP_SKIP_NETWORK_TESTS === '1' ? 'WORKSHOP_SKIP_NETWORK_TESTS=1' : false;

test('every patch a fork maps exists, is active, and targets that platform', () => {
  const forks = loadForks();
  const byId = new Map(loadAllPatches().map((p) => [p.id, p]));
  for (const fork of Object.values(forks.forks)) {
    const entries = patchesForFork(fork, byId); // throws on any violation
    assert.ok(entries.length > 0);
  }
});

test('no patch targets a platform without being mapped into that fork', () => {
  // A patch we apply somewhere but sync nowhere is exactly the hand-copying
  // this command exists to end.
  const forks = loadForks();
  const patches = loadAllPatches();
  for (const [name, fork] of Object.entries(forks.forks)) {
    assert.deepEqual(unmappedForPlatform(fork, patches), [], `${name} has unmapped patches`);
  }
});

test('splitForkFile finds the diff body for both diff dialects', () => {
  const gitStyle = 'prose\n\ndiff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n';
  assert.equal(splitForkFile(gitStyle).header, 'prose\n');
  assert.ok(splitForkFile(gitStyle).body.startsWith('diff --git'));

  const plainStyle = 'prose\n\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n';
  assert.equal(splitForkFile(plainStyle).header, 'prose\n');
  assert.ok(splitForkFile(plainStyle).body.startsWith('--- a/x'));

  // A file that is nothing but prose has no body to protect.
  assert.equal(splitForkFile('just prose').body, '');
});

test('prose extraction prefers the verbatim ```text fence when there is one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'workshop-docs-'));
  try {
    const fenced = join(dir, 'a.md');
    writeFileSync(fenced, '# id\n\n**A title**\n\nPorted from somewhere.\n\n```text\nWHY\n    verbatim\n```\n\n## Extra\n\nignored\n');
    assert.deepEqual(prosePartsFrom(fenced), { title: 'A title', body: 'WHY\n    verbatim' });

    const plain = join(dir, 'b.md');
    writeFileSync(plain, '# id\n\n**Another title**\n\n## Why\n\nbecause\n');
    const got = prosePartsFrom(plain);
    assert.equal(got.title, 'Another title');
    assert.match(got.body, /## Why/);
    assert.doesNotMatch(got.body, /^# id/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the generated banner names the canonical patch', () => {
  assert.match(generatedMarker('003-pcm-tap'), /^GENERATED from rn-media-engine patches\/003-pcm-tap — edit THERE/);
});

test('generation is BYTE-STABLE: same inputs, identical bytes', { skip, timeout: 600_000 }, async () => {
  const engine = loadEngine();
  const forks = loadForks();
  const byId = new Map(loadAllPatches().map((p) => [p.id, p]));
  const fork = forks.forks.android;
  // 003 is the anchored one, so this exercises the rendering path rather than
  // the pass-through path a `kind: diff` patch would take.
  const patch = byId.get('003-pcm-tap');
  const a = await generateForkFile(patch, 'android', fork, { engine });
  const b = await generateForkFile(patch, 'android', fork, { engine });
  assert.equal(a, b, 'two renders of the same patch must be byte-identical');
  assert.ok(a.startsWith(generatedMarker('003-pcm-tap')));
  assert.ok(a.includes('WORKSHOP'), 'the generated header must carry the WORKSHOP block');
  assert.ok(splitForkFile(a).body.startsWith('diff --git'));
});
