# Decisions

This file is the living record of every architectural decision in this repo and
its *why*, in the same spirit as rn-media's `ARCHITECTURE.md`. A change that
alters a decision updates this file in the same commit. Report contradictions
rather than silently diverging.

Decisions **D1–D5** were frozen by the architect before phase 1 was implemented.
They are recorded verbatim, followed by the rationale and by the choices made
*within* them during implementation.

---

## D1 — Patch canonical format: HYBRID

### The decision, verbatim

> Patch canonical format: HYBRID.
>
> - Feature-insertion patches = **declarative anchored transforms**: a patch is a
>   DATA file (JSON, or a .mjs module exporting a plain object — choose one,
>   justify in DECISIONS.md) declaring: id, marker string, docs (why/provenance/
>   upstream citations — port them from the existing patch headers), target dep
>   (mpv/ffmpeg), platforms (shared/android/darwin), and a list of transforms
>   `{file, pristine, patched, expectCount}`. ONE engine (tools/) applies them.
>   STRICT contract fixing ales-drnz's defect: every transform must match exactly
>   expectCount times or the whole patch fails atomically — no partial
>   application possible, no silent skips. Marker idempotence (marker present ⇒
>   skip, but verify ALL transforms' patched forms present, else error
>   "partially patched tree").
> - Bulk/structural patches = **unified diffs** (kind: "diff"), applied with
>   git apply (strict, no fuzz).
> - Large code additions = whole .c/.h files in the patch dir, transforms only
>   wire them in.
> - `render-diff` command: for anchored patches, materialize the effective
>   unified diff (apply to pristine source, git diff) so reviews always see a
>   diff.

### Why

Neither format is right for everything, and pretending otherwise is what both
existing approaches get wrong.

`ales-drnz/libmpv-scripts` has **no `.patch` file anywhere**: every change is a
Python script doing exact-string replacement against named pristine anchors. The
properties that buys are real and we want them — zero fuzz by construction,
line-number independence (so unrelated upstream churn is free), and idempotence
via a marker. But bulk deletion is what diffs are *for*: `002-remove-libass` is
2 892 lines that delete four files, add one, and rewrite large regions of
`meson.build`. Expressing that as anchored transforms would be strictly worse in
every dimension including safety.

Our forks have the opposite problem: **everything** is a unified diff, so every
engine bump is a rebase of every patch, including the ones whose edits do not
care what line they land on. `003-pcm-tap` pins seven edits to line numbers in
`player/command.c` — a 4 500-line file upstream churns constantly — for no
benefit whatsoever.

So: diffs for bulk and structural change, anchored transforms for feature
insertion, and one `kind:` field saying which. This also matches ales-drnz's own
de-facto split — they copy whole `.c` files in and only *wire* them with anchors.

The cost is two mechanisms to teach and two failure modes to read. `render-diff`
pays most of that back on the review side, and `workshop verify` treats both
kinds identically from the outside.

### The strict contract, and the defect it fixes

`patches/mpv/shared/patch_prefetch_state.py` in ales-drnz's repo does this, for
each of several call sites in one file:

```python
if pristine in text:
    text = text.replace(pristine, patched)
```

A call site whose anchor moved is **silently skipped**, while the file-level
`MARKER` is still written. The next run then reports `Already patched:` over a
half-patched tree. For a prefetch state machine that means some transitions
wired and others not — a build that succeeds and mostly works.

Our contract closes every part of that:

| Rule | Where |
| --- | --- |
| Every transform declares `expectCount` and must match **exactly** that many times | `tools/lib/anchored.js` |
| Too few **and too many** matches both fail — a duplicated call site is not silently multiplied | `inspectAnchored` → `moved` |
| The patch is validated as a unit, staged in memory, and only then written — a rejection leaves the tree untouched | `applyAnchored` phases 1–3 |
| Marker present ⇒ skip, but only after **all** transforms verify as applied; otherwise `partially patched tree` | `inspectAnchored` |
| A transform applied with the marker **absent** is also `partially patched tree` | `inspectAnchored` |
| The marker must be absent from every pristine anchor and present in the patched result, or it proves nothing | `patches.js` + `applyAnchored` phase 2 |
| Two transforms whose anchors overlap on one file are caught before any write | `applyAnchored` phase 1 |

Each of these has a test in `tests/anchored.test.js` asserting the *negative*
case. ales-drnz's patchers have no tests at all, which is why the defect above
survived.

### Choice within D1: **JSON, with anchor text in sibling fragment files**

The brief allowed JSON or an `.mjs` module. JSON wins, with one refinement.

* **Data, not code.** A `.mjs` patch is an executable that the workshop imports.
  For a repo whose entire job is supply-chain integrity, "the patch format is a
  program" is the wrong default. JSON cannot do anything.
* **Consumable by everything.** node reads it natively, nix reads it with
  `builtins.fromJSON`, and a shell script gets at it through node. That was a
  hard requirement: phase 2 generates the forks' patch dirs, and those forks are
  bash and nix.
* **The refinement.** Raw JSON is a terrible place to put C: `"\n"`-escaped
  240-line blobs are unreadable and unreviewable, which is the one thing a patch
  must not be. So every multi-line anchor lives in `fragments/<name>.{pristine,patched}.txt`
  as **real text with real syntax**, and `patch.json` references it by path.
  Single-line anchors stay inline, where JSON escaping is harmless.

This gets the best of the `.mjs` template-literal ergonomics with none of the
execution, and it dodges the escaping hazard template literals have around
`` ` `` and `${` — both of which occur in meson and shell sources we patch.

The fragments for `003-pcm-tap` were **extracted, not typed**: pulled byte-for-byte
out of a pristine mpv 0.41.0 tree and out of the tree the original diff produces.
See the equivalence proof below.

### Choice within D1: the number is identity, the order is declared

`NNN-<name>` is a **stable identifier**, not an apply order, and it cannot be
one: the darwin fork applies its export-list patch *before* the libass strip,
and the Android fork has no export-list patch at all. No single numbering
encodes both sequences.

Order is therefore declared in `manifest/series.json`, per dependency and per
platform. This also closes a gap the research named in all three prior systems —
Android encodes order in a filename glob, darwin in the order of `patch -p1`
lines inside a `.nix` string, and ales-drnz in the body of a shell function with
the constraint written only as a comment (*"MUST run before strip_libass"*).
None of the three can be diffed against another.

### The equivalence proof

Converting a shipped patch to a new format is only safe if the two produce the
same **bytes**. `003-pcm-tap` therefore carries its own proof, re-run by
`workshop verify` and by `tests/equivalence.test.js`:

```
tree A = pristine mpv 0.41.0 + tests/fixtures/003-pcm-tap.reference.diff
         (the exact file both forks ship today, copied verbatim)
tree B = pristine mpv 0.41.0 + patches/003-pcm-tap via the anchored engine
assert  A and B are byte-identical — every file, no exceptions
```

Result: **832 files identical, zero differences.** A conversion without a
byte-identity proof is a rewrite, and `patches/004-prefetch-hook/docs.md`
requires the same proof of the next conversion.

---

## D2 — Sync model (d): the workshop GENERATES the forks' patch dirs

### The decision, verbatim

> Sync model (d): the workshop GENERATES the forks' patch dirs (phase 2 — NOT in
> your scope; but structure patch dirs so generation is trivial: one canonical
> naming scheme `NNN-<name>`).

### Why

Today the two forks carry byte-identical copies of two patches, and that is true
**by discipline and nothing else** — there is no check, in either repo or in
rn-media, and a `grep` across both forks for the other fork's name returns
exactly two hits, both prose comments. The alternatives were:

* *copy + verify* — a tripwire, not a lock; copies can be edited between CI runs;
* *fetch-at-build* — adds a network input to a nix derivation and to Android's
  fully-local `patch.sh`, and a fork can no longer be built from its own checkout;
* *submodule/subtree* — byte-identity becomes a git invariant, but the darwin repo
  already pays a submodule tax on libplacebo, and subtree hides the provenance we
  specifically want visible.

Generation gives the same guarantee as fetch-at-build with no build-time network
and no bootstrapping circularity: the forks keep self-contained, offline-buildable
patch dirs, each carrying a `GENERATED — do not edit` header, and CI runs the
generator in `--check` mode.

### What phase 1 did to make phase 2 trivial

* One canonical naming scheme, `NNN-<name>`, replacing `004.rn_media_pcm_tap.patch`
  on one side and `mpv-rn-media-pcm-tap.patch` on the other.
* Every patch is a self-contained directory: declaration, docs, payload, assets.
* `render-diff` already materialises any patch — including anchored ones — as a
  unified diff. Generating a fork's patch dir is that, plus the fork's filename
  convention and a generated header.
* `manifest/series.json` already knows each fork's apply order, which is the one
  thing a generator cannot infer.

**Not done, and deliberately:** nothing in this repo writes to either fork, and
nothing in either fork reads this repo yet. Phase 1 is a mirror, not yet a source.

---

## D3 — Manifests

### The decision, verbatim

> Manifests:
> - `manifest/engine.json`: per-dependency × per-platform pins — {version, url,
>   sha256, pinNote}. Populate from MEASURED reality in the two forks (research
>   §5.2 + fork files; Android has no checksums — compute sha256 for Android's
>   sources by downloading the same tags it clones, or record checksum:null with
>   a TODO note, justify choice). Divergences MUST be declared: a `divergence`
>   field with {reason, status: "intentional"|"bug", ref} — mbedTLS and libxml2
>   get status "bug" referencing rn-media task #32. Undeclared divergence between
>   platforms = `workshop verify` failure.
> - `manifest/flags.json`: the ffmpeg/mpv configure+meson flag sets by scope
>   (shared / android / darwin) × variant (audio / video), extracted from the
>   forks' build files (research §5.3–5.4 names the exact files). Include the
>   LGPL invariant flags. This is data, not a build system — plain lists with a
>   `notes` field.

### Why divergence must be *declared* rather than merely reported

Divergence between the platforms is sometimes legitimate (libplacebo's
build-time submodules are vendored on darwin because a release tarball ships them
empty, while Android clones `--recursive`) and sometimes a bug (mbedTLS 3.6.1 vs
3.4.1 on the TLS stack that terminates every HTTPS connection). A tool cannot
tell those apart. A human can, in one sentence, once.

So the rule runs **both ways**, and both directions are `workshop verify`
failures:

* a **measured** difference that is not **declared** — how mbedTLS, libxml2 and
  nine cover-art decoders all stayed invisible;
* a **declared** difference that is no longer measured — a stale declaration is
  how a fixed bug quietly becomes permission to regress.

`status: "bug"` is not approval. It means *known, tracked, still wrong*, and it
must carry a `ref`. Twelve divergences are currently declared as bugs; `workshop
status` lists them.

### Choice within D3: Android checksums were **computed**, not left null

The brief allowed either. They were computed, by downloading the release tarball
for the exact tag the Android fork clones, and each is recorded with
`fetch: "git-tag"` plus a `ref`, so the manifest never pretends the fork verifies
anything today.

Reasons: a `sha256: null` is a hole that `workshop verify` cannot use, and
verify's whole value is applying patches to *the bytes the forks build*. Recording
the real hash makes the Android rows usable immediately and makes the migration
target explicit rather than aspirational. The gap itself is declared as the
repo-level `source-integrity` divergence, `status: "bug"`.

A useful side effect: mpv 0.41.0 and FFmpeg 8.1.2 hashed **identical** to the
values in the darwin fork's `packages.lock.nix`, independently confirming that
manifest.

### What flags.json is, and what it is not

It is **data**: plain lists, extracted from
`buildscripts/scripts/{ffmpeg,mpv}.sh` and `mk-pkg-ffmpeg/meson.build` +
`mk-pkg-mpv/default.nix`, with `shared` as the exact intersection of the two
platforms' audio sets and everything else declared. It is not a build system, it
generates no configure line, and it never will — the forks own their builds.

The divergence check runs on the **audio** variant only, because Android builds
no video variant at all and every darwin video flag would otherwise drown the
signal. That scope is recorded for the option-semantics audit instead.

Stated once and meant: these are **declared flags, not shipped artifacts**.
FFmpeg auto-selects components through `_select`/`_deps` chains, so a flag being
absent does not prove a component is absent from the binary. Confirming any of
the findings needs a shipped-artifact probe — the next phase of this repo.

### What the flag manifest found immediately

Building it surfaced two divergences **nobody had named**, on top of the ones the
research already knew about:

* **`-Diconv`** — Android `disabled`, darwin `enabled`. iconv is what mpv uses to
  transcode non-UTF-8 text, which for an audio engine means legacy ID3 tag
  charsets. A CP1251 artist name is likely correct on iOS and mojibake on Android.
* **FFmpeg `--enable-zlib`** — darwin only. zlib in libavformat decompresses
  Matroska compressed track headers, so a `.mka` using header compression is a
  candidate for behaving differently across platforms.

Both are parity gates under CLAUDE.md and are declared `status: "bug"`.

---

## D4 — Release orchestration: out of scope, plan recorded

### The decision, verbatim

> Release orchestration: OUT of phase-1 scope, but `docs/DECISIONS.md` records
> the plan (assertion-mode first, tag-authority engine-v`<mpv>`-`<n>` later).

### The plan

**Stage 1 — assertion mode (next).** The forks keep their own tags and their own
releases. The workshop only *asserts* that they agree: a check job reads both
pin files and both fork releases and fails if mpv / FFmpeg / libplacebo / mbedTLS
disagree, or if a patch marker is missing from a shipped artifact. Small blast
radius, no cross-repo credentials, and it cures the two pains that are purely
informational.

**Stage 2 — tag authority.** The workshop becomes the tag authority:
`engine-v<mpv>-<n>` is tagged here, `repository_dispatch` fans out to both forks,
each builds and verifies and releases its own asset under a derived tag, and a
final job opens the rn-media pin-bump PR carrying both sets of checksums.

The tag scheme changes deliberately. `v<upstream>-rnmedia.N` is per-fork and
already lying — `libmpv.pin` says so in as many words: *"the `v0.7.2` base no
longer describes the contents"*. One lineage across both platforms is the point.

**The cost, stated up front:** cross-repo dispatch needs a PAT with write scope
on three repositories, which is a real supply-chain surface for a repo whose
whole job is supply-chain integrity. That is why stage 1 comes first and why
stage 2 is a separate decision to be taken with eyes open.

Also required regardless: the Android fork's CI runs on `main` push only, never
fires on `rn-media-hls`, and does not reference `rn-media-release.sh` at all.
Android releases are a local script plus a manual upload today. That has to be
rebuilt before either stage means anything.

---

## D5 — Dry run: in scope

### The decision, verbatim

> Dry-run: IN scope (see commands).
>
> `dry-run --mpv <tag|master>` (and --ffmpeg): same as verify but against a
> candidate version; per-patch applies-clean/rejects + per-anchor
> found/moved/gone report; plus the option-semantics audit: diff the candidate's
> meson_options.txt / configure --help against flags.json and report
> added/removed/renamed options and newly-auto features (the avfoundation-AO
> class of hazard, see research D5(b)).

### Why the option audit is not optional

Patches applying cleanly says nothing about whether the flags still *mean* what
they meant. Two incidents shape the implementation, and neither would be caught
by a patch check:

* **mpv 0.41 added `avfoundation`**, value `auto`, whose dependency resolves on
  iOS as well as macOS. Nothing rejected it and nothing warned: left alone it
  silently built a **second audio output** into an audio-only engine.
* **FFmpeg 8.1 deleted the `hls://` protocol**, so `--enable-protocol=hls` now
  matches nothing. configure prints `WARNING: ... did not match anything` and
  exits 0 — indistinguishable from success in a CI log. HLS kept working only
  because what carries it is the demuxer.

### Choice within D5: static resolution, not `configure --help`

The brief said "configure --help". The implementation reads the candidate's own
**registration tables** instead — `libavcodec/allcodecs.c`, `libavformat/allformats.c`,
`libavformat/protocols.c`, `libavfilter/allfilters.c`, `libavcodec/parsers.c`,
`libavcodec/hwaccels.h` — and glob-resolves every `--enable-<class>=<name>` we
pass against them.

Why: `configure --help` requires executing a large shell script whose output
format is not stable and which does real work; the registration tables are the
ground truth configure itself derives its component lists from. It needs no
execution, works identically on any host, and it is exactly what the Android
fork's own comment describes doing **by hand** for the 6.0 → 8.1.2 bump
(*"re-verified against 8.1.2's own registration tables ... rather than against
memory or a changelog"*). This automates a step we were already performing.

Validation: run against the pinned FFmpeg 8.1.2 it reports exactly the three
flags the fork's comment records configure warning about —
`--enable-protocol=hls`, `--enable-decoder=ljpeg`, `--enable-protocol=srt` — and
nothing else. Against `master` it reports the same three, so nothing further has
rotted.

For mpv the audit parses `meson.options` / `meson_options.txt` and reports
removed options (meson hard-errors on each), options whose type changed between
`boolean` and `feature` (which silently changes what our spelling means), and
every **new** feature option we do not name — the avfoundation class. Against
mpv `master` today that is `amf`, `libcurl` and `subrandr`; `libcurl` is a new
network backend that would enter an audio engine unasked.

### Dry run reports; it does not gate

Breakage against a moving branch is expected and is the entire product. The
command exits non-zero only when it could not run. Every candidate fetch is
unpinned by definition — there is no checksum for a version we have not adopted —
and that is stated loudly on every run rather than being papered over.

---

## D6 — Implementation decisions taken during phase 1

These were not pre-frozen; they are recorded here because they change how the
repo behaves.

### D6.1 — Scratch trees live outside the repository, always

`git apply` run from a **subdirectory of a git work tree** silently ignores hunks
whose paths fall outside that subdirectory: it exits 0, `--check` agrees, and
nothing is written. With scratch trees under the workshop's own `.cache/`, every
git-format patch became a silent no-op that `verify` reported as green.

It was caught only because every patch application asserts its **marker**
afterwards. That post-condition is now load-bearing rather than decorative.

Two defences, because one silent no-op was enough:

1. `WORK_DIR` defaults to a path under `os.tmpdir()`, outside any repository;
2. `tools/lib/diffpatch.js` refuses to run when `git rev-parse --show-prefix`
   returns non-empty — the exact condition under which the ignore rule is live.

### D6.2 — The marker is a post-condition for both patch kinds

For anchored patches the marker is checked statically (present in some patched
text, absent from every pristine anchor) *and* dynamically. For diffs,
idempotence comes from `git apply --reverse --check`, which is exact, so the
marker's job there is purely to prove the patch **landed**. Both kinds assert it
after applying.

Marker quality is checked, not assumed: `006-mpv-fix-missing-objc` needs a
two-line marker because the single line it adds, `add_languages('objc', native:
false)`, is **already present** in pristine mpv 0.41.0 at `meson.build:1547`. A
one-line marker there would report a pristine tree as already patched. The
pre-image check catches exactly this.

### D6.3 — `verify` stops at the first failure; `dry-run` does not

A series is a sequence, and a later patch's anchors may only exist because an
earlier one ran, so continuing past a failure in `verify` produces noise. In
`dry-run`, "which of the five broke, and how" is the entire report, so it
continues and reports every one.

### D6.4 — Two darwin patches were added beyond the brief's list

The brief enumerated four darwin-only patches (export-list, fix-missing-objc,
audiounit-shared-session, ltmain). The darwin fork also carries
`ffmpeg-fix-vp9-hwaccel` and `ffmpeg-fix-ios-hdr-texture`, gated to the video
variant. Both were imported as `009` and `010`, `variants: ["video"]`.

Rationale: this repo's stated job is to be the single source of truth for
everything we do to the engine. A patch that lives in a fork but not here is
exactly the invisible divergence the repo exists to end. They never touch an
audio build.

### D6.5 — Export lists are collected, not yet asserted

`assets/export-lists/` holds both linker files side by side, following the one
idea in ales-drnz's repo that has no equivalent in either fork: all export lists
in one directory. The two disagree — 55 names via a `mpv_*` wildcard on Android,
54 exact names on darwin — and nothing yet compares them. Collecting them is
phase 1; asserting the delta against a shipped binary belongs to the
shipped-artifact matrix.

---

## What phase 1 deliberately does **not** do

Stated plainly so no one reads a green board as more than it is:

* It does not **build** anything. Patches applying is not code compiling.
* It does not inspect a **shipped artifact**: no export-count check, no
  16 KB page-alignment check, no `DT_NEEDED` allow-list, no demuxer/filter
  presence probe, no assertion that the shipped dylib was not built from the
  `encodersgpl` flavour. The LGPL invariant is checked against the flag lists
  only, and says so.
* It does not **write** to either fork, and neither fork reads it. Phase 1 is a
  mirror.
* It does not **release** anything (D4).
* The flag divergence findings are strong signals from declared flags, not
  measurements of binaries.
