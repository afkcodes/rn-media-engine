// 8. The audio output the platform is supposed to have — and only that one.
//
// mpv 0.41 added `avfoundation`, value `auto`, whose dependency resolves on iOS
// as well as macOS: left alone it silently builds a SECOND audio output into an
// audio-only engine. So this checks presence AND absence.
import { hasExactString, stringsOf } from '../binutils.js';

const EXPECTED = { android: 'audiotrack', darwin: 'audiounit' };
const FORBIDDEN = {
  android: ['audiounit', 'coreaudio', 'avfoundation', 'aaudio', 'opensles'],
  darwin: ['avfoundation', 'coreaudio', 'audiotrack', 'aaudio', 'opensles'],
};

export default {
  id: 'audio-output',
  title: 'Audio output',
  run(slice) {
    if (slice.role !== 'engine') return { state: 'na', detail: 'audio outputs live in libmpv, not in its dependencies' };
    const want = EXPECTED[slice.platform];
    const present = hasExactString(slice.binary, want);
    const extra = FORBIDDEN[slice.platform].filter((a) => hasExactString(slice.binary, a));
    if (!present) {
      // Quote the build's own configure line when it is embedded: a failure
      // that carries its own evidence is one nobody has to reproduce.
      const line = stringsOf(slice.binary).split('\n').find((l) => l.includes('-Daudiounit=') || l.includes('-Daudiotrack='));
      const flags = line ? line.match(/-D(?:audiounit|avfoundation|coreaudio|audiotrack|aaudio|opensles)=\w+/g) ?? [] : [];
      return {
        state: 'fail',
        detail: `the ${want} AO is NOT in this binary — it has NO audio output at all` + (flags.length ? `. Its own embedded meson line says: ${flags.join(' ')}` : ''),
      };
    }
    if (extra.length) return { state: 'fail', detail: `${want} present, but so are: ${extra.join(' ')} — an audio-only engine should carry exactly one AO` };
    return { state: 'pass', detail: `${want} present; none of ${FORBIDDEN[slice.platform].join('/')} built in` };
  },
};
