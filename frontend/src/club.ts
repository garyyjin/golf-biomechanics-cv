import { interpolateGaps } from "./phases";
import type { PoseFrame } from "./types";

export interface ClubPoint {
  x: number;
  y: number;
}

/**
 * Bridges short runs of missed clubhead detections (bounded by two confident
 * ones on either side) with linear interpolation, same pattern as
 * detectPhases' hand-height smoothing. Gaps at the very start/end of the
 * video, with no bracketing detection to interpolate between, stay null
 * rather than extrapolating a guess.
 *
 * Operates on club_tip_yolo (the experimental per-frame YOLOv8n detector,
 * see backend/app/club.py) — not club_tip, the existing Hough-line
 * detection already consumed directly by overlayRenderer.ts.
 */
export function fillClubGaps(frames: PoseFrame[]): (ClubPoint | null)[] {
  const xs = interpolateGaps(frames.map((f) => f.club_tip_yolo?.x ?? null));
  const ys = interpolateGaps(frames.map((f) => f.club_tip_yolo?.y ?? null));
  return xs.map((x, i) => {
    const y = ys[i];
    return x !== null && y !== null ? { x, y } : null;
  });
}
