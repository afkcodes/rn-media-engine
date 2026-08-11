# 001-lavc-set-java-vm

**rn-media: re-export av_jni_set_java_vm as mpv_lavc_set_java_vm**

Ported verbatim from `libmpv-android-audio-build@rn-media-hls buildscripts/patches/mpv/002.lavc_set_java_vm.patch`. This file is the canonical record; the fork
copy is generated from it (see docs/DECISIONS.md, D2).

```text
WHY THIS EXISTS
    mpv's Android audio output (audio/out/ao_audiotrack.c) reaches the JVM
    through misc/jni.c, whose mp_jni_get_env() calls av_jni_get_java_vm()
    (misc/jni.c:52 in 0.41.0).  That global is set by av_jni_set_java_vm(),
    which lives in the ffmpeg we link *statically* into libmpv.so — so the
    symbol is not exported and no consumer can call it.  Without it the
    AudioTrack AO cannot attach a JNIEnv and there is no audio at all.

    This patch adds one exported wrapper so the consumer's own JNI_OnLoad
    can hand mpv the JavaVM.  rn-media calls it from
    packages/player/android/src/main/cpp/cpp-adapter.cpp.

PROVENANCE
    Originally media-kit's `002.lavc_set_java_vm.patch` (against mpv 0.35.1).
    Rebased here onto 0.41.0; the change in substance is unchanged.

    Not adopted: ales-drnz/libmpv-scripts avoids the patch entirely by
    linking an android_jni_bridge.o with its own JNI_OnLoad into libmpv.so.
    That only works when the app calls System.loadLibrary("mpv") directly —
    the Android loader does not run JNI_OnLoad for a library pulled in as a
    transitive DT_NEEDED, which is exactly how rn-media links libmpv.  So
    the exported wrapper stays.

WHAT CHANGED IN THE 0.35.1 -> 0.41.0 REBASE
    * libmpv/client.h moved to include/mpv/client.h (mpv 0.38).
    * libmpv/mpv.def is GONE (mpv 0.37 dropped the .def export list).
      Exports are now driven by meson's gnu_symbol_visibility: 'hidden'
      plus the MPV_EXPORT attribute in the public header, so the
      declaration below is the whole export mechanism — the old mpv.def
      hunk is deliberately not carried forward.
    * player/client.c's mpv_wakeup() body moved from pthread_mutex_* to
      mpv's mp_mutex_* wrappers; the anchor was re-taken on the new body.

REBASING
    Re-check three anchors:
      1. `MPV_EXPORT void mpv_wakeup(mpv_handle *ctx);` in include/mpv/client.h
      2. the body of `void mpv_wakeup(mpv_handle *ctx)` in player/client.c
      3. that misc/jni.c still obtains the VM via av_jni_get_java_vm() — if
         upstream ever gains a real client-API entry point for this, delete
         this patch instead of rebasing it.
    Prove it reached the shipped .so with:  nm -D libmpv.so | grep lavc
```
