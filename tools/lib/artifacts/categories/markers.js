// 4. Every patch's marker strings, in the shipped binary.
//
// The strings come FROM THE PATCH MANIFESTS — `markers` in patch.json — so
// adding a patch adds its own artifact assertion and there is no second list to
// forget. A patch whose effect leaves no greppable string declares an empty
// list WITH a reason, which is printed; a silent empty list is rejected by the
// loader.
import { hasSubstring } from '../binutils.js';

export default {
  id: 'patch-markers',
  title: 'Patch markers present',
  run(slice, ctx) {
    if (slice.role !== 'engine') return { state: 'na', detail: 'patch markers are asserted against libmpv, not its dependencies' };

    const applicable = ctx.patches.filter((p) => p.status === 'active' && p.platforms.includes(slice.platform) && p.variants.includes('audio') && p.deps.includes('mpv'));
    const checked = [];
    const missing = [];
    const skipped = [];
    for (const p of applicable) {
      if (!p.markers?.length) {
        skipped.push(`${p.id} (${p.markersNote ?? 'no reason recorded'})`);
        continue;
      }
      for (const m of p.markers) {
        if (hasSubstring(slice.binary, m)) checked.push(m);
        else missing.push(`${p.id}: ${JSON.stringify(m)}`);
      }
    }
    const detail = `${checked.length} marker(s) found across ${applicable.length - skipped.length} patch(es)` + (skipped.length ? `; not string-checkable: ${skipped.join(', ')}` : '');
    return missing.length ? { state: 'fail', detail: `MISSING ${missing.join('; ')}. ${detail}` } : { state: 'pass', detail };
  },
};
