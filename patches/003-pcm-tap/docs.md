# 003-pcm-tap

**rn-media: a PCM tap on the client API (properties `pcm-tap`, `pcm-tap-frame`)**

Ported verbatim from `libmpv-android-audio-build@rn-media-hls buildscripts/patches/mpv/004.rn_media_pcm_tap.patch` (byte-identical to the darwin fork's `patches/mpv-rn-media-pcm-tap.patch`). This file is the canonical record; the fork
copy is generated from it (see docs/DECISIONS.md, D2).

```text
WHY THIS EXISTS
    libmpv's client API has no way to see the samples it is playing, on any
    platform, in any release.  rn-media needs them for its audio visualizer,
    and the alternative — Android's `android.media.audiofx.Visualizer` — is
    Android-only, capped at ~20 Hz and 8-bit, and requires RECORD_AUDIO from
    every consuming app.  Tapping mpv itself is the only route that is the
    same code on Android and iOS, needs no permission, and gives full-scale
    float samples at a rate we choose.

PROVENANCE
    The idea, the tap point and the property name `pcm-tap-frame` follow
    ales-drnz/libmpv-scripts (BSD-3-Clause), the patch set behind the Flutter
    package `mpv_audio_kit` — the only shipped precedent for reading PCM out
    of libmpv.  This implementation is written from scratch — originally
    against mpv 0.35.1/0.36.0, now maintained against 0.41.0 — and differs
    from it deliberately in three ways:
      * the tap hangs off `mpv_global`, so several mpv cores in one process
        each tap their own audio.  Theirs is a process-wide singleton whose
        own comments call the multi-core behaviour "benign but wrong-looking";
      * the ring is allocated on arm and freed on disarm, and is sized by the
        client (`pcm-tap` is the window, in samples per channel) instead of a
        fixed 256 KiB static plus a 256 KiB conversion scratch;
      * samples are converted straight into the ring, so there is no scratch
        buffer and no chunk-size ceiling.

APPLIES TO
    mpv 0.41.0.  Previously applied unchanged to 0.35.1 and 0.36.0; see
    "0.35 -> 0.41 REBASE NOTES" below for what had to move.

WHAT IT ADDS
    `pcm-tap`        int, read/write, default 0.  The number of samples per
                     channel to retain.  0 disarms the tap and frees the ring;
                     any other value is clamped to [64, 65536].  While
                     disarmed the audio thread's tap path is a single relaxed
                     atomic load per device chunk, and nothing is allocated.
    `pcm-tap-frame`  node, read-only.  A MAP of the newest retained window:
                       sample_rate  int64   Hz
                       channels     int64   interleaving factor of `samples`
                       frames       int64   samples per channel
                       pts_us       int64   microseconds when the newest chunk
                                            was tapped, i.e. mp_time_ns()/1000
                       seq          int64   monotonic chunk counter; an
                                            unchanged value means no new audio
                                            reached the device (paused, EOF)
                       samples      byte array, interleaved float32 in host
                                    byte order, frames*channels*4 bytes
                     M_PROPERTY_UNAVAILABLE while disarmed or before any
                     audio has reached the device.

    No new exported symbol: the whole feature is reachable through
    mpv_get_property/mpv_set_property, so libmpv's ABI is untouched and the
    export set of the shipped binary is byte-identical to the unpatched build.
    Presence in a shipped artifact is proved by the string
    "[rn-media] pcm-tap window=%d" (player/command.c), which nothing else in
    the tree emits.

WHERE IT TAPS
    The last statement of ao_post_process_data() (audio/out/ao.c), which is
    the funnel every AO's data passes through in audio/out/buffer.c's
    read_buffer() — push and pull drivers alike.  That is after the filter
    chain and after mpv's software gain, so the tap reports what is audible,
    and it is the closest point to the device that still sees PCM.

THREADING
    Writes run on the audio device's own thread (the AudioTrack feeder on
    Android, the AudioUnit render callback on iOS).  That thread never blocks:
    it takes the tap lock with mp_mutex_trylock and drops the chunk on
    contention, which costs at most one frame of a visualizer.  The reader
    (the property getter, on the core thread) holds the lock for one memcpy.
    mp_mutex_trylock is a #define onto pthread_mutex_trylock in
    osdep/threads-posix.h, so it keeps pthread return semantics: 0 means the
    lock was acquired, and any non-zero result must drop the chunk.

REBASING
    Four files, no build-system files.  mpv dropped waf in 0.37, so from
    0.37 on there is only the meson build, and this patch is independent of
    it either way.  The anchors to re-check after a version bump are:
      audio/out/ao.c    ao_post_process_data()'s body.  Unchanged from 0.35.1
                        through 0.41.0; the tap call is its last statement.
      audio/out/ao.h    the ao_print_devices() declaration at end of file.
                        Its signature is unchanged 0.35.1 -> 0.41.0 (it has
                        taken `struct ao *playback_ao` since before 0.35.1);
                        it is only an anchor, nothing calls it here.
      common/global.h   struct mpv_global.  0.41 added
                        `struct demux_packet_pool *packet_pool;` as its last
                        member, so the tap pointer now follows that line.
      player/command.c  mp_property_audio_params() — the two handlers go
                        immediately above it — and the {"audio-out-params",
                        ...} property-table entry, which the two new rows
                        follow.  Note 0.41 renamed the neighbouring
                        property_switch_track() to mp_property_switch_track(),
                        which only matters as diff context.
    If ao_post_process_data() is ever renamed or split, the tap moves with it;
    the only requirement is that it sees interleaved-or-planar PCM in
    ao->format together with ao->channels/ao->samplerate.
    Keep the player/command.c edits inside the audio-property region: our
    other patches touch include/mpv/client.h + player/client.c, and
    meson.build + sub/* + the libass-version property getter (command.c
    line ~4542, far from the audio rows).

0.35 -> 0.41 REBASE NOTES
    Behaviour is unchanged.  Every edit below is an idiom substitution
    forced by an upstream API change; the clamping, the trylock-and-drop
    write path, the one-relaxed-load-while-disarmed cost, the per-core
    ownership and the node field names/units are all identical.

    All four upstream changes below landed in 0.37.0 and are unchanged
    through 0.41.0 (verified against the v0.36.0/v0.37.0/v0.38.0 tags).

    Threading (0.37 replaced raw pthreads with its own wrappers,
    osdep/threads.h -> osdep/threads-posix.h):
      pthread_mutex_t          -> mp_mutex
      pthread_mutex_init(m,    -> mp_mutex_init(m)          [no attr arg]
                         NULL)
      pthread_mutex_lock       -> mp_mutex_lock
      pthread_mutex_trylock    -> mp_mutex_trylock
      pthread_mutex_unlock     -> mp_mutex_unlock
      audio/out/ao.c now includes "osdep/threads.h".
      All four mp_mutex_* names are plain #defines onto the pthread calls,
      so return values and semantics carry over exactly.  mp_mutex_init()
      is the one real function: it selects PTHREAD_MUTEX_ERRORCHECK in
      debug builds and PTHREAD_MUTEX_DEFAULT otherwise, and DEFAULT is what
      a NULL attr gave before — so release builds are unchanged and debug
      builds only gain misuse detection we do not trip.

    Atomics (0.37 deleted osdep/atomic.h; C11 stdatomic is now mandatory —
    meson.build sets c_std=c11, and audio/out/internal.h declares
    `_Atomic float gain`):
      #include "osdep/atomic.h"  -> #include <stdatomic.h>
      global->pcm_tap: void *    -> _Atomic(struct mp_pcm_tap *)
      __atomic_load_n(..., __ATOMIC_ACQUIRE)
                                 -> atomic_load_explicit(...,
                                        memory_order_acquire)
      __atomic_store_n(..., __ATOMIC_RELEASE)
                                 -> atomic_store_explicit(...,
                                        memory_order_release)
    The acquire/release pair that publishes the tap pointer is the same
    ordering, now expressed in C11 rather than in GCC builtins (which
    appear nowhere in the 0.41 tree).  The pointer no longer has to be a
    bare void*: _Atomic is a C11 keyword, not a <stdatomic.h> typedef, so
    common/global.h still needs no new #include, and no C++ translation
    unit includes that header.  `armed` keeps its exact orderings: relaxed
    on the audio thread, seq_cst on the core thread, and a plain (seq_cst)
    atomic_store to publish arm/disarm — atomic_store on ao->gain in the
    same file is the house precedent.  It is still left false by
    talloc_zero rather than atomic_init, which is what mpv itself does
    (atomic_init and ATOMIC_VAR_INIT appear nowhere in 0.41).

    Time (0.37 moved the clock from microseconds to nanoseconds;
    osdep/timer.h at v0.41.0 declares only mp_time_ns()):
      mp_time_us()             -> mp_time_ns() / 1000
    `pts_us` stays in MICROseconds, so the property's unit and the
    struct mp_pcm_tap_frame field are unchanged; only the source clock and
    the divisor are new.  Integer division is deliberate — the
    MP_TIME_NS_TO_US() macro in osdep/timer.h yields a double.

    Unchanged and re-verified against v0.41.0, no substitution needed:
      af_fmt_is_pcm / af_fmt_is_planar / af_fmt_from_planar  audio/format.h
      AF_FORMAT_U8/S16/S32/S64/FLOAT/DOUBLE                  audio/format.h
      MP_NUM_CHANNELS (64)                                   audio/chmap.h
      MPMIN / MPCLAMP                                        common/common.h
      talloc_array / talloc_zero / talloc_memdup / TA_FREEP   ta/ta_talloc.h
      M_PROPERTY_OK / _UNAVAILABLE / _NOT_IMPLEMENTED,
        M_PROPERTY_GET_TYPE / _GET / _SET                 options/m_property.h
      struct m_option { double min, max; },
        CONF_TYPE_INT, CONF_TYPE_NODE                      options/m_option.h
      node_init / node_map_add / node_map_add_int64             misc/node.h
      mpv_byte_array, MPV_FORMAT_NODE_MAP, MPV_FORMAT_BYTE_ARRAY
                                                          include/mpv/client.h
      struct ao { global, format, channels, samplerate }   audio/out/internal.h
      the property-table row format, still {"name", handler}   player/command.c
```

## Canonical form: anchored transforms

This is the one patch in the series expressed as **anchored transforms** rather
than a unified diff, and it is the proof of the format (docs/DECISIONS.md, D1).
It is the right shape for it: four files, no deletions, no build-system files,
and every edit is an insertion at a named landmark. A diff would pin all seven
edits to line numbers in `player/command.c` — a 4 500-line file that upstream
churns constantly — for no benefit, since none of the edits cares where in the
file it lands.

The seven transforms map one-to-one onto the "REBASING" anchors above:

| # | File | Anchor | Fragment |
| --- | --- | --- | --- |
| 1 | `audio/out/ao.c` | `#include <assert.h>` | inline |
| 2 | `audio/out/ao.c` | `#include "common/global.h"` | inline |
| 3 | `audio/out/ao.c` | the whole body of `ao_post_process_data()` | `ao.c-tap-and-post-process` |
| 4 | `audio/out/ao.h` | the `#endif /* MPLAYER_AUDIO_OUT_H */` guard | `ao.h-public-api` |
| 5 | `common/global.h` | `struct demux_packet_pool *packet_pool;` + `};` | `global.h-pcm-tap-member` |
| 6 | `player/command.c` | `static int mp_property_audio_params(...)` | `command.c-property-handlers` |
| 7 | `player/command.c` | `{"audio-out-params", mp_property_audio_out_params},` | `command.c-property-table` |

Transform 3 deliberately anchors on the ENTIRE `ao_post_process_data()` body
rather than on a line near it: the tap block is inserted before the function and
the tap call is appended inside it, so making both one transform means a
rewritten function body is one clear failure rather than two half-failures.

The `fragments/*.txt` files hold the exact pristine and patched text. They were
not typed: they were extracted byte-for-byte from a pristine mpv 0.41.0 tree and
from the tree the original unified diff produces, and `tests/equivalence.test.js`
re-proves on every CI run that applying these transforms to a pristine 0.41.0
tree yields a tree **byte-identical** to applying
`tests/fixtures/003-pcm-tap.reference.diff` — which is the exact file both forks
ship today.

### Marker

`[rn-media] pcm-tap window=` — the `MP_VERBOSE` format string in
`player/command.c`. It is the same string `rn-media-release.sh` greps for in the
stripped `libmpv.so` before it will package a jar, so the workshop's
"is this patch applied" question and the release script's "did this patch reach
the artifact" question are answered by one string.
