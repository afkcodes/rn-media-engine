// `workshop verify` — the gate.
//
// Downloads the pinned sources by url + sha256, applies the full patch series
// strictly (git apply for diffs, the anchored engine for transforms), checks the
// manifests for undeclared divergence, and re-proves every anchored conversion
// against the diff it replaced. Any failure is a non-zero exit. Nothing here
// writes to the repo.

import { loadAllPatches, PatchError } from '../lib/patches.js';
import { loadEngine, loadFlags, loadSeries, pinFor, seriesEntries } from '../lib/manifest.js';
import { checkEngineDivergence, checkFlagDivergence, checkLgplInvariant } from '../lib/divergence.js';
import { applySeries, variantGroups } from '../lib/apply.js';
import { pristineTree, scratchCopy, clearWork, SourceError } from '../lib/cache.js';
import { proveAllEquivalences } from '../lib/equivalence.js';
import { asciiTable, markdownTable } from '../lib/table.js';
import { detail, heading, line, mark, stepSummary } from '../lib/log.js';

export function help() {
  return [
    'workshop verify — apply the full patch series to the pinned sources.',
    '',
    'This is the core gate. It proves three things, and exits non-zero if any of',
    'them is false:',
    '',
    '  1. every patch in manifest/series.json applies cleanly, with no fuzz, to the',
    '     exact bytes manifest/engine.json pins (url + sha256, both checked);',
    '  2. the manifests are internally consistent — every measured cross-platform',
    '     divergence is declared, no declaration is stale, and the LGPL invariant',
    '     holds across every recorded flag scope;',
    '  3. every ANCHORED patch produces a tree byte-identical to the unified diff',
    '     it was converted from — the diff the forks ship — and every anchored',
    '     patch has such a diff to be proven against.',
    '',
    'Usage: ./workshop verify [options]',
    '',
    'Options:',
    '  --only <dep>          verify one dependency only (mpv, ffmpeg, ...)',
    '  --skip-equivalence    skip check 3 (it needs two more copies of the tree per',
    '                        converted patch)',
    '  --keep                do not delete the scratch trees on the way out',
    '  --json                machine-readable result',
    '  --help                this text',
    '',
    'Sources are cached under $WORKSHOP_CACHE (default .cache/), so the second run',
    'and every CI run with a warm cache download nothing.',
  ].join('\n');
}

export async function run({ flags }) {
  const json = flags.json === true;
  /** @type {{step: string, ok: boolean, detail: string}[]} */
  const results = [];
  const record = (step, ok, detailText) => {
    results.push({ step, ok, detail: detailText });
    return ok;
  };

  // ── 1. load + validate everything on disk ─────────────────────────────────
  let engine, flagsManifest, series, patches;
  try {
    engine = loadEngine();
    flagsManifest = loadFlags();
    series = loadSeries();
    patches = loadAllPatches();
  } catch (e) {
    if (!json) {
      heading('Manifests and patches');
      mark('fail', e instanceof PatchError ? `patch declaration invalid: ${e.message}` : e.message);
    }
    record('load', false, e.message);
    return finish(results, json, 1);
  }
  const patchesById = new Map(patches.map((p) => [p.id, p]));
  const active = patches.filter((p) => p.status === 'active');
  if (!json) {
    heading('Manifests and patches');
    mark('ok', `${Object.keys(engine.dependencies).length} dependencies, ${active.length} active patches, ${patches.length - active.length} reserved slot(s)`);
  }
  record('load', true, `${active.length} active patches`);

  // ── 2. manifest consistency ───────────────────────────────────────────────
  const engineCheck = checkEngineDivergence(engine);
  const flagCheck = checkFlagDivergence(flagsManifest);
  const lgpl = checkLgplInvariant(flagsManifest);
  const findings = [...engineCheck.findings, ...flagCheck.findings, ...lgpl.findings];

  if (!json) {
    heading('Manifest consistency');
    line(asciiTable([['Dependency', 'Role', 'Android', 'Darwin', 'Divergence', 'Ref'], ...engineCheck.rows]));
    line('');
    if (findings.length === 0) {
      mark('ok', 'every measured divergence is declared, and every declaration is still real');
      mark('ok', `LGPL invariant holds across ${['ffmpeg', 'mpv'].length} tools' recorded flag scopes`);
    } else {
      for (const f of findings) {
        mark('fail', `${f.id}: ${f.message}`);
        if (f.detail) detail(f.detail);
      }
    }
  }
  record('manifest-consistency', findings.length === 0, findings.length === 0 ? 'no undeclared or stale divergence' : `${findings.length} finding(s)`);

  // ── 3. the patch series against the pinned sources ────────────────────────
  if (!json) heading('Patch series against pinned sources');
  /** @type {string[][]} */
  const seriesRows = [];
  let seriesOk = true;

  for (const { dep, platform } of seriesEntries(series)) {
    if (flags.only && flags.only !== dep) continue;
    const pin = pinFor(engine, dep, platform);
    if (!pin) {
      seriesOk = false;
      seriesRows.push([dep, platform, '—', 'FAIL', 'no pin in manifest/engine.json for this dependency+platform']);
      continue;
    }

    let tree;
    try {
      tree = await pristineTree({ name: dep, version: pin.version, url: pin.url, sha256: pin.sha256 });
    } catch (e) {
      seriesOk = false;
      seriesRows.push([dep, platform, pin.version, 'FAIL', e instanceof SourceError ? e.message.split('\n')[0] : e.message]);
      if (!json) {
        mark('fail', `${dep}/${platform}: ${e.message}`);
      }
      continue;
    }

    for (const group of variantGroups(series, patchesById, dep, platform)) {
      const label = `${dep}/${platform}/${group.variants.join('+')}`;
      const work = scratchCopy(tree, `verify-${label.replace(/\//g, '-')}`);
      const applied = applySeries(work, group.patches, { stopOnFailure: true });
      const failed = applied.filter((r) => r.result === 'failed');
      if (failed.length) seriesOk = false;

      if (!json) {
        mark(failed.length ? 'fail' : 'ok', `${label}  (series of ${group.patches.length})`);
        for (const r of applied) {
          const glyph = r.result === 'failed' ? '✗' : r.result === 'skipped' ? '·' : '✓';
          detail(`${glyph} ${r.id.padEnd(34)} ${r.kind.padEnd(9)} ${r.result === 'failed' ? r.reason : r.reason}`);
          if (r.result === 'failed' && r.anchors) {
            for (const a of r.anchors.filter((x) => x.state !== 'found' && x.state !== 'applied')) {
              detail(`    anchor ${a.file}#${a.index}: ${a.state} (matched ${a.pristineCount}x, expected ${a.expectCount})`);
            }
          }
        }
        // A series that never ran a patch would pass vacuously; say the count.
        if (group.patches.length === 0) detail('(no patches for this combination)');
      }
      for (const r of applied) seriesRows.push([label, r.id, r.kind, r.result.toUpperCase(), r.reason]);
      if (applied.length < group.patches.length) {
        seriesRows.push([label, '(remaining)', '', 'NOT RUN', 'series stopped at the first failure']);
      }
    }
  }
  record('patch-series', seriesOk, seriesOk ? 'every patch applied cleanly' : 'at least one patch failed');

  // ── 4. every anchored conversion is byte-identical to the diff it replaced ─
  let equivalence = null;
  if (flags['skip-equivalence'] || (flags.only && flags.only !== 'mpv')) {
    if (!json) {
      heading('Anchored-conversion equivalence');
      mark('skip', 'skipped by flag — the anchored forms are NOT proven equal to the shipped diffs in this run');
    }
    record('equivalence', true, 'skipped by flag');
  } else {
    try {
      equivalence = await proveAllEquivalences();
      if (!json) {
        heading('Anchored-conversion equivalence');
        for (const r of equivalence.results) {
          mark(r.ok ? 'ok' : 'fail', r.detail);
          for (const d of r.differences.slice(0, 20)) detail(d);
        }
        // An anchored patch with no reference diff is a conversion nobody
        // checked. Staying quiet about it would lose the entire point.
        for (const id of equivalence.missing) {
          mark('fail', `${id}: anchored, but there is no tests/fixtures/${id}.reference.diff to prove it against`);
        }
        if (equivalence.results.length === 0 && equivalence.missing.length === 0) mark('skip', 'no anchored patches to prove');
      }
      record(
        'equivalence',
        equivalence.ok,
        equivalence.missing.length
          ? `${equivalence.missing.length} anchored patch(es) with no reference diff: ${equivalence.missing.join(', ')}`
          : `${equivalence.results.length} conversion(s) proven byte-identical`,
      );
    } catch (e) {
      if (!json) {
        heading('Anchored-conversion equivalence');
        mark('fail', e.message);
      }
      record('equivalence', false, e.message);
    }
  }

  if (!flags.keep) clearWork();

  const failedSteps = results.filter((r) => !r.ok);
  if (!json) {
    heading('Result');
    for (const r of results) mark(r.ok ? 'ok' : 'fail', `${r.step}: ${r.detail}`);
    line('');
    line(failedSteps.length === 0 ? 'workshop verify: GREEN — the pinned engine builds from this patch series.' : `workshop verify: RED — ${failedSteps.length} step(s) failed.`);
  }

  await stepSummary(
    ['## workshop verify', '', markdownTable([['Step', 'Result', 'Detail'], ...results.map((r) => [r.step, r.ok ? '🟢 pass' : '🔴 FAIL', r.detail])]), '', '### Divergence', '', markdownTable([['Dependency', 'Role', 'Android', 'Darwin', 'Divergence', 'Ref'], ...engineCheck.rows])].join('\n'),
  );

  return finish(results, json, failedSteps.length === 0 ? 0 : 1, { series: seriesRows, equivalence });
}

function finish(results, json, code, extra = {}) {
  if (json) console.log(JSON.stringify({ ok: code === 0, results, ...extra }, null, 2));
  return code;
}
