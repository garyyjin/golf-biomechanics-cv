import { useCallback, useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import {
  CATCHUP_SEEK_THRESHOLD,
  correctedPlaybackRate,
  idealTimeForPlan,
  referenceSeekTime,
  syncTargetForPlan,
} from "./comparison";
import type { ReferenceSwing, SyncPlan } from "./comparison";
import { computeAddressRefs } from "./geometry";
import { referenceSwingVideoUrl } from "./libraryApi";
import { createOverlayRenderState, renderOverlayFrame } from "./overlayRenderer";

interface Props {
  reference: ReferenceSwing;
  /** How to follow the master: phase-stretched or natural tempo. A phase plan with no anchors = can't align. */
  plan: SyncPlan;
  /** Master video's current media time — the per-frame sync input. */
  masterTime: number;
  playing: boolean;
  /** True when the master stopped by finishing its course — file end, or swing end in regular-speed mode — not a user pause. */
  masterDone: boolean;
  masterVideoRef: RefObject<HTMLVideoElement | null>;
  hideVideo: boolean;
}

/**
 * The reference half of compare mode, driven by the master (user) video in
 * one of three modes. Master paused: this video is paused and seeked to the
 * phase-aligned frame (seeks coalesced, latest target wins). Master playing
 * inside the shared phase range: this video PLAYS — every frame decoded, no
 * skipping — at a per-segment playbackRate that makes each phase span the
 * same wall-clock time as the master's, with a gentle proportional rate
 * nudge correcting drift (never a seek in steady state). Master playing
 * outside the range: held frozen on the boundary anchor frame.
 */
export function ReferenceVideo({
  reference,
  plan,
  masterTime,
  playing,
  masterDone,
  masterVideoRef,
  hideVideo,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererStateRef = useRef(createOverlayRenderState());
  const seekingRef = useRef(false);
  const pendingIndexRef = useRef<number | null>(null);
  const lastSoughtIndexRef = useRef<number | null>(null);
  const readyRef = useRef(false);
  // Read by the frame-callback loop, which must see the latest values
  // without re-subscribing per master frame.
  const playModeRef = useRef<{ baseRate: number } | null>(null);
  const planRef = useRef<SyncPlan>(plan);
  planRef.current = plan;

  const cannotAlign = plan.kind === "phase" && plan.anchors.length === 0;

  const { analysis } = reference;
  const { fps, frame_count, frames, view, handedness, width, height } = analysis;
  const aspect = width / height;

  const addressRefs = useMemo(
    () => computeAddressRefs(frames, handedness, aspect),
    [frames, handedness, aspect],
  );

  const indexForTime = useCallback(
    (t: number) => Math.min(frame_count - 1, Math.max(0, Math.round(t * fps))),
    [fps, frame_count],
  );

  const drawAt = useCallback(
    (mediaTime: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const p = planRef.current;
      if (p.kind === "phase" && p.anchors.length === 0) {
        ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
        return;
      }
      renderOverlayFrame(
        ctx,
        canvas.clientWidth,
        canvas.clientHeight,
        indexForTime(mediaTime),
        frames,
        view,
        handedness,
        aspect,
        addressRefs,
        rendererStateRef.current,
      );
    },
    [indexForTime, frames, view, handedness, aspect, addressRefs],
  );

  const issueSeek = useCallback(
    (index: number) => {
      const video = videoRef.current;
      if (!video || !readyRef.current) {
        pendingIndexRef.current = index;
        return;
      }
      if (index === lastSoughtIndexRef.current) return;
      if (seekingRef.current) {
        // Latest target wins; a paused video only ever needs to land on the
        // most recent frame, so intermediate targets are dropped.
        pendingIndexRef.current = index;
        return;
      }
      seekingRef.current = true;
      lastSoughtIndexRef.current = index;
      video.currentTime = referenceSeekTime(analysis, index);
    },
    [analysis],
  );

  // The seek dedupe cache is only meaningful within one paused/hold stretch;
  // after playback has moved the video it would wrongly skip a realign seek.
  const resetSeekState = useCallback(() => {
    lastSoughtIndexRef.current = null;
    pendingIndexRef.current = null;
  }, []);

  // Mode controller: reacts to every master time/play-state change.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (cannotAlign) {
      playModeRef.current = null;
      if (!video.paused) video.pause();
      drawAt(video.currentTime); // clears the overlay in the can't-align state
      return;
    }

    if (!playing) {
      // Regular-speed comparison: the master finishing its swing doesn't
      // stop a still-swinging reference — each pauses at its own swing end,
      // so let it run out (the frame-callback loop stops it at refEndTime).
      if (
        plan.kind === "natural" &&
        masterDone &&
        !video.paused &&
        video.currentTime < plan.refEndTime - 0.01
      ) {
        playModeRef.current = null; // master time is frozen; steering against it would drag the rate down
        video.playbackRate = masterVideoRef.current?.playbackRate ?? 1;
        return;
      }
      if (playModeRef.current) {
        playModeRef.current = null;
        resetSeekState();
      }
      if (!video.paused) video.pause();
      issueSeek(indexForTime(idealTimeForPlan(masterTime, plan)));
      return;
    }

    const target = syncTargetForPlan(
      masterTime,
      plan,
      masterVideoRef.current?.playbackRate ?? 1,
    );
    if (target.mode === "hold") {
      if (playModeRef.current) {
        playModeRef.current = null;
        resetSeekState();
      }
      if (!video.paused) video.pause();
      issueSeek(indexForTime(target.refTime));
    } else {
      // Keep baseRate fresh across segment/speed changes; the frame-callback
      // loop applies it with drift correction.
      playModeRef.current = { baseRate: target.baseRate };
      if (video.paused) {
        // Entering play mode: one alignment seek, then continuous playback.
        resetSeekState();
        issueSeek(indexForTime(target.refTime));
        video.playbackRate = correctedPlaybackRate(target.baseRate, 0);
        void video.play();
      }
    }
  }, [
    playing,
    masterTime,
    plan,
    masterDone,
    cannotAlign,
    masterVideoRef,
    drawAt,
    indexForTime,
    issueSeek,
    resetSeekState,
  ]);

  // Frame-callback loop: draws the overlay for every presented reference
  // frame and, while play-synced, steers playbackRate toward zero alignment
  // error. Only a jump larger than the catch-up threshold (a master scrub)
  // is allowed to seek.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let handle = 0;
    let cancelled = false;
    const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
      if (cancelled) return;
      drawAt(metadata.mediaTime);
      // Regular-speed comparison ends at the reference's own swing end. This
      // lives here rather than in the mode controller because in the
      // let-it-run state (master already done) the master's clock is frozen
      // and no controller ticks arrive.
      const p = planRef.current;
      if (p.kind === "natural" && metadata.mediaTime >= p.refEndTime && !video.paused) {
        video.pause();
        handle = video.requestVideoFrameCallback(onFrame);
        return;
      }
      const playMode = playModeRef.current;
      const master = masterVideoRef.current;
      if (playMode && master && !video.paused) {
        const ideal = idealTimeForPlan(master.currentTime, planRef.current);
        const error = ideal - metadata.mediaTime;
        if (Math.abs(error) > CATCHUP_SEEK_THRESHOLD) {
          video.currentTime = referenceSeekTime(analysis, indexForTime(ideal));
        } else {
          video.playbackRate = correctedPlaybackRate(playMode.baseRate, error);
        }
      }
      handle = video.requestVideoFrameCallback(onFrame);
    };
    handle = video.requestVideoFrameCallback(onFrame);
    return () => {
      cancelled = true;
      video.cancelVideoFrameCallback(handle);
    };
  }, [drawAt, analysis, indexForTime, masterVideoRef]);

  // Canvas backing store tracks the video's displayed size at device pixel
  // ratio, same as the master video's overlay.
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const observer = new ResizeObserver(() => {
      const rect = video.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawAt(video.currentTime);
    });
    observer.observe(video);
    return () => observer.disconnect();
  }, [drawAt]);

  const flushPending = useCallback(() => {
    const next = pendingIndexRef.current;
    pendingIndexRef.current = null;
    if (next !== null) issueSeek(next);
  }, [issueSeek]);

  return (
    <>
      <div
        className={hideVideo ? "video-box hide-video" : "video-box"}
        style={{ aspectRatio: aspect, "--video-aspect": aspect } as React.CSSProperties}
      >
        <video
          src={referenceSwingVideoUrl(reference.entry.id)}
          ref={videoRef}
          playsInline
          muted
          preload="auto"
          onLoadedMetadata={() => {
            readyRef.current = true;
            flushPending();
          }}
          onSeeked={(e) => {
            seekingRef.current = false;
            // Covers paused seeks; during playback the frame callback draws.
            drawAt(e.currentTarget.currentTime);
            flushPending();
          }}
        />
        <canvas ref={canvasRef} className="overlay" />
      </div>
      {cannotAlign && (
        <p className="video-slot-caption">
          Can't align these swings — no matching swing phases were detected.
        </p>
      )}
    </>
  );
}
