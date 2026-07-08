import { useCallback, useEffect, useRef, useState } from "react";
import { drawSkeleton } from "./draw";
import { LandmarkSmoother } from "./smoothing";
import type { AnalysisResponse } from "./types";

interface Props {
  videoUrl: string;
  analysis: AnalysisResponse;
  onReset: () => void;
}

export function PlayerScreen({ videoUrl, analysis, onReset }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const smootherRef = useRef(new LandmarkSmoother());
  const { fps, frame_count, frames } = analysis;

  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);

  const frameIndexAt = useCallback(
    (mediaTime: number) =>
      Math.min(frame_count - 1, Math.max(0, Math.round(mediaTime * fps))),
    [fps, frame_count],
  );

  const drawAt = useCallback(
    (mediaTime: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const cssWidth = canvas.clientWidth;
      const cssHeight = canvas.clientHeight;
      const index = frameIndexAt(mediaTime);
      const smoothed = smootherRef.current.apply(frames[index].landmarks, index);
      drawSkeleton(ctx, smoothed, cssWidth, cssHeight);
    },
    [frames, frameIndexAt],
  );

  // requestVideoFrameCallback loop: draws whenever the video presents a frame
  // (playback and most seeks).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let handle = 0;
    let cancelled = false;
    const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
      if (cancelled) return;
      drawAt(metadata.mediaTime);
      setTime(metadata.mediaTime);
      handle = video.requestVideoFrameCallback(onFrame);
    };
    handle = video.requestVideoFrameCallback(onFrame);
    return () => {
      cancelled = true;
      video.cancelVideoFrameCallback(handle);
    };
  }, [drawAt]);

  // Canvas backing store tracks the video's displayed size (window resizes,
  // layout changes) at device pixel ratio; redraw after each resize.
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

  const seekTo = useCallback(
    (t: number) => {
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = Math.min(Math.max(t, 0), video.duration || t);
    },
    [],
  );

  const stepFrame = useCallback(
    (delta: 1 | -1) => {
      const video = videoRef.current;
      if (!video) return;
      video.pause();
      const target = Math.min(
        frame_count - 1,
        Math.max(0, frameIndexAt(video.currentTime) + delta),
      );
      // Land a quarter-frame in: (target + 0.5) would sit exactly on the
      // rounding boundary, making the next step's index computation flip up
      // and turn backward steps into no-ops.
      seekTo((target + 0.25) / fps);
    },
    [fps, frame_count, frameIndexAt, seekTo],
  );

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        stepFrame(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        stepFrame(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, stepFrame]);

  const currentIndex = frameIndexAt(time);

  return (
    <div className="player">
      <div className="video-box">
        <video
          ref={videoRef}
          src={videoUrl}
          playsInline
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onSeeked={(e) => {
            // Covers paused scrubs in browsers that don't fire a video frame
            // callback for them.
            drawAt(e.currentTarget.currentTime);
            setTime(e.currentTarget.currentTime);
          }}
        />
        <canvas ref={canvasRef} className="overlay" />
      </div>

      <div className="controls">
        <button type="button" onClick={togglePlay}>
          {playing ? "Pause" : "Play"}
        </button>
        <input
          type="range"
          className="scrub"
          min={0}
          max={duration || 0}
          step={1 / fps}
          value={Math.min(time, duration || time)}
          onChange={(e) => seekTo(Number(e.target.value))}
          aria-label="Scrub"
        />
        <span className="frame-label">
          frame {currentIndex + 1}/{frame_count}
        </span>
      </div>

      <p className="hint">Space: play/pause · ← →: step one frame</p>
      <button type="button" className="reset" onClick={onReset}>
        Analyze another video
      </button>
    </div>
  );
}
