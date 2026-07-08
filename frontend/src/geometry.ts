import { VISIBILITY_THRESHOLD } from "./pose";
import type { Handedness, Landmark, PoseFrame, View } from "./types";

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
      }
    : {
        leadShoulder: RIGHT_SHOULDER,
        trailShoulder: LEFT_SHOULDER,
        leadHip: RIGHT_HIP,
        trailHip: LEFT_HIP,
        leadWrist: RIGHT_WRIST,
        trailWrist: LEFT_WRIST,
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
