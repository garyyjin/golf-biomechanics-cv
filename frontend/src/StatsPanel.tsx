import { ASSUMED_CLUB_LENGTH_INCHES } from "./stats";
import type { SwingStats } from "./stats";

interface StatsPanelProps {
  stats: SwingStats;
}

/**
 * Clubhead speed is measured from the tracer's per-frame positions, scaled
 * by an assumed club length (see stats.ts) -- everything else here is a
 * further derived estimate, not a measurement, and the caption below says
 * so explicitly rather than presenting mph/yardage as precise numbers a
 * launch monitor would give.
 */
export function StatsPanel({ stats }: StatsPanelProps) {
  const hasStats = stats.clubheadSpeedMph !== null;

  return (
    <details className="stats-panel" open>
      <summary>Swing stats</summary>
      {hasStats ? (
        <>
          <div className="stats-row">
            <span className="stats-label">Clubhead speed</span>
            <span className="stats-value">{stats.clubheadSpeedMph!.toFixed(0)} mph</span>
          </div>
          <div className="stats-row">
            <span className="stats-label">Est. ball speed</span>
            <span className="stats-value">{stats.ballSpeedMph!.toFixed(0)} mph</span>
          </div>
          <div className="stats-row">
            <span className="stats-label">Est. carry distance</span>
            <span className="stats-value">
              {stats.estCarryYards !== null ? `${stats.estCarryYards.toFixed(0)} yd` : "—"}
            </span>
          </div>
        </>
      ) : (
        <p className="stats-caption">
          Not enough tracking data to estimate speed for this swing — needs the clubhead tracked at
          address and in the frames right around impact.
        </p>
      )}
      <p className="stats-caption">
        Clubhead speed is measured from tracking, assuming a {ASSUMED_CLUB_LENGTH_INCHES}in club (there's
        no way to know your actual club from video). Ball speed and carry distance are rough estimates
        derived from clubhead speed alone — they assume a solid, center-face strike and ignore spin and
        drag entirely, so treat them as directional, not exact. A real launch monitor measures these
        directly and will be far more accurate.
      </p>
    </details>
  );
}
