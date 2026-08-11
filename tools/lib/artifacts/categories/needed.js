// 6. DT_NEEDED allow-list.
//
// The proof that 002-remove-libass actually reached the artifact. libass drags
// in freetype, fribidi and harfbuzz; an audio engine that never draws a glyph
// must link none of the four. This is the category that checks the patch by its
// EFFECT, which is the only way to check a patch whose whole content is
// deletion.
import { dtNeeded } from '../binutils.js';

const FORBIDDEN = ['libass', 'libfreetype', 'libfribidi', 'libharfbuzz'];
const ALLOWED = ['libc.so', 'libm.so', 'libdl.so', 'libandroid.so', 'liblog.so', 'libz.so', 'libOpenSLES.so', 'libaaudio.so'];

export default {
  id: 'dt-needed',
  title: 'DT_NEEDED allow-list',
  run(slice) {
    if (slice.kind !== 'elf') {
      return { state: 'na', detail: 'Mach-O uses LC_LOAD_DYLIB, and this xcframework ships FFmpeg/mbedTLS as SEPARATE frameworks by design, so the same list would not mean the same thing. The libass invariant is covered for darwin by the audio-components category instead' };
    }
    const r = dtNeeded(slice.binary);
    if (!r.ok) return { state: 'na', detail: `could not read the dynamic section: ${r.error}` };
    const banned = r.names.filter((n) => FORBIDDEN.some((f) => n.startsWith(f)));
    const unexpected = r.names.filter((n) => !ALLOWED.includes(n) && !banned.includes(n));
    if (banned.length) return { state: 'fail', detail: `FORBIDDEN: ${banned.join(' ')} — 002-remove-libass did not reach this artifact` };
    if (unexpected.length) return { state: 'fail', detail: `outside the allow-list: ${unexpected.join(' ')} (allowed: ${ALLOWED.join(' ')})` };
    return { state: 'pass', detail: `${r.names.length} entries, all allow-listed: ${r.names.join(' ')}` };
  },
};
