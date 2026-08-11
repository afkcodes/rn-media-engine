# 005-mpv-export-list

**rn-media: pin libmpv's Mach-O export list to the 54 public `mpv_*` symbols.**

Canonical copy of `libmpv-darwin-build@rn-media-hls
patches/mpv-rn-media-export-list.patch`. The export list itself is
`assets/mpv.exp`, copied into the source tree as `rn-media-mpv.exp` before the
patch is applied — a list of names is a file, not diff hunks.

## Why this exists

mpv's waf build derived a linker version script from `libmpv/mpv.def`, which is
why the older binaries exported exactly the 53 names in that file. mpv 0.37
deleted `mpv.def`, and 0.41's meson relies solely on
`gnu_symbol_visibility: 'hidden'` plus `MPV_EXPORT` in the public headers. That
governs mpv's **own** objects and does nothing whatsoever for the archives
linked into it.

On this fork that used to be harmless — FFmpeg and mbedTLS ship as separate
dylibs on darwin, so nothing static entered the link. mpv 0.41 changed that:
libplacebo became mandatory and is linked statically, and every one of its ~570
public symbols is decorated `PL_API __attribute__((visibility("default")))` on
non-Windows targets regardless of `PL_STATIC`. Without this patch they all land
in `Mpv.framework`'s export table.

Not cosmetic. A React Native app routinely loads other media libraries, and a
leaked symbol set makes the dynamic linker's choice of whose implementation a
call binds to essentially arbitrary — the exact class of collision this project
chose libmpv to avoid.

## Why the flag is scoped to this link, and not to the cross file

That distinction cost a CI run. meson feeds the built-in `*_link_args` to every
compiler check too, so an export list naming only `_mpv_*` made
`dependency('appleframeworks', modules: ['Foundation', 'AudioToolbox'])` fail
its link probe — "Run-time dependency appleframeworks found: NO", CI run
31460332314 — and took the AudioUnit AO out of an audio-only build. The patch
therefore adds the flag to `library('mpv', ...)`'s own `link_args` and nowhere
else. Scoping it to the one link that ships is both correct and narrower.

## The Android counterpart, and the delta

Android solves the same problem with a **different mechanism**: `scripts/mpv.sh`
passes `-Wl,--version-script=include/mpv.ver` plus `-Wl,--exclude-libs=ALL`
through `-Dc_link_args`, with no patch involved. The two lists are collected
side by side in `assets/export-lists/` precisely because they disagree:

| | Android | Darwin |
| --- | --- | --- |
| File | `mpv.ver` (GNU version script) | `mpv.exp` (ld64 list) |
| Form | wildcard `mpv_*` | 54 exact names |
| Count | 55 | 54 |
| Extra | `mpv_lavc_set_java_vm` (patch 001) | — |

The list is exact rather than a wildcard on the Apple side so that a new export
is a review event and the count is assertable against the shipped dylib.
Nothing yet compares the two counts across platforms; that is the shipped-artifact
matrix, and it is the next phase of this repo.

## Rebasing

One anchor: the `library('mpv', sources, dependencies: dependencies, ...)` call
in `meson.build`, and specifically its `link_args:` line, which today reads
`cc.get_supported_link_arguments(['-Wl,-Bsymbolic'])`. If upstream ever adds its
own `link_args` handling, rebase onto it rather than replacing it.

Prove it reached the shipped artifact with:
`nm -gU Mpv.framework/Mpv | grep -c '^.* T _mpv_'` — expect 54, and expect zero
`_pl_*`.

## Marker

`rn-media-mpv.exp` — the filename in the added `join_paths(source_root, ...)`
call. It appears nowhere in pristine mpv.
