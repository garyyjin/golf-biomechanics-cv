import { useState } from "react";
import { analyzeVideo, pollAnalysisJob } from "./api";
import { FileField } from "./FileField";
import type { AnalysisResponse, Handedness, Quality, View } from "./types";

interface Props {
  onAnalyzed: (file: File, analysis: AnalysisResponse) => void;
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

export function UploadScreen({ onAnalyzed }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [handedness, setHandedness] = useState<Handedness | null>(null);
  const [quality, setQuality] = useState<Quality | null>(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const ready =
    file !== null && view !== null && handedness !== null && quality !== null && !processing;

  async function submit() {
    if (!file || !view || !handedness || !quality) return;
    setProcessing(true);
    setProgress(0);
    setError(null);
    setJobId(null);
    try {
      const analysis = await analyzeVideo(file, view, handedness, quality, setProgress, setJobId);
      onAnalyzed(file, analysis);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
      setProcessing(false);
    }
  }

  /** Resumes tracking the same job — used after a poll failure so a dropped
   * connection doesn't force re-uploading a video that's already most of
   * the way through server-side processing. */
  async function retry() {
    if (!file || !jobId) return;
    setProcessing(true);
    setError(null);
    try {
      const analysis = await pollAnalysisJob(jobId, setProgress);
      onAnalyzed(file, analysis);
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
          setJobId(null);
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
        {processing ? "Analyzing…" : "Analyze swing"}
      </button>
      {processing && (
        <>
          <div className="progress-bar" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
            <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
            <span className="progress-bar-label">{Math.round(progress)}%</span>
          </div>
          <p className="hint">Extracting pose landmarks — this can take a moment.</p>
        </>
      )}
      {error && (
        <div className="error-row">
          <p className="error">{error}</p>
          {jobId && (
            <button type="button" className="reset retry-button" onClick={retry}>
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}
