// Binary inspection. One place that knows how to ask an ELF or a Mach-O a
// question, so the category modules contain judgement and not tool invocations.
//
// llvm-nm reads BOTH formats, which is what makes the Apple half of this matrix
// runnable on a Linux CI box at all. It is looked up in the Android NDK (the
// newest installed) and then on PATH; if neither has it, the categories that
// need it report N/A WITH THE REASON rather than passing vacuously.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function ndkBinDirs() {
  const roots = [process.env.ANDROID_NDK_HOME, process.env.ANDROID_HOME && join(process.env.ANDROID_HOME, 'ndk'), join(homedir(), 'Android/Sdk/ndk')].filter(Boolean);
  const out = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    if (existsSync(join(root, 'toolchains'))) {
      out.push(join(root, 'toolchains/llvm/prebuilt/linux-x86_64/bin'));
      continue;
    }
    for (const v of readdirSync(root).sort().reverse()) {
      const p = join(root, v, 'toolchains/llvm/prebuilt/linux-x86_64/bin');
      if (existsSync(p)) out.push(p);
    }
  }
  return out;
}

function which(name) {
  for (const dir of ndkBinDirs()) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  try {
    return execFileSync('command', ['-v', name], { shell: '/bin/sh', encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

/** Resolved once; every category shares it. */
export const TOOLS = {
  llvmNm: which('llvm-nm'),
  nm: which('nm'),
  readelf: which('readelf') ?? which('llvm-readelf'),
};

function run(bin, args) {
  try {
    return { ok: true, out: execFileSync(bin, args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 }) };
  } catch (e) {
    return { ok: false, error: (e.stderr?.toString() ?? e.message).trim() };
  }
}

/**
 * Exported (globally defined) symbol names.
 *
 * llvm-nm prints a `path:` header line when it feels like it, and Mach-O names
 * carry a leading underscore that ELF names do not. Both are normalised here so
 * a category can compare two platforms' sets without knowing either quirk.
 *
 * @param {'elf'|'macho'} kind
 * @returns {{ok: true, names: string[]} | {ok: false, error: string}}
 */
export function exportedSymbols(binary, kind) {
  const tool = TOOLS.llvmNm;
  if (!tool) return { ok: false, error: 'llvm-nm not found (looked in the Android NDK and on PATH)' };
  const args = kind === 'macho' ? ['-gUj', binary] : ['-Dj', '--defined-only', binary];
  const r = run(tool, args);
  if (!r.ok) return { ok: false, error: r.error };
  const names = r.out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.endsWith(':') && !l.includes('/'))
    .map((l) => (kind === 'macho' ? l.replace(/^_/, '') : l));
  return { ok: true, names: [...new Set(names)].sort() };
}

/** ELF DT_NEEDED entries. */
export function dtNeeded(binary) {
  if (!TOOLS.readelf) return { ok: false, error: 'readelf not found' };
  const r = run(TOOLS.readelf, ['-dW', binary]);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, names: [...r.out.matchAll(/\(NEEDED\)\s+Shared library: \[([^\]]+)\]/g)].map((m) => m[1]) };
}

/** Alignment of every PT_LOAD segment, in bytes. */
export function loadAlignments(binary) {
  if (!TOOLS.readelf) return { ok: false, error: 'readelf not found' };
  const r = run(TOOLS.readelf, ['-lW', binary]);
  if (!r.ok) return { ok: false, error: r.error };
  const aligns = [...r.out.matchAll(/^\s+LOAD\s+.*?(0x[0-9a-f]+)\s*$/gm)].map((m) => parseInt(m[1], 16));
  return aligns.length ? { ok: true, aligns } : { ok: false, error: 'no PT_LOAD segments parsed' };
}

/**
 * Printable strings, cached per binary — several categories grep the same
 * multi-megabyte file and re-reading it each time is the difference between a
 * fast matrix and a slow one.
 * @type {Map<string,string>}
 */
const stringsCache = new Map();

export function stringsOf(binary) {
  if (stringsCache.has(binary)) return stringsCache.get(binary);
  // Read the file and extract runs of printable ASCII >= 4 chars. Doing it in
  // Node rather than shelling out to `strings` keeps the dependency floor at
  // "node", and it is the same algorithm.
  const buf = readFileSync(binary);
  const out = [];
  let start = -1;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    const printable = b >= 0x20 && b < 0x7f;
    if (printable) {
      if (start < 0) start = i;
    } else {
      if (start >= 0 && i - start >= 4) out.push(buf.toString('latin1', start, i));
      start = -1;
    }
  }
  if (start >= 0 && buf.length - start >= 4) out.push(buf.toString('latin1', start, buf.length));
  const text = out.join('\n');
  stringsCache.set(binary, text);
  return text;
}

/** Does an exact whole-line string exist in the binary? */
export function hasExactString(binary, s) {
  return stringsOf(binary).split('\n').includes(s);
}

/** Does the binary contain this substring anywhere? */
export function hasSubstring(binary, s) {
  return stringsOf(binary).includes(s);
}
