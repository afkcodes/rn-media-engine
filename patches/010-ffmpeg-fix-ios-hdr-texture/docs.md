# 010-ffmpeg-fix-ios-hdr-texture

**Return BGRA instead of P010 for >8-bit VideoToolbox output on iOS, and make
`32BGRA` mappable without full range.**

Canonical copy of `libmpv-darwin-build@rn-media-hls
patches/ffmpeg-fix-ios-hdr-texture.patch`. **Video variant only** — not in any
artifact rn-media ships today.

## Why this exists

Two independent Apple-specific defects, both in the VideoToolbox path:

1. **`libavcodec/videotoolbox.c`** — for `depth > 8` FFmpeg returns
   `AV_PIX_FMT_P010`. iOS's GLES implementation does not support 10-bit
   textures, so a 10-bit stream decodes and then cannot be uploaded. Under
   `TARGET_OS_IPHONE` the patch returns `AV_PIX_FMT_BGRA` instead, letting
   VideoToolbox do the conversion itself. Credited in the source to `@tmm1`.

2. **`libavutil/hwcontext_videotoolbox.c`** — `kCVPixelFormatType_32BGRA` was
   registered as full-range-only. After a change to
   `videotoolbox_best_pixel_format`, `av_map_videotoolbox_format_from_pixfmt2`
   can no longer map it, and hardware acceleration fails outright. Registering
   it with `false` makes it available without full range. Credited to
   `@alexmercerind`.

The second hunk is what makes the first one work: without it, asking for BGRA
gets you a failed hwaccel rather than a converted frame.

## Provenance

Both hunks are carried by media-kit's `libmpv-darwin-build` upstream and are
inherited, not written here. Neither is upstreamable as written — hunk 1 is an
unconditional platform behaviour change that upstream would want expressed as a
capability query.

## Rebasing

Two anchors:

1. `libavcodec/videotoolbox.c` — the
   `#if HAVE_KCVPIXELFORMATTYPE_420YPCBCR10BIPLANARVIDEORANGE` / `if (depth > 8)`
   block.
2. `libavutil/hwcontext_videotoolbox.c` — the `kCVPixelFormatType_32BGRA` row of
   the format table.

Both are small and stable. Check on every FFmpeg bump whether upstream has
gained a real capability query for 10-bit texture support; if it has, **delete
this patch** rather than rebasing it.

## Marker

`iOS doesn't support 10 bit textures in GLES` — the comment the patch adds.
