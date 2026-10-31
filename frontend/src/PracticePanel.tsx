import type { PracticeFocus } from "./drills";

interface PracticePanelProps {
  focuses: PracticeFocus[];
  onSeekToFrame: (frameIndex: number) => void;
}

/**
 * A short, concrete plan built from this swing's own flagged metrics: at most
 * three faults, each with a drill to fix it. The diagnoses are already in the
 * feedback list; this is the answer to "so what do I do about it", which is
 * otherwise the part that needs a lesson.
 */
export function PracticePanel({ focuses, onSeekToFrame }: PracticePanelProps) {
  if (focuses.length === 0) return null;

  return (
    <details className="practice-panel" open>
      <summary>Practice plan</summary>
      <p className="practice-intro">
        Work on these in your next session — one drill at a time, at half speed before adding a
        ball.
      </p>
      {focuses.map(({ item, drill }) => (
        <div className="practice-focus" key={item.metric}>
          <div className="practice-head">
            <span className="practice-metric">{item.metricLabel}</span>
            <span className="practice-phase">{item.phaseLabel}</span>
          </div>
          <p className="practice-name">{drill.name}</p>
          <p className="practice-cue">{drill.cue}</p>
          <ol className="practice-steps">
            {drill.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {item.frameIndex !== null && (
            <button
              type="button"
              className="practice-seek"
              onClick={() => onSeekToFrame(item.frameIndex!)}
            >
              View this moment
            </button>
          )}
        </div>
      ))}
    </details>
  );
}
