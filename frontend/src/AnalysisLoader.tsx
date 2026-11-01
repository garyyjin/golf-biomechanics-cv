import type { CSSProperties } from "react";
import type { AnalysisProgress } from "./api";

interface Props {
  progress: AnalysisProgress;
  /** Seconds left at the current rate, or null while it can't be estimated
   * yet (the upload, and the first moments of extraction before frames are
   * being finished). */
  etaSeconds: number | null;
}

const STAGE_TITLE: Record<AnalysisProgress["stage"], string> = {
  uploading: "Uploading video",
  analyzing: "Analyzing swing",
  saving: "Finishing up",
};

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * What the wait is for, in words. The percentage alone can't distinguish the
 * three very different waits — sending the file, a cold model load, a long
 * clip grinding frame by frame — and a bare "0%" through all of them is what
 * made the wait look frozen.
 */
function stageDetail(progress: AnalysisProgress): string {
  if (progress.stage === "uploading") {
    return progress.totalBytes
      ? `Sending ${megabytes(progress.totalBytes)} — ${megabytes(progress.uploadedBytes ?? 0)} sent.`
      : "Sending your video to the analyzer.";
  }
  if (progress.stage === "saving") {
    return "Pose extraction finished — building your report.";
  }
  if (!progress.framesTotal) {
    return "Loading the pose and clubhead models. The first analysis of a session takes a few extra seconds.";
  }
  return `Extracting pose landmarks — frame ${progress.framesDone} of ${progress.framesTotal}.`;
}

function etaText(seconds: number): string {
  if (seconds < 3) return "Almost there…";
  if (seconds < 60) return `About ${Math.round(seconds)} seconds left`;
  const minutes = seconds / 60;
  return `About ${minutes < 10 ? minutes.toFixed(1) : Math.round(minutes)} minutes left`;
}

/**
 * The analysis wait, as one readout: a dial counting 0-100, the stage, the
 * frame it's on, and how long is left.
 *
 * The percentage is the whole operation (upload included) and only ever moves
 * forwards, so the number behaves like a stopwatch rather than flickering
 * between stages. While the models load there are no frames to count yet, so
 * the dial shows a slow pulse instead of pretending to hold a position.
 */
export function AnalysisLoader({ progress, etaSeconds }: Props) {
  const percent = Math.min(100, Math.max(0, progress.percent));
  const waitingOnModels = progress.stage === "analyzing" && !progress.framesTotal;

  return (
    <div className="analysis-loader">
      <div
        className={waitingOnModels ? "analysis-dial is-waiting" : "analysis-dial"}
        style={{ "--dial-progress": `${percent}%` } as CSSProperties}
        role="progressbar"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${STAGE_TITLE[progress.stage]}, ${Math.round(percent)}%`}
      >
        <span className="analysis-dial-value">
          {Math.round(percent)}
          <span className="analysis-dial-unit">%</span>
        </span>
      </div>
      <div className="analysis-loader-body" aria-live="polite">
        <span className="analysis-loader-title">{STAGE_TITLE[progress.stage]}</span>
        <p className="hint analysis-loader-detail">{stageDetail(progress)}</p>
        {etaSeconds !== null && progress.stage === "analyzing" && (
          <p className="hint analysis-loader-eta">{etaText(etaSeconds)}</p>
        )}
      </div>
    </div>
  );
}
