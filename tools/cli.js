// Argument parsing and command dispatch. Nothing else lives here.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/paths.js';

export const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

/**
 * Commands are loaded lazily so `workshop --help` costs one small import and a
 * broken command module cannot take the whole CLI down with it.
 */
export const COMMANDS = {
  status: { load: () => import('./commands/status.js'), blurb: 'pins vs upstream latest, divergence table, patch inventory' },
  verify: { load: () => import('./commands/verify.js'), blurb: 'apply the full patch series to the pinned sources (the gate)' },
  'dry-run': { load: () => import('./commands/dry-run.js'), blurb: 'the same, against a candidate version, plus an option-semantics audit' },
  'verify-artifacts': { load: () => import('./commands/verify-artifacts.js'), blurb: 'the shipped-artifact matrix over both forks\' releases' },
  sync: { load: () => import('./commands/sync.js'), blurb: 'generate the forks\' patch files from the canonical copies' },
  'render-diff': { load: () => import('./commands/render-diff.js'), blurb: 'materialise a patch as a unified diff, whatever its canonical form' },
  'new-patch': { load: () => import('./commands/new-patch.js'), blurb: 'scaffold a new patch directory' },
};

/**
 * Minimal parser: `--flag`, `--key value`, `--key=value`, and positionals.
 * Deliberately not a library. It parses five commands' worth of arguments.
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  /** @type {Record<string, string|boolean>} */
  const flags = {};
  /** @type {string[]} */
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('-')) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else if (a === '-h') {
      flags.help = true;
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

export function topLevelHelp() {
  const width = Math.max(...Object.keys(COMMANDS).map((c) => c.length));
  return [
    `rn-media engine workshop ${VERSION}`,
    '',
    'The single source of truth for everything we do to the mpv engine: the canonical',
    'patch series, the per-platform pins, and the configure/meson flag sets that our',
    'two binary forks (libmpv-android-audio-build, libmpv-darwin-build) build from.',
    '',
    'Usage: ./workshop <command> [options]',
    '',
    'Commands:',
    ...Object.entries(COMMANDS).map(([name, c]) => `  ${name.padEnd(width)}  ${c.blurb}`),
    '',
    'Run `./workshop <command> --help` for a command\'s own options.',
    '',
    'Global:',
    '  --help, -h    this text',
    '  --version     print the workshop version (tracked separately from the mpv it patches)',
    '',
    'Environment:',
    '  WORKSHOP_CACHE   where sources are downloaded and trees are built (default .cache/)',
    '  GH_TOKEN         raises the GitHub API rate limit from 60/h to 5000/h (status, dry-run)',
  ].join('\n');
}
