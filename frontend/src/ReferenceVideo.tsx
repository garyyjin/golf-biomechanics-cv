import { useCallback, useEffect, useMemo, useRef } from "react";
import { referenceSeekTime } from "./comparison";
import type { ReferenceSwing } from "./comparison";
import { computeAddressRefs } from "./geometry";
import { referenceSwingVideoUrl } from "./libraryApi";
import { createOverlayRenderState, renderOverlayFrame } from "./overlayRenderer";

interface Props {
  reference: ReferenceSwing;
  /** Reference frame aligned with the master video's current frame; null when the swings share no detected phases. */
  targetFrameIndex: number | null;
  hideVideo: boolean;
}

/**
 * The reference half of compare mode. Never plays on its own — the master
 * (user) video drives it by prop: each targetFrameIndex change seeks this
 * paused video to the phase-aligned moment and redraws its overlay. Seeks
 * are coalesced (at most one in flight, latest target wins) so a playing
 * master can't pile them up faster than the browser can decode.
 */
export function ReferenceVideo({ reference, targetFrameIndex, hideVideo }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererStateRef = useRef(createOverlayRenderState());
  const seekingRef = useRef(false);
  const pendingIndexRef = useRef<number | null>(null);
  const lastSoughtIndexRef = useRef<number | null>(null);
  const readyRef = useRef(false);
  const alignedRef = useRef(targetFrameIndex !== null);
  alignedRef.current = targetFrameIndex !== null;

  const { analysis } = reference;
  const { fps, frame_count, frames, view, handedness, width, height } = analysis;
  const aspect = width / height;

  const addressRefs = useMemo(
    () => computeAddressRefs(frames, handedness, aspect),
    [frames, handedness, aspect],
  );

  const drawCurrent = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!video || !canvas || !ctx) return;
    if (!alignedRef.current) {
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      return;
    }
    const index = Math.min(frame_count - 1, Math.max(0, Math.round(video.currentTime * fps)));
    renderOverlayFrame(
      ctx,
      canvas.clientWidth,
      canvas.clientHeight,
      index,
      frames,
      view,
      handedness,
      aspect,
      addressRefs,
      rendererStateRef.current,
    );
  }, [fps, frame_count, frames, view, handedness, aspect, addressRefs]);

  const issueSeek = useCallback(
    (index: number) => {
      const video = videoRef.current;
      if (!video || !readyRef.current) {
        pendingIndexRef.current = index;
        return;
      }
      if (index === lastSoughtIndexRef.current) return;
      if (seekingRef.current) {
        // Latest target wins; intermediate frames are dropped rather than
        // queued so seeks never pile up behind a slow decode.
        pendingIndexRef.current = index;
        return;
      }
      seekingRef.current = true;
      lastSoughtIndexRef.current = index;
      video.currentTime = referenceSeekTime(analysis, index);
    },
    [analysis],
  );

  useEffect(() => {
    if (targetFrameIndex !== null) issueSeek(targetFrameIndex);
    else drawCurrent(); // clears the overlay in the can't-align state
  }, [targetFrameIndex, issueSeek, drawCurrent]);

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
      drawCurrent();
    });
    observer.observe(video);
    return () => observer.disconnect();
  }, [drawCurrent]);

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
            if (pendingIndexRef.current === null && targetFrameIndex !== null) {
              pendingIndexRef.current = targetFrameIndex;
            }
            flushPending();
          }}
          onSeeked={() => {
            seekingRef.current = false;
            drawCurrent();
            flushPending();
          }}
        />
        <canvas ref={canvasRef} className="overlay" />
      </div>
      {targetFrameIndex === null && (
        <p className="video-slot-caption">
          Can't align these swings — no matching swing phases were detected.
        </p>
      )}
    </>
  );
}
