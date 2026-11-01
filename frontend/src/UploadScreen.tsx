import { useRef, useState } from "react";
import { AnalysisLoader } from "./AnalysisLoader";
import { analyzeVideo, pollAnalysisJob, UPLOAD_SHARE } from "./api";
import type { AnalysisJobHandle, AnalysisProgress } from "./api";
import { FileField } from "./FileField";
import type { AnalysisResponse, Handedness, Quality, View } from "./types";

interface Props {
  onAnalyzed: (file: File, analysis: AnalysisResponse, swingId: string) => void;
}

const VIEW_OPTIONS: { value: View; label: string }[] = [
  { value: "face_on", label: "Face-on" },
  { value: "down_the_line", label: "Down-the-line" },
];

const HANDEDNESS_OPTIONS: { value: Handedness; label: string }[] = [
  { value: "right", label: "Right" },
  { value: "left", label: "Left" },
];

const QUALITY_OPTIONS: { value: Quality; label: string }[] = [
  { value: "fast", label: "Fast" },
  { value: "accurate", label: "Accurate" },
];

const PROCESSING_LABEL: Record<AnalysisProgress["stage"], string> = {
  uploading: "Uploading…",
  analyzing: "Analyzing…",
  saving: "Finishing…",
};

/**
 * Seconds left, from how fast frames are actually being finished.
 *
 * Measured against the previous report rather than the run's start: extraction
 * speeds up once the models are warm and slows again through the dense model
 * passes, so a rate taken from the beginning would keep quoting a number that
 * stopped being true. The estimate is smoothed so it doesn't jitter on the
 * frame to frame noise of a single poll interval.
 */
function useFrameRateEta() {
  const last = useRef<{ at: number; frames: number } | null>(null);
  const smoothed = useRef<number | null>(null);

  function reset() {
    last.current = null;
    smoothed.current = null;
  }

  /** Returns the updated estimate; call with the newest progress report. */
  function update(progress: AnalysisProgress): number | null {
    const done = progress.framesDone ?? 0;
    const total = progress.framesTotal ?? 0;
    // Not extracting, or still loading models: no rate to measure yet.
    if (progress.stage !== "analyzing" || !total || !done) {
      return smoothed.current;
    }

    const now = performance.now();
    const previous = last.current;
    if (previous && done > previous.frames) {
      const secondsPerFrame = (now - previous.at) / 1000 / (done - previous.frames);
      const raw = (total - done) * secondsPerFrame;
      smoothed.current = smoothed.current === null ? raw : smoothed.current * 0.6 + raw * 0.4;
    }
    last.current = { at: now, frames: done };
    return smoothed.current;
  }

  return { update, reset };
}

export function UploadScreen({ onAnalyzed }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [view, setView] = useState<View | null>(null);
  // Right-handed and the accurate model are the defaults: most golfers are
  // right-handed, and accuracy is the reason to run a swing through this at
  // all. The camera view has no sensible default — it changes which angles
  // are measured — so it stays an explicit choice.
  const [handedness, setHandedness] = useState<Handedness>("right");
  const [quality, setQuality] = useState<Quality>("accurate");
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<AnalysisProgress>({ percent: 0, stage: "uploading" });
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<AnalysisJobHandle | null>(null);
  const eta = useFrameRateEta();

  const ready = file !== null && view !== null && !processing;

  /** Every progress report from the API funnels through here, so the bar and
   * the remaining-time estimate can never disagree about where the run is. */
  function reportProgress(next: AnalysisProgress) {
    setProgress(next);
    if (next.stage === "uploading") {
      eta.reset();
      setEtaSeconds(null);
      return;
    }
    setEtaSeconds(next.stage === "analyzing" ? eta.update(next) : null);
  }

  async function submit() {
    if (!file || !view || !handedness || !quality) return;
    setProcessing(true);
    eta.reset();
    setEtaSeconds(null);
    setProgress({ percent: 0, stage: "uploading" });
    setError(null);
    setJob(null);
    try {
      const { analysis, swingId } = await analyzeVideo(
        file,
        view,
        handedness,
        quality,
        reportProgress,
        setJob,
      );
      onAnalyzed(file, analysis, swingId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
      setProcessing(false);
    }
  }

  /** Resumes tracking the same job — used after a poll failure so a dropped
   * connection doesn't force re-uploading a video that's already most of
   * the way through server-side processing. */
  async function retry() {
    if (!file || !job) return;
    setProcessing(true);
    setError(null);
    eta.reset();
    setEtaSeconds(null);
    setProgress({ percent: UPLOAD_SHARE, stage: "analyzing" });
    try {
      const analysis = await pollAnalysisJob(job.jobId, reportProgress);
      onAnalyzed(file, analysis, job.swingId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
      setProcessing(false);
    }
  }

  return (
    <div className="upload">
      <h1>Analyze your swing</h1>
      <p className="hint upload-subhead">
        Upload a swing video to get pose-based biomechanics feedback, phase-by-phase.
      </p>

      <FileField
        label="Swing video (mp4, mov or webm)"
        file={file}
        accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm"
        disabled={processing}
        onChange={(f) => {
          setFile(f);
          setJob(null);
        }}
      />

      <div className="field">
        <span>Camera view</span>
        <div className="toggle-group" role="radiogroup" aria-label="Camera view">
          {VIEW_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={view === opt.value ? "toggle selected" : "toggle"}
              aria-pressed={view === opt.value}
              disabled={processing}
              onClick={() => setView(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span>Handedness</span>
        <div className="toggle-group" role="radiogroup" aria-label="Handedness">
          {HANDEDNESS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={handedness === opt.value ? "toggle selected" : "toggle"}
              aria-pressed={handedness === opt.value}
              disabled={processing}
              onClick={() => setHandedness(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span>Analysis quality</span>
        <div className="toggle-group" role="radiogroup" aria-label="Analysis quality">
          {QUALITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={quality === opt.value ? "toggle selected" : "toggle"}
              aria-pressed={quality === opt.value}
              disabled={processing}
              onClick={() => setQuality(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <button type="button" className="submit" disabled={!ready} onClick={submit}>
        {processing ? PROCESSING_LABEL[progress.stage] : "Analyze swing"}
      </button>
      {processing && <AnalysisLoader progress={progress} etaSeconds={etaSeconds} />}
      {error && (
        <div className="error-row">
          <p className="error">{error}</p>
          {job && (
            <button type="button" className="reset retry-button" onClick={retry}>
              Retry
            </button>
          )}
        </div>
      )}

      <section className="upload-tips" aria-label="How to film your swing">
        <h2 className="upload-tips-title">Film it right</h2>
        <ul>
          <li>
            <span className="upload-tip-index">01</span>
            <span>Whole body in frame from head to feet, with room above your head and in
            front of the ball.</span>
          </li>
          <li>
            <span className="upload-tip-index">02</span>
            <span>Face-on: camera at chest height, square to your chest. Down-the-line:
            directly behind the ball, on the target line.</span>
          </li>
          <li>
            <span className="upload-tip-index">03</span>
            <span>30fps or higher on a steady mount, sun behind the camera. A tripod beats a
            handed phone every time.</span>
          </li>
        </ul>
      </section>
    </div>
  );
}
