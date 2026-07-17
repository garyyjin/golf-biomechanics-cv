import { clubTipEstimate } from "./geometry";
import type { Point } from "./geometry";
import { interpolateGaps } from "./phases";
import type { Handedness, Landmark, PoseFrame } from "./types";

export interface ClubPoint {
  x: number;
  y: number;
}

// Below this total detour distance (normalized [0,1] units), a wobble is
// just jitter, not a false detection -- without this floor, the tiny
// natural jitter around an almost-stationary point (e.g. near address or
// the top of the backswing, where neighbors are already only millimeters
// apart) would ratio-trigger as an "outlier" for no reason.
const OUTLIER_ABS_FLOOR = 0.08;
// How much longer the path through a point can be than the direct path
// between its neighbors before it's a detour rather than real motion.
// Genuine fast motion (e.g. through impact) is still roughly a straight
// line frame to frame, so its detour ratio stays near 1; a false detection
// miles off the real path (the detector locking onto the grip for a frame)
// produces a large one. Kept fairly loose on purpose: a real direction
// reversal -- the top of the backswing, by definition -- is also a detour
// off the straight chord between its neighbors, especially if the detector
// misses a few frames right around the apex. Too tight a factor here
// rejects that real turning point as if it were a false detection and
// interpolates a smoothed-over path that cuts the corner instead.
const OUTLIER_DETOUR_FACTOR = 4;

function distance(a: ClubPoint, b: ClubPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Nulls out a lone detection that's a big detour off the straight line
 * between its nearest real neighbors on either side -- the detector
 * confidently locking onto the wrong thing for a frame (the grip instead of
 * the clubhead) rather than genuine clubhead motion, which roughly
 * continues the path its neighbors describe even at its fastest. Treating
 * it the same as a miss lets fillClubGaps' existing interpolation bridge
 * over it instead of drawing the tracer through it.
 */
function rejectOutliers(points: (ClubPoint | null)[]): (ClubPoint | null)[] {
  const result = [...points];
  for (let i = 0; i < result.length; i++) {
    const point = result[i];
    if (point === null) continue;

    let prevIdx = i - 1;
    while (prevIdx >= 0 && result[prevIdx] === null) prevIdx--;
    let nextIdx = i + 1;
    while (nextIdx < result.length && result[nextIdx] === null) nextIdx++;
    if (prevIdx < 0 || nextIdx >= result.length) continue;

    const prev = result[prevIdx]!;
    const next = result[nextIdx]!;
    const detour = distance(point, prev) + distance(point, next);
    const direct = distance(prev, next);
    if (detour > OUTLIER_ABS_FLOOR && detour > OUTLIER_DETOUR_FACTOR * direct) {
      result[i] = null;
    }
  }
  return result;
}

/**
 * Bridges short runs of missed clubhead detections (bounded by two confident
 * ones on either side) with linear interpolation, same pattern as
 * detectPhases' hand-height smoothing. Gaps at the very start/end of the
 * video, with no bracketing detection to interpolate between, stay null
 * rather than extrapolating a guess. Lone false detections (see
 * rejectOutliers) are treated as gaps too, before interpolation runs.
 *
 * Operates on club_tip_yolo (the experimental per-frame YOLOv8n detector,
 * see backend/app/club.py) — not club_tip, the existing Hough-line
 * detection already consumed directly by overlayRenderer.ts.
 */
export function fillClubGaps(frames: PoseFrame[]): (ClubPoint | null)[] {
  const cleaned = rejectOutliers(frames.map((f) => f.club_tip_yolo ?? null));
  const xs = interpolateGaps(cleaned.map((p) => p?.x ?? null));
  const ys = interpolateGaps(cleaned.map((p) => p?.y ?? null));
  return xs.map((x, i) => {
    const y = ys[i];
    return x !== null && y !== null ? { x, y } : null;
  });
}

/** Whether an analysis has any YOLO detections at all — false when it was run
 * against a backend with no clubhead.pt installed, in which case there's
 * nothing for the tracer to show. */
export function hasClubTrack(track: (ClubPoint | null)[]): boolean {
  return track.some((point) => point !== null);
}

/**
 * The clubhead point to draw for one frame: the gap-filled YOLO track (see
 * fillClubGaps) where it has one, otherwise the body-pose estimate
 * (geometry.ts's clubTipEstimate). A real detector miss is common on fast,
 * motion-blurred downswing/impact frames -- exactly the stretch a swing
 * path needs to cover -- and interpolation only bridges gaps bounded by a
 * real detection on both sides. Without this fallback, a miss that runs to
 * the end of the visible detections (impact is often the last one the
 * detector picks back up on) just stops the trail short instead of
 * following the club the rest of the way. The estimate is a rough
 * approximation (it projects a fixed length from the wrist in the hand's
 * orientation, not the true shaft angle), but a rough line beats no line for
 * the stretch nothing else covers.
 */
export function resolveClubTip(
  index: number,
  yoloTrack: (ClubPoint | null)[] | null,
  smoothed: Landmark[] | null,
  handedness: Handedness,
): Point | null {
  const detected = yoloTrack?.[index] ?? null;
  return detected ?? clubTipEstimate(smoothed, handedness);
}
