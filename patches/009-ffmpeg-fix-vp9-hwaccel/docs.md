# 009-ffmpeg-fix-vp9-hwaccel

**Restore a standalone `vp9_videotoolbox` decoder carrying the superframe
bitstream filters VideoToolbox requires.**

Canonical copy of `libmpv-darwin-build@rn-media-hls
patches/ffmpeg-fix-vp9-hwaccel.patch`. **Video variant only** — it is not in any
artifact rn-media ships today.

## Why this exists

VideoToolbox cannot be fed raw VP9 the way FFmpeg's generic hwaccel path feeds
it. Two things have to happen that the generic path does not do:

* **Intel Macs** require VP9 invisible (alt-ref) frames to be merged into VP9
  superframes; violating that hangs VideoToolbox inside
  `VTDecompressionSessionDecodeFrame` due to defective error handling there
  (FFmpeg ticket #9599). That needs the `vp9_superframe` bitstream filter.
* **Everything else** needs `vp9_superframe_split`.

A bitstream filter cannot be attached to a plain hwaccel — `.bsfs` is a property
of an `FFCodec`. So the patch removes VP9's VideoToolbox entry from the generic
decoder's `hw_configs` and registers a separate `ff_vp9_videotoolbox_decoder`
that carries the right `.bsfs` for the architecture it was built for.

## Provenance

Carried by media-kit's `libmpv-darwin-build` upstream, credited in the source
comment to `@low-batt`. Inherited by this fork, not written here.

## Why it is here at all

rn-media is audio-first and video is additive, never in core (PLAN.md §7.5). The
darwin fork nonetheless builds a video variant, and this workshop's job is to be
the complete record of what we do to the engine — a patch that exists in a fork
but not here would be exactly the invisible divergence this repo was built to
end. It is gated to `variants: ["video"]` so it never touches an audio build.

## Rebasing

Two anchors, and this is the fragile one of the series:

1. `libavcodec/allcodecs.c` — the `extern const FFCodec ff_vp9_*` block, where
   the new declaration is inserted between `ff_vp9_vaapi_encoder` and
   `ff_vp9_qsv_encoder`.
2. `libavcodec/vp9.c` — the tail of the generic decoder's `hw_configs` array,
   from which `HWACCEL_VIDEOTOOLBOX(vp9)` is removed and after which the new
   codec struct is appended.

The second anchor copies a large amount of upstream's own decoder struct, so
**any** change to VP9's decoder definition — a new `.caps_internal` flag, a
renamed callback macro — rejects it. FFmpeg 8 already renamed several of these
(`FF_CODEC_CAP_USES_PROGRESSFRAMES` is one). Re-read upstream's struct and
re-derive rather than force-fitting the old text.

## Marker

`ff_vp9_videotoolbox_decoder` — the symbol the patch introduces.
