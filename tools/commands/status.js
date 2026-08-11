// `workshop status` — what the engine is pinned to, where it diverges, and what
// we do to it. Read-only, network-tolerant, and never green about something it
// could not measure.

import { loadAllPatches } from '../lib/patches.js';
import { loadEngine, loadFlags, loadSeries } from '../lib/manifest.js';
import { checkEngineDivergence, checkFlagDivergence } from '../lib/divergence.js';
import { resolveUpstream } from '../lib/upstream.js';
import { compareVersions, isVersionLike } from '../lib/version.js';
import { asciiTable, wrap } from '../lib/table.js';
import { heading, line, mark } from '../lib/log.js';

export function help() {
  return [
    'workshop status — pins vs upstream, divergence, and the patch inventory.',
    '',
    'Three tables:',
    '  1. every pinned dependency against upstream latest stable, per platform.',
    '     Endpoints come from each dependency\'s `upstream` block in',
    '     manifest/engine.json, so no version is ever written in the tooling.',
    '  2. the divergence table: what differs between Android and darwin, whether',
    '     it is declared, and whether the declaration calls it intentional or a bug.',
    '  3. the patch inventory: id, kind, target dependency, platforms, variants.',
    '',
    'Usage: ./workshop status [options]',
    '',
    'Options:',
    '  --offline   skip every upstream lookup (tables 2 and 3 still render)',
    '  --json      machine-readable dump',
    '  --help      this text',
    '',
    'An unreachable upstream is reported as `unknown`, never as `current`. Set',
    'GH_TOKEN to raise the GitHub rate limit from 60/h to 5000/h.',
  ].join('\n');
}

export async function run({ flags }) {
  const json = flags.json === true;
  const engine = loadEngine();
  const flagsManifest = loadFlags();
  const series = loadSeries();
  const patches = loadAllPatches();

  // ── 1. pins vs upstream ───────────────────────────────────────────────────
  const deps = Object.entries(engine.dependencies);
  const resolved = flags.offline
    ? deps.map(() => ({ ok: 'skip', reason: '--offline' }))
    : await Promise.all(deps.map(([, d]) => resolveUpstream(d.upstream)));

  /** @type {{component:string, android:string, darwin:string, latest:string, status:string, note:string}[]} */
  const pinRows = [];
  let behind = 0;
  let unknown = 0;
  for (let i = 0; i < deps.length; i++) {
    const [name, dep] = deps[i];
    const r = resolved[i];
    const android = dep.pins.android?.version ?? '—';
    const darwin = dep.pins.darwin?.version ?? '—';
    let status;
    let latest;
    let note = '';
    if (r.ok === 'skip') {
      status = 'unwatched';
      latest = '—';
      note = r.reason;
    } else if (!r.ok) {
      status = 'unknown';
      latest = 'unknown';
      note = `upstream lookup failed: ${r.error}`;
      unknown++;
    } else {
      latest = r.version;
      // "Ours" is the LOWEST pin across platforms: if either platform lags, we lag.
      const ours = [android, darwin].filter((v) => v !== '—' && isVersionLike(v)).sort(compareVersions)[0];
      if (!ours) {
        status = 'unknown';
        note = 'pin is a commit, not a version — nothing to compare';
        unknown++;
      } else {
        const c = compareVersions(ours, latest);
        status = c < 0 ? 'BEHIND' : c > 0 ? 'ahead' : 'current';
        if (c < 0) {
          behind++;
          // A pin can be deliberately behind — FFmpeg routinely is, because our
          // FFmpeg is chosen by what the pinned mpv requires and a fresh major
          // postdates the mpv release that must build against it. The row still
          // says BEHIND; it just also says why, in the pin's own words.
          const notes = [...new Set(Object.values(dep.pins).map((p) => p.pinNote))];
          note = `PINNED DELIBERATELY: ${notes.join(' // ')}`;
        }
      }
    }
    pinRows.push({ component: name, android, darwin, latest, status, note });
  }

  // ── 2. divergence ─────────────────────────────────────────────────────────
  const engineCheck = checkEngineDivergence(engine);
  const flagCheck = checkFlagDivergence(flagsManifest);

  // ── 3. patch inventory ────────────────────────────────────────────────────
  const inventory = patches.map((p) => ({
    id: p.id,
    kind: p.status === 'reserved' ? 'RESERVED' : p.kind,
    deps: p.deps.join(','),
    scope: p.scope,
    variants: p.variants.join(','),
    files: p.status === 'reserved' ? '—' : String(p.files.length),
    payload: p.status === 'reserved' ? '—' : p.kind === 'anchored' ? `${p.transforms.length} transforms` : 'unified diff',
    summary: p.summary,
  }));

  if (json) {
    console.log(JSON.stringify({ pins: pinRows, divergence: { engine: engineCheck, flags: flagCheck }, patches: inventory, series: series.series, behind, unknown }, null, 2));
    return 0;
  }

  heading('Pins vs upstream latest stable');
  line(asciiTable([['Dependency', 'Android', 'Darwin', 'Latest', 'Status'], ...pinRows.map((r) => [r.component, r.android, r.darwin, r.latest, r.status])]));
  const noted = pinRows.filter((r) => r.note);
  if (noted.length) {
    line('');
    line('Notes:');
    for (const r of noted) line(wrap(`${r.component}: ${r.note}`, 100, '    '));
  }
  line('');
  // "All current" is only ever said when something was actually measured.
  // --offline measures nothing, and a table full of `unwatched` rows adding up
  // to zero drift is not a green light.
  const watched = pinRows.filter((r) => r.status !== 'unwatched').length;
  line(
    flags.offline
      ? 'No upstream lookups were performed (--offline): currency is UNMEASURED.'
      : watched === 0
        ? 'No dependency declares an upstream resolver: currency is UNMEASURED.'
        : behind > 0
          ? `${behind} of ${watched} watched dependenc${behind === 1 ? 'y is' : 'ies are'} behind upstream latest stable.`
          : unknown > 0
            ? `No lag measured, but currency is UNVERIFIED: ${unknown} lookup(s) did not resolve.`
            : `All ${watched} watched dependencies are current.`,
  );

  heading('Cross-platform divergence');
  line(asciiTable([['Dependency', 'Role', 'Android', 'Darwin', 'Divergence', 'Ref'], ...engineCheck.rows]));
  line('');
  line(asciiTable([['Tool', 'Flag divergence', 'Status', 'Flags', 'Ref'], ...flagCheck.rows]));
  line('');
  const problems = [...engineCheck.findings, ...flagCheck.findings];
  if (problems.length === 0) {
    mark('ok', 'every measured divergence is declared, and every declaration is still real');
  } else {
    for (const f of problems) mark('fail', `${f.id}: ${f.message}`);
  }
  const bugs = [
    ...(engine.repoDivergences ?? []).filter((d) => d.status === 'bug').map((d) => `repo/${d.id}`),
    ...Object.entries(engine.dependencies).filter(([, d]) => d.divergence?.status === 'bug').map(([n]) => `pin/${n}`),
    ...['ffmpeg', 'mpv'].flatMap((t) => (flagsManifest[t].divergences ?? []).filter((d) => d.status === 'bug').map((d) => `flag/${d.id}`)),
  ];
  line('');
  line(`Declared as BUG (tracked, still wrong): ${bugs.length}`);
  for (const b of bugs) line(`    ${b}`);

  heading('Patch inventory');
  line(
    asciiTable([
      ['Patch', 'Kind', 'Dependency', 'Platforms', 'Variants', 'Files', 'Payload'],
      ...inventory.map((p) => [p.id, p.kind, p.deps, p.scope, p.variants, p.files, p.payload]),
    ]),
  );
  line('');
  line('Apply order (manifest/series.json):');
  for (const [dep, byPlatform] of Object.entries(series.series)) {
    for (const [platform, ids] of Object.entries(byPlatform)) {
      if (ids.length) line(`    ${`${dep}/${platform}`.padEnd(22)} ${ids.join(' → ')}`);
    }
  }

  return 0;
}
