# 002-remove-libass

**rn-media: remove libass from the mpv 0.41.0 build (audio-only libmpv)**

Ported verbatim from `libmpv-android-audio-build@rn-media-hls buildscripts/patches/mpv/003.mpv_remove_libass.patch` (byte-identical to the darwin fork's `patches/mpv-remove-libass.patch`). This file is the canonical record; the fork
copy is generated from it (see docs/DECISIONS.md, D2).

```text
WHY THIS EXISTS
    mpv 0.41's meson.build has an unconditional
        libass = dependency('libass', version: '>= 0.12.2')
    and offers no switch to turn it off.  sub/osd_dummy.c — the stub OSD
    backend that let older mpv build without libass — was deleted upstream,
    so every mpv >= 0.37 drags in libass and, transitively, freetype +
    fribidi + harfbuzz.

    Our Android/iOS libmpv is audio-only: vid=no, vo=null, sid=no, and no
    OSD is ever rendered.  Not one glyph is drawn, yet those four libraries
    cost roughly 1-2 MB per ABI on a ~6.4 MB binary.  This patch removes
    them from the link.

    It replaces our old 003.mpv_remove_libass.patch, which was written for
    mpv 0.35.1 and cannot be rebased: it edits wscript and
    wscript_build.py, both deleted when mpv dropped waf in 0.37, plus 0.35's
    sub/ tree layout.

PROVENANCE
    The removal was mapped out by ales-drnz/libmpv-scripts (BSD-3-Clause),
    in patches/mpv/shared/patch_strip_libass.py — a Python script that
    performs this exact surgery on a 0.41.0 tree.  We credit the same author
    for the PCM tap (004).  Their symbol analysis was independently
    re-verified against pristine v0.41.0 and found complete; this patch is
    the same removal expressed as a static .patch, because our build applies
    patches with `git apply`, not Python.

    Two deliberate differences from the prior art:

      * It stubs osd_mangle_ass(), osd_get_function_sym(), sd_ass_pkt_text()
        and sd_ass_to_plaintext() as no-ops.  None of those four calls
        libass — they are pure string handling — and osd_mangle_ass() is
        reachable from the client API as the `escape-ass` command, which
        would silently start returning "".  We reproduce all four verbatim.

      * Its osd_get_text_size() returns 0/0.  Its caller,
        player/command.c:cut_osd_list(), computes
        screen_h / MPMAX(font_h, 1) and then subtracts 1 for the header, so
        0/0 yields max_lines == -1 and truncates OSD lists to nothing.  We
        return 720/30, i.e. the same 24 lines that the terminal branch of
        that very function defaults to.

WHAT IT DOES
    meson.build
        drops the `libass = dependency(...)` line and the now-stale comment
        about libass-before-ffmpeg link ordering; removes libass from the
        `dependencies` array and 'libass' from the `features` dict; drops
        sub/ass_mp.c, sub/osd_libass.c and sub/sd_ass.c from `sources` and
        adds sub/stub_libass.c in their place.

    deletes  sub/ass_mp.c, sub/ass_mp.h, sub/osd_libass.c, sub/sd_ass.c
        Those are the only files in 0.41.0 that touch libass.  ass_mp.h is
        included by nothing else once they are gone.

    adds  sub/stub_libass.c
        One translation unit defining every non-static symbol from the
        deleted files that surviving code still references — twelve of them,
        no more and no fewer.  Verbatim copies where the original has no
        libass in it (the whole sub-filter option group, which the option
        subsystem walks at mpv_create() time, and the ASS event string
        helpers the subtitle filters call); no-ops or failures only where
        the original genuinely needs an ASS_Renderer or ASS_Track.  Each
        symbol carries a comment naming its caller.

    player/command.c
        drops `#include <ass/ass.h>` (header gone) and makes the
        `libass-version` property report 0 instead of calling
        ass_library_version() (symbol gone).  Two one-line hunks, both far
        from the audio-property region that 004 edits.

    Not touched: sub/meson.build still generates sub/osd_font.otf.inc.  Only
    the deleted osd_libass.c ever included it, so it costs a few KB of build
    time and zero bytes of binary; leaving it keeps the patch surface small.

VERIFIED
    Configured and built to completion on Linux/x86-64 against the host's
    ffmpeg and libplacebo:
        meson setup build -Dlibmpv=true -Dcplayer=false -Dgpl=false \
              --default-library shared && ninja -C build
    libmpv.so links with no libass/freetype/fribidi/harfbuzz in DT_NEEDED
    and no undefined ass_* symbols.  A smoke program against the built
    library confirms mpv_create()+mpv_initialize() succeed, the
    sub-filter-sdh* options parse, `libass-version` reads 0, `escape-ass`
    returns byte-identical output to upstream's algorithm, and
    `osd-overlay` with compute-bounds succeeds and reports no bounds.
    Cross-compiled Android/iOS builds are NOT covered by this run.

REBASING
    Small patch, but every hunk is an anchor.  After an mpv bump re-check:
      meson.build            the `libass = dependency(...)` line, the
                             `dependencies = [...]` array, the `features`
                             dict, and the `## Subtitles` block of
                             `sources = files(...)`
      sub/                   whether ass_mp.c/.h, osd_libass.c, sd_ass.c are
                             still the complete set of libass-only files:
                               grep -rn 'ass/ass\.h' --include='*.[ch]' .
                             must report exactly those plus player/command.c
      sub/stub_libass.c      the twelve symbols, against their declarations
                             in sub/osd.h, sub/osd_state.h and sub/sd.h.  A
                             signature that drifts is a link error at best.
                             Re-diff the verbatim bodies against the deleted
                             originals: mp_sub_filter_opts (vs sd_ass.c),
                             sd_ass_fmt_offset / sd_ass_pkt_text /
                             sd_ass_to_plaintext + its static
                             ass_to_plaintext()/append() (vs sd_ass.c),
                             osd_get_function_sym / osd_mangle_ass and the
                             ASS_USE_OSD_FONT macro (vs osd_libass.c)
      player/command.c       the `#include <ass/ass.h>` line and
                             mp_property_libass_version()
    If upstream ever restores a real build switch for libass, delete this
    patch entirely and set that option instead.
```
