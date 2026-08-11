# 004-prefetch-hook

**RESERVED SLOT — nothing is applied from here yet.**

## Why this slot is empty

A prefetch-hook patch was being authored in
`libmpv-android-audio-build@rn-media-hls` as
`buildscripts/patches/mpv/006.rn_media_prefetch_hook.patch` at the moment this
workshop was built. It is deliberately **not** copied here.

Importing a patch that is still being written would fork it: the workshop copy
and the fork copy would drift from their first hour, which is the exact failure
this repo exists to make impossible. The slot is claimed so the number cannot be
reused, and the patch is imported once — after it has landed and been reviewed.

## How to import it

1. Copy the diff in and confirm it applies to the pinned mpv with
   `./workshop verify`.
2. **Then convert it to `kind: anchored`.** It is a feature insertion across
   several `player/` files, which is exactly the shape the anchored format
   exists for (docs/DECISIONS.md, D1), and it is a multi-call-site patch, which
   is the shape that goes wrong quietly.
3. Prove the conversion the same way `003-pcm-tap` proves its own: keep the
   original diff as `tests/fixtures/004-prefetch-hook.reference.diff` and add an
   equivalence case to `tests/equivalence.test.js`. A conversion without a
   byte-identity proof is a rewrite.
4. Add it to `manifest/series.json` in both platforms' mpv series, after
   `003-pcm-tap`.

## The specific hazard to design against

The closest prior art is `ales-drnz/libmpv-scripts`'
`patches/mpv/shared/patch_prefetch_state.py`, and it carries a real defect worth
naming here because this patch will be shaped like it:

```python
# patch_loadfile_c, for each of several call sites:
if pristine in text:
    text = text.replace(pristine, patched)
```

A call site whose anchor moved is **silently skipped**, while the file-level
`MARKER` is still written — so the next run reports "Already patched" over a
half-patched tree, and the build succeeds with some transitions wired and others
not. In an audio prefetch path that is a state machine that mostly works.

Give **every call site its own transform with its own `expectCount`**. The
workshop then fails the whole patch atomically if any one of them moved, and
`workshop dry-run` names which one. That defect is unreachable in this format —
but only if the patch is written as several transforms rather than one loop.
