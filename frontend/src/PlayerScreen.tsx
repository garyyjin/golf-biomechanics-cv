import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ANNOTATION_COLORS, ANNOTATION_TOOLS, useAnnotations } from "./annotations";
import type { AnnotationTool } from "./annotations";
import type { BenchmarkTable } from "./benchmarks";
import { fillClubGaps, hasClubTrack } from "./club";
import {
  anchorTimePairs,
  buildNaturalSync,
  loadReferenceSwing,
  matchingReferenceEntries,
  sharedPhaseAnchors,
} from "./comparison";
import type { ReferenceSwing, SyncPlan } from "./comparison";
import { CLUB_TRACER_COLOR, LINE_COLORS } from "./draw";
import { FeedbackPanel } from "./FeedbackPanel";
import type { ReferenceStatus } from "./FeedbackPanel";
import { computeFeedback } from "./feedback";
import { computeAddressRefs, findAddressFrame, isDownTheLineMisaligned } from "./geometry";
import type { OverlayLine } from "./geometry";
import { listReferenceSwings } from "./libraryApi";
import type { LibraryEntry } from "./libraryApi";
import { createOverlayRenderState, renderOverlayFrame } from "./overlayRenderer";
import { ReferenceVideo } from "./ReferenceVideo";
import { SwingScoreBadge } from "./SwingScoreBadge";
import { computeSwingScore } from "./swingScore";
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

  // The video-box's exact pixel size, fit within the frame that's left after
  // the annotation sidebar claims its column. Measured in JS rather than via
  // CSS aspect-ratio + flex-grow + max-height: when the aspect-derived size
  // is the one that ends up clamped by max-height, the flex-grown dimension
  // doesn't shrink back to match, silently breaking the aspect ratio (the
  // pose overlay canvas then scales landmarks against the wrong box).
  const videoFrameRef = useRef<HTMLDivElement>(null);
  const [videoBoxSize, setVideoBoxSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const frame = videoFrameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(() => {
      const rect = frame.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      let boxWidth = rect.width;
      let boxHeight = boxWidth / aspect;
      if (boxHeight > rect.height) {
        boxHeight = rect.height;
        boxWidth = boxHeight * aspect;
      }
      setVideoBoxSize({ width: boxWidth, height: boxHeight });
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [aspect]);

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
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [showClubPath, setShowClubPath] = useState(true);

  // Compare mode: both slots must resolve to the exact same height, or the
  // two swings visibly don't line up. Deriving each slot's width from its
  // OWN measured element (as a previous version of this did) races: the
  // primary slot's measurement depends on layout that its own resulting
  // width then changes, so the two slots could settle on different row
  // heights depending on observer callback order. Measuring the shared row
  // (.video-pair) once instead — its height comes only from ancestors
  // (nav/controls chrome), never from either slot's own content — gives a
  // single source of truth that both slots derive their width from.
  const videoPairRef = useRef<HTMLDivElement>(null);
  const [compareRowHeight, setCompareRowHeight] = useState<number | null>(null);
  const comparingNow = compareMode && referenceStatus !== "unavailable";

  useEffect(() => {
    if (!comparingNow) {
      setCompareRowHeight(null);
      return;
    }
    const pair = videoPairRef.current;
    if (!pair) return;
    const observer = new ResizeObserver(() => {
      const rowHeight = pair.getBoundingClientRect().height;
      if (rowHeight <= 0) return;
      setCompareRowHeight(rowHeight);
    });
    observer.observe(pair);
    return () => observer.disconnect();
  }, [comparingNow]);

  // Must match .annotation-sidebar's width and .video-stage's gap.
  const SIDEBAR_WIDTH = 58;
  const STAGE_GAP = 8;
  const referenceAspect = reference ? reference.analysis.width / reference.analysis.height : aspect;
  const primarySlotWidth =
    compareRowHeight != null ? SIDEBAR_WIDTH + STAGE_GAP + compareRowHeight * aspect : null;
  const referenceSlotWidth = compareRowHeight != null ? compareRowHeight * referenceAspect : null;

  const playerMainRef = useRef<HTMLDivElement>(null);
  const [sidePanelWidth, setSidePanelWidth] = useState<number | null>(null);
  const [resizingSidePanel, setResizingSidePanel] = useState(false);
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const onSidePanelResizeStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const panel = playerMainRef.current?.querySelector<HTMLElement>(".side-panel");
    const startWidth = panel?.getBoundingClientRect().width ?? sidePanelWidth ?? 420;
    resizeStateRef.current = { startX: e.clientX, startWidth };
    setResizingSidePanel(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [sidePanelWidth]);

  const onSidePanelResizeMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const state = resizeStateRef.current;
    if (!state) return;
    const containerWidth = playerMainRef.current?.getBoundingClientRect().width ?? Infinity;
    // Leave the video column at least 320px so dragging can't collapse it away.
    const maxWidth = Math.min(800, containerWidth - 320);
    const delta = e.clientX - state.startX;
    setSidePanelWidth(Math.min(maxWidth, Math.max(320, state.startWidth - delta)));
  }, []);

  const onSidePanelResizeEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    resizeStateRef.current = null;
    setResizingSidePanel(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const [controlsHeight, setControlsHeight] = useState<number | null>(null);
  const [resizingControls, setResizingControls] = useState(false);
  const controlsResizeStateRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const controlsRef = useRef<HTMLDivElement>(null);

  const onControlsResizeStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const startHeight = controlsRef.current?.getBoundingClientRect().height ?? controlsHeight ?? 55;
    controlsResizeStateRef.current = { startY: e.clientY, startHeight };
    setResizingControls(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [controlsHeight]);

  const onControlsResizeMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const state = controlsResizeStateRef.current;
    if (!state) return;
    // Dragging the handle up should grow the bar (it's pinned to the
    // bottom), so an upward (negative) pointer delta increases height.
    const delta = e.clientY - state.startY;
    setControlsHeight(Math.min(220, Math.max(55, state.startHeight - delta)));
  }, []);

  const onControlsResizeEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    controlsResizeStateRef.current = null;
    setResizingControls(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  // Below the mobile breakpoint the panes stack instead of sitting
  // side-by-side, so a dragged pixel size would otherwise pin a pane to the
  // wrong dimension (and fight the stacked layout's own sizing).
  useEffect(() => {
    function handleResize() {
      if (window.innerWidth <= 800) {
        setSidePanelWidth(null);
        setControlsHeight(null);
      }
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

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
  // when the analysis came from a backend with no clubhead.pt installed --
  // that's when the tracer doesn't render at all (see clubTracer below).
  const clubTrack = useMemo(() => fillClubGaps(frames), [frames]);
  const yoloAvailable = useMemo(() => hasClubTrack(clubTrack), [clubTrack]);

  const feedback = useMemo(() => computeFeedback(analysis, benchmarks), [analysis, benchmarks]);
  const swingScore = useMemo(() => computeSwingScore(feedback), [feedback]);

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
        yoloAvailable && showClubPath
          ? { yoloTrack: clubTrack, topIndex: feedback.phases.top, impactIndex: feedback.phases.impact }
          : undefined,
        showSkeleton,
      );
      setLines(overlay);
    },
    [
      frames,
      frameIndexAt,
      view,
      handedness,
      aspect,
      addressRefs,
      yoloAvailable,
      showClubPath,
      clubTrack,
      feedback.phases.top,
      feedback.phases.impact,
      showSkeleton,
    ],
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

  const annotations = useAnnotations(currentIndex, videoRef);

  const comparing = compareMode && referenceStatus !== "unavailable";

  return (
    <div className="player">
      <div className="player-main" ref={playerMainRef}>
        <div className={comparing ? "video-column comparing" : "video-column"}>
          <div className={comparing ? "video-pair" : "video-single"} ref={videoPairRef}>
            <div
              className="video-slot video-slot-primary"
              style={
                {
                  "--video-aspect": aspect,
                  ...(primarySlotWidth ? { flexBasis: primarySlotWidth, width: primarySlotWidth } : {}),
                } as React.CSSProperties
              }
            >
              {comparing && (
                <div className="video-slot-header">
                  <span className="video-slot-label">Your swing</span>
                </div>
              )}
              <div className="video-stage">
                <div className="annotation-sidebar">
                  <button
                    type="button"
                    className={annotations.active ? "icon-button selected" : "icon-button"}
                    aria-pressed={annotations.active}
                    aria-label={annotations.active ? "Done drawing" : "Draw"}
                    title="Draw on the paused frame to mark up your swing — marks stay attached to this frame"
                    onClick={() => annotations.setActive(!annotations.active)}
                  >
                    <PencilIcon />
                  </button>
                  {annotations.active && (
                    <>
                      <div className="annotation-tool-group" role="radiogroup" aria-label="Annotation tool">
                        {ANNOTATION_TOOLS.map((t) => (
                          <button
                            key={t.value}
                            type="button"
                            className={annotations.tool === t.value ? "icon-button selected" : "icon-button"}
                            aria-pressed={annotations.tool === t.value}
                            aria-label={t.label}
                            title={t.label}
                            onClick={() => annotations.setTool(t.value)}
                          >
                            <ToolIcon tool={t.value} />
                          </button>
                        ))}
                      </div>
                      <div className="annotation-swatches" role="radiogroup" aria-label="Annotation color">
                        {ANNOTATION_COLORS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            className={annotations.color === c ? "annotation-swatch selected" : "annotation-swatch"}
                            style={{ background: c }}
                            aria-pressed={annotations.color === c}
                            aria-label={`Color ${c}`}
                            onClick={() => annotations.setColor(c)}
                          />
                        ))}
                      </div>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="Undo"
                        title="Undo"
                        disabled={!annotations.hasStrokesOnFrame}
                        onClick={annotations.undo}
                      >
                        <UndoIcon />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="Clear"
                        title="Clear"
                        disabled={!annotations.hasStrokesOnFrame}
                        onClick={annotations.clearFrame}
                      >
                        <ClearIcon />
                      </button>
                    </>
                  )}
                </div>
                <div className="video-frame" ref={videoFrameRef}>
                  <div
                    className={hideVideo ? "video-box hide-video" : "video-box"}
                    style={{
                      aspectRatio: aspect,
                      "--video-aspect": aspect,
                      ...(videoBoxSize
                        ? { width: videoBoxSize.width, height: videoBoxSize.height }
                        : {}),
                    } as React.CSSProperties}
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
                    <canvas
                      ref={annotations.canvasRef}
                      className={annotations.active ? "annotation-canvas active" : "annotation-canvas"}
                      onPointerDown={annotations.onPointerDown}
                      onPointerMove={annotations.onPointerMove}
                      onPointerUp={annotations.onPointerUp}
                      onPointerLeave={annotations.onPointerUp}
                    />
                  </div>
                </div>
              </div>
            </div>

            {comparing && (
              <div
                className="video-slot"
                style={
                  {
                    "--video-aspect": referenceAspect,
                    ...(referenceSlotWidth
                      ? { flexBasis: referenceSlotWidth, width: referenceSlotWidth }
                      : {}),
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
        </div>

        <div
          className={resizingSidePanel ? "resize-handle dragging" : "resize-handle"}
          onPointerDown={onSidePanelResizeStart}
          onPointerMove={onSidePanelResizeMove}
          onPointerUp={onSidePanelResizeEnd}
          onDoubleClick={() => setSidePanelWidth(null)}
          title="Drag to resize · double-click to reset"
        />

        <div
          className="side-panel"
          style={
            sidePanelWidth !== null
              ? { flex: `0 0 ${sidePanelWidth}px`, width: sidePanelWidth, maxWidth: sidePanelWidth }
              : undefined
          }
        >
          <SwingScoreBadge score={swingScore} />

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
            {yoloAvailable && showClubPath && (
              <div className="readout-row">
                <span className="swatch" style={{ background: `rgb(${CLUB_TRACER_COLOR.join(", ")})` }} />
                <span>Club path (red: takeback, green: downswing; approx. where undetected)</span>
              </div>
            )}
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

      <div
        className={resizingControls ? "controls-resize-handle dragging" : "controls-resize-handle"}
        onPointerDown={onControlsResizeStart}
        onPointerMove={onControlsResizeMove}
        onPointerUp={onControlsResizeEnd}
        onDoubleClick={() => setControlsHeight(null)}
        title="Drag to resize · double-click to reset"
      />

      <div
        className="controls"
        ref={controlsRef}
        style={controlsHeight !== null ? { height: controlsHeight } : undefined}
      >
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
        <div className="toggle-group" aria-label="View options">
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
            className={showSkeleton ? "toggle selected" : "toggle"}
            aria-pressed={showSkeleton}
            title="Show or hide the pose skeleton (bones and joints) overlay"
            onClick={() => setShowSkeleton((v) => !v)}
          >
            Skeleton
          </button>
          <button
            type="button"
            className={showClubPath ? "toggle selected" : "toggle"}
            aria-pressed={showClubPath}
            disabled={!yoloAvailable}
            title={
              yoloAvailable
                ? "Show or hide the club swing-path tracer"
                : "This swing has no YOLO clubhead detections -- train and install backend/app/models/clubhead.pt"
            }
            onClick={() => setShowClubPath((v) => !v)}
          >
            Swing path
          </button>
        </div>
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
      </div>

      <p className="hint">Space: play/pause · ← →: step one frame</p>
      <button type="button" className="reset" onClick={onReset}>
        Analyze another video
      </button>
    </div>
  );
}

const ICON_PROPS = {
  viewBox: "0 0 24 24",
  width: 18,
  height: 18,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function PencilIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function PenIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 20c2-6 4-10 6-12" />
      <path d="M10 8l3-3 3 3-3 3z" />
      <path d="M17 4l3 3" />
    </svg>
  );
}

function LineIcon() {
  return (
    <svg {...ICON_PROPS}>
      <line x1="5" y1="19" x2="19" y2="5" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg {...ICON_PROPS}>
      <line x1="5" y1="19" x2="19" y2="5" />
      <polyline points="9 5 19 5 19 15" />
    </svg>
  );
}

function CircleToolIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="8" />
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}

function ToolIcon({ tool }: { tool: AnnotationTool }) {
  switch (tool) {
    case "pen":
      return <PenIcon />;
    case "line":
      return <LineIcon />;
    case "arrow":
      return <ArrowIcon />;
    case "circle":
      return <CircleToolIcon />;
  }
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
