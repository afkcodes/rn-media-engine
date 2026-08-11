// 2. Export set vs the canonical expectation.
//
// The truth is the forks' own linker files, collected in assets/export-lists/:
// mpv.exp names 54 symbols exactly, and mpv.ver is a `mpv_*` wildcard, so the
// Android expectation is DERIVED — the darwin 54 plus mpv_lavc_set_java_vm,
// which patch 001 adds and which is Android-only by design. Nothing is invented
// here; the derivation is stated so a reader can check it.
import { exportedSymbols } from '../binutils.js';

export default {
  id: 'exports',
  title: 'Export set',
  run(slice, ctx) {
    if (slice.role !== 'engine') return { state: 'na', detail: 'not the mpv engine — export expectations are defined for libmpv only' };
    const expected = ctx.expectedExports[slice.platform];
    const got = exportedSymbols(slice.binary, slice.kind);
    if (!got.ok) return { state: 'na', detail: `could not read exports: ${got.error}` };

    const have = new Set(got.names);
    const missing = [...expected].filter((n) => !have.has(n));
    const extra = [...have].filter((n) => !expected.has(n));
    if (missing.length === 0 && extra.length === 0) {
      return { state: 'pass', detail: `${have.size}/${expected.size} exactly as expected`, extra: { count: have.size } };
    }
    return {
      state: 'fail',
      detail: `${have.size} exported, expected ${expected.size}` + (missing.length ? `; MISSING ${missing.join(' ')}` : '') + (extra.length ? `; UNEXPECTED ${extra.join(' ')}` : ''),
      extra: { count: have.size, missing, extra },
    };
  },
};
