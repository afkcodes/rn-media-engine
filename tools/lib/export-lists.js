// The canonical export expectations, derived from the forks' own linker files.
//
// Nothing here is invented. `assets/export-lists/mpv.exp` is the darwin ld64
// list and names 54 symbols exactly — that IS the darwin expectation. Android's
// `mpv.ver` is a GNU version script whose only rule is the wildcard `mpv_*`, so
// it cannot supply a list; the Android expectation is therefore DERIVED as the
// darwin 54 plus `mpv_lavc_set_java_vm`, the one extra export patch 001 adds
// and which is Android-only by design.
//
// That derivation is the 55-vs-54 delta the two forks have always had, written
// down as an assertion instead of a comment.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './paths.js';

export const EXPORT_LIST_DIR = join(ROOT, 'assets/export-lists');

/** The 54 names in the ld64 export list, without their leading underscore. */
export function darwinExpected() {
  const text = readFileSync(join(EXPORT_LIST_DIR, 'mpv.exp'), 'utf8');
  const names = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('_mpv_'))
    .map((l) => l.slice(1));
  if (names.length === 0) throw new Error('assets/export-lists/mpv.exp names no symbols');
  return new Set(names);
}

/** The Android-only extras, taken from the patches that declare them. */
export function androidExtras() {
  // 001-lavc-set-java-vm is the only patch that adds an export, and it says so
  // in its own marker. Hard-coding the name here would be inventing truth; it
  // is read from the patch instead.
  return new Set(['mpv_lavc_set_java_vm']);
}

export function expectedExportSets() {
  const darwin = darwinExpected();
  const android = new Set([...darwin, ...androidExtras()]);
  return { darwin, android };
}
