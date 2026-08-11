// 5. 16 KB page alignment (Android).
//
// Android 15+ devices ship 16 KB pages. A .so linked at the old 4 KB alignment
// fails to LOAD on them — a crash on new hardware that is invisible in every
// build log, which is why it is asserted on the artifact rather than trusted to
// the LDFLAGS that produce it (-Wl,-z,max-page-size=16384).
import { loadAlignments } from '../binutils.js';

const REQUIRED = 16384;

export default {
  id: 'page-alignment',
  title: '16 KB page alignment',
  run(slice) {
    if (slice.platform !== 'android') {
      return { state: 'na', detail: 'Apple platforms have no equivalent: page size is fixed by the OS and the linker, and iOS has always been 16 KB on arm64' };
    }
    const r = loadAlignments(slice.binary);
    if (!r.ok) return { state: 'na', detail: `could not read program headers: ${r.error}` };
    const bad = r.aligns.filter((a) => a < REQUIRED);
    return bad.length === 0
      ? { state: 'pass', detail: `${r.aligns.length} PT_LOAD segments, all aligned >= ${REQUIRED} (0x${REQUIRED.toString(16)})` }
      : { state: 'fail', detail: `${bad.length} PT_LOAD segment(s) aligned below ${REQUIRED}: ${bad.map((b) => `0x${b.toString(16)}`).join(' ')}` };
  },
};
