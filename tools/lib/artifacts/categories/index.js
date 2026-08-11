// The FIXED category matrix.
//
// Fixed is the point. ales-drnz's verify_binaries.sh runs the same 14 categories
// over every artifact with `∅ N/A` cells that must carry a stated reason, and
// that structure is the single strongest idea in that repo: comparability across
// platforms is enforced by shape, so "iOS passed 9" and "Android passed 11" can
// never quietly mean different things. Every slice runs every category here;
// a category that does not apply returns `na` WITH a reason, and the reason is
// printed.
import identity from './identity.js';
import exportsCat from './exports.js';
import exportPurity from './export_purity.js';
import markers from './markers.js';
import alignment from './alignment.js';
import needed from './needed.js';
import lgpl from './lgpl.js';
import audioOutput from './audio_output.js';
import components from './components.js';
import sizeDelta from './size_delta.js';

export const CATEGORIES = [identity, exportsCat, exportPurity, markers, alignment, needed, lgpl, audioOutput, components, sizeDelta];
