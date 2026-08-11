// 10. Size against the previous release.
//
// A category that cannot pass or fail on its own — it has no threshold, because
// there is no honest one — but a 40% jump in a stripped .so is how you notice
// that a strip step silently stopped running, and a 0-byte delta across a
// release that was supposed to add a patch is how you notice nothing was
// rebuilt. It reports, and the reader judges.
export default {
  id: 'size-delta',
  title: 'Size vs previous release',
  run(slice, ctx) {
    const prev = ctx.previous?.sizes?.[slice.assetName];
    if (!ctx.previous) return { state: 'na', detail: ctx.previousError ?? 'no previous release resolved' };
    if (prev === undefined) return { state: 'na', detail: `${slice.assetName} does not exist in ${ctx.previous.tag}` };
    const delta = slice.assetSize - prev;
    const pct = ((delta / prev) * 100).toFixed(2);
    const sign = delta >= 0 ? '+' : '';
    return {
      state: 'info',
      detail: `${slice.assetSize.toLocaleString()} B vs ${prev.toLocaleString()} B in ${ctx.previous.tag} (${sign}${delta.toLocaleString()} B, ${sign}${pct}%)`,
      extra: { delta, pct: Number(pct) },
    };
  },
};
