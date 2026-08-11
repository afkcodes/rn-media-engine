# 007-mpv-audiounit-shared-session

**Reference-count the shared `AVAudioSession` in `ao_audiounit`, and let a
client opt out of session management entirely.**

Canonical copy of `libmpv-darwin-build@rn-media-hls
patches/mpv-audiounit-shared-session.patch`.

## Why this exists

`AVAudioSession` is a **process-wide singleton** — the OS owns exactly one per
app. mpv's `ao_audiounit.m` treats it as if it owned it: `init()` sets the
category, mode, active state and preferred channel count unconditionally, and
`uninit()` calls `setActive:NO` unconditionally.

rn-media runs **several mpv cores in one process** (multi-instance players are
a day-one requirement, CLAUDE.md principle 5). With upstream's code the second
player's `init()` re-configures the session under the first, and — much worse —
the first player to stop calls `setActive:NO` and kills audio for every other
player still running. That is not a corner case; it is what happens the moment a
notification sound and a track overlap.

## What it adds

* a file-static `audiounit_session_use_count` behind a `mp_static_mutex`, so the
  session is configured on the 0→1 transition and deactivated on the 1→0
  transition, and never in between;
* a `session_acquired` flag per `struct priv`, so a core that failed part-way
  through `init()` releases exactly what it took — the error path calls
  `release_audio_session()` before it frees the layout;
* an `--audiounit-skip-session-management` option (`.options_prefix =
  "audiounit"`), so a host that manages `AVAudioSession` itself can tell mpv to
  keep its hands off it entirely.

That last one matters to rn-media specifically: `packages/audio-session` exists
to own `AVAudioSession` — categories, interruptions, route changes — and two
owners is worse than either. The option lets the engine defer to it.

## Threading

`acquire_audio_session()` / `release_audio_session()` run on whichever thread
calls the AO's `init`/`uninit`, which is the core thread of each mpv instance —
so several threads genuinely can race here, which is why the counter is behind a
real mutex rather than an atomic. The mutex is held across the `AVAudioSession`
calls on purpose: those must not interleave between two cores. The render
callback never touches any of this.

The underflow branch (`audiounit_session_use_count > 0` else `MP_WARN`) is
deliberate — a mismatched release is a bug we want reported, not clamped
silently.

## Rebasing

Four anchors in `audio/out/ao_audiounit.m`:

1. `struct priv` — the two new members
2. `init()`'s session-configuration block (the four `[instance set...]` calls
   this patch replaces with `acquire_audio_session()`)
3. `init()`'s `coreaudio_error:` label — the release on the failure path
4. `uninit()`'s `setActive:NO` block
5. the `ao_driver` struct's tail, where `.options` / `.options_prefix` are added

If upstream ever grows its own session refcounting, drop this patch and keep
only the `skip-session-management` option.

## Marker

`audiounit_session_use_count` — the static counter's name. Nothing else in mpv
emits it.
