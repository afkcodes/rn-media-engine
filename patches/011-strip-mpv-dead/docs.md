# 011-strip-mpv-dead

**rn-media: strip dead subsystems from the audio-only mpv 0.41.0 build**

Canonical home of the patch the Android fork ships as `007.rn_media_strip_dead.patch` and the
darwin fork as `mpv-strip-dead.patch`. Written for rn-media task #30 (binary size, zero feature
loss); the fork copies are generated from here (docs/DECISIONS.md, D2).

**AUDIO VARIANT ONLY.** The darwin fork also builds a video variant, and this patch deletes the
renderer that variant exists for. `variants: ["audio"]` in patch.json is the guard.

```text
WHY THIS EXISTS
    This engine is audio-only by construction: vid=no, vo=null, sid=no,
    force-window=no, no terminal, no IPC, no scripting, and it is configured
    with -Dgl=disabled -Dvulkan=disabled -Degl-android=disabled (every GPU
    backend off; see scripts/mpv.sh's exhaustive option list). mpv still
    COMPILES the whole GPU/shader renderer, the screenshot pipeline, encode
    mode, the image writer, the bitmap-subtitle path and the default key
    bindings into that build, because none of them has an off switch —
    they are only unreachable at RUNTIME, which the linker cannot know.

    Measured on the arm64-v8a artifact of rn-media-hls @ 4200e83:
    9,233,464 -> 7,931,056 bytes stripped, i.e. -1,302,408 (-14.1%).
    .text -668,448, .rodata -342,908, .data.rel.ro -62,608, .data -17,132.

    Every removal below was verified to be COMPILED IN today before it was
    removed — the object file exists in deps/mpv/_build-arm64/libmpv.so.p/
    on the unpatched build (e.g. video_out_gpu_video.c.o 137,888 B,
    video_out_vo_gpu_next.c.o 62,688 B, common_encode_lavc.c.o 30,080 B).
    No speculative wins.

PROVENANCE
    The removal map comes from ales-drnz/libmpv-scripts (BSD-3-Clause),
    patches/mpv/shared/patch_strip_mpv_dead.py — the same author whose
    libass strip became our 003 and whose PCM tap became our 004. Their
    script claims ~700 KB; on THIS build it is worth 1.27 MiB, because our
    option set differs (we keep swscale and libplacebo, they drop swscale).

    As with 003, the idea is theirs and the verification is ours, and it is
    expressed as a static .patch because this fork applies patches with
    `git apply`, not Python. That is not a stylistic preference: the Python
    model applies edits with silent tolerance for a missing anchor
    (`_drop_lines` skips lines it cannot find), so an upstream reflow
    degrades it into a PARTIAL application that still exits 0. `git apply`
    refuses.

    Two deliberate differences from the prior art:
      * Its stub_gpu.c has a `/*` inside a block comment and its
        encode_lavc.c stub omits the header that declares
        encoder_update_log(); both produce compiler warnings on our build,
        which is -Wall -Wextra. Both fixed here.
      * Its marker string is renamed to RN_MEDIA_STRIP_DEAD_V1 so the
        provenance of a stub in OUR tree is unambiguous.

WHAT IS REMOVED, AND WHY IT IS DEAD HERE

 1. GPU / shader render stack  (video/out/gpu/*.c, vo_gpu.c, vo_gpu_next.c,
    placebo/ra_pl.c, placebo/utils.c, gpu_next/context.c)
        PROOF, not assertion: video/out/gpu/context.c's contexts[] array is
        gated entirely on HAVE_D3D11 / HAVE_VULKAN / HAVE_EGL_* / HAVE_GL_*
        / HAVE_WAYLAND / HAVE_X11 / HAVE_COCOA, and deps/mpv/_build-arm64/
        config.h has every one of them at 0. The array therefore contains
        exactly one entry, &ra_ctx_dummy. vo_gpu and vo_gpu_next cannot
        obtain a context that can present, on any device, in this build.
        The same is true of render_backend_gpu (libmpv_gpu.c): it is cut
        from render_backends[] in vo_libmpv.c, leaving render_backend_sw.
        rn-media's core deliberately never links render.h at all
        (packages/player/cpp/third_party/mpv/include/mpv/README.md) and
        HybridMpvClient::attachVideoOutput() throws `unsupported`.
        video/out/stub_gpu.c supplies the four m_sub_options that
        options/options.c walks at startup (ra_ctx_conf, gl_video_conf,
        gl_next_conf, spirv_conf) as empty-but-valid groups, plus the three
        ra_hwdec_* helpers filters/f_lavfi.c still calls.

 2. Terminal video outputs  (vo_tct.c, vo_kitty.c)
        ASCII-art and kitty-graphics VOs. There is no terminal on Android
        and vo=null is fixed by the client; also they #include
        <libswscale/swscale.h> directly, which matters for stage (b).

 3. Encode mode  (ao_lavc.c, vo_lavc.c, vo_image.c; encode_lavc.c stubbed)
        Reachable only through --o=<file>, which turns mpv into a
        transcoder. rn-media never sets it and the client API has no path
        to it. The stub reproduces the `encode_config` m_sub_options
        VERBATIM so options/options.c's OPT_SUBSTRUCT keeps parsing
        identically, and provides the nine common/encode.h entry points the
        player core calls unconditionally.

 4. Screenshot  (player/screenshot.c stubbed) and the image writer
    (video/image_writer.c stubbed)
        The `screenshot`, `screenshot-to-file` and `screenshot-raw`
        commands stay in the command table and become no-ops — deliberately
        safer than deleting multi-line option rows. image_writer_opts[] and
        image_writer_opts_defaults are reproduced verbatim for
        options/options.c's screenshot_conf. THIS IS THE ONE REMOVAL THAT
        CHANGES OBSERVABLE CLIENT-API BEHAVIOUR (see RISKS).

 5. Bitmap-subtitle decode / render  (sd_lavc.c, img_convert.c,
    lavc_conv.c, filter_sdh.c; draw_bmp.c stubbed, &sd_lavc cut from
    sd_list[])
        sid=no, no OSD, no VO. 003 already removed the libass half of this
        path and left sd_ass stubbed; this removes the lavc half. The
        draw_bmp stub exists only because sub/osd.c still references
        mp_draw_sub_*.

 6. Default key bindings  (input/input.c: builtin_input_conf[] emptied)
        etc/input.conf.inc is ~14 KB of .rodata mapping keys and mouse
        buttons to commands. There is no input device wired to this
        library: no terminal, no VO window, no IPC socket. The command
        parser and every command are untouched — only the DEFAULT BINDINGS
        table is empty, so the bind loop iterates zero times.
        etc/builtin.conf.inc (the builtin profiles) is NOT touched.

WHAT IS NOT TOUCHED
    Nothing in audio/, demux/, stream/, filters/, or the four rn-media
    patches. The 55-symbol export list is unchanged (verified on the
    stripped artifact), as are all five rn-media marker strings, the 17
    FFmpeg audio filters + overlay, HLS/mpegts, the vendored libiconv
    alias tables, static zlib, and 16 KB page alignment.

RISKS (see the experiment report for the full list)
    * screenshot-raw becomes a no-op instead of an error. MEASURED on a
      Poco F4 / Android 16 by running tests/device/run.sh against this .so
      and against the unpatched one: the ONLY behavioural difference across
      50 on-device checks is that `screenshot`, `screenshot-to-file` and
      `screenshot-raw` return 0 here and -12 (MPV_ERROR_COMMAND) on the
      baseline. Note what that means: they were ALREADY FAILING before this
      patch, because vid=no/vo=null leaves no frame to capture. The change
      is the failure mode, not the capability. rn-media does not call them
      (grepped: packages/player has no screenshot reference at all), but a
      caller that checks the return value would stop seeing the error.
    * DT_NEEDED loses libdl.so, because dl_iterate_phdr — the C++ unwinder's
      only libdl reference, pulled in by the libplacebo C++ TUs — is gone
      with them. A shrink, not a gain; asserted as a subset, not equality.
    * A future video plugin cannot reuse this .so. It already could not
      (-Dgl=disabled), so this makes an existing constraint explicit.
```

## Evidence

Measured on `libmpv-android-audio-build@rn-media-hls` 4200e83, arm64-v8a, stripped:

| | bytes |
|---|---:|
| baseline | 9,233,464 |
| after this patch | 7,931,056 |
| delta | **-1,302,408 (-14.10%)** |

Gate, all on the STRIPPED artifact: 55 exports / 0 non-`mpv_*`, all five rn-media marker strings,
HLS + mpegts, the 17 audio filters, 16 KB LOAD alignment, libiconv alias tables, static zlib.
`buildscripts/tests/probe-artifact.sh` in the Android fork is that gate as a script (62 assertions),
and `buildscripts/tests/device/` runs the shipped .so on real hardware (50 assertions: decode of
seven containers, all 17 filters in a real lavfi graph, HTTP + HLS, a CP1251 CUE sheet through
libiconv, the PCM tap, the prefetch hook, and these stubs being invoked without crashing).

The device harness was run against this patch AND against the unpatched engine on the same phone.
Both scored 50/50, and the ONLY behavioural difference anywhere was `screenshot`/
`screenshot-to-file`/`screenshot-raw` returning 0 here versus -12 (MPV_ERROR_COMMAND) unpatched —
they were already failing before the strip, because vid=no/vo=null leaves nothing to capture, so
what changed is the failure mode and not a capability.

## Provenance

The removal map is ales-drnz/libmpv-scripts (BSD-3-Clause), `patch_strip_mpv_dead.py` — the same
author as 002 and 003. Their script claims ~700 KB; on our option set it is worth 1.27 MiB. As with
002 the idea is theirs and the verification is ours, and it is expressed as a static diff because
the Python model tolerates a missing anchor silently (`_drop_lines` skips what it cannot find), so
an upstream reflow degrades it into a partial application that still exits 0. A diff refuses.
