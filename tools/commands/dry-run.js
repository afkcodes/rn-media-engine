// `workshop dry-run` — what an upstream bump would cost, before we take it.
//
// Two questions, both cheap, both answered without a toolchain:
//
//   1. does the patch series still apply? Per patch: applies-clean / rejects.
//      Per anchor: found / moved / gone — which is the thing a unified diff can
//      never tell you, because a rejected hunk names a line number and not the
//      landmark that moved.
//   2. do our FLAGS still mean what they meant? mpv 0.41 added `avfoundation`
//      with value `auto` and silently built a second audio output; FFmpeg 8.1
//      deleted the `hls://` protocol and configure only WARNED. Neither shows
//      up in a patch check.
//
// Breakage here is information, not failure: this command's job is to produce
// an honest report early. It exits non-zero only when it could not run.

import { loadAllPatches } from '../lib/patches.js';
import { loadEngine, loadFlags, loadSeries } from '../lib/manifest.js';
import { applySeries, variantGroups } from '../lib/apply.js';
import { pristineTree, scratchCopy, clearWork } from '../lib/cache.js';
import { candidateSource } from '../lib/upstream.js';
import { auditFfmpegFlags, auditMesonOptions, readFfmpegComponents, readMesonOptions } from '../lib/options-audit.js';
import { asciiTable, markdownTable, wrap } from '../lib/table.js';
import { detail, heading, line, mark, stepSummary, warn } from '../lib/log.js';

export function help() {
  return [
    'workshop dry-run — apply the series to a CANDIDATE version and audit the flags.',
    '',
    'Usage: ./workshop dry-run --mpv <tag|master> [--ffmpeg <tag|master>]',
    '',
    'Options:',
    '  --mpv <ref>       candidate mpv: a tag (0.42.0, v0.42.0) or `master`',
    '  --ffmpeg <ref>    candidate FFmpeg: a tag (9.0, n9.0) or `master`',
    '  --keep            keep the scratch trees',
    '  --json            machine-readable report',
    '  --help            this text',
    '',
    'Reports, per candidate:',
    '  * per patch   applies-clean | rejects, in series order',
    '  * per anchor  found | moved | gone (anchored patches only — a unified diff',
    '                has no anchors to report on, only hunks)',
    '  * options     mpv: added / removed / renamed meson options, and every NEW',
    '                option defaulting to `auto` that we do not explicitly name',
    '                — the avfoundation hazard.',
    '                FFmpeg: every --enable-<class>=<name> we pass, resolved',
    '                against the candidate\'s own registration tables. This is',
    '                FFmpeg\'s "did not match anything" warning, computed',
    '                statically and turned into a report you cannot miss.',
    '',
    'A candidate is fetched WITHOUT a checksum — it has no pin yet, by definition.',
    'That is stated on every run. `verify` is the command that checks checksums.',
  ].join('\n');
}

export async function run({ flags }) {
  const json = flags.json === true;
  const targets = ['mpv', 'ffmpeg'].filter((d) => typeof flags[d] === 'string');
  if (targets.length === 0) {
    console.error('workshop dry-run: name at least one candidate, e.g. --mpv master\n');
    console.error(help());
    return 1;
  }

  const engine = loadEngine();
  const flagsManifest = loadFlags();
  const series = loadSeries();
  const patches = loadAllPatches();
  const patchesById = new Map(patches.map((p) => [p.id, p]));

  /** @type {any[]} */
  const report = [];

  for (const dep of targets) {
    const ref = String(flags[dep]);
    const src = candidateSource(dep, ref);
    if (!src.ok) {
      if (!json) mark('fail', src.error);
      return 1;
    }
    const pinned = engine.dependencies[dep]?.pins?.darwin?.version ?? engine.dependencies[dep]?.pins?.android?.version ?? '?';

    if (!json) {
      heading(`Candidate: ${dep} ${src.version}   (pinned today: ${pinned})`);
      warn(`${src.url} is fetched WITHOUT a checksum — a candidate has no pin yet.${src.moving ? ' This ref MOVES: the result is only true for the commit fetched just now.' : ''}`);
    }

    let tree;
    try {
      tree = await pristineTree(src, { allowUnpinned: true });
    } catch (e) {
      if (!json) mark('fail', `could not fetch candidate: ${e.message}`);
      report.push({ dep, ref: src.version, error: e.message });
      continue;
    }

    // ── 1. the series, per platform ─────────────────────────────────────────
    /** @type {any[]} */
    const seriesReport = [];
    for (const platform of engine.platforms) {
      for (const group of variantGroups(series, patchesById, dep, platform)) {
        const label = `${platform}/${group.variants.join('+')}`;
        const work = scratchCopy(tree, `dry-${dep}-${label.replace(/\//g, '-')}`);
        // Do NOT stop at the first failure: "which of the five broke, and how"
        // is the entire product of a dry run.
        const applied = applySeries(work, group.patches, { stopOnFailure: false });
        seriesReport.push({ label, results: applied });

        if (!json) {
          const bad = applied.filter((r) => r.result === 'failed').length;
          mark(bad ? 'fail' : 'ok', `${label}: ${applied.length - bad}/${applied.length} patches apply`);
          for (const r of applied) {
            detail(`${r.result === 'failed' ? '✗' : '✓'} ${r.id.padEnd(34)} ${r.result === 'failed' ? 'REJECTS' : 'applies clean'}`);
            if (r.result === 'failed') detail(`    ${r.reason}`);
            for (const a of r.anchors ?? []) {
              if (a.state !== 'found' && a.state !== 'applied') {
                detail(`    anchor ${a.file}#${a.index}: ${a.state.toUpperCase()} (matched ${a.pristineCount}x, expected ${a.expectCount})${a.note ? ` — ${a.note}` : ''}`);
              }
            }
          }
        }
      }
    }

    // ── 2. option semantics ─────────────────────────────────────────────────
    const optionReport = dep === 'mpv' ? auditMpv(tree, flagsManifest, json) : auditFfmpeg(tree, flagsManifest, json);
    report.push({ dep, ref: src.version, pinned, moving: src.moving, series: seriesReport, options: optionReport });
  }

  if (!flags.keep) clearWork();

  if (json) {
    console.log(JSON.stringify({ report }, null, 2));
    return 0;
  }

  heading('Verdict');
  for (const r of report) {
    if (r.error) {
      mark('fail', `${r.dep} ${r.ref}: ${r.error}`);
      continue;
    }
    const failed = r.series.flatMap((s) => s.results.filter((x) => x.result === 'failed'));
    const hazards = r.options?.hazards ?? 0;
    mark(failed.length || hazards ? 'warn' : 'ok', `${r.dep} ${r.ref}: ${failed.length} patch rejection(s), ${hazards} option hazard(s)`);
  }
  line('');
  line('A dry run REPORTS; it does not gate. Rejections against a moving branch are');
  line('expected and are exactly what this is meant to surface early.');

  await stepSummary(
    ['## workshop dry-run', '', markdownTable([['Candidate', 'Rejections', 'Option hazards'], ...report.map((r) => [`${r.dep} ${r.ref}`, r.error ? 'n/a' : String(r.series.flatMap((s) => s.results.filter((x) => x.result === 'failed')).length), r.error ? 'n/a' : String(r.options?.hazards ?? 0)])])].join('\n'),
  );
  return 0;
}

function auditMpv(tree, flagsManifest, json) {
  const parsed = readMesonOptions(tree);
  if (!parsed.ok) {
    if (!json) mark('fail', `option audit: ${parsed.error}`);
    return { error: parsed.error, hazards: 0 };
  }
  const scopes = flagsManifest.mpv.scopes;
  const ours = [...(scopes.shared?.audio ?? []), ...(scopes.android?.audio ?? []), ...(scopes.darwin?.audio ?? [])];
  const a = auditMesonOptions(parsed, ours);
  const hazards = a.newAuto.length + a.removed.length + a.typeChanged.length;

  if (!json) {
    line('');
    mark(hazards ? 'warn' : 'ok', `mpv option semantics (${parsed.file.split('/').pop()}, ${parsed.options.size} options)`);
    if (a.removed.length) {
      detail(`REMOVED/RENAMED — we pass ${a.removed.length} option(s) the candidate does not define; meson will hard-error on each:`);
      detail(`    ${a.removed.join(' ')}`);
    }
    if (a.typeChanged.length) {
      detail(`TYPE CHANGED — ${a.typeChanged.length} option(s) changed between boolean and feature, so our spelling is now wrong:`);
      detail(`    ${a.typeChanged.join(' ')}`);
    }
    if (a.newAuto.length) {
      detail(`NEW and NOT NAMED BY US — ${a.newAuto.length} feature option(s) we do not set. Each defaults to \`auto\`, i.e. each builds itself in if its dependency happens to resolve. This is the avfoundation class:`);
      detail(wrap(a.newAuto.join(' '), 90, '    ').replace(/^/, '    '));
    }
    if (!hazards) detail('every option we pass still exists, with the same type, and no new auto feature is unnamed');
  }
  return { ...a, hazards };
}

function auditFfmpeg(tree, flagsManifest, json) {
  const { components, missing } = readFfmpegComponents(tree);
  const scopes = flagsManifest.ffmpeg.scopes;
  const ours = [...(scopes.shared?.audio ?? []), ...(scopes.android?.audio ?? []), ...(scopes.darwin?.audio ?? []), ...(scopes.darwin?.video ?? [])];
  const a = auditFfmpegFlags(components, ours);
  const hazards = a.unmatched.length;

  if (!json) {
    line('');
    mark(hazards ? 'warn' : 'ok', `FFmpeg component resolution (${a.matched} of ${a.matched + a.unmatched.length} component flags resolve)`);
    if (missing.length) detail(`registration tables not found (layout changed?): ${missing.join(', ')}`);
    if (a.unmatched.length) {
      detail(`${a.unmatched.length} flag(s) match NOTHING in this candidate — configure will warn and carry on, which is why this has to be read here:`);
      for (const u of a.unmatched) detail(`    ${u.flag}`);
    }
    if (a.unchecked.length) detail(`not checkable statically (not a component class): ${a.unchecked.join(' ')}`);
    if (!hazards) detail('every component flag we pass resolves against the candidate\'s registration tables');
  }
  return { unmatched: a.unmatched, matched: a.matched, hazards };
}
