# Changelog

This repository's own version, tracked **independently** of the mpv it patches.
The workshop is a tool; the engine versions it pins live in
`manifest/engine.json`.

## 0.4.0 — 2026-08-12

The parity release's engine side (rn-media task #32). Six divergences the
workshop had been tracking as `bug` are now closed; the manifests record what
changed, and the schema's own rule — parity is the ABSENCE of a divergence
entry — is what removes them.

### Resolved (both forks changed; see `flags.json` → `resolved`)

* **Cover art** — darwin's audio flavour gains 8 image decoders (`bmp gif
  jpeg2000 jpegls mjpeg png tiff webp`). Eight, not Android's nine:
  `--enable-decoder=ljpeg` matches nothing in any FFmpeg, so it was **deleted
  from Android** rather than copied to darwin.
* **TrueHD / DTS-HD** — darwin gains `--enable-decoder=truehd` and
  `--enable-demuxer=dtshd`; it already had the truehd demuxer, so a `.thd`
  demuxed and then failed to decode.
* **zlib** — Android gains `--enable-zlib` (Matroska compressed track headers).
  Free: the NDK sysroot ships `zlib.h` and `libz.so` at API 21.
* **LGPL polarity** — darwin now *asserts* `--disable-gpl --disable-nonfree`
  rather than leaving them commented out.
* **Dead flags** — `--enable-decoder=ljpeg`, `--enable-protocol=srt` (Android)
  and `--enable-protocol=hls` (both) deleted rather than propagated. The
  option-semantics audit now reports **190 of 190** component flags resolving
  against FFmpeg 8.1.2 *and* against master, where it was 190 of 193.
* **iconv** — aligned **down**: darwin now passes `-Diconv=disabled`, matching
  Android. Decided on evidence, not preference — Android builds at API 21 and
  bionic only gained `iconv(3)` at API 28, so enabling it there needs minSdk 28
  (dropping Android 5–8) or vendoring GNU libiconv. And with `uchardet` disabled
  and `--metadata-codepage` unset on both forks, `mp_iconv_to_utf8()` returns its
  buffer untouched anyway, so it was inert on iOS. **The loss, exactly:** neither
  platform can now apply an explicit `--metadata-codepage`.
* **mbedTLS** — both forks to **3.6.7**, the current 3.6 LTS point release
  (2026-07-07, resolved from the Mbed-TLS releases API). darwin moves from
  3.4.1 and switches to the official release tarball, because from 3.6 on a bare
  `/archive/` snapshot needs `make_generated_files.py` before it will build.
* **libxml2** — both forks to **2.15.3** (resolved from gitlab.gnome.org tags;
  still ships autotools, which both builds need — checked against the tree).
* **Patch application** — darwin applies the **whole** series with `--fuzz=0
  --no-backup-if-mismatch`, in every derivation that patches, not just the one
  prefetch-hook line. Verified: all six mpv patches apply at `--fuzz=0` in
  derivation order, leaving zero `.orig` files.

### Still open, deliberately

* `libxml2-scope` — the version skew is closed but the SCOPE difference is not,
  and the evidence sharpened while fixing the versions: libxml2 in libavformat
  serves only the DASH demuxer, and Android does not enable that demuxer, so the
  shipped Android audio artifact links an **XML parser nothing can reach**. The
  fix is to drop `--enable-libxml2` from Android, not to add it to darwin. Not
  folded in here because it changes what ships rather than aligning it.
* `ffmpeg-image-encoders`, `mpv-exhaustive-disable-list`, `source-integrity`,
  `ios-simulator-has-no-audio-output` — unchanged; the last stays `bug` because
  the manifest tracks what SHIPS and no release carries `ff0fb70` yet.

### Changed

* Both anchored patches now render with **one** convention. The
  `render.hunkFuncContext` / `render.base` options that existed only to
  reproduce the forks' pre-generation bytes are deleted. Seven hunk headers
  changed in the prefetch-hook file, **zero** content lines, and both series
  still apply.

### Fixed

* **The flag extractor read flags out of prose.** The darwin nix files use
  backtick shell comments (`` -Dfoo=bar `# why` ``), and the new iconv rationale
  quotes `-Diconv=enabled` while the build passes `disabled` — which the
  generator dutifully believed. It now strips comments before extracting. Caught
  because the regenerated manifest disagreed with the source.
* **`WORK_DIR` is now process-private.** `clearWork()` removes the directory
  whole, so two concurrent runs could delete each other's in-flight scratch
  trees. `node --test` runs files in parallel and the equivalence suite's
  cleanup raced the sync suite's render, producing two different renders of one
  patch. Caught by the byte-stability test, which is exactly what it is for.

## 0.3.0 — 2026-08-12

Phases 2 and 3: the workshop now GENERATES the forks' patch files, and checks the
binaries they ship.

### Added — `workshop sync` (phase 2, D2 model (d))

* Generates each fork's patch files from the canonical copies: header prose from
  `docs.md`, a `WORKSHOP` block, and the diff body — for anchored patches
  rendered through the same machinery as `render-diff`. Output is **byte-stable**
  (no timestamps, no version stamps, no blob hashes), so `sync` followed by
  `sync --check` is always green.
* `sync --check` writes nothing and exits non-zero listing every fork file that
  differs, reporting **header drift and body drift separately** — rewriting prose
  is routine, rewriting patch content is an incident. Writing a changed body
  requires `--allow-body-change`.
* `manifest/forks.json` declares each fork's repo, branch, patch directory, how
  patches are applied there (per dependency), and the canonical-id → filename
  map. The map is explicit because the Android fork numbers the same patches
  002/003/004/006 where the workshop numbers them 001–004: its numbering carries
  its apply order, so renumbering would risk reordering the series for no gain.
* CI job `fork-sync` clones both forks' `rn-media-hls` shallow and runs
  `sync --check`. Fork drift is now a red build **here**; the fork CIs are
  untouched.
* **Both forks migrated and pushed.** All 13 files regenerated;
  **every diff body byte-identical**, verified by hashing each body before and
  after. Seven darwin files gained a header for the first time — the
  darwin-native patches shipped as bare diffs with their rationale living only in
  nix comments. Both forks' CI ran green on the sync commits.

### Added — `workshop verify-artifacts` (phase 3, D5(d))

* A **fixed 10-category matrix** over every shipped slice: all four Android ABIs
  from their jars, both iOS slices of `Mpv.xcframework`, and the Avutil/Avformat/
  Avfilter frameworks as spot checks. Categories: identity+sha256, export set,
  export purity, patch markers, 16 KB page alignment, DT_NEEDED allow-list, LGPL
  invariant, audio output, HLS+16 filters, size delta vs the previous release.
* Fixed is the point, borrowed from ales-drnz's `verify_binaries.sh`: every slice
  runs every category and **every `∅` carries a printed reason**, so
  "iOS passed 8" and "Android passed 9" can never quietly mean different things.
* Expectations are derived from the forks' own linker files, not invented:
  `assets/export-lists/mpv.exp` IS the darwin 54, and the Android 55 is that plus
  `mpv_lavc_set_java_vm`, the one export patch 001 adds.
* Marker strings come **from the patch manifests** — every patch now declares
  `markers`, and an empty list must carry a `markersNote` saying why (enforced by
  the loader). Adding a patch adds its own artifact assertion.
* Tags are required arguments with no defaults, because this repo deliberately
  records no fork release tags.

### Found by the matrix

* **The iOS SIMULATOR slice ships with no audio output at all.** Its own embedded
  meson line reads `-Daudiounit=disabled -Davfoundation=disabled
  -Daudiotrack=disabled -Daaudio=disabled -Dcoreaudio=disabled
  -Dopensles=disabled`. The device slice (`ios-arm64`) is correct. Consequence:
  libmpv cannot play audio in the iOS Simulator, and patch
  007-mpv-audiounit-shared-session is absent from that slice because
  `ao_audiounit.m` was never compiled into it. The Android x86/x86_64 emulator
  ABIs *do* carry `audiotrack`, so this is a real cross-platform parity gap for
  developers. Cause is visible in `mk-pkg-mpv/default.nix`: `IOS_OPTIONS`
  (`-Daudiounit=enabled`) is applied only when the os is `ios`, and the simulator
  builds under a different os value, falling through to `DISABLE_ALL_OPTIONS`.
  **Reported, not worked around** — the check stays red, and it is now declared
  in `manifest/engine.json` as the tracked repo divergence
  `ios-simulator-has-no-audio-output`. The fix is a one-line idiom change in the
  darwin fork's `mk-pkg-mpv/default.nix`, using the same
  `[ $os == ios ] || [ $os == iossimulator ]` form that repo already uses
  correctly in `mk-out-frameworks/default.nix:83`. It needs a rebuild and a new
  darwin release, so it is not folded into a sync commit.
  **Fix landed** on `libmpv-darwin-build@rn-media-hls` as `ff0fb70` (one line of
  behaviour, no tag, no release); it ships with the parity release. Until that
  release exists, `verify-artifacts` against `v0.7.2-rnmedia.5` stays red **by
  design** — the check reports what shipped, not what is fixed in source. On the
  next release the simulator slice's `audio-output` and `patch-markers` cells
  flip to PASS and its size jumps, which is the AO and `ao_audiounit.m` entering
  the binary rather than a regression. **Verified against the CI artifact from
  that commit** rather than predicted: the simulator slice now carries
  `audiounit` (and no second AO), carries patch 007's markers, reads
  `-Daudiounit=enabled`, and grows 5,527,008 → 5,548,256 B (+21,248 B). The
  device slice is byte-for-byte the same size, so the change touched only the
  simulator path.
* Everything else is green: 48 pass, 2 fail, 46 n/a (each with a reason), 24
  informational across 120 cells. Android is clean on all four ABIs — 55 exports
  all `mpv_*`, 16 KB aligned, no libass/freetype/fribidi/harfbuzz in DT_NEEDED,
  `--disable-gpl` in the embedded configure line, HLS demuxer and all 17 audio
  filters present.

## 0.2.1 — 2026-08-11

### Fixed

* **master-watch issue body: deduplicated the `## Detail` section.** A patch
  belongs to several series — `003-pcm-tap` runs in `android/audio`,
  `darwin/audio` and `darwin/video` — so when its anchor moves it fails in all of
  them, and every failure was rendered as its own identical block. Issue #1
  carried `002-remove-libass` twice and `003-pcm-tap` three times, and the
  headline read "5 patch rejection(s)" for two broken patches.
  * Failures are now collapsed on `(patch, reason)`, not on patch alone: a patch
    genuinely *can* fail differently in different series, because an earlier
    patch in one series may have changed the tree underneath it. Identical text
    merges; a genuinely different failure stays visible as its own entry. Both
    directions are tested.
  * The per-series breakdown is not lost — each entry names every series it
    affects on an `Affects:` line, and the raw per-series view stays in the
    collapsed full console report, which is where it belongs.
  * Counts and the issue title now say `N patch(es) rejected`, which is the
    number of distinct broken patches. Against mpv master today that is 2, not 5.

### Notes

* First **lockstep release** cut from these patches: `v1.1.9-rnmedia.6`
  (Android) and `v0.7.2-rnmedia.5` (darwin), both carrying `004-prefetch-hook`.
  Both tag messages and the rn-media pin comments point at this repo as the
  canonical edit target.
* `manifest/engine.json` records **no** fork release tags and deliberately still
  does not. It pins upstream *sources* — what the forks are built FROM — and the
  fork tags are what the forks *produce*; recording them here would duplicate
  rn-media's `libmpv.gradle` / `libmpv.pin`, which are their real consumers, with
  nothing checking the copy. Asserting that the two forks' releases agree is
  D4 stage 1, and it belongs there with a checker attached rather than here as a
  field that rots on the next release.

## 0.2.0 — 2026-08-11

Imports the prefetch hook, filling the slot 0.1.0 reserved. The equivalence
discipline that 003 carried by hand is now enforced by the tooling.

### Added

* **`004-prefetch-hook`**, converted from the fork's unified diff to **anchored
  transforms** on import: seven edits across `player/{loadfile.c,core.h,command.c,command.h}`,
  each its own transform with its own `expectCount`. It adds the
  `on_prefetch_load` hook and the read-only `prefetch-playlist-entry-id`
  property, so a URL-rewriting resolver finally sees the prefetched entry —
  without it, `--prefetch-playlist` plus a resolver is measurably *worse* than no
  prefetch, because `open_demux_reentrant()` discards the in-flight open on a
  byte-exact URL compare. Upstream documents the gap as permanent.
  Source: `libmpv-android-audio-build@rn-media-hls` commit `a6061c6`.
  * Equivalence proven: **832 files, zero differences** against
    `tests/fixtures/004-prefetch-hook.reference.diff`.
  * `series.json`: appended to both platforms' mpv series, both variants,
    matching how the darwin derivation gates it (outside the audio-only block,
    after the pcm-tap patch).
  * Its prose header is ported verbatim, including the `REGRESSION TEST` section.
    `docs.md` records that the harness itself (`tests/prefetch_hook_test.c`,
    `tests/run.sh`) still lives in the Android fork; migrating it is a later
    phase, and until then a rebase of this patch is not finished until that
    harness has been run.

### Changed

* The equivalence proof generalised from one hardcoded patch to **every anchored
  patch**, discovered by the presence of a reference fixture. `verify` now also
  fails when an anchored patch has **no** fixture — a conversion cannot ship
  without its proof, and cannot be silently skipped by simply not adding a test.

### Found

* **The two forks' copies of this patch were not byte-identical**, contrary to
  what both the brief and the darwin derivation's own comment asserted:
  `dddcf323…` (android) vs `3190f94a…` (darwin). The **diff bodies are
  identical** — `1f20833d…`, 231 lines, four files — so nothing shipped differs;
  the divergence is entirely in the prose header, where the darwin copy is
  missing the whole `REGRESSION TEST` section and has two reflowed paragraphs.
  * The darwin derivation asserts *"Byte-identical to the Android fork's …
    (sha256 3190f94ab…)"* — quoting **its own** hash, not the Android file's. It
    is a self-referential integrity check that cannot fail.
  * Prose drift is not cosmetic when the prose is the rebasing instructions. In
    the workshop's canonical form the class is impossible: one prose record, one
    payload, fork copies generated from both (D2).

## 0.1.0 — 2026-08-11

First release. Phase 1: the workshop is a complete, verified **mirror** of what
both forks do to the engine. It does not yet write to either fork, build
anything, inspect a shipped artifact, or release.

### Added

* **Canonical patch series**, ten patches migrated from
  `libmpv-android-audio-build@rn-media-hls` and `libmpv-darwin-build@rn-media-hls`
  under one naming scheme, each with its own declaration, prose docs ported from
  the fork patch headers, and payload.
  * `003-pcm-tap` converted from a unified diff to **anchored transforms** — the
    proof of the hybrid format — with a byte-identity equivalence test against
    the diff both forks ship today (832 files, zero differences).
  * `004-prefetch-hook` reserved as an empty slot, with the import procedure and
    the specific defect to design against written down.
* **`manifest/engine.json`** — 22 dependencies × per-platform pins with version,
  url, sha256 and pinNote, populated from measured fork reality. Android's
  checksums, which did not exist, were computed against the release tarballs for
  the exact tags the fork clones; mpv 0.41.0 and FFmpeg 8.1.2 hashed identically
  to the darwin fork's `packages.lock.nix`, independently confirming it.
* **`manifest/flags.json`** — the FFmpeg and mpv flag sets by scope, with the
  LGPL invariant and 15 declared divergence buckets covering all 144 platform-only
  flags.
* **`manifest/series.json`** — apply order, declared per dependency and per
  platform for the first time; it was previously implicit in a filename glob on
  one side and the order of lines in a `.nix` string on the other.
* **`./workshop`** — zero-dependency Node CLI: `status`, `verify`, `dry-run`,
  `render-diff`, `new-patch`.
  * `verify` is the gate: full series against checksum-verified pinned sources,
    manifest consistency, and the equivalence proof. Non-zero exit on any failure.
  * `dry-run` adds the option-semantics audit — mpv meson options and FFmpeg
    component resolution against the candidate's own registration tables.
* **CI** — `verify.yml` on push/PR, `master-watch.yml` weekly against mpv and
  FFmpeg master with a single self-maintaining tracking issue.
* **`tests/`** — 23 `node:test` cases covering the anchored engine's failure
  modes, manifest consistency, and the equivalence proof.
* **`assets/export-lists/`** — both linkers' export lists side by side.

### Found while building it

Divergences between the two forks that nothing could previously see, now declared
and tracked (see `README.md` and `./workshop status`):

* **`-Diconv`** disabled on Android, enabled on darwin — legacy ID3 tag charsets
  decode correctly on one platform and not the other. Not previously named.
* **FFmpeg `--enable-zlib`** on darwin only — Matroska compressed track headers.
  Not previously named.
* Confirmed and quantified: nine cover-art decoders and the truehd decoder /
  dtshd demuxer missing from darwin's audio flavour; mbedTLS and libxml2 version
  skew; the LGPL assertion being present on one side and only implied on the
  other; and the Android fork verifying no source checksums at all.

### Fixed

* A real trap in the tooling, caught by the marker post-condition rather than by
  review: `git apply` run inside a parent repository's work tree silently ignores
  hunks outside the current subdirectory, exits 0, and `--check` agrees. Scratch
  trees now live outside any repository, and the diff applier refuses to run
  where `git rev-parse --show-prefix` is non-empty.
