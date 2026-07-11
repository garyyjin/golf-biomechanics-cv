import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BenchmarkTable } from "./benchmarks";
import { fillClubGaps, hasClubTrack } from "./club";
import type { ClubDetector } from "./club";
import {
  anchorTimePairs,
  buildNaturalSync,
  loadReferenceSwing,
  matchingReferenceEntries,
  sharedPhaseAnchors,
} from "./comparison";
import type { ReferenceSwing, SyncPlan } from "./comparison";
import { LINE_COLORS } from "./draw";
import { FeedbackPanel } from "./FeedbackPanel";
import type { ReferenceStatus } from "./FeedbackPanel";
import { computeFeedback } from "./feedback";
import { computeAddressRefs, findAddressFrame, isDownTheLineMisaligned } from "./geometry";
import type { OverlayLine } from "./geometry";
import { listReferenceSwings } from "./libraryApi";
import type { LibraryEntry } from "./libraryApi";
import { createOverlayRenderState, renderOverlayFrame } from "./overlayRenderer";
import { ReferenceVideo } from "./ReferenceVideo";
import { computeTempoScore, describeTempoRatio } from "./tempo";
import type { TempoScore, TempoSegment } from "./tempo";
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
  const rendererStateRef = useRef(createOverlayRenderState());
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
  const [referenceEntries, setReferenceEntries] = useState<LibraryEntry[]>([]);
  const [selectedReferenceId, setSelectedReferenceId] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [naturalSpeed, setNaturalSpeed] = useState(false);
  const [showTempo, setShowTempo] = useState(false);
  const [masterEnded, setMasterEnded] = useState(false);
  const [clubDetector, setClubDetector] = useState<ClubDetector>("hough");

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = playbackRate;
  }, [playbackRate]);

  // One shared reference selection drives everything reference-based: the
  // side-by-side compare video, the feedback panel's normalized skeleton
  // comparison, and its captions. Defaults to the most recent matching
  // view/handedness entry (the pre-picker auto-selection policy).
  useEffect(() => {
    let cancelled = false;
    setReferenceStatus("loading");
    listReferenceSwings()
      .then((entries) => {
        if (cancelled) return;
        const matches = matchingReferenceEntries(entries, view, handedness);
        setReferenceEntries(matches);
        if (matches.length === 0) {
          setReference(null);
          setReferenceStatus("unavailable");
        } else {
          setSelectedReferenceId(matches[0].id);
        }
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

  useEffect(() => {
    const entry = referenceEntries.find((e) => e.id === selectedReferenceId);
    if (!entry) return;
    let cancelled = false;
    setReferenceStatus("loading");
    loadReferenceSwing(entry)
      .then((result) => {
        if (cancelled) return;
        setReference(result);
        setReferenceStatus("loaded");
      })
      .catch(() => {
        if (cancelled) return;
        setReference(null);
        setReferenceStatus("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedReferenceId, referenceEntries]);

  // Fixed address-frame references (sway line, swing plane) computed once
  // from the raw landmarks.
  const addressRefs = useMemo(
    () => computeAddressRefs(frames, handedness, aspect),
    [frames, handedness, aspect],
  );

  // YOLO clubhead detections, with short misses bridged. Empty of detections
  // when the analysis came from a backend with no clubhead.pt installed —
  // that's what disables the YOLO detector option below.
  const clubTrack = useMemo(() => fillClubGaps(frames), [frames]);
  const yoloAvailable = useMemo(() => hasClubTrack(clubTrack), [clubTrack]);

  const feedback = useMemo(() => computeFeedback(analysis, benchmarks), [analysis, benchmarks]);

  // Down-the-line footage is most accurate when the camera sits directly on
  // the target line; a camera off to the side reveals stance width on
  // screen that a well-aligned shot wouldn't show.
  const alignmentWarning = useMemo(() => {
    if (view !== "down_the_line") return false;
    const address = findAddressFrame(frames);
    return address ? isDownTheLineMisaligned(address.landmarks, aspect) : false;
  }, [view, frames, aspect]);

  const frameIndexAt = useCallback(
    (mediaTime: number) =>
      Math.min(frame_count - 1, Math.max(0, Math.round(mediaTime * fps))),
    [fps, frame_count],
  );

  // A "yolo" selection carried over from a previous video that did have
  // detections would otherwise leave this one with no tracer at all.
  const activeDetector: ClubDetector = yoloAvailable ? clubDetector : "hough";

  // The trail is a rolling window of the last 18 points; without this it would
  // splice the old detector's points onto the new one's for a beat after a switch.
  useEffect(() => {
    rendererStateRef.current.clubTrail = [];
  }, [activeDetector]);

  const drawAt = useCallback(
    (mediaTime: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const index = frameIndexAt(mediaTime);
      const overlay = renderOverlayFrame(
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
        activeDetector,
        clubTrack,
      );
      setLines(overlay);
    },
    [frames, frameIndexAt, view, handedness, aspect, addressRefs, activeDetector, clubTrack],
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

  // Media-time anchor pairs at the phases detected on both swings — the
  // alignment map for the side-by-side compare video. The per-frame sync
  // input is the `time` state itself: it fires from the frame-callback loop,
  // onTimeUpdate, and onSeeked, so playback, scrubbing, stepping, and
  // phase-chip seeks all flow through.
  const timeAnchors = useMemo(
    () =>
      reference
        ? anchorTimePairs(
            sharedPhaseAnchors(feedback.phases, reference.phases),
            frames,
            reference.analysis.frames,
          )
        : [],
    [reference, feedback.phases, frames],
  );

  // How much the phase-aligned sync must modify the reference's speed over
  // the backswing and downswing — pure function of the two swings' phase
  // timings, so it holds regardless of the current playback mode.
  const tempoScore = useMemo(
    () =>
      reference
        ? computeTempoScore(feedback.phases, reference.phases, frames, reference.analysis.frames)
        : null,
    [reference, feedback.phases, frames],
  );

  const naturalSync = useMemo(
    () =>
      naturalSpeed && reference
        ? buildNaturalSync(feedback.phases, reference.phases, frames, reference.analysis.frames)
        : null,
    [naturalSpeed, reference, feedback.phases, frames],
  );

  const syncPlan: SyncPlan = useMemo(
    () => (naturalSync ? naturalSync.plan : { kind: "phase", anchors: timeAnchors }),
    [naturalSync, timeAnchors],
  );

  // Regular-speed comparison plays the swing, not the whole clip: the master
  // pauses at its own swing end (the reference finishes independently).
  useEffect(() => {
    if (playing && naturalSync && time >= naturalSync.masterEndTime) {
      videoRef.current?.pause();
    }
  }, [playing, time, naturalSync]);

  // "The master stopped because it finished its course" — file end, or swing
  // end in regular-speed mode — as opposed to a user pause. Derived from
  // `time`, so scrubbing back clears it.
  const masterDone =
    masterEnded || (naturalSync !== null && time >= naturalSync.masterEndTime - 1e-3);

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
    if (video.paused) {
      // Regular-speed comparison replays both swings from just before their
      // takeaways so the swings start at the same moment (the reference
      // restarts via its sync plan).
      if (compareMode && naturalSync) video.currentTime = naturalSync.masterStartTime;
      void video.play();
    } else {
      video.pause();
    }
  }, [compareMode, naturalSync]);

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

  const comparing = compareMode && referenceStatus !== "unavailable";

  return (
    <div className="player">
      <div className="player-main">
        <div className={comparing ? "video-column comparing" : "video-column"}>
          <div className={comparing ? "video-pair" : "video-single"}>
            <div
              className="video-slot"
              style={{ "--video-aspect": aspect } as React.CSSProperties}
            >
              {comparing && (
                <div className="video-slot-header">
                  <span className="video-slot-label">Your swing</span>
                </div>
              )}
              <div
                className={hideVideo ? "video-box hide-video" : "video-box"}
                style={{ aspectRatio: aspect, "--video-aspect": aspect } as React.CSSProperties}
              >
                <video
                  ref={videoRef}
                  src={videoUrl}
                  playsInline
                  onPlay={() => {
                    setPlaying(true);
                    setMasterEnded(false);
                  }}
                  onPause={() => setPlaying(false)}
                  onEnded={() => {
                    setPlaying(false);
                    setMasterEnded(true);
                  }}
                  onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                  onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                  onSeeked={(e) => {
                    // Covers paused scrubs in browsers that don't fire a video frame
                    // callback for them.
                    drawAt(e.currentTarget.currentTime);
                    setTime(e.currentTarget.currentTime);
                    setMasterEnded(e.currentTarget.ended);
                  }}
                />
                <canvas ref={canvasRef} className="overlay" />
              </div>
            </div>

            {comparing && (
              <div
                className="video-slot"
                style={
                  {
                    "--video-aspect": reference
                      ? reference.analysis.width / reference.analysis.height
                      : aspect,
                  } as React.CSSProperties
                }
              >
                <div className="video-slot-header">
                  <span className="video-slot-label">Reference</span>
                  <div className="video-slot-tools">
                    <button
                      type="button"
                      className={naturalSpeed ? "toggle selected" : "toggle"}
                      aria-pressed={naturalSpeed}
                      title="Play the reference at its own tempo, started together with your swing, instead of stretching it to match your phases"
                      onClick={() => setNaturalSpeed((v) => !v)}
                    >
                      Regular speed
                    </button>
                    <button
                      type="button"
                      className={showTempo ? "toggle selected" : "toggle"}
                      aria-pressed={showTempo}
                      title="Score how closely your tempo matches the reference — 10/10 means its speed never had to be modified"
                      onClick={() => setShowTempo((v) => !v)}
                    >
                      Tempo score
                    </button>
                    <select
                      className="reference-picker"
                      aria-label="Reference swing"
                      value={selectedReferenceId ?? ""}
                      onChange={(e) => setSelectedReferenceId(e.target.value)}
                    >
                      {referenceEntries.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.filename} · {new Date(entry.createdAt).toLocaleDateString()}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {reference && referenceStatus === "loaded" ? (
                  <ReferenceVideo
                    key={reference.entry.id}
                    reference={reference}
                    plan={syncPlan}
                    masterTime={time}
                    playing={playing}
                    masterDone={masterDone}
                    masterVideoRef={videoRef}
                    hideVideo={hideVideo}
                  />
                ) : (
                  <div
                    className="video-box video-placeholder"
                    style={{ aspectRatio: aspect, "--video-aspect": aspect } as React.CSSProperties}
                  >
                    <p>Loading reference…</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {comparing && showTempo && tempoScore && <TempoCard tempo={tempoScore} />}

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
            <button
              type="button"
              className={compareMode ? "toggle selected" : "toggle"}
              aria-pressed={compareMode}
              disabled={referenceStatus === "unavailable"}
              title={
                referenceStatus === "unavailable"
                  ? "Add a matching-view reference swing to your library to compare"
                  : undefined
              }
              onClick={() => setCompareMode((v) => !v)}
            >
              Compare
            </button>
            <button
              type="button"
              className={activeDetector === "yolo" ? "toggle selected" : "toggle"}
              aria-pressed={activeDetector === "yolo"}
              disabled={!yoloAvailable}
              title={
                yoloAvailable
                  ? "Switch the club tracer between the Hough-line and YOLO detectors"
                  : "This swing has no YOLO clubhead detections — train and install backend/app/models/clubhead.pt"
              }
              onClick={() => setClubDetector((d) => (d === "yolo" ? "hough" : "yolo"))}
            >
              Club: {activeDetector === "yolo" ? "YOLO" : "Hough"}
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
            <div className="readout-row">
              <span className="swatch" style={{ background: "rgb(255, 199, 44)" }} />
              <span>Club (detected, or approx. when unclear)</span>
            </div>
            {view === "down_the_line" && (
              <p className="readout-note">
                Plane is a body-only approximation — most accurate with the camera aligned to
                the target line
              </p>
            )}
            {view === "down_the_line" && alignmentWarning && (
              <p className="readout-note readout-warning">
                Your feet look spread apart on screen for a down-the-line shot — the camera may
                not be lined up with the target line, which can skew these readings. Try
                positioning the camera directly behind the ball, in line with the target.
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

function TempoRow({ label, segment }: { label: string; segment: TempoSegment | null }) {
  return (
    <div className="tempo-row">
      <span>{label}</span>
      {segment ? (
        <span className="tempo-detail">
          {segment.score.toFixed(1)}/10 · {describeTempoRatio(segment.ratio)}
        </span>
      ) : (
        <span className="tempo-detail">not detected</span>
      )}
    </div>
  );
}

function TempoCard({ tempo }: { tempo: TempoScore }) {
  return (
    <div className="tempo-card">
      <div className="tempo-card-header">
        <h3>Tempo score</h3>
        {tempo.overall !== null ? (
          <span className="tempo-overall">{tempo.overall.toFixed(1)} / 10</span>
        ) : (
          <span className="tempo-detail">Swing phases couldn't be detected on both videos</span>
        )}
      </div>
      <TempoRow label="Backswing" segment={tempo.backswing} />
      <TempoRow label="Downswing" segment={tempo.downswing} />
    </div>
  );
}
