# 008-ltmain-target-passthrough

**Teach libtool to pass `-target` through to the compiler.**

Canonical copy of `libmpv-darwin-build@rn-media-hls
patches/ltmain-target-passthrough.patch`.

## Why this exists

`ltmain.sh` maintains an explicit allow-list of compiler flags that must be
forwarded to both the compile and the link command rather than being swallowed
as libtool's own arguments:

```sh
-model|-arch|-isysroot|--sysroot)
```

Clang's `-target <triple>` is not on it, and it is precisely the flag that makes
a cross-compile a cross-compile on Apple. Without the passthrough, an autotools
dependency configures for the host, compiles objects for the host, and then
fails to link against the iOS sysroot — or, worse, links and produces a library
for the wrong architecture that only fails much later.

This is a **build-tooling fix, not an engine change**: it touches no source of
any library, only the libtool driver script that four of the darwin fork's
autotools dependencies ship in their release tarballs.

## Applies to

Four dependency trees, all darwin-only, all autotools:
`libxml2`, `libass`, `libogg`, `libvorbis`. The Android fork does not need it —
the NDK's own toolchain files set the triple through `--host` and the standard
autotools cross-compilation path, and none of these four is built there anyway.

`workshop verify` applies it to all four pinned trees, not just one, because a
libtool version skew between them is exactly the kind of thing that would
otherwise be found at build time on a macOS runner.

## Rebasing

One anchor, in each tree's `ltmain.sh`:
`-model|-arch|-isysroot|--sysroot)`. libtool regenerates this file per release,
so the anchor moves whenever a dependency bumps its autotools version — but the
line itself has been stable in libtool for many years.

## Marker

`-model|-arch|-isysroot|--sysroot|-target` — the patched case pattern. The
pristine form is the same string without `|-target`, so the marker discriminates
cleanly.
