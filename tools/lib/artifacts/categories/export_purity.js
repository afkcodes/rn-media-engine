// 3. Nothing but `mpv_*` leaves the binary.
//
// The invariant the export lists exist to enforce. Measured on the first mpv
// 0.41 build of the Android fork: 4020 exported symbols instead of 55 — every
// av_*, every adler32 — because meson's gnu_symbol_visibility governs mpv's own
// objects and does nothing for the static archives linked into it. A React
// Native app routinely loads other media libraries that link their own FFmpeg,
// and a leaked av_* set makes the dynamic linker's choice arbitrary.
import { exportedSymbols } from '../binutils.js';

export default {
  id: 'export-purity',
  title: 'Zero non-mpv_* exports',
  run(slice) {
    if (slice.role !== 'engine') {
      return { state: 'na', detail: 'a dependency framework legitimately exports its own API (av_*, mbedtls_*); the invariant is about libmpv' };
    }
    const got = exportedSymbols(slice.binary, slice.kind);
    if (!got.ok) return { state: 'na', detail: `could not read exports: ${got.error}` };
    const leaked = got.names.filter((n) => !n.startsWith('mpv_'));
    return leaked.length === 0
      ? { state: 'pass', detail: `0 of ${got.names.length} exports are non-mpv_*` }
      : { state: 'fail', detail: `${leaked.length} leaked: ${leaked.slice(0, 12).join(' ')}${leaked.length > 12 ? ' …' : ''}` };
  },
};
