// Unified-diff application. `git apply` and nothing else, on purpose.
//
// ARCHITECTURE.md §11 mandates --fuzz=0. GNU `patch` defaults to --fuzz=2 and
// the darwin fork still applies its series with plain `patch -p1`, which is how
// a patch can land on an already-fixed tree in the wrong place. `git apply` has
// no fuzz at all: a hunk matches or the patch is rejected. That is the whole
// reason this wrapper exists rather than a `patch` call.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** @param {string[]} args @param {string} cwd */
function git(args, cwd) {
  try {
    const stdout = execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    return { ok: true, stdout, stderr: '' };
  } catch (e) {
    return { ok: false, stdout: e.stdout?.toString() ?? '', stderr: (e.stderr?.toString() ?? e.message).trim() };
  }
}

const APPLY_ARGS = ['apply', '-p1', '--whitespace=nowarn'];

/**
 * Refuse to operate inside someone else's git work tree.
 *
 * `git apply` run from a SUBDIRECTORY of a work tree quietly drops every hunk
 * whose path leaves that subdirectory, and reports success — `--check` agrees.
 * A scratch tree sitting under the workshop's own `.cache/` hit exactly this:
 * git-format patches (`diff --git a/... b/...`) applied to nothing, twice over,
 * silently. `git rev-parse --show-prefix` is non-empty in precisely that
 * situation, so it is the exact test.
 */
function assertNotNestedInRepo(tree) {
  const r = git(['rev-parse', '--show-prefix'], tree);
  if (r.ok && r.stdout.trim() !== '') {
    throw new DiffError(
      `refusing to apply patches in ${tree}: it is a subdirectory of a git work tree ` +
        `(prefix "${r.stdout.trim()}"), where git apply silently ignores hunks outside the ` +
        'current directory. Set WORKSHOP_WORK to a path outside any repository.',
    );
  }
}

/**
 * @typedef {'appliable'|'applied'|'rejects'} DiffState
 * @returns {{ state: DiffState, reason: string }}
 */
export function inspectDiff(tree, diffFile) {
  assertNotNestedInRepo(tree);
  const forward = git([...APPLY_ARGS, '--check', diffFile], tree);
  if (forward.ok) return { state: 'appliable', reason: 'git apply --check clean' };
  const reverse = git([...APPLY_ARGS, '--reverse', '--check', diffFile], tree);
  if (reverse.ok) return { state: 'applied', reason: 'already applied (reverse check is clean)' };
  return { state: 'rejects', reason: forward.stderr || 'git apply --check failed' };
}

/**
 * @returns {{ result: 'applied'|'skipped', reason: string }}
 * @throws {DiffError}
 */
export function applyDiff(tree, diffFile, patchId) {
  const state = inspectDiff(tree, diffFile);
  if (state.state === 'applied') return { result: 'skipped', reason: state.reason };
  if (state.state === 'rejects') throw new DiffError(`${patchId}: ${state.reason}`);
  const res = git([...APPLY_ARGS, diffFile], tree);
  if (!res.ok) throw new DiffError(`${patchId}: git apply failed after a clean --check: ${res.stderr}`);
  return { result: 'applied', reason: 'git apply clean (no fuzz)' };
}

export class DiffError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DiffError';
  }
}

const HEADER = /^(diff |index |--- |\+\+\+ |@@ |new file |deleted file |old mode |new mode |similarity |rename |copy |GIT binary|\\ No newline)/;

/**
 * Parse a unified diff into the files it touches and its two images.
 *
 * `preImage` is what the diff expects to find (context + removed lines) and
 * `postImage` is what it leaves behind (context + added lines). Having both is
 * what lets a marker be validated statically even when it spans a context line
 * and an added one — which patch 006's does, because the only thing it adds is
 * a line that already exists verbatim elsewhere in mpv's meson.build.
 *
 * @returns {{ files: string[], preImage: string, postImage: string }}
 */
export function readDiff(diffFile) {
  const text = readFileSync(diffFile, 'utf8');
  const files = new Set();
  const pre = [];
  const post = [];
  for (const raw of text.split('\n')) {
    const f = /^(?:\+\+\+|---) (?:[ab]\/)?(.+?)(?:\t.*)?$/.exec(raw);
    if (f) {
      if (f[1] !== '/dev/null') files.add(f[1]);
      continue;
    }
    if (HEADER.test(raw)) continue;
    if (raw.startsWith('+')) post.push(raw.slice(1));
    else if (raw.startsWith('-')) pre.push(raw.slice(1));
    else if (raw.startsWith(' ')) {
      pre.push(raw.slice(1));
      post.push(raw.slice(1));
    }
  }
  return { files: [...files].sort(), preImage: pre.join('\n'), postImage: post.join('\n') };
}
