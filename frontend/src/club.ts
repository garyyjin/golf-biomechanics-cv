import { clubTipEstimate } from "./geometry";
import type { Point } from "./geometry";
import { interpolateGaps } from "./phases";
import type { Handedness, Landmark, PoseFrame } from "./types";

export interface ClubPoint {
  x: number;
  y: number;
}

/**
 * Which clubhead detector feeds the on-screen tracer. "hough" is the
 * Canny + Hough-line detection in pose.py (club_tip); "yolo" is the
 * per-frame YOLOv8n model in club.py (club_tip_yolo), gap-filled by
 * fillClubGaps.
 */
export type ClubDetector = "hough" | "yolo";

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

/** Whether an analysis has any YOLO detections at all — false when it was run
 * against a backend with no clubhead.pt installed, in which case there's
 * nothing for the "YOLO" detector option to show. */
export function hasClubTrack(track: (ClubPoint | null)[]): boolean {
  return track.some((point) => point !== null);
}

/**
 * The clubhead point to draw for one frame under the selected detector.
 *
 * Each detector falls back only to the body-pose estimate, never to the other
 * detector: the point of the toggle is an honest side-by-side, and letting
 * YOLO quietly borrow Hough's answer on hard frames (impact, motion blur)
 * would hide exactly the gaps worth looking at.
 */
export function resolveClubTip(
  detector: ClubDetector,
  frames: PoseFrame[],
  index: number,
  yoloTrack: (ClubPoint | null)[] | null,
  smoothed: Landmark[] | null,
  handedness: Handedness,
): Point | null {
  const detected =
    detector === "yolo"
      ? (yoloTrack?.[index] ?? null)
      : (frames[index].club_tip ?? null);
  return detected ?? clubTipEstimate(smoothed, handedness);
}
