// 7. The LGPL invariant, on the binary.
//
// FFmpeg compiles its own configure line into libavutil and hands it back
// through avutil_configuration(), so the flags are greppable in whatever binary
// libavutil ended up inside. That is a real assertion on the artifact, not on a
// flag list — and it is the only one of the two that could catch a build made
// from the darwin fork's live `encodersgpl` flavour, which really does pass
// --enable-gpl and link libx264.
//
// WHAT IS CHECKABLE WHERE, exactly:
//   android  FFmpeg is linked STATICALLY into libmpv.so, so the configure
//            string is inside the engine binary itself.
//   darwin   FFmpeg ships as SEPARATE frameworks, so libmpv (Mpv) carries no
//            configure string at all. The assertion moves to the Avutil
//            framework, which is why it is downloaded as a spot-check slice.
import { hasSubstring, stringsOf } from '../binutils.js';

const FORBIDDEN = ['--enable-gpl', '--enable-nonfree'];

export default {
  id: 'lgpl',
  title: 'LGPL invariant',
  run(slice) {
    const text = stringsOf(slice.binary);
    const hasConfigure = text.includes('--disable-') || text.includes('--enable-');
    if (!hasConfigure) {
      return {
        state: 'na',
        detail:
          slice.platform === 'darwin' && slice.role === 'engine'
            ? 'no FFmpeg configure string in Mpv: this xcframework links FFmpeg as separate frameworks, so the assertion is made on the Avutil slice below instead'
            : 'no embedded configure string found in this binary, so there is nothing to assert against here',
      };
    }
    const found = FORBIDDEN.filter((f) => hasSubstring(slice.binary, f));
    if (found.length) return { state: 'fail', detail: `FORBIDDEN flag in the embedded configure line: ${found.join(' ')}` };
    const positive = hasSubstring(slice.binary, '--disable-gpl');
    return {
      state: 'pass',
      detail: positive
        ? 'embedded configure line contains --disable-gpl and neither --enable-gpl nor --enable-nonfree'
        : 'embedded configure line omits --enable-gpl and --enable-nonfree (no positive --disable-gpl assertion on this platform — see flags.json divergence ffmpeg-lgpl-polarity)',
    };
  },
};
