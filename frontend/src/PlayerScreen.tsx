import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BenchmarkTable } from "./benchmarks";
import { findLatestReferenceSwing } from "./comparison";
import type { ReferenceSwing } from "./comparison";
import { LINE_COLORS, drawOverlayLines, drawSkeleton } from "./draw";
import { FeedbackPanel } from "./FeedbackPanel";
import type { ReferenceStatus } from "./FeedbackPanel";
import { computeFeedback } from "./feedback";
import { computeAddressRefs, computeOverlayLines } from "./geometry";
import type { OverlayLine } from "./geometry";
import { LandmarkSmoother } from "./smoothing";
import type { AnalysisResponse } from "./types";

interface Props {
  videoUrl: string;
  analysis: AnalysisResponse;
  benchmarks: BenchmarkTable;
  onReset: () => void;
}

const SPEED_OPTIONS = [0.25, 0.5, 1] as const;

export function PlayerScreen({ videoUrl, analysis, benchmarks, onReset }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const smootherRef = useRef(new LandmarkSmoother());
  const { fps, frame_count, frames, view, handedness, width, height } = analysis;
  const aspect = width / height;

  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [lines, setLines] = useState<OverlayLine[]>([]);
  const [hideVideo, setHideVideo] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [reference, setReference] = useState<ReferenceSwing | null>(null);
  const [referenceStatus, setReferenceStatus] = useState<ReferenceStatus>("loading");

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = playbackRate;
  }, [playbackRate]);

  // Auto-picks the most recent matching-view/handedness reference swing from
  // the library (no manual picker) so the feedback panel can show a
  // normalized skeleton comparison alongside each scored phase.
  useEffect(() => {
    let cancelled = false;
    setReferenceStatus("loading");
    findLatestReferenceSwing(view, handedness)
      .then((result) => {
        if (cancelled) return;
        setReference(result);
        setReferenceStatus(result ? "loaded" : "unavailable");
      })
      .catch(() => {
        if (cancelled) return;
        setReference(null);
        setReferenceStatus("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [view, handedness]);

  // Fixed address-frame references (sway line, swing plane) computed once
  // from the raw landmarks.
  const addressRefs = useMemo(
    () => computeAddressRefs(frames, handedness, aspect),
    [frames, handedness, aspect],
  );

  const feedback = useMemo(() => computeFeedback(analysis, benchmarks), [analysis, benchmarks]);

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
      const overlay = computeOverlayLines(view, smoothed, handedness, aspect, addressRefs);
      drawSkeleton(ctx, smoothed, cssWidth, cssHeight);
      drawOverlayLines(ctx, overlay, cssWidth, cssHeight);
      setLines(overlay);
    },
    [frames, frameIndexAt, view, handedness, aspect, addressRefs],
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
      <div className="player-main">
        <div className="video-column">
          <div
            className={hideVideo ? "video-box hide-video" : "video-box"}
            style={{ aspectRatio: aspect }}
          >
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
            <div className="speed-group" role="radiogroup" aria-label="Playback speed">
              {SPEED_OPTIONS.map((rate) => (
                <button
                  key={rate}
                  type="button"
                  className={playbackRate === rate ? "toggle speed-btn selected" : "toggle speed-btn"}
                  aria-pressed={playbackRate === rate}
                  onClick={() => setPlaybackRate(rate)}
                >
                  {rate}x
                </button>
              ))}
            </div>
            <button
              type="button"
              className={hideVideo ? "toggle selected" : "toggle"}
              aria-pressed={hideVideo}
              onClick={() => setHideVideo((v) => !v)}
            >
              Skeleton only
            </button>
          </div>
        </div>

        <div className="side-panel">
          <aside className="readout-panel">
            <h2>{view === "face_on" ? "Face-on" : "Down-the-line"}</h2>
            {lines.map((line) => (
              <div key={line.id} className="readout-row">
                <span className="swatch" style={{ background: LINE_COLORS[line.id] }} />
                <span>{line.label}</span>
                <span className="value">
                  {line.angleDeg !== null ? `${line.angleDeg.toFixed(1)}°` : "—"}
                </span>
              </div>
            ))}
            {view === "down_the_line" && (
              <p className="readout-note">
                Plane is a body-only approximation — most accurate with the camera aligned to
                the target line
              </p>
            )}
          </aside>

          <FeedbackPanel
            result={feedback}
            analysis={analysis}
            currentIndex={currentIndex}
            reference={reference}
            referenceStatus={referenceStatus}
            onSeekToFrame={(frameIndex) => seekTo(frames[frameIndex].t)}
          />
        </div>
      </div>

      <p className="hint">Space: play/pause · ← →: step one frame</p>
      <button type="button" className="reset" onClick={onReset}>
        Analyze another video
      </button>
    </div>
  );
}
