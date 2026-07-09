import { ComparisonDiagram } from "./ComparisonDiagram";
import { mapUserFrameToReference } from "./comparison";
import type { ReferenceSwing } from "./comparison";
import { getCoachingTip } from "./coachingTips";
import { PHASE_LABELS, PHASE_ORDER, SCORED_PHASES } from "./feedback";
import type { FeedbackItem, FeedbackResult } from "./feedback";
import type { AnalysisResponse, View } from "./types";

export type ReferenceStatus = "loading" | "loaded" | "unavailable";

interface FeedbackPanelProps {
  result: FeedbackResult;
  analysis: AnalysisResponse;
  currentIndex: number;
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

/** Plain-English headline for a feedback row — the primary content a
 * beginner reads, with the raw number/range demoted to secondary detail. */
function tipFor(item: FeedbackItem, view: View): string {
  if (item.status === "undetected") return "We couldn't spot this moment in your swing.";
  if (item.status === "within") return `${item.metricLabel} looks good here — keep it up.`;
  return (
    getCoachingTip(view, item.phase, item.metric, item.status) ??
    `${item.metricLabel} is ${item.status} the target range here.`
  );
}

export function FeedbackPanel({
  result,
  analysis,
  currentIndex,
  reference,
  referenceStatus,
  onSeekToFrame,
}: FeedbackPanelProps) {
  const hasEmpirical = result.items.some((item) => item.source === "empirical");
  const userAspect = analysis.width / analysis.height;
  const referenceAspect = reference ? reference.analysis.width / reference.analysis.height : null;

  const userLandmarks = analysis.frames[currentIndex]?.landmarks ?? null;
  const referenceFrameIndex = reference
    ? mapUserFrameToReference(currentIndex, result.phases, reference.phases, reference.analysis.frame_count)
    : null;
  const referenceLandmarks =
    reference && referenceFrameIndex !== null ? reference.analysis.frames[referenceFrameIndex].landmarks : null;

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
            {referenceStatus === "loading" && "Loading a reference swing to compare against…"}
            {referenceStatus === "unavailable" &&
              "Add a matching-view reference swing to your library to see how this swing should look."}
            {referenceStatus === "loaded" && reference && referenceLandmarks &&
              `Synced to your ${reference.entry.filename} reference — play, scrub, or use the buttons above to pause at a key moment.`}
            {referenceStatus === "loaded" && reference && !referenceLandmarks &&
              "Reference not available at this moment in the swing."}
          </p>
        </div>
      )}

      {SCORED_PHASES.map((phase) => {
        const items = result.items.filter((item) => item.phase === phase);
        if (items.length === 0) return null;

        return (
          <div key={phase} className="feedback-group">
            <h3>{PHASE_LABELS[phase]}</h3>
            {items.map((item) => (
              <button
                key={item.metric}
                type="button"
                className="feedback-row"
                disabled={item.frameIndex === null}
                title={STATUS_LABEL[item.status]}
                onClick={() => item.frameIndex !== null && onSeekToFrame(item.frameIndex)}
              >
                <div className="feedback-row-main">
                  <span className={`feedback-dot feedback-dot-${item.status}`} />
                  <span className="feedback-tip">{tipFor(item, analysis.view)}</span>
                </div>
                <div className="feedback-row-detail">
                  <span>{item.metricLabel}</span>
                  {item.value !== null && <span>{item.value.toFixed(1)}°</span>}
                  {item.range && (
                    <span>
                      target {item.range.min.toFixed(0)}–{item.range.max.toFixed(0)}°
                    </span>
                  )}
                  {item.source && (
                    <span className={`feedback-source feedback-source-${item.source}`}>
                      {SOURCE_LABEL[item.source]}
                    </span>
                  )}
                </div>
              </button>
            ))}
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
