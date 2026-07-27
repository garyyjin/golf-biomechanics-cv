import { CLUB_LABELS, CLUB_LENGTH_INCHES } from "./stats";
import type { SwingStats } from "./stats";
import type { ClubType } from "./types";

/** Which real-world reference calibrated this swing's numbers, in plain
 * language -- see CalibrationSource's doc comment in stats.ts for the tier
 * order (ball size, then club length, then body proportion). */
function calibrationCaption(stats: SwingStats, club: ClubType): string {
  switch (stats.calibrationSource) {
    case "ball":
      return "Clubhead speed is measured from tracking, calibrated against the ball's own size in frame (a fixed, known diameter) rather than a guess about your club.";
    case "body-proportion":
      return "Clubhead speed is measured from tracking, calibrated against an assumed average body proportion since neither the ball nor a clear clubhead-at-address view was available — treat this reading as rougher than usual.";
    case "club-length":
    case null:
      return `Clubhead speed is measured from tracking, calibrated against your selected club (${CLUB_LABELS[club]}, assumed ${CLUB_LENGTH_INCHES[club]}in).`;
  }
}

interface StatsPanelProps {
  stats: SwingStats;
  club: ClubType;
}

/** Plain-language explanation for why the panel has nothing to show,
 * specific to which gate in computeSwingStats failed -- see
 * SwingStatsDiagnostic's doc comment in stats.ts for what each gate means. */
function nullReasonCaption(stats: SwingStats): string {
  switch (stats.diagnostic.gate) {
    case "phase-detection":
      return "Couldn't identify your swing's key moments (address and impact) in this clip — try a clearer angle with your full swing visible, from setup through follow-through.";
    case "impact-at-clip-edge":
      return "Impact looks like it's right at the start or end of this clip — trim the video so there's a moment of stillness before your swing and after impact.";
    case "scale-calibration":
      return "Detected your swing, but couldn't get a clean view of the clubhead at address to calibrate distance.";
    case "no-detection-near-impact":
      return "Detected your swing, but lost track of the clubhead around impact — common on fast swings; try better lighting or a higher frame rate.";
    case "implausible-speed":
      return "Tracked the clubhead, but the resulting speed reading was outside a plausible range — likely a bad detection somewhere in the swing.";
    case "ok":
      // Shouldn't reach here (an "ok" diagnostic implies clubheadSpeedMph
      // isn't null), but keep a sane fallback instead of an empty string.
      return "Not enough tracking data to estimate speed for this swing.";
  }
}

export function StatsPanel({ stats, club }: StatsPanelProps) {
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
            <span className="stats-label">
              {stats.ballSpeedSource === "measured" ? "Ball speed" : "Est. ball speed"}
            </span>
            <span className="stats-value">{stats.ballSpeedMph!.toFixed(0)} mph</span>
          </div>
          <div className="stats-row">
            <span className="stats-label">
              {stats.ballSpeedSource === "measured" ? "Carry distance" : "Est. carry distance"}
            </span>
            <span className="stats-value">
              {stats.estCarryYards !== null ? `${stats.estCarryYards.toFixed(0)} yd` : "—"}
            </span>
          </div>
          {stats.ballSpeedSource === "estimated" && (
            <p className="stats-caption">
              Ball wasn't visible after impact, so ball speed and carry are estimated from clubhead
              speed rather than measured directly.
            </p>
          )}
        </>
      ) : (
        <p className="stats-caption">{nullReasonCaption(stats)}</p>
      )}
      <p className="stats-caption">
        {calibrationCaption(stats, club)}{" "}
        {stats.ballSpeedSource === "measured"
          ? "Ball speed is measured from tracking the ball itself just after impact; carry distance is still a rough estimate derived from it."
          : "Ball speed and carry distance are rough estimates derived from clubhead speed alone — they assume a solid, center-face strike and ignore spin and drag entirely, so treat them as directional, not exact."}{" "}
        A real launch monitor measures these directly and will be far more accurate.
      </p>
    </details>
  );
}
