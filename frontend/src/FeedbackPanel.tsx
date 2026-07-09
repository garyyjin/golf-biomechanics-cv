import { ComparisonDiagram } from "./ComparisonDiagram";
import type { ReferenceSwing } from "./comparison";
import { PHASE_LABELS, PHASE_ORDER, SCORED_PHASES } from "./feedback";
import type { FeedbackItem, FeedbackResult } from "./feedback";
import type { AnalysisResponse } from "./types";

export type ReferenceStatus = "loading" | "loaded" | "unavailable";

interface FeedbackPanelProps {
  result: FeedbackResult;
  analysis: AnalysisResponse;
  reference: ReferenceSwing | null;
  referenceStatus: ReferenceStatus;
  onSeekToFrame: (frameIndex: number) => void;
}

const STATUS_LABEL: Record<FeedbackItem["status"], string> = {
  below: "Below range",
  within: "Within range",
  above: "Above range",
  undetected: "Not detected",
};

const SOURCE_LABEL: Record<NonNullable<FeedbackItem["source"]>, string> = {
  empirical: "Library",
  published: "Default",
};

export function FeedbackPanel({ result, analysis, reference, referenceStatus, onSeekToFrame }: FeedbackPanelProps) {
  const hasEmpirical = result.items.some((item) => item.source === "empirical");
  const userAspect = analysis.width / analysis.height;
  const referenceAspect = reference ? reference.analysis.width / reference.analysis.height : null;

  return (
    <details className="feedback-panel" open>
      <summary>Swing feedback</summary>

      <div className="phase-chips">
        {PHASE_ORDER.map((phase) => {
          const frameIndex = result.phases[phase];
          return (
            <button
              key={phase}
              type="button"
              className="phase-chip"
              disabled={frameIndex === null}
              title={frameIndex === null ? "Not detected" : undefined}
              onClick={() => frameIndex !== null && onSeekToFrame(frameIndex)}
            >
              {PHASE_LABELS[phase]}
            </button>
          );
        })}
      </div>

      {SCORED_PHASES.map((phase) => {
        const items = result.items.filter((item) => item.phase === phase);
        if (items.length === 0) return null;

        const userFrameIndex = result.phases[phase];
        const userLandmarks = userFrameIndex !== null ? analysis.frames[userFrameIndex].landmarks : null;
        const referenceFrameIndex = reference ? reference.phases[phase] : null;
        const referenceLandmarks =
          reference && referenceFrameIndex !== null ? reference.analysis.frames[referenceFrameIndex].landmarks : null;

        return (
          <div key={phase} className="feedback-group">
            <h3>{PHASE_LABELS[phase]}</h3>
            {items.map((item) => (
              <button
                key={item.metric}
                type="button"
                className="feedback-row"
                disabled={item.frameIndex === null}
                onClick={() => item.frameIndex !== null && onSeekToFrame(item.frameIndex)}
              >
                <span className="feedback-metric">{item.metricLabel}</span>
                <span className="feedback-value">
                  {item.value !== null ? `${item.value.toFixed(1)}°` : "—"}
                </span>
                <span className={`feedback-status feedback-status-${item.status}`}>
                  {STATUS_LABEL[item.status]}
                </span>
                <span className="feedback-range">
                  {item.range ? `target ${item.range.min.toFixed(0)}–${item.range.max.toFixed(0)}°` : ""}
                </span>
                {item.source && (
                  <span className={`feedback-source feedback-source-${item.source}`}>
                    {SOURCE_LABEL[item.source]}
                  </span>
                )}
              </button>
            ))}

            {userLandmarks && (
              <div className="comparison">
                <ComparisonDiagram
                  userLandmarks={userLandmarks}
                  userAspect={userAspect}
                  referenceLandmarks={referenceLandmarks}
                  referenceAspect={referenceAspect}
                />
                <div className="comparison-legend">
                  <span className="comparison-legend-item">
                    <span className="comparison-swatch comparison-swatch-user" /> You
                  </span>
                  {referenceLandmarks && (
                    <span className="comparison-legend-item">
                      <span className="comparison-swatch comparison-swatch-reference" /> Reference
                    </span>
                  )}
                </div>
                <p className="comparison-caption">
                  {referenceStatus === "loading" &&
                    "Loading a reference swing to compare against…"}
                  {referenceStatus === "unavailable" &&
                    "Add a matching-view reference swing to your library to see how this phase should look."}
                  {referenceStatus === "loaded" && reference && referenceLandmarks &&
                    `Compared against your ${reference.entry.filename} reference.`}
                  {referenceStatus === "loaded" && reference && !referenceLandmarks &&
                    "Your reference swing doesn't have this phase detected."}
                </p>
              </div>
            )}
          </div>
        );
      })}

      <p className="feedback-caption">
        {hasEmpirical
          ? "Includes calibrated ranges from your reference swings."
          : "Using default published reference ranges — add swings to your reference library to personalize."}
      </p>
    </details>
  );
}
