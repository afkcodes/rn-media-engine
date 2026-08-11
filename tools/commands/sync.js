// `workshop sync` — generate each fork's patch files from the canonical copies.
//
// This is what kills hand-copying. Before it, the two forks carried copies that
// were byte-identical "by discipline and nothing else", and the one time that
// was checked it turned out to be false: the prefetch-hook headers had drifted,
// and the darwin derivation's own integrity comment quoted its own hash.
//
// The generated file is header prose + a WORKSHOP block + the diff body. Only
// the body is load-bearing, and `--check` reports header drift and body drift
// separately, because rewriting prose is routine and rewriting a diff body is
// an incident.

import { statSync } from 'node:fs';
import { loadAllPatches } from '../lib/patches.js';
import { loadEngine, loadForks } from '../lib/manifest.js';
import { clearWork } from '../lib/cache.js';
import { generateForkFile, forkPath, patchesForFork, readForkFile, splitForkFile, unmappedForPlatform, writeForkFile } from '../lib/fork-sync.js';
import { asciiTable } from '../lib/table.js';
import { detail, heading, line, mark } from '../lib/log.js';

export function help() {
  return [
    'workshop sync — generate the forks\' patch files from the canonical copies.',
    '',
    'Usage: ./workshop sync [--check] [options]',
    '',
    'Options:',
    '  --check              write nothing; exit non-zero listing every fork file',
    '                       that differs from what would be generated',
    '  --fork <name>        only android, or only darwin (default: both)',
    '  --android-path <p>   where the Android fork is checked out',
    '  --darwin-path <p>    where the darwin fork is checked out',
    '  --allow-body-change  permit a diff BODY to change. Off by default: a body',
    '                       change means the patch content itself moved, which',
    '                       during a migration is an incident, not a sync.',
    '  --json               machine-readable result',
    '  --help               this text',
    '',
    'Paths resolve as: --<fork>-path, then $WORKSHOP_FORK_ANDROID / _DARWIN, then',
    'the defaultLocalPath in manifest/forks.json (the forks beside this repo).',
    '',
    'Output is byte-stable — no timestamps, no version stamps, no blob hashes —',
    'so `sync` immediately followed by `sync --check` is always green.',
  ].join('\n');
}

export async function run({ flags }) {
  const check = flags.check === true;
  const json = flags.json === true;
  const engine = loadEngine();
  const forks = loadForks();
  const patches = loadAllPatches();
  const patchesById = new Map(patches.map((p) => [p.id, p]));

  const names = typeof flags.fork === 'string' ? [flags.fork] : Object.keys(forks.forks);
  /** @type {any[]} */
  const results = [];
  let bodyChanges = 0;
  let drift = 0;
  let missingCheckout = 0;

  for (const name of names) {
    const fork = forks.forks[name];
    if (!fork) throw new Error(`unknown fork "${name}" — known: ${Object.keys(forks.forks).join(', ')}`);
    const root = forkPath(name, fork, flags);

    if (!json) heading(`${name} — ${fork.repo} @ ${fork.branch}`);

    // A patch that applies on a platform but is mapped into no file there is
    // the hand-copying this command exists to end.
    const unmapped = unmappedForPlatform(fork, patches);
    if (unmapped.length) {
      if (!json) mark('fail', `${unmapped.length} patch(es) target ${fork.platform} but are mapped to no file: ${unmapped.join(', ')}`);
      drift += unmapped.length;
      results.push({ fork: name, unmapped });
    }

    const entries = patchesForFork(fork, patchesById);
    if (!existsDir(root)) {
      missingCheckout++;
      if (!json) {
        mark('fail', `no checkout at ${root}`);
        detail('pass --' + name + '-path, or set WORKSHOP_FORK_' + name.toUpperCase());
      }
      results.push({ fork: name, error: `no checkout at ${root}` });
      continue;
    }

    /** @type {string[][]} */
    const rows = [];
    for (const { patch, filename } of entries) {
      const generated = await generateForkFile(patch, name, fork, { engine });
      const current = readForkFile(root, fork, filename);

      if (current.text === null) {
        rows.push([filename, patch.id, 'NEW', 'file does not exist in the fork']);
        drift++;
        if (!check) writeForkFile(root, fork, filename, generated);
        continue;
      }
      if (current.text === generated) {
        rows.push([filename, patch.id, 'in sync', '']);
        continue;
      }

      // Header drift is routine; body drift is an incident. Report them apart.
      const a = splitForkFile(current.text);
      const b = splitForkFile(generated);
      const bodyDiffers = a.body !== b.body;
      if (bodyDiffers) bodyChanges++;
      drift++;
      rows.push([
        filename,
        patch.id,
        bodyDiffers ? 'BODY CHANGED' : 'header only',
        bodyDiffers ? `${diffStat(a.body, b.body)} — the patch CONTENT differs` : `${diffStat(a.header, b.header)} in the prose header`,
      ]);

      if (!check) {
        if (bodyDiffers && !flags['allow-body-change']) {
          if (!json) {
            mark('fail', `${filename}: the diff BODY would change — refusing to write`);
            detail('A sync is supposed to rewrite prose, not patch content. Investigate the');
            detail('difference; re-run with --allow-body-change only once you know why it moved.');
          }
          continue;
        }
        writeForkFile(root, fork, filename, generated);
      }
    }

    if (!json) {
      line(asciiTable([['File', 'Canonical patch', 'State', 'Detail'], ...rows]));
      const changed = rows.filter((r) => r[2] !== 'in sync').length;
      line('');
      mark(changed === 0 ? 'ok' : check ? 'fail' : 'warn', `${rows.length} file(s), ${changed} differing from canonical`);
    }
    results.push({ fork: name, root, rows });
  }

  clearWork();

  if (json) {
    console.log(JSON.stringify({ ok: drift === 0, drift, bodyChanges, results }, null, 2));
    return check && drift > 0 ? 1 : 0;
  }

  heading('Result');
  if (missingCheckout) {
    mark('fail', `${missingCheckout} fork checkout(s) missing — nothing was compared for those`);
  }
  if (drift === 0 && !missingCheckout) {
    mark('ok', 'every fork patch file matches what the canonical copies generate');
  } else {
    mark(check ? 'fail' : 'warn', `${drift} file(s) differ from canonical${bodyChanges ? `, ${bodyChanges} of them in the DIFF BODY` : ''}`);
  }
  line('');
  line(
    check
      ? drift > 0 || missingCheckout
        ? 'workshop sync --check: DRIFT — a fork has been edited in place, or the canonical copy moved without a sync.'
        : 'workshop sync --check: clean.'
      : 'Generated. Review the diff in each fork and commit there.',
  );
  return (check && (drift > 0 || missingCheckout)) || missingCheckout ? 1 : 0;
}

function existsDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** "+n/-m lines" between two texts, computed by line multiset. */
function diffStat(a, b) {
  const count = (t) => {
    const m = new Map();
    for (const l of t.split('\n')) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const ma = count(a);
  const mb = count(b);
  let added = 0;
  let removed = 0;
  for (const [l, n] of mb) added += Math.max(0, n - (ma.get(l) ?? 0));
  for (const [l, n] of ma) removed += Math.max(0, n - (mb.get(l) ?? 0));
  return `+${added}/-${removed} lines`;
}
