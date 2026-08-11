// Turning release assets into SLICES — one inspectable binary each.
//
// A "slice" is the unit the category matrix runs over: all four Android ABIs
// out of their jars, both iOS slices out of the Mpv xcframework, plus a few
// dependency frameworks as spot checks (the LGPL assertion lives in Avutil on
// darwin, and the HLS/filter assertions live in Avformat/Avfilter, because that
// fork ships FFmpeg as separate frameworks).
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fetchAssets, unzipTo, ARTIFACT_CACHE } from './fetch.js';

/** Every regular file named `name` under `root`. */
function findByName(root, name) {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name === name) out.push(p);
    }
  };
  if (existsSync(root)) walk(root);
  return out.sort();
}

export async function androidSlices(repo, tag) {
  const assets = await fetchAssets(repo, tag, /\.jar$/);
  const slices = [];
  for (const a of assets) {
    const dir = unzipTo(a.path, join(ARTIFACT_CACHE, repo.replace('/', '__'), tag, `x-${basename(a.name, '.jar')}`));
    for (const so of findByName(dir, 'libmpv.so')) {
      const abi = so.split('/').at(-2);
      // Android links FFmpeg statically into libmpv.so, so this one file
      // carries the demuxers and the filters as well as the engine.
      slices.push({ platform: 'android', label: `android/${abi}`, binary: so, kind: 'elf', role: 'engine', carries: ['demuxers', 'filters'], assetName: a.name, assetSize: a.size });
    }
  }
  return slices;
}

/**
 * The Mpv xcframework's slices, plus the dependency frameworks that carry the
 * things Mpv itself cannot answer for on this platform.
 */
const SPOT_FRAMEWORKS = [
  { name: 'Avutil', why: 'carries FFmpeg\'s embedded configure line — the LGPL assertion', carries: [] },
  { name: 'Avformat', why: 'carries the demuxers — the HLS assertion', carries: ['demuxers'] },
  { name: 'Avfilter', why: 'carries the audio filters — the EQ/DSP assertion', carries: ['filters'] },
];

export async function darwinSlices(repo, tag, { spot = true } = {}) {
  const slices = [];
  const wanted = spot ? new RegExp(`_(Mpv|${SPOT_FRAMEWORKS.map((f) => f.name).join('|')})\\.zip$`) : /_Mpv\.zip$/;
  const assets = await fetchAssets(repo, tag, wanted);
  for (const a of assets) {
    const fw = /_([A-Za-z]+)\.zip$/.exec(a.name)?.[1];
    if (!fw) continue;
    const dir = unzipTo(a.path, join(ARTIFACT_CACHE, repo.replace('/', '__'), tag, `x-${fw}`));
    for (const bin of findByName(dir, fw)) {
      if (statSync(bin).size < 1024) continue; // headers/plists, not the binary
      const platformSlice = bin.split('/').find((s) => s.startsWith('ios-'));
      slices.push({
        platform: 'darwin',
        label: `darwin/${platformSlice ?? '?'}/${fw}`,
        binary: bin,
        kind: 'macho',
        role: fw === 'Mpv' ? 'engine' : 'spot',
        spotReason: SPOT_FRAMEWORKS.find((f) => f.name === fw)?.why,
        // The darwin xcframework ships FFmpeg as SEPARATE frameworks, so no
        // single slice carries both halves and Mpv itself carries neither.
        carries: SPOT_FRAMEWORKS.find((f) => f.name === fw)?.carries ?? [],
        assetName: a.name,
        assetSize: a.size,
      });
    }
  }
  return slices;
}
