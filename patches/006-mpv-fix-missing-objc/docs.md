# 006-mpv-fix-missing-objc

**Enable the Objective-C language where the cocoa/audiounit features are
enabled, not only where a macOS SDK is detected.**

Canonical copy of `libmpv-darwin-build@rn-media-hls
patches/mpv-fix-missing-objc.patch`.

## Why this exists

mpv 0.41's `meson.build` calls `add_languages('objc', native: false)` in exactly
one place: inside the block that runs when it has successfully detected a macOS
SDK version (`message('Detected macOS SDK: ' + macos_sdk_version)`). That probe
does not resolve inside the nix build sandbox, which has an Xcode toolchain
available but not the host SDK layout the probe expects.

The result is a build that enables `cocoa` and `audiounit` — both of which
compile `.m` sources (`osdep/path-mac.m`, `audio/out/ao_audiounit.m`) — while
Objective-C was never added as a project language. meson then fails, or worse
silently drops the sources, depending on the path taken.

This patch moves the call to where the decision actually is: inside
`if features['cocoa']` and `if features['audiounit']`. `add_languages()` is
idempotent in meson, so calling it from two places is safe, and calling it where
a feature is switched on is strictly more correct than calling it where an SDK
happens to be detected.

Apple-only, and only needed because we build under nix rather than under a
stock Xcode checkout. Not a candidate for upstreaming as-is.

## Rebasing

Two anchors, both in `meson.build`:

1. `if features['cocoa']` immediately followed by `dependencies += cocoa`
2. `if features['audiounit']` immediately followed by
   `dependencies += audiounit['deps']`

If upstream fixes the SDK probe, or moves the `add_languages` call itself,
**delete this patch instead of rebasing it** and confirm with a build that
`ao_audiounit.m` is still compiled.

## Marker

`if features['cocoa']\n    add_languages('objc', native: false)` — a two-line
marker, deliberately.

The single line `add_languages('objc', native: false)` is **already present** in
pristine mpv 0.41.0 at `meson.build:1547`, inside the macOS-SDK block. Used
alone it would report a pristine tree as already patched. The two-line form
exists only after this patch runs, and the workshop checks both halves: present
in the diff's post-image, absent from its pre-image.
