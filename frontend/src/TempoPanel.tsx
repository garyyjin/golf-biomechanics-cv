import { TOUR_TEMPO_RATIO, describeSwingTempo, formatTempoRatio } from "./tempo";
import type { SwingTempo } from "./tempo";

interface TempoPanelProps {
  tempo: SwingTempo;
}

/**
 * The swing's own backswing:downswing tempo against the 3:1 tour standard.
 *
 * Distinct from the "Tempo score" card in the comparison column, which rates
 * agreement with a chosen reference swing and therefore says nothing until
 * the library has one. This reads off the user's own phases alone, so it's
 * populated on the very first upload.
 */
export function TempoPanel({ tempo }: TempoPanelProps) {
  return (
    <details className="tempo-panel" open>
      <summary>Swing tempo</summary>
      {tempo.ratio !== null && tempo.score !== null ? (
        <>
          <div className="stats-row">
            <span className="stats-label">Backswing : downswing</span>
            <span className="stats-value">{formatTempoRatio(tempo.ratio)}</span>
          </div>
          <div className="stats-row">
            <span className="stats-label">Against the {TOUR_TEMPO_RATIO}:1 standard</span>
            <span className="stats-value">{tempo.score.toFixed(1)} / 10</span>
          </div>
          <div className="stats-row">
            <span className="stats-label">Backswing · downswing</span>
            <span className="stats-value">
              {tempo.backswingSeconds!.toFixed(2)}s · {tempo.downswingSeconds!.toFixed(2)}s
            </span>
          </div>
          <p className="stats-caption">
            Your tempo is {describeSwingTempo(tempo.ratio)}. Tour players cluster near a 3:1
            backswing-to-downswing ratio regardless of how fast they swing overall, so the ratio
            is the target here — not the raw durations.
          </p>
        </>
      ) : (
        <p className="stats-caption">
          Couldn't time your backswing and downswing — that needs the takeaway, top, and impact
          all detected in this clip. Try a clearer angle with the full swing in frame.
        </p>
      )}
    </details>
  );
}
