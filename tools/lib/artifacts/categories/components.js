// 9. The components the product actually depends on.
//
// HLS is what the queue streams, and the sixteen audio filters are what the EQ
// and DSP surface is built from. Both are allow-list entries in a configure
// line that `--disable-all` makes the whole world, so a dropped flag silently
// removes a feature — exactly how the `hls` demuxer was missing from this
// engine once already while `--enable-protocol=hls` sat in the flags looking
// reassuring.
import { hasExactString, hasSubstring } from '../binutils.js';

const FILTERS = ['aresample', 'aformat', 'anull', 'volume', 'equalizer', 'bass', 'treble', 'lowpass', 'highpass', 'anequalizer', 'superequalizer', 'firequalizer', 'acompressor', 'alimiter', 'dynaudnorm', 'loudnorm', 'crossfeed'];

export default {
  id: 'components',
  title: 'HLS + 16 audio filters',
  run(slice) {
    // Which halves this slice is RESPONSIBLE for is decided by packaging and
    // declared on the slice, not sniffed. Android links FFmpeg statically into
    // libmpv.so and so owns both; the darwin xcframework splits them across
    // Avformat and Avfilter, and Mpv itself owns neither.
    const carries = slice.carries ?? [];
    if (carries.length === 0) {
      return {
        state: 'na',
        detail: 'this binary contains no FFmpeg components by design — the darwin xcframework ships them as separate frameworks, so the assertion is made on the Avformat (demuxers) and Avfilter (filters) slices',
      };
    }
    const problems = [];
    const done = [];
    if (carries.includes('demuxers')) {
      if (hasSubstring(slice.binary, 'hls demuxer')) done.push('HLS demuxer present');
      else problems.push('the HLS demuxer is absent');
    }
    if (carries.includes('filters')) {
      const missing = FILTERS.filter((f) => !hasExactString(slice.binary, f));
      if (missing.length) problems.push(`${missing.length} of ${FILTERS.length} audio filters absent: ${missing.join(' ')}`);
      else done.push(`all ${FILTERS.length} audio filters present`);
    }
    return problems.length ? { state: 'fail', detail: problems.join('; ') } : { state: 'pass', detail: done.join('; ') };
  },
};
