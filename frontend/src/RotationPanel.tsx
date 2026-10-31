import { MIN_SCORE_CONFIDENCE } from "./measurement";
import type { Rotation3d } from "./rotation3d";

interface RotationPanelProps {
  rotation: Rotation3d;
}

function formatDegrees(degrees: number | null, fallback = "—"): string {
  return degrees === null ? fallback : `${degrees.toFixed(0)}°`;
}

/**
 * Address-relative 3D turn readings. Replaces nothing — the screen-space
 * readout above it is still what's drawn on the video — but fills in the
 * measurement that screen angles can't make once a golfer turns toward or
 * away from the camera (see rotation3d.ts).
 */
export function RotationPanel({ rotation }: RotationPanelProps) {
  const hasReadings = rotation.available && rotation.torsoAtTop !== null;

  return (
    <details className="rotation-panel" open>
      <summary>3D rotation</summary>
      {hasReadings ? (
        <>
          <div className="stats-row">
            <span className="stats-label">Chest at the top</span>
            <span className="stats-value">{formatDegrees(rotation.torsoAtTop!.degrees)}</span>
          </div>
          <div className="stats-row">
            <span className="stats-label">Pelvis at the top</span>
            <span className="stats-value">{formatDegrees(rotation.pelvisAtTop?.degrees ?? null)}</span>
          </div>
          <div className="stats-row">
            <span className="stats-label">Chest − pelvis at the top</span>
            <span className="stats-value">{formatDegrees(rotation.separationAtTop)}</span>
          </div>
          <div className="stats-row">
            <span className="stats-label">Peak chest turn · backswing</span>
            <span className="stats-value">{formatDegrees(rotation.peakTorso?.degrees ?? null)}</span>
          </div>
          <div className="stats-row">
            <span className="stats-label">Chest at impact</span>
            <span className="stats-value">{formatDegrees(rotation.torsoAtImpact?.degrees ?? null)}</span>
          </div>
          {rotation.confidence < MIN_SCORE_CONFIDENCE && (
            <p className="stats-caption">
              Your body was partly hidden around these moments, so these turns are less certain than
              usual — a clear, well-lit angle showing your whole torso will sharpen them.
            </p>
          )}
          <p className="stats-caption">
            Turn measured against your own address alignment, so a slightly open or closed setup
            doesn't count against you. Depth comes from a single camera rather than markers or
            radar, so treat these as close estimates — and note that the magnitude alone doesn't
            say which direction you turned.
          </p>
        </>
      ) : (
        <p className="stats-caption">
          {rotation.available
            ? "Couldn't read a turn for this swing — that needs the top of the backswing and impact detected in the clip."
            : "This clip has no 3D pose data, so turns can't be measured in depth. Analyses run before 3D tracking was added, and frames where your whole body wasn't visible, come back without it — re-analyzing the video adds it."}
        </p>
      )}
    </details>
  );
}
