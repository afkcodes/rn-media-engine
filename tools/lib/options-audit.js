// The option-semantics audit.
//
// Patches applying cleanly says nothing about whether the FLAGS still mean what
// they meant. Two real incidents shape this file:
//
//   * mpv 0.41 added `avfoundation`, value `auto`, whose dependency resolves on
//     iOS as well as macOS. Nothing rejected it, nothing warned: left alone it
//     silently built a SECOND audio output into an audio-only engine. A NEW
//     option defaulting to `auto` is a hazard even when every existing option
//     still applies.
//   * FFmpeg 8.1 deleted the `hls://` protocol, so `--enable-protocol=hls` now
//     matches nothing. configure prints a WARNING and exits 0, which in CI is
//     indistinguishable from success. HLS kept working only because what
//     carries it is the demuxer.
//
// So: for mpv, diff the candidate's meson options against what we pass and
// report added/removed/renamed plus every new `auto` feature we do not name.
// For FFmpeg, resolve each `--enable-<class>=<name>` against the candidate's
// own registration tables, which is what "did not match anything" really means.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// mpv: meson options
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse `meson.options` / `meson_options.txt`. mpv moved to the newer filename
 * at some point in the 0.3x line, so both are tried.
 * @returns {{ ok: true, file: string, options: Map<string,{type:string,value:string}> } | { ok: false, error: string }}
 */
export function readMesonOptions(tree) {
  const candidates = ['meson.options', 'meson_options.txt'];
  const file = candidates.map((c) => join(tree, c)).find((p) => existsSync(p));
  if (!file) return { ok: false, error: `neither ${candidates.join(' nor ')} is present` };
  const text = readFileSync(file, 'utf8');
  const options = new Map();
  // option('name', type: 'feature', value: 'auto', ...) — possibly wrapped.
  for (const m of text.matchAll(/option\(\s*'([^']+)'([\s\S]*?)\)\s*(?:\n|$)/g)) {
    const body = m[2];
    options.set(m[1], {
      type: /type\s*:\s*'([^']+)'/.exec(body)?.[1] ?? 'unknown',
      value: /value\s*:\s*'?([^',\s)]+)'?/.exec(body)?.[1] ?? '',
    });
  }
  return options.size === 0 ? { ok: false, error: `parsed no options out of ${file}` } : { ok: true, file, options };
}

/**
 * @param {string[]} ourFlags every `-Dname=value` we pass, across all scopes
 * @returns {{ added: string[], newAuto: string[], removed: string[], typeChanged: string[] }}
 */
export function auditMesonOptions(candidate, ourFlags) {
  const ours = new Map();
  for (const f of ourFlags) {
    const m = /^-D([a-z0-9-]+)=(.*)$/.exec(f);
    if (m) ours.set(m[1], m[2]);
  }
  const theirs = candidate.options;

  const added = [...theirs.keys()].filter((k) => !ours.has(k)).sort();
  // The avfoundation class: new, defaulted to auto, and not named by us.
  const newAuto = added.filter((k) => theirs.get(k).value === 'auto' || theirs.get(k).type === 'feature').sort();
  const removed = [...ours.keys()].filter((k) => !theirs.has(k)).sort();
  // A boolean that became a feature (or vice versa) silently changes what
  // `=disabled` / `=false` means, and meson errors on the wrong spelling.
  const typeChanged = [...ours.keys()]
    .filter((k) => theirs.has(k))
    .filter((k) => {
      const t = theirs.get(k).type;
      const v = ours.get(k);
      const wantsBool = v === 'true' || v === 'false';
      return wantsBool ? t !== 'boolean' && t !== 'unknown' : t === 'boolean';
    })
    .sort();
  return { added, newAuto, removed, typeChanged };
}

// ─────────────────────────────────────────────────────────────────────────────
// FFmpeg: registration tables
// ─────────────────────────────────────────────────────────────────────────────

const TABLES = {
  decoder: [['libavcodec/allcodecs.c', /extern\s+const\s+(?:FFCodec|AVCodec)\s+ff_([a-z0-9_]+)_decoder\b/g]],
  encoder: [['libavcodec/allcodecs.c', /extern\s+const\s+(?:FFCodec|AVCodec)\s+ff_([a-z0-9_]+)_encoder\b/g]],
  parser: [['libavcodec/parsers.c', /extern\s+const\s+(?:AVCodecParser|FFCodecParser)\s+ff_([a-z0-9_]+)_parser\b/g]],
  demuxer: [['libavformat/allformats.c', /extern\s+const\s+(?:FFInputFormat|AVInputFormat)\s+ff_([a-z0-9_]+)_demuxer\b/g]],
  muxer: [['libavformat/allformats.c', /extern\s+const\s+(?:FFOutputFormat|AVOutputFormat)\s+ff_([a-z0-9_]+)_muxer\b/g]],
  protocol: [['libavformat/protocols.c', /extern\s+const\s+URLProtocol\s+ff_([a-z0-9_]+)_protocol\b/g]],
  // Filters are registered as `ff_<pad-shape>_<name>`, where the prefix encodes
  // the input/output media types. The set is closed and small, so it is spelled
  // out rather than guessed with `[a-z]+` — filter names contain underscores,
  // and a greedy prefix would eat the first segment of half of them.
  filter: [['libavfilter/allfilters.c', /extern\s+const\s+(?:AVFilter|FFFilter)\s+ff_(?:af|asink|asrc|avf|avsrc|vaf|vf|vsink|vsrc)_([a-z0-9_]+)\s*;/g]],
  hwaccel: [['libavcodec/hwaccels.h', /extern\s+const\s+(?:struct\s+)?(?:FFHWAccel|AVHWAccel)\s+ff_([a-z0-9_]+)_hwaccel\b/g]],
};

/** Read a candidate FFmpeg tree's component names, per class. */
export function readFfmpegComponents(tree) {
  /** @type {Record<string, Set<string>>} */
  const out = {};
  /** @type {string[]} */
  const missing = [];
  for (const [cls, sources] of Object.entries(TABLES)) {
    const names = new Set();
    for (const [rel, re] of sources) {
      const p = join(tree, rel);
      if (!existsSync(p)) {
        missing.push(rel);
        continue;
      }
      for (const m of readFileSync(p, 'utf8').matchAll(re)) names.add(m[1]);
    }
    out[cls] = names;
  }
  return { components: out, missing: [...new Set(missing)] };
}

/**
 * Resolve `--enable-<class>=<glob>` against a candidate's registration tables.
 * This reproduces FFmpeg's own "Option ... did not match anything" statically,
 * without running configure or a compiler.
 *
 * @returns {{ unmatched: {flag:string,cls:string,pattern:string}[], matched: number, unchecked: string[] }}
 */
export function auditFfmpegFlags(components, flags) {
  const unmatched = [];
  const unchecked = [];
  let matched = 0;
  for (const flag of flags) {
    const m = /^--enable-(decoder|encoder|parser|demuxer|muxer|protocol|filter|hwaccel)=(.+)$/.exec(flag);
    if (!m) {
      if (/^--enable-[a-z0-9-]+=/.test(flag)) unchecked.push(flag);
      continue;
    }
    const [, cls, pattern] = m;
    const names = components[cls];
    if (!names) {
      unchecked.push(flag);
      continue;
    }
    // FFmpeg's configure globs with `*`; nothing else is special.
    const re = new RegExp(`^${pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    if ([...names].some((n) => re.test(n))) matched++;
    else unmatched.push({ flag, cls, pattern });
  }
  return { unmatched, matched, unchecked };
}
