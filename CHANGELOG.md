# Changelog

This repository's own version, tracked **independently** of the mpv it patches.
The workshop is a tool; the engine versions it pins live in
`manifest/engine.json`.

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
