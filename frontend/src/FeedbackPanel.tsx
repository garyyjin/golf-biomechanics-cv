import { PHASE_LABELS, PHASE_ORDER, SCORED_PHASES } from "./feedback";
import type { FeedbackItem, FeedbackResult } from "./feedback";

interface FeedbackPanelProps {
  result: FeedbackResult;
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

export function FeedbackPanel({ result, onSeekToFrame }: FeedbackPanelProps) {
  const hasEmpirical = result.items.some((item) => item.source === "empirical");

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
