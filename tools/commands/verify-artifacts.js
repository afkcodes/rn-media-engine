// `workshop verify-artifacts` — the shipped-artifact matrix (D5(d)).
//
// Everything before this command checks SOURCES: that patches apply, that pins
// agree, that flags are declared. None of it proves anything about the binary a
// user actually downloads. This does: a fixed category matrix over every slice
// of both platforms' releases.
//
// Fixed is the whole idea, borrowed from ales-drnz's verify_binaries.sh: every
// slice runs every category, and a category that does not apply prints `∅` with
// a stated reason. Comparability is enforced by shape, so "iOS passed 8" and
// "Android passed 9" can never quietly mean different things.
//
// The workshop records no fork release tags by design (they are what the forks
// PRODUCE, not what they are built from), so both tags are required arguments.

import { loadAllPatches } from '../lib/patches.js';
import { CATEGORIES } from '../lib/artifacts/categories/index.js';
import { androidSlices, darwinSlices } from '../lib/artifacts/slices.js';
import { fetchAssets, listAssets, previousTag, ArtifactError } from '../lib/artifacts/fetch.js';
import { TOOLS } from '../lib/artifacts/binutils.js';
import { expectedExportSets } from '../lib/export-lists.js';
import { loadForks } from '../lib/manifest.js';
import { asciiTable, markdownTable, wrap } from '../lib/table.js';
import { detail, heading, line, mark, stepSummary } from '../lib/log.js';

const GLYPH = { pass: 'PASS', fail: 'FAIL', na: '∅', info: 'info' };

export function help() {
  return [
    'workshop verify-artifacts — the shipped-artifact matrix.',
    '',
    'Usage: ./workshop verify-artifacts --android-tag <tag> --darwin-tag <tag>',
    '',
    'Both tags are REQUIRED and there are no defaults, on purpose: the workshop',
    'records no fork release tags anywhere. It pins the SOURCES the forks build',
    'from; the release tags are what the forks produce, and rn-media\'s',
    'libmpv.gradle / libmpv.pin are their consumers. Inventing a default here',
    'would mean carrying a copy that goes stale on the next release.',
    '',
    'Options:',
    '  --android-tag <tag>   e.g. v1.1.9-rnmedia.6',
    '  --darwin-tag <tag>    e.g. v0.7.2-rnmedia.5',
    '  --android-prev <tag>  previous release for the size delta (default: the',
    '  --darwin-prev <tag>   release published immediately before the tag)',
    '  --no-spot             skip the darwin dependency frameworks',
    '  --json                machine-readable matrix',
    '  --help                this text',
    '',
    'Categories (every slice runs every one; ∅ always carries a reason):',
    ...CATEGORIES.map((c) => `  ${c.id.padEnd(15)} ${c.title}`),
    '',
    'Needs `unzip`, and `llvm-nm` for the export categories — it reads both ELF',
    'and Mach-O, which is what makes the Apple half runnable on a Linux CI box.',
    'It is looked up in the Android NDK and then on PATH; if it is missing, the',
    'export categories report ∅ with that reason rather than passing vacuously.',
  ].join('\n');
}

export async function run({ flags }) {
  const json = flags.json === true;
  const androidTag = typeof flags['android-tag'] === 'string' ? flags['android-tag'] : null;
  const darwinTag = typeof flags['darwin-tag'] === 'string' ? flags['darwin-tag'] : null;
  if (!androidTag && !darwinTag) {
    console.error('workshop verify-artifacts: pass --android-tag and/or --darwin-tag\n');
    console.error(help());
    return 1;
  }

  const forks = loadForks();
  const patches = loadAllPatches();
  const expectedExports = expectedExportSets();

  /** @type {any[]} */
  const slices = [];
  /** @type {Record<string, any>} */
  const ctxByPlatform = {};

  for (const [platform, tag] of [['android', androidTag], ['darwin', darwinTag]]) {
    if (!tag) continue;
    const repo = forks.forks[platform].repo;
    if (!json) heading(`${platform} — ${repo} @ ${tag}`);

    // The previous release, for the size delta. Resolved rather than assumed.
    const prevFlag = flags[`${platform}-prev`];
    let previous = null;
    let previousError = null;
    const prevTag = typeof prevFlag === 'string' ? prevFlag : (await previousTag(repo, tag)).tag;
    if (prevTag) {
      try {
        const assets = await listAssets(repo, prevTag);
        previous = { tag: prevTag, sizes: Object.fromEntries(assets.map((a) => [a.name.replace(prevTag, tag), a.size])) };
      } catch (e) {
        previousError = `could not read ${prevTag}: ${e.message}`;
      }
    } else {
      previousError = `no release found before ${tag}`;
    }
    ctxByPlatform[platform] = { previous, previousError };

    try {
      const got = platform === 'android' ? await androidSlices(repo, tag) : await darwinSlices(repo, tag, { spot: flags['no-spot'] !== true });
      slices.push(...got);
      if (!json) mark('ok', `${got.length} slice(s) from ${new Set(got.map((s) => s.assetName)).size} asset(s); previous release: ${previous?.tag ?? `none (${previousError})`}`);
    } catch (e) {
      if (!json) mark('fail', e instanceof ArtifactError ? e.message : `${e.name}: ${e.message}`);
      return 1;
    }
  }

  if (!TOOLS.llvmNm && !json) {
    mark('warn', 'llvm-nm not found — the export categories will report ∅, not pass');
  }

  // ── run the matrix ────────────────────────────────────────────────────────
  const results = [];
  for (const slice of slices) {
    const ctx = { patches, expectedExports, ...ctxByPlatform[slice.platform], flags };
    const cells = {};
    for (const cat of CATEGORIES) {
      try {
        cells[cat.id] = cat.run(slice, ctx);
      } catch (e) {
        cells[cat.id] = { state: 'fail', detail: `category threw: ${e.message}` };
      }
    }
    results.push({ slice, cells });
  }

  const failures = results.flatMap((r) => Object.entries(r.cells).filter(([, c]) => c.state === 'fail').map(([id, c]) => ({ slice: r.slice.label, id, detail: c.detail })));

  if (json) {
    console.log(JSON.stringify({ ok: failures.length === 0, results: results.map((r) => ({ slice: r.slice.label, role: r.slice.role, cells: r.cells })), failures }, null, 2));
    return failures.length ? 1 : 0;
  }

  // ── render ────────────────────────────────────────────────────────────────
  heading('Matrix');
  line(asciiTable([['Slice', ...CATEGORIES.map((c) => c.id)], ...results.map((r) => [r.slice.label, ...CATEGORIES.map((c) => GLYPH[r.cells[c.id].state])])]));

  heading('Per-cell detail');
  for (const r of results) {
    line(`${r.slice.label}${r.slice.role === 'spot' ? `   [spot check: ${r.slice.spotReason}]` : ''}`);
    for (const cat of CATEGORIES) {
      const c = r.cells[cat.id];
      line(`    ${GLYPH[c.state].padEnd(4)} ${cat.id.padEnd(15)} ${c.detail}`);
    }
    line('');
  }

  heading('Result');
  const counts = { pass: 0, fail: 0, na: 0, info: 0 };
  for (const r of results) for (const cat of CATEGORIES) counts[r.cells[cat.id].state]++;
  mark(failures.length ? 'fail' : 'ok', `${results.length} slices x ${CATEGORIES.length} categories = ${results.length * CATEGORIES.length} cells: ${counts.pass} pass, ${counts.fail} FAIL, ${counts.na} n/a (each with a reason), ${counts.info} informational`);
  for (const f of failures) {
    line('');
    mark('fail', `${f.slice} / ${f.id}`);
    detail(wrap(f.detail, 92));
  }
  line('');
  line(failures.length === 0 ? 'workshop verify-artifacts: GREEN — every shipped slice satisfies every applicable category.' : `workshop verify-artifacts: RED — ${failures.length} cell(s) failed.`);

  await stepSummary(
    ['## workshop verify-artifacts', '', markdownTable([['Slice', ...CATEGORIES.map((c) => c.id)], ...results.map((r) => [r.slice.label, ...CATEGORIES.map((c) => GLYPH[r.cells[c.id].state])])])].join('\n'),
  );
  return failures.length ? 1 : 0;
}
