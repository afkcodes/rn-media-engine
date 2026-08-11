# rn-media-engine

**The engine workshop for [rn-media](https://github.com/afkcodes/rn-media).**

rn-media is a React Native audio library built on [libmpv](https://mpv.io/). We
do not consume a stock libmpv — we build our own, from patched mpv and FFmpeg
sources, for Android and for Apple platforms. This repository is the single
source of truth for everything we do to that engine: the canonical patch series,
the per-platform version pins, and the exact configure/meson flag sets our two
binary forks build from.

```
afkcodes/libmpv-android-audio-build ──┐
                                      ├──> rn-media (the RN library)
afkcodes/libmpv-darwin-build ─────────┘

                 ▲
                 └── rn-media-engine (this repo): the patches, pins and flags
                     that both of them are built from
```

---

## Why we fork the engine

rn-media's mission is stated by its owner in one line: *build the best audio
module on React Native — easy to use, with all the features.* Operationally the
consequence is that **feature parity between Android and iOS is a gate, not a
preference**. Platform-capped compromises get rejected even when they are
easier — and the way you avoid a platform ceiling becoming your product's
ceiling is to own the engine.

Three things follow from that, and each is a patch in this repo:

**1. The client API cannot see the audio it is playing.** libmpv has no way to
read the samples going to the device — on any platform, in any release. Android
has `android.media.audiofx.Visualizer`, which is Android-only, capped around
20 Hz and 8-bit, and demands `RECORD_AUDIO` from every consuming app. There is no
iOS equivalent at all. So a visualizer is either an Android-only feature with a
scary permission prompt, or you tap mpv itself. We tap mpv
([`003-pcm-tap`](patches/003-pcm-tap/docs.md)): one patch, both platforms, no
permission, full-scale float samples at a rate the client chooses.

**2. An audio player should not ship a subtitle renderer.** mpv 0.41 has an
unconditional `dependency('libass', ...)` and no switch to turn it off — the stub
OSD backend that used to allow it was deleted upstream. So every mpv ≥ 0.37 drags
in libass and, transitively, freetype, fribidi and harfbuzz: roughly 1–2 MB per
ABI on a ~6.4 MB binary, to draw glyphs we never draw
([`002-remove-libass`](patches/002-remove-libass/docs.md)).

**3. Platform integration needs symbols and behaviour upstream has no reason to
provide.** mpv's Android audio output reaches the JVM through a global that lives
in the FFmpeg we link *statically*, so nothing can set it and there is no audio
at all ([`001-lavc-set-java-vm`](patches/001-lavc-set-java-vm/docs.md)). On
Apple, `AVAudioSession` is a process-wide singleton that upstream's AudioUnit
output treats as its own, so the first of several players to stop kills audio for
all of them ([`007-mpv-audiounit-shared-session`](patches/007-mpv-audiounit-shared-session/docs.md)).

Owning the engine is not free, and this repo is the machinery that makes it
affordable.

---

## What every patch does

| Patch | Kind | Dependency | Platforms | What and why |
| --- | --- | --- | --- | --- |
| [`001-lavc-set-java-vm`](patches/001-lavc-set-java-vm/docs.md) | diff | mpv | android | Exports `mpv_lavc_set_java_vm` so the app's `JNI_OnLoad` can hand mpv the `JavaVM`. Without it the AudioTrack output cannot attach a `JNIEnv` and there is no audio. |
| [`002-remove-libass`](patches/002-remove-libass/docs.md) | diff | mpv | shared | Strips libass + freetype + fribidi + harfbuzz out of the audio-only build, replacing them with a stub. |
| [`003-pcm-tap`](patches/003-pcm-tap/docs.md) | **anchored** | mpv | shared | Adds `pcm-tap` / `pcm-tap-frame` properties: the newest window of post-DSP audio, as interleaved float32, for the visualizer. No new exported symbol — the ABI is untouched. |
| [`004-prefetch-hook`](patches/004-prefetch-hook/docs.md) | *reserved* | mpv | shared | Slot claimed; the patch is being authored in the Android fork and is imported once it lands. |
| [`005-mpv-export-list`](patches/005-mpv-export-list/docs.md) | diff | mpv | darwin | Pins the Mach-O export list to 54 public `mpv_*` names, so a statically linked libplacebo does not leak ~570 symbols into the framework. |
| [`006-mpv-fix-missing-objc`](patches/006-mpv-fix-missing-objc/docs.md) | diff | mpv | darwin | Enables Objective-C where the cocoa/audiounit features are switched on, rather than only where a macOS SDK probe succeeds — the probe does not resolve in our nix sandbox. |
| [`007-mpv-audiounit-shared-session`](patches/007-mpv-audiounit-shared-session/docs.md) | diff | mpv | darwin | Reference-counts `AVAudioSession` so several mpv cores in one process do not deactivate it under each other, plus an opt-out for hosts that own the session themselves. |
| [`008-ltmain-target-passthrough`](patches/008-ltmain-target-passthrough/docs.md) | diff | libxml2, libass, libogg, libvorbis | darwin | Teaches libtool to forward clang's `-target`, without which an autotools dependency cross-compiles for the host. |
| [`009-ffmpeg-fix-vp9-hwaccel`](patches/009-ffmpeg-fix-vp9-hwaccel/docs.md) | diff | ffmpeg | darwin, *video only* | Restores a standalone `vp9_videotoolbox` decoder carrying the superframe bitstream filters VideoToolbox needs. |
| [`010-ffmpeg-fix-ios-hdr-texture`](patches/010-ffmpeg-fix-ios-hdr-texture/docs.md) | diff | ffmpeg | darwin, *video only* | Returns BGRA rather than P010 for >8-bit VideoToolbox output on iOS, where GLES has no 10-bit textures. |

Every patch directory holds its own `docs.md`: why it exists, where it came from,
what it adds, and — the section that decides whether the next engine bump takes
an hour or a week — **which anchors to re-check**.

### Two formats, on purpose

Bulk and structural changes are **unified diffs**, applied with `git apply`,
which has no fuzz: a hunk matches or the patch is rejected. Feature insertions
are **anchored transforms** — a JSON declaration of exact `{file, pristine,
patched, expectCount}` replacements, with the anchor text held in readable
fragment files. Anchored patches carry no line numbers, so unrelated upstream
churn costs nothing, and a moved anchor is a precise error rather than a wall of
rejected hunks.

The difference is visible the moment upstream moves. Running the series against
mpv `master` today:

```
✗ 002-remove-libass    REJECTS
    error: patch failed: meson.build:29
    error: meson.build: patch does not apply
    error: patch failed: player/command.c:25
    ... six more like it

✗ 003-pcm-tap          REJECTS
    1/7 anchor(s) did not match: common/global.h#4 gone
    anchor common/global.h#4: GONE (matched 0x, expected 1)
      — one tap per mpv core, hung off mpv_global
```

One tells you which file broke. The other tells you which *idea* broke.

`./workshop render-diff <patch-id>` materialises any patch as a unified diff —
including the anchored ones, generated by applying them to a pristine tree — so
review always gets a diff to read.

The full reasoning, including the strict contract that makes partial application
unreachable, is in [`docs/DECISIONS.md`](docs/DECISIONS.md).

---

## The manifests

**[`manifest/engine.json`](manifest/engine.json)** — every dependency, per
platform: version, url, sha256, and a `pinNote` saying why that version. Every
difference between the platforms must be **declared**, with a status of
`intentional` or `bug`; `bug` must carry a tracking reference. The rule runs both
ways, and both are `verify` failures: an undeclared divergence, and a declared
divergence that is no longer real.

**[`manifest/flags.json`](manifest/flags.json)** — the configure and meson flag
sets, as data. `shared` is the exact intersection of the two platforms' audio
sets; everything else is platform-only and must be covered by a declared
divergence bucket. Includes the LGPL invariant.

**[`manifest/series.json`](manifest/series.json)** — apply order, declared per
dependency and per platform. The `NNN-` prefix is identity, not order: darwin
applies its export-list patch before the libass strip and Android has no
export-list patch at all, so no single numbering can encode both.

### What building the manifests found

Collecting this in one place immediately surfaced divergences that had been
invisible because nothing could see both forks at once. Twelve are currently
declared as bugs. The ones that reach users:

* **Cover art.** Android's audio build enables nine image decoders (`mjpeg`,
  `png`, `webp`, …); darwin enables **none**. Embedded album art is decoded by
  exactly these, so art that renders on Android is expected to fail on iOS.
* **TrueHD / DTS-HD.** darwin has the truehd *demuxer* but no truehd *decoder*,
  and no dtshd demuxer. A `.thd` file demuxes on iOS and then fails to decode.
* **Text encoding.** mpv's `-Diconv` is `disabled` on Android and `enabled` on
  darwin, so a legacy CP1251 or Shift-JIS ID3 tag is likely correct on iOS and
  mojibake on Android. *Not previously named anywhere.*
* **TLS.** mbedTLS is 3.6.1 on Android and 3.4.1 on darwin — the library
  terminating every HTTPS and HLS connection, two minor versions behind on one
  platform.
* **Source integrity.** The Android fork fetches every source as a shallow git
  clone by tag and verifies no checksum at all; darwin carries a sha256 on all 22.

These are declared, tracked, and still wrong — which is the point of writing them
down. `./workshop status` lists them.

---

## How a bump works

The dependency policy is *evaluate within two weeks of an upstream stable
release, ship after the full verification playbook*. The workshop covers the
early, cheap parts of that playbook.

```sh
./workshop status                  # are we behind? what diverges? what do we patch?
./workshop dry-run --mpv 0.42.0    # would the series still apply? do the flags still mean what they meant?
# ... rebase whatever moved, in this repo ...
./workshop verify                  # the gate: full series against pinned sources
```

`dry-run` answers two questions that a build cannot answer cheaply and a patch
check cannot answer at all:

* **per patch and per anchor** — applies-clean or rejects, and for anchored
  patches, which specific anchor is `found` / `moved` / `gone`;
* **option semantics** — for mpv, every meson option we pass that the candidate
  removed or retyped, plus every **new** option defaulting to `auto` that we do
  not name. That last one is not theoretical: mpv 0.41 added `avfoundation` with
  value `auto`, its dependency resolves on iOS, and left alone it silently built
  a *second audio output* into an audio-only engine. For FFmpeg, every
  `--enable-<class>=<name>` we pass is resolved against the candidate's own
  registration tables — FFmpeg's `did not match anything` warning, computed
  statically, because in a CI log that warning is indistinguishable from success.
  (FFmpeg 8.1 deleted the `hls://` protocol this way. HLS kept working only
  because what carries it is the demuxer.)

`verify` is the gate, and it exits non-zero on any failure. It proves three
things: every patch applies cleanly with no fuzz to the exact bytes the manifest
pins, checked by sha256; the manifests are internally consistent; and the
anchored form of `003-pcm-tap` produces a tree **byte-identical** to the unified
diff both forks ship today — 832 files, no exceptions.

---

## How a release works

Not yet, and this repo says so rather than implying otherwise.

Today the two forks release independently: darwin is tag-triggered and fully
automated in CI, Android is a local script plus a manual upload, and the two tag
lineages (`v1.1.9-rnmedia.5`, `v0.7.2-rnmedia.4`) no longer describe their own
contents. The plan is staged — first the workshop *asserts* that the two forks
agree, then it becomes the tag authority with a single `engine-v<mpv>-<n>`
lineage across both. The reasoning, and the supply-chain cost of the second
stage, are recorded in [`docs/DECISIONS.md`](docs/DECISIONS.md) under D4.

**What phase 1 explicitly does not do:** it does not build anything, does not
inspect a shipped binary, does not write to either fork, and does not release.
The LGPL invariant is checked against the declared flag lists, not against a
binary — and the flag divergences above are strong signals from declared flags,
not measurements of artifacts. A shipped-artifact verification matrix is the next
phase.

---

## Using it

Requires **Node ≥ 22**, `git` and `tar`. No `npm install` — the tooling has
**zero runtime dependencies**, so a CI run reproduces on a laptop with no
install step and no token. A gate you can only run by pushing is a gate that
rots.

```sh
./workshop --help              # all commands
./workshop status              # pins vs upstream, divergence, patch inventory
./workshop verify              # the gate
./workshop dry-run --mpv master --ffmpeg master
./workshop render-diff 003-pcm-tap
./workshop new-patch my-change --kind anchored
node --test "tests/**/*.test.js"
```

Sources are downloaded and verified once into `.cache/` (override with
`WORKSHOP_CACHE`). Set `GH_TOKEN` to raise the GitHub API rate limit from 60/h to
5000/h.

## Layout

```
workshop                 the CLI (executable node script)
tools/
  cli.js                 argument parsing + command dispatch
  commands/              one file per command
  lib/                   anchored engine, diff applier, manifests, cache, audits
manifest/
  engine.json            per-dependency x per-platform pins, with declared divergence
  flags.json             configure/meson flag sets by scope, with declared divergence
  series.json            apply order, per dependency and per platform
patches/NNN-<name>/
  patch.json             the declaration
  docs.md                why it exists, provenance, what to re-check on a bump
  *.diff | fragments/    the payload
  assets/                whole files the patch installs
assets/export-lists/     both linkers' export lists, side by side
tests/                   node:test — the anchored engine's failure modes, the
                         manifests, and the 003 equivalence proof
```

## Versioning

This repo carries its own version, tracked **independently** of the mpv it
patches — the workshop is a tool, not a release of the engine. Engine versions
live in `manifest/engine.json`.

## Licence

The tooling in this repository is MIT. The patches are derived works of mpv and
FFmpeg and carry those projects' terms — mpv under LGPLv2.1+ (built here with
`-Dgpl=false`) and FFmpeg under LGPLv3 (`--disable-gpl --disable-nonfree
--enable-version3`). Keeping every artifact we ship LGPL is a hard invariant,
recorded in `manifest/flags.json` and checked by `workshop verify`.
