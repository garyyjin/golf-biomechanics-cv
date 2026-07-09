import { VISIBILITY_THRESHOLD } from "./pose.ts";
import type { Handedness, Landmark, PoseFrame, View } from "./types.ts";

/**
 * Pure geometry for the biomechanics overlay. No canvas/DOM here.
 *
 * Coordinates are MediaPipe-normalized [0,1] with y growing downward.
 * Endpoints are returned normalized (drawn like the skeleton), but every
 * angle is computed in aspect-correct space (x' = x * aspect, aspect =
 * video width / height) so normalized coordinates don't distort angles.
 * z (MediaPipe's coarse, hip-relative depth) is used only in the horizontal
 * angle term below, never for drawing — endpoints are still drawn from raw
 * x/y.
 *
 * Sign conventions:
 * - Angle from vertical (spine): deg(atan2((top.x − bottom.x)·aspect,
 *   bottom.y − top.y)); positive = upper point leans toward +x on screen.
 * - Angle from horizontal (shoulders/hips/plane): endpoints ordered
 *   (lead, trail); deg(atan2(trail.y − lead.y, hypot(|trail.x − lead.x|·aspect, dz)));
 *   positive = lead endpoint higher on screen than trail.
 */

// MediaPipe Pose landmark indices.
export const LEFT_SHOULDER = 11;
export const RIGHT_SHOULDER = 12;
export const LEFT_WRIST = 15;
export const RIGHT_WRIST = 16;
export const LEFT_HIP = 23;
export const RIGHT_HIP = 24;
export const LEFT_ANKLE = 27;
export const RIGHT_ANKLE = 28;
export const LEFT_INDEX = 19;
export const RIGHT_INDEX = 20;

export interface Point {
  x: number;
  y: number;
  z?: number;
}

export interface LineResult {
  a: Point;
  b: Point;
  angleDeg: number;
}

export type LineId = "spine" | "shoulder" | "hip" | "sway" | "plane";

export interface OverlayLine {
  id: LineId;
  label: string;
  a: Point;
  b: Point;
  angleDeg: number | null; // null for the sway reference
  extend: boolean; // extend through both points to the canvas bounds
  fixed: boolean; // address-frame reference (drawn dashed)
}

export interface SideIndices {
  leadShoulder: number;
  trailShoulder: number;
  leadHip: number;
  trailHip: number;
  leadWrist: number;
  trailWrist: number;
  leadIndex: number;
  trailIndex: number;
}

export interface AddressRefs {
  swayX: number | null;
  plane: LineResult | null;
}

const DEG_PER_RAD = 180 / Math.PI;

/** A right-handed golfer leads with their left side, and vice versa. */
export function sideIndices(handedness: Handedness): SideIndices {
  return handedness === "right"
    ? {
        leadShoulder: LEFT_SHOULDER,
        trailShoulder: RIGHT_SHOULDER,
        leadHip: LEFT_HIP,
        trailHip: RIGHT_HIP,
        leadWrist: LEFT_WRIST,
        trailWrist: RIGHT_WRIST,
        leadIndex: LEFT_INDEX,
        trailIndex: RIGHT_INDEX,
      }
    : {
        leadShoulder: RIGHT_SHOULDER,
        trailShoulder: LEFT_SHOULDER,
        leadHip: RIGHT_HIP,
        trailHip: LEFT_HIP,
        leadWrist: RIGHT_WRIST,
        trailWrist: LEFT_WRIST,
        leadIndex: RIGHT_INDEX,
        trailIndex: LEFT_INDEX,
      };
}

export function midpoint(a: Point, b: Point): Point {
  const z = a.z !== undefined && b.z !== undefined ? (a.z + b.z) / 2 : undefined;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, ...(z !== undefined ? { z } : {}) };
}

export function visiblePoint(landmarks: Landmark[], index: number): Point | null {
  const lm = landmarks[index];
  if (lm.visibility < VISIBILITY_THRESHOLD) return null;
  return { x: lm.x, y: lm.y, z: lm.z };
}

export function angleFromVerticalDeg(bottom: Point, top: Point, aspect: number): number {
  // z is intentionally not used here: this term is signed (encodes left/right
  // lean direction), and MediaPipe's z has no compatible sign convention with
  // that — combining them would conflate forward/back lean with lateral tilt.
  return Math.atan2((top.x - bottom.x) * aspect, bottom.y - top.y) * DEG_PER_RAD;
}

export function angleFromHorizontalDeg(lead: Point, trail: Point, aspect: number): number {
  // Folding in |dz| recovers some signal lost to foreshortening when the
  // camera isn't perfectly perpendicular/parallel to the body's turn — a
  // rotation partly "toward the camera" shows up in z even as screen-x
  // shrinks. Safe because this term was already an unsigned run magnitude.
  const dx = Math.abs(trail.x - lead.x) * aspect;
  const dz = (trail.z ?? 0) - (lead.z ?? 0);
  return Math.atan2(trail.y - lead.y, Math.hypot(dx, dz)) * DEG_PER_RAD;
}

/**
 * Mid-hip → mid-shoulder line with angle from vertical. Serves face-on
 * "spine tilt" and down-the-line "forward bend" (same math, different label).
 */
export function spineLine(landmarks: Landmark[] | null, aspect: number): LineResult | null {
  if (!landmarks) return null;
  const ls = visiblePoint(landmarks, LEFT_SHOULDER);
  const rs = visiblePoint(landmarks, RIGHT_SHOULDER);
  const lh = visiblePoint(landmarks, LEFT_HIP);
  const rh = visiblePoint(landmarks, RIGHT_HIP);
  if (!ls || !rs || !lh || !rh) return null;
  const a = midpoint(lh, rh);
  const b = midpoint(ls, rs);
  return { a, b, angleDeg: angleFromVerticalDeg(a, b, aspect) };
}

export function shoulderLine(
  landmarks: Landmark[] | null,
  handedness: Handedness,
  aspect: number,
): LineResult | null {
  if (!landmarks) return null;
  const side = sideIndices(handedness);
  const lead = visiblePoint(landmarks, side.leadShoulder);
  const trail = visiblePoint(landmarks, side.trailShoulder);
  if (!lead || !trail) return null;
  return { a: lead, b: trail, angleDeg: angleFromHorizontalDeg(lead, trail, aspect) };
}

export function hipLine(
  landmarks: Landmark[] | null,
  handedness: Handedness,
  aspect: number,
): LineResult | null {
  if (!landmarks) return null;
  const side = sideIndices(handedness);
  const lead = visiblePoint(landmarks, side.leadHip);
  const trail = visiblePoint(landmarks, side.trailHip);
  if (!lead || !trail) return null;
  return { a: lead, b: trail, angleDeg: angleFromHorizontalDeg(lead, trail, aspect) };
}

/**
 * Hip-midpoint x — the anchor for the fixed vertical sway-reference line.
 * Uses the midpoint rather than the lead hip alone because hip rotation/turn
 * during the swing moves a single hip landmark's screen-x even with zero
 * true lateral sway and a perfectly perpendicular camera; averaging both
 * hips is the standard "pelvis center" proxy. This damps some yaw-induced
 * noise too, but can't fully cancel a systematic yaw-induced shift — that
 * would require known camera pose.
 */
export function swayReferenceX(
  landmarks: Landmark[] | null,
  handedness: Handedness,
): number | null {
  if (!landmarks) return null;
  const side = sideIndices(handedness);
  const lead = visiblePoint(landmarks, side.leadHip);
  const trail = visiblePoint(landmarks, side.trailHip);
  if (!lead || !trail) return null;
  return midpoint(lead, trail).x;
}

/**
 * Body-only swing-plane approximation (MediaPipe has no club/shaft
 * detection): the line through the wrist midpoint and the trail shoulder.
 * Angle is the line's inclination above horizontal, positive when the
 * wrist end sits below the shoulder end (the normal address posture).
 */
export function swingPlaneLine(
  landmarks: Landmark[] | null,
  handedness: Handedness,
  aspect: number,
): LineResult | null {
  if (!landmarks) return null;
  const side = sideIndices(handedness);
  const lw = visiblePoint(landmarks, side.leadWrist);
  const tw = visiblePoint(landmarks, side.trailWrist);
  const shoulder = visiblePoint(landmarks, side.trailShoulder);
  if (!lw || !tw || !shoulder) return null;
  const a = midpoint(lw, tw);
  return { a, b: shoulder, angleDeg: angleFromHorizontalDeg(shoulder, a, aspect) };
}

export interface NormalizedPoint {
  x: number;
  y: number;
  visible: boolean;
}

interface ComparisonTransform {
  hipMid: Point;
  torsoLength: number;
}

function computeComparisonTransform(landmarks: Landmark[], aspect: number): ComparisonTransform | null {
  const lh = visiblePoint(landmarks, LEFT_HIP);
  const rh = visiblePoint(landmarks, RIGHT_HIP);
  const ls = visiblePoint(landmarks, LEFT_SHOULDER);
  const rs = visiblePoint(landmarks, RIGHT_SHOULDER);
  if (!lh || !rh || !ls || !rs) return null;

  const hipMid = midpoint(lh, rh);
  const shoulderMid = midpoint(ls, rs);
  const dx = (shoulderMid.x - hipMid.x) * aspect;
  const dy = shoulderMid.y - hipMid.y;
  const torsoLength = Math.hypot(dx, dy);
  if (torsoLength < 1e-6) return null;
  return { hipMid, torsoLength };
}

function applyComparisonTransform(point: Point, transform: ComparisonTransform, aspect: number): NormalizedPoint {
  return {
    x: ((point.x - transform.hipMid.x) * aspect) / transform.torsoLength,
    y: (point.y - transform.hipMid.y) / transform.torsoLength,
    visible: true,
  };
}

/**
 * Re-centers landmarks on the hip midpoint and scales by torso length
 * (hip-mid to shoulder-mid, aspect-corrected), so two swings filmed at
 * different distances/framing produce comparably-sized skeletons. Output is
 * a unitless space (torso length = 1) with y still growing downward, meant
 * for side-by-side diagrams rather than drawing over the source video.
 * Returns null when the torso landmarks aren't visible enough to anchor the
 * normalization.
 */
export function normalizeLandmarksForComparison(
  landmarks: Landmark[] | null,
  aspect: number,
): NormalizedPoint[] | null {
  if (!landmarks) return null;
  const transform = computeComparisonTransform(landmarks, aspect);
  if (!transform) return null;

  return landmarks.map((lm) => ({
    ...applyComparisonTransform({ x: lm.x, y: lm.y }, transform, aspect),
    visible: lm.visibility >= VISIBILITY_THRESHOLD,
  }));
}

/**
 * MediaPipe has no club/shaft detection, so the club head position is
 * approximated from hand orientation rather than arm position: the vector
 * from the wrists toward the index-finger knuckles tracks how the grip (and
 * therefore the shaft) is angled through wrist hinge/release, which a
 * shoulder-to-hands line can't capture — that line only resembles the club
 * at address and drifts badly once the wrists cock going back (this is what
 * made the tracer point the wrong way at the top of the backswing). Length
 * is scaled off torso length (a stable body proportion, roughly constant
 * through the swing) rather than off the tiny, noisy wrist-to-knuckle
 * distance itself.
 *
 * No aspect correction needed here (unlike the angle functions above): this
 * extends a point by a scaled direction vector for *drawing*, and drawing
 * already renders x/y independently (x * cssWidth, y * cssHeight) — aspect
 * correction only matters when *measuring* an angle between axes.
 */
const CLUB_LENGTH_TORSO_RATIO = 1.6;

export function clubTipEstimate(landmarks: Landmark[] | null, handedness: Handedness): Point | null {
  if (!landmarks) return null;
  const side = sideIndices(handedness);
  const lw = visiblePoint(landmarks, side.leadWrist);
  const tw = visiblePoint(landmarks, side.trailWrist);
  const li = visiblePoint(landmarks, side.leadIndex);
  const ti = visiblePoint(landmarks, side.trailIndex);
  const ls = visiblePoint(landmarks, LEFT_SHOULDER);
  const rs = visiblePoint(landmarks, RIGHT_SHOULDER);
  const lh = visiblePoint(landmarks, LEFT_HIP);
  const rh = visiblePoint(landmarks, RIGHT_HIP);
  if (!lw || !tw || !li || !ti || !ls || !rs || !lh || !rh) return null;

  const handsMid = midpoint(lw, tw);
  const knuckleMid = midpoint(li, ti);
  const dx = knuckleMid.x - handsMid.x;
  const dy = knuckleMid.y - handsMid.y;
  const dirLength = Math.hypot(dx, dy);
  if (dirLength < 1e-6) return null;

  const shoulderMid = midpoint(ls, rs);
  const hipMid = midpoint(lh, rh);
  const torsoLength = Math.hypot(shoulderMid.x - hipMid.x, shoulderMid.y - hipMid.y);
  if (torsoLength < 1e-6) return null;

  const shaftLength = torsoLength * CLUB_LENGTH_TORSO_RATIO;
  return {
    x: handsMid.x + (dx / dirLength) * shaftLength,
    y: handsMid.y + (dy / dirLength) * shaftLength,
  };
}

export interface ClubSegment {
  hands: NormalizedPoint;
  tip: NormalizedPoint;
}

/** Hands-to-club-tip segment in the same normalized comparison space as
 * normalizeLandmarksForComparison, for drawing alongside a comparison
 * skeleton. */
export function clubSegmentForComparison(
  landmarks: Landmark[] | null,
  handedness: Handedness,
  aspect: number,
): ClubSegment | null {
  if (!landmarks) return null;
  const transform = computeComparisonTransform(landmarks, aspect);
  if (!transform) return null;

  const side = sideIndices(handedness);
  const lw = visiblePoint(landmarks, side.leadWrist);
  const tw = visiblePoint(landmarks, side.trailWrist);
  const tip = clubTipEstimate(landmarks, handedness);
  if (!lw || !tw || !tip) return null;

  return {
    hands: applyComparisonTransform(midpoint(lw, tw), transform, aspect),
    tip: applyComparisonTransform(tip, transform, aspect),
  };
}

/**
 * Heuristic check for whether a down-the-line video was actually filmed
 * from along the target line. When the camera is aligned, the stance
 * (feet apart along the target line, i.e. straight toward/away from the
 * camera) foreshortens almost entirely away, so the ankles land very close
 * together on screen; a camera off to the side reveals more of the true
 * stance width as horizontal (x) separation. Torso length (not hip width,
 * which foreshortens the same way the ankles do) is used as the reference
 * scale since it stays roughly constant under this kind of yaw.
 *
 * This is a rough heuristic tuned by eye, not a calibrated measurement —
 * it exists to catch clearly-off-axis footage, not to grade alignment
 * precisely.
 */
const DOWN_THE_LINE_MISALIGNMENT_RATIO = 0.35;

export function downTheLineAlignmentRatio(landmarks: Landmark[] | null, aspect: number): number | null {
  if (!landmarks) return null;
  const la = visiblePoint(landmarks, LEFT_ANKLE);
  const ra = visiblePoint(landmarks, RIGHT_ANKLE);
  const transform = computeComparisonTransform(landmarks, aspect);
  if (!la || !ra || !transform) return null;

  const ankleSeparation = Math.abs(la.x - ra.x) * aspect;
  return ankleSeparation / transform.torsoLength;
}

export function isDownTheLineMisaligned(landmarks: Landmark[] | null, aspect: number): boolean {
  const ratio = downTheLineAlignmentRatio(landmarks, aspect);
  return ratio !== null && ratio > DOWN_THE_LINE_MISALIGNMENT_RATIO;
}

/** The address frame: frame 0, falling back to the first detected pose. */
export function findAddressFrame(frames: PoseFrame[]): PoseFrame | null {
  for (const frame of frames) {
    if (frame.landmarks) return frame;
  }
  return null;
}

/**
 * Fixed references computed once from the raw (unsmoothed) address-frame
 * landmarks. Each field is independently null when its landmarks are
 * missing or below the visibility threshold.
 */
export function computeAddressRefs(
  frames: PoseFrame[],
  handedness: Handedness,
  aspect: number,
): AddressRefs {
  const address = findAddressFrame(frames);
  const landmarks = address ? address.landmarks : null;
  return {
    swayX: swayReferenceX(landmarks, handedness),
    plane: swingPlaneLine(landmarks, handedness, aspect),
  };
}

/**
 * The full set of renderable lines for one frame. Live lines are omitted
 * when their landmarks are missing; fixed address references still render
 * on frames with no detected pose.
 */
export function computeOverlayLines(
  view: View,
  landmarks: Landmark[] | null,
  handedness: Handedness,
  aspect: number,
  refs: AddressRefs,
): OverlayLine[] {
  const lines: OverlayLine[] = [];

  if (view === "face_on") {
    const spine = spineLine(landmarks, aspect);
    if (spine) {
      lines.push({ id: "spine", label: "Spine tilt", ...spine, extend: false, fixed: false });
    }
    const shoulders = shoulderLine(landmarks, handedness, aspect);
    if (shoulders) {
      lines.push({ id: "shoulder", label: "Shoulders", ...shoulders, extend: false, fixed: false });
    }
    const hips = hipLine(landmarks, handedness, aspect);
    if (hips) {
      lines.push({ id: "hip", label: "Hips", ...hips, extend: false, fixed: false });
    }
    if (refs.swayX !== null) {
      lines.push({
        id: "sway",
        label: "Sway ref",
        a: { x: refs.swayX, y: 0 },
        b: { x: refs.swayX, y: 1 },
        angleDeg: null,
        extend: false,
        fixed: true,
      });
    }
  } else {
    if (refs.plane) {
      lines.push({ id: "plane", label: "Plane (approx)", ...refs.plane, extend: true, fixed: true });
    }
    const spine = spineLine(landmarks, aspect);
    if (spine) {
      lines.push({ id: "spine", label: "Forward bend", ...spine, extend: false, fixed: false });
    }
    const hips = hipLine(landmarks, handedness, aspect);
    if (hips) {
      lines.push({ id: "hip", label: "Hips", ...hips, extend: false, fixed: false });
    }
  }

  return lines;
}
