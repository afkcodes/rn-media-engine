# Export lists

Both linkers' export lists for `libmpv`, in one directory.

This is the one idea from `ales-drnz/libmpv-scripts` that has no equivalent in
either of our forks: they keep four export lists — one per linker format —
together in a single directory, so the sets can be compared at a glance. Ours
were in two repositories, in two formats, produced by two different mechanisms,
and nothing compared them.

| File | Platform | Format | Applied by | Names |
| --- | --- | --- | --- | --- |
| `mpv.ver` | Android | GNU version script | `-Wl,--version-script` + `-Wl,--exclude-libs=ALL` in `buildscripts/scripts/mpv.sh` | wildcard `mpv_*` → **55** exported |
| `mpv.exp` | darwin | ld64 `-exported_symbols_list` | patch [`005-mpv-export-list`](../../patches/005-mpv-export-list/docs.md), scoped to `library('mpv')`'s own `link_args` | **54** exact names |

## Why they differ

The extra Android name is `mpv_lavc_set_java_vm`, added by patch
[`001-lavc-set-java-vm`](../../patches/001-lavc-set-java-vm/docs.md), which is
correctly Android-only.

The *form* differs for a less good reason: Android uses a wildcard because a
version script can, darwin uses an exact list because it wanted a new export to
be a review event and the count to be assertable against the shipped dylib. The
exact list is the better discipline and Android should adopt it.

## Why the lists exist at all

mpv's waf build derived a version script from `libmpv/mpv.def`, which is why
older binaries exported exactly the 53 names in that file. mpv 0.37 deleted
`mpv.def`, and 0.41's meson relies solely on `gnu_symbol_visibility: 'hidden'`
plus `MPV_EXPORT` in the public headers. That governs mpv's **own** objects and
does nothing at all for the static archives linked into it.

Measured on the first 0.41 build of the Android fork: **4 020** exported symbols
instead of 55 — every `av_*`, every `adler32`, the entire FFmpeg surface. On
darwin the trigger was different but the effect the same: libplacebo became a
mandatory static dependency and its ~570 `PL_API` symbols are visibility-default
regardless of `PL_STATIC`.

That is not cosmetic. A React Native app routinely loads other media libraries
that link their own FFmpeg, and a leaked `av_*` set makes the dynamic linker's
choice of whose implementation a call binds to essentially arbitrary — the exact
class of collision this project chose libmpv to avoid.

## Status: collected, not yet asserted

Nothing currently compares the two lists, or either list against a shipped
binary. Doing that belongs to the shipped-artifact verification matrix, which is
the next phase of this repo. Until then these files are here so the difference is
at least *visible*.
