# Changelog

This repository's own version, tracked **independently** of the mpv it patches.
The workshop is a tool; the engine versions it pins live in
`manifest/engine.json`.

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
