// `workshop new-patch` — scaffold a patch directory.
//
// It writes a patch.json that will FAIL validation until it is filled in, and a
// docs.md whose headings are the questions the existing patches all answer.
// That is deliberate: a patch whose rationale is not written down is how a fork
// accumulates changes nobody can rebase.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listPatchIds } from '../lib/patches.js';
import { PATCHES_DIR } from '../lib/paths.js';

export function help() {
  return [
    'workshop new-patch — scaffold a new patch directory.',
    '',
    'Usage: ./workshop new-patch <name> [options]',
    '',
    '  <name>  lower-case, hyphenated, no number: `prefetch-hook`, not',
    '          `006-prefetch-hook`. The next free NNN prefix is assigned for you.',
    '',
    'Options:',
    '  --kind <k>        anchored (default) or diff',
    '  --dep <d>         target dependency (default: mpv)',
    '  --platforms <l>   comma-separated: android,darwin (default: both)',
    '  --variants <l>    comma-separated: audio,video (default: both)',
    '  --number <NNN>    claim a specific slot instead of the next free one',
    '  --help            this text',
    '',
    'Choosing a kind — the rule from docs/DECISIONS.md D1:',
    '  anchored   a FEATURE INSERTION. Edits are additions at named landmarks and',
    '             survive unrelated upstream churn. Large code goes in as whole',
    '             .c/.h files under assets/; transforms only wire them in.',
    '  diff       BULK or STRUCTURAL change: deletions, file removals, renames,',
    '             wide build-system edits. Diffs are what those are for.',
    '',
    'The scaffold does not validate: `./workshop verify` will reject it until the',
    'marker, the anchors and the docs are real.',
  ].join('\n');
}

export async function run({ flags, positional }) {
  const name = positional[0];
  if (!name) {
    console.error('workshop new-patch: name the patch\n');
    console.error(help());
    return 1;
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    console.error(`workshop new-patch: "${name}" must be lower-case, digits and hyphens only`);
    return 1;
  }

  const existing = listPatchIds();
  const next = typeof flags.number === 'string' ? flags.number.padStart(3, '0') : String(Math.max(0, ...existing.map((i) => parseInt(i.slice(0, 3), 10))) + 1).padStart(3, '0');
  const id = `${next}-${name}`;
  const dir = join(PATCHES_DIR, id);
  if (existsSync(dir)) {
    console.error(`workshop new-patch: ${id} already exists`);
    return 1;
  }

  const kind = typeof flags.kind === 'string' ? flags.kind : 'anchored';
  if (!['anchored', 'diff'].includes(kind)) {
    console.error(`workshop new-patch: --kind must be anchored or diff, got "${kind}"`);
    return 1;
  }
  const dep = typeof flags.dep === 'string' ? flags.dep : 'mpv';
  const platforms = typeof flags.platforms === 'string' ? flags.platforms.split(',') : ['android', 'darwin'];
  const variants = typeof flags.variants === 'string' ? flags.variants.split(',') : ['audio', 'video'];

  mkdirSync(dir, { recursive: true });

  const base = {
    id,
    summary: 'TODO one line: what this does, in the imperative.',
    kind,
    marker: 'TODO a string this patch ADDS and nothing else in the tree emits. It must be absent from the pristine tree and present after applying — the workshop checks both — and it should be greppable in the SHIPPED artifact so a release can assert the patch survived stripping.',
    deps: [dep],
    platforms,
    variants,
    verification: { mode: 'series' },
  };
  if (kind === 'anchored') {
    mkdirSync(join(dir, 'fragments'), { recursive: true });
    base.transforms = [
      {
        file: 'TODO/path/relative/to/the/source/tree.c',
        expectCount: 1,
        note: 'TODO what this edit is for, one line',
        pristine: 'TODO the EXACT text to find. Use pristineFile/patchedFile with fragments/*.txt for anything multi-line — do not escape C into JSON by hand.',
        patched: 'TODO the EXACT text to replace it with.',
      },
    ];
    writeFileSync(join(dir, 'fragments', '.gitkeep'), '');
  } else {
    base.diff = `${id}.diff`;
    writeFileSync(join(dir, base.diff), '');
  }

  writeFileSync(join(dir, 'patch.json'), JSON.stringify(base, null, 2) + '\n');
  writeFileSync(
    join(dir, 'docs.md'),
    [
      `# ${id}`,
      '',
      '**TODO one-line title.**',
      '',
      '## Why this exists',
      '',
      'TODO. The problem, not the solution. What breaks without this patch, and why',
      'the alternatives were rejected.',
      '',
      '## Provenance',
      '',
      'TODO. Where the idea came from, what licence it carries if it came from',
      'someone else, and what we deliberately did differently.',
      '',
      '## What it adds',
      '',
      'TODO. The observable surface: properties, symbols, options. State plainly',
      'whether the exported ABI changes.',
      '',
      '## Threading / ownership',
      '',
      'TODO, if any of it runs off the core thread. Which thread writes, which',
      'reads, what may block, what the failure mode is under contention.',
      '',
      '## Rebasing',
      '',
      'TODO. Name every anchor and what to re-check when the engine is bumped —',
      'this is the section that decides whether the next bump takes an hour or a',
      'week. Include the command that proves the patch reached the shipped',
      'artifact.',
      '',
      '## Marker',
      '',
      'TODO. The marker string, and why it is a good one.',
      '',
    ].join('\n'),
  );

  console.log(`Created patches/${id}/`);
  console.log(`  patch.json   fill in summary, marker${kind === 'anchored' ? ' and transforms' : ' and drop the diff in'}`);
  console.log('  docs.md      fill in every TODO — the rebasing section is the one that matters');
  console.log('');
  console.log(`Then add "${id}" to the right series in manifest/series.json (order is declared,`);
  console.log('not inferred from the number), and run `./workshop verify`.');
  return 0;
}
