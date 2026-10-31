import { LEFT_HIP, LEFT_SHOULDER, midpoint, RIGHT_HIP, RIGHT_SHOULDER, sideIndices, visiblePoint } from "./geometry";
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

// --- Rigid-club model -------------------------------------------------------
//
// A real club is a rigid segment: its length is fixed and its head is always
// exactly "one shaft" away from the grip. Treating each detector reading as
// an independent point throws that away, so every pixel of box jitter (and
// every false detection somewhere else in the frame) turns into a visible
// kink in the tracer. Instead, each reading is decomposed into (shaft angle,
// club length) around that frame's grip, the length is checked against the
// swing's own measured club length (a golf club does not get longer and
// shorter as it swings) and smoothed, and the tip is rebuilt from the grip
// out. This is what makes a tracer read as a club swinging rather than a
// dotted line of detector output.
//
// All lengths here are aspect-corrected (x scaled by width/height, matching
// the convention geometry.ts uses for its angle math): otherwise a club
// pointing sideways would measure a different length than one pointing
// straight down, purely because normalized coordinates don't preserve
// silhouette shape.

// Plausible grip-to-clubhead distance as a multiple of torso length. A driver
// is about 2.1-2.3 torso lengths and a wedge about 1.7, with room for the
// detector reading the box's toe/heel rather than its exact tip. Anything
// outside this is not this golfer's club -- in particular, the detector often
// locks onto the hands/shaft for a stretch, which sits around 0.2-0.5 torso
// lengths from the grip and would otherwise drag the tracer in to the body.
const CLUB_LENGTH_MIN_TORSO_RATIO = 0.8;
const CLUB_LENGTH_MAX_TORSO_RATIO = 3.2;
// A detection whose returned point is this close to the frame border is a box
// clipped by the frame edge, not a clubhead the detector actually saw: the
// head is off-screen and the box is pinned to the boundary. Those readings
// hug the edge and produce the flat, jagged run along the top/left of the
// video that made the tracer look broken on down-the-line footage.
const FRAME_EDGE_MARGIN = 0.02;
// How far an individual reading may deviate from the swing's median club
// length before it's treated as a false detection (landing on the shaft,
// the grip, the body, or the ground). Generous enough to absorb perspective
// drift and a motion-blurred box growing during the downswing.
const CLUB_LENGTH_TOLERANCE = 1.7;

// Angular speed (radians/frame) above which shaft direction is left
// unsmoothed: the downswing and release genuinely swing the shaft tens of
// degrees between frames, and a moving average there would blur the arc and
// lag the real clubhead. Below these thresholds the direction is mostly
// detector jitter, so it is averaged over a wider neighborhood.
const ANGLE_SMOOTH_FAST = (20 * Math.PI) / 180;
const ANGLE_SMOOTH_MEDIUM = (7 * Math.PI) / 180;
const RADIUS_SMOOTH_HALF_WINDOW = 2;

// How far past the first/last real detection the track may be extended. The
// detector commonly misses the fastest frames right at impact; a short
// constant-velocity extension keeps the trail running to the ball instead of
// stopping short, without inventing a long pinch of path that was never seen.
const EDGE_EXTRAPOLATION_FRAMES = 3;

function distance(a: ClubPoint, b: ClubPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Nulls out a lone detection that's a big detour off the straight line
 * between its nearest real neighbors on either side -- the detector
 * confidently locking onto the wrong thing for a frame (the grip instead of
 * the clubhead) rather than genuine clubhead motion, which roughly
 * continues the path its neighbors describe even at its fastest. Treating
 * it the same as a miss lets the gap bridging bridge over it instead of
 * drawing the tracer through it.
 *
 * Exported separately from the track builder so stats.ts can search for the
 * nearest *real* detection around impact -- interpolated points are a
 * straight-line average across however wide the surrounding gap is, which
 * understates the true speed at any single fast-moving instant inside it
 * (impact, chiefly).
 */
export function rejectOutliers(points: (ClubPoint | null)[]): (ClubPoint | null)[] {
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
 * The golfer's grip: the midpoint of whichever wrists are visible, falling
 * back to the single visible one. A profile-ish view (down the line
 * especially) routinely occludes one hand, and the visible wrist alone is
 * still within a hand's width of the grip -- close enough to anchor a club
 * segment on.
 */
function gripPoint(landmarks: Landmark[] | null, handedness: Handedness): ClubPoint | null {
  if (!landmarks) return null;
  const side = sideIndices(handedness);
  const lead = visiblePoint(landmarks, side.leadWrist);
  const trail = visiblePoint(landmarks, side.trailWrist);
  if (lead && trail) return midpoint(lead, trail);
  return lead ?? trail;
}

/**
 * Mid-shoulder to mid-hip distance, aspect-corrected -- the same torso length
 * geometry.ts's comparison transform uses, and the scale reference for "how
 * long should this club be in this frame". Null unless all four torso
 * landmarks are visible enough to be trusted.
 */
function torsoLength(landmarks: Landmark[] | null, aspect: number): number | null {
  if (!landmarks) return null;
  const ls = visiblePoint(landmarks, LEFT_SHOULDER);
  const rs = visiblePoint(landmarks, RIGHT_SHOULDER);
  const lh = visiblePoint(landmarks, LEFT_HIP);
  const rh = visiblePoint(landmarks, RIGHT_HIP);
  if (!ls || !rs || !lh || !rh) return null;
  const shoulder = midpoint(ls, rs);
  const hip = midpoint(lh, rh);
  return Math.hypot((shoulder.x - hip.x) * aspect, shoulder.y - hip.y);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Shortest signed difference a - b between two angles, in (-pi, pi]. */
function angleDelta(a: number, b: number): number {
  let delta = a - b;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta <= -Math.PI) delta += 2 * Math.PI;
  return delta;
}

/** Linear interpolation over x/y, used only when no pose landmarks exist to
 * anchor a club model on (see buildClubTrack's fallback). */
function bridgeGaps(points: (ClubPoint | null)[]): (ClubPoint | null)[] {
  const xs = interpolateGaps(points.map((p) => p?.x ?? null));
  const ys = interpolateGaps(points.map((p) => p?.y ?? null));
  return xs.map((x, i) => {
    const y = ys[i];
    return x !== null && y !== null ? { x, y } : null;
  });
}

/**
 * Bridges bounded runs of missed shaft angles along the *shortest arc*
 * between the detections on either side. Interpolating the angle rather than
 * the tip position is what keeps a bridged downswing miss on the swing's
 * real arc instead of cutting a straight chord across it.
 *
 * Gaps at the very start/end of the video stay null here; extendTrackEdges
 * handles those separately, deliberately more conservatively.
 */
function fillAngles(angles: (number | null)[]): (number | null)[] {
  const result = [...angles];
  let i = 0;
  while (i < result.length) {
    if (result[i] !== null) {
      i++;
      continue;
    }
    const start = i;
    while (i < result.length && result[i] === null) i++;
    const end = i; // exclusive
    const before = start - 1;
    if (before < 0 || end >= result.length) continue;
    const a = result[before]!;
    const delta = angleDelta(result[end]!, a);
    for (let j = start; j < end; j++) {
      const t = (j - before) / (end - before);
      result[j] = a + delta * t;
    }
  }
  return result;
}

/**
 * Averages shaft angles over a neighborhood whose size follows how fast the
 * shaft is actually rotating: still or slow stretches (address, the top of
 * the backswing) get the widest window, because their frame-to-frame wobble
 * is detector noise; the downswing gets none, because its angle change is
 * real motion and averaging it would flatten the arc and lag the clubhead.
 * Averaging relative to the center sample keeps it correct across the -pi/pi
 * wrap.
 */
function smoothAngles(angles: (number | null)[]): (number | null)[] {
  return angles.map((angle, i) => {
    if (angle === null) return null;
    let speed = 0;
    for (const j of [i - 1, i + 1]) {
      const neighbor = angles[j];
      if (neighbor === null || neighbor === undefined) continue;
      speed = Math.max(speed, Math.abs(angleDelta(neighbor, angle)));
    }
    const half = speed > ANGLE_SMOOTH_FAST ? 0 : speed > ANGLE_SMOOTH_MEDIUM ? 1 : 2;
    if (half === 0) return angle;
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(angles.length - 1, i + half); j++) {
      const neighbor = angles[j];
      if (neighbor === null) continue;
      sum += angleDelta(neighbor, angle);
      count++;
    }
    return angle + sum / count;
  });
}

/** Symmetric moving average over a nullable numeric series, skipping nulls. */
function smoothSeries(series: (number | null)[], half: number): (number | null)[] {
  return series.map((value, i) => {
    if (value === null) return null;
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(series.length - 1, i + half); j++) {
      const neighbor = series[j];
      if (neighbor === null) continue;
      sum += neighbor;
      count++;
    }
    return sum / count;
  });
}

/**
 * Extends the track a few frames past its first/last real detection: the
 * clubhead is commonly lost to motion blur on exactly the fastest,
 * most-important frames around impact, and the alternative -- both here and
 * in earlier versions -- was a body-pose guess that points the shaft along
 * the hand's knuckles, which is a different direction entirely and produced
 * the visible spikes this model replaced. Holding the club's measured length
 * and continuing the shaft's own slight rotation is both smoother and
 * closer to what the club is really doing for those few frames.
 */
function extendTrackEdges(
  angles: (number | null)[],
  radii: (number | null)[],
): { angles: (number | null)[]; radii: (number | null)[] } {
  const extendedAngles = [...angles];
  const extendedRadii = [...radii];
  const valid: number[] = [];
  for (let i = 0; i < angles.length; i++) {
    if (angles[i] !== null && radii[i] !== null) valid.push(i);
  }
  if (valid.length === 0) return { angles: extendedAngles, radii: extendedRadii };

  const first = valid[0];
  const last = valid[valid.length - 1];
  for (let i = Math.max(0, first - EDGE_EXTRAPOLATION_FRAMES); i < first; i++) {
    extendedAngles[i] = angles[first];
    extendedRadii[i] = radii[first];
  }

  const previous = valid.length >= 2 ? valid[valid.length - 2] : null;
  const slope =
    previous === null ? 0 : Math.max(-Math.PI / 3, Math.min(Math.PI / 3, angleDelta(angles[last]!, angles[previous]!) / (last - previous)));
  for (let k = 1; k <= EDGE_EXTRAPOLATION_FRAMES && last + k < angles.length; k++) {
    const offset = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, slope * k));
    extendedAngles[last + k] = angles[last]! + offset;
    extendedRadii[last + k] = radii[last]!;
  }
  return { angles: extendedAngles, radii: extendedRadii };
}

/**
 * Builds the clubhead track the tracer draws: one grip-anchored point per
 * frame, or null where the club can't be placed.
 *
 * The pipeline is deliberately "model first, detector second": clamp each
 * raw detection to the swing's own measured club length, bridge misses in
 * (angle, length) space, smooth only as much as the shaft's actual rotation
 * allows, then rebuild each tip from that frame's grip plus the corrected
 * shaft vector. The result is a continuous club path that keeps the hands'
 * real motion and the club's real direction while discarding detector
 * jitter that no rigid club could produce.
 *
 * Falls back to plain interpolation of the raw points when the analysis has
 * no pose landmarks at all to anchor the model on (e.g. a clip analyzed
 * before landmarks existed, or footage where the golfer is never detected).
 */
export function buildClubTrack(
  frames: PoseFrame[],
  handedness: Handedness = "right",
  aspect = 1,
): (ClubPoint | null)[] {
  const raw = rejectOutliers(frames.map((f) => f.club_tip_yolo ?? f.club_tip ?? null));
  const grips = frames.map((f) => gripPoint(f.landmarks, handedness));
  if (!grips.some((grip) => grip !== null)) return bridgeGaps(raw);

  // The grip and torso length are the model's anchors, so a few frames where
  // MediaPipe's visibility score dips (routine on a down-the-line view, where
  // one hand is behind the other and the hips turn away) must not punch holes
  // in the club path. They vary smoothly in reality, so bounded gaps are
  // interpolated like any other short miss; the track is only left null where
  // the golfer really isn't tracked at all (clip start/end).
  const gripXs = interpolateGaps(grips.map((grip) => grip?.x ?? null));
  const gripYs = interpolateGaps(grips.map((grip) => grip?.y ?? null));
  const torsos = interpolateGaps(frames.map((f) => torsoLength(f.landmarks, aspect)));

  const angles: (number | null)[] = new Array(frames.length).fill(null);
  const radii: (number | null)[] = new Array(frames.length).fill(null);
  const ratios: number[] = [];
  for (let i = 0; i < frames.length; i++) {
    const point = raw[i];
    const gripX = gripXs[i];
    const gripY = gripYs[i];
    const torso = torsos[i];
    if (!point || gripX === null || gripY === null || torso === null || torso < 1e-6) continue;
    if (
      point.x <= FRAME_EDGE_MARGIN ||
      point.x >= 1 - FRAME_EDGE_MARGIN ||
      point.y <= FRAME_EDGE_MARGIN ||
      point.y >= 1 - FRAME_EDGE_MARGIN
    ) continue;
    const dx = (point.x - gripX) * aspect;
    const dy = point.y - gripY;
    const radius = Math.hypot(dx, dy);
    const ratio = radius / torso;
    if (ratio < CLUB_LENGTH_MIN_TORSO_RATIO || ratio > CLUB_LENGTH_MAX_TORSO_RATIO) continue;
    ratios.push(ratio);
    angles[i] = Math.atan2(dy, dx);
    radii[i] = radius;
  }

  const clubRatio = median(ratios);
  if (clubRatio === null) return bridgeGaps(raw);

  // Second pass against the swing's own median club length: a reading that
  // is plausible in absolute terms but not this club's length is a false
  // detection on something else (another player, the bag, the cart).
  for (let i = 0; i < frames.length; i++) {
    const radius = radii[i];
    const torso = torsos[i];
    if (radius === null || torso === null) continue;
    const ratio = radius / torso;
    if (ratio < clubRatio / CLUB_LENGTH_TOLERANCE || ratio > clubRatio * CLUB_LENGTH_TOLERANCE) {
      angles[i] = null;
      radii[i] = null;
    }
  }

  const filledAngles = fillAngles(angles);
  const filledRadii = interpolateGaps(radii);
  const smoothedAngles = smoothAngles(filledAngles);
  const smoothedRadii = smoothSeries(filledRadii, RADIUS_SMOOTH_HALF_WINDOW);
  const extended = extendTrackEdges(smoothedAngles, smoothedRadii);

  return frames.map((_, i) => {
    const gripX = gripXs[i];
    const gripY = gripYs[i];
    const angle = extended.angles[i];
    const radius = extended.radii[i];
    if (gripX === null || gripY === null || angle === null || radius === null) return null;
    return {
      x: gripX + (Math.cos(angle) * radius) / aspect,
      y: gripY + Math.sin(angle) * radius,
    };
  });
}

/**
 * The per-frame clubhead track with short misses bridged, keyed off the
 * golfer's grip -- see buildClubTrack for the model. Prefers club_tip_yolo
 * (the per-frame YOLOv8n detector, see backend/app/club.py) per frame,
 * falling back to club_tip (the classical Hough-line detection) only on
 * frames where YOLO has nothing -- a single miss from one detector no longer
 * breaks the drawn trail for that frame. This is a display-only fusion:
 * stats.ts's speed math deliberately keeps the two detectors' real
 * (non-interpolated) points separate instead of mixing them within one
 * measurement (see computeFromSource).
 */
export function fillClubGaps(
  frames: PoseFrame[],
  handedness: Handedness = "right",
  aspect = 1,
): (ClubPoint | null)[] {
  return buildClubTrack(frames, handedness, aspect);
}

/** Whether an analysis has any clubhead detections at all — false when it was
 * run against a backend with no clubhead.pt installed, in which case there's
 * nothing for the tracer to show. */
export function hasClubTrack(track: (ClubPoint | null)[]): boolean {
  return track.some((point) => point !== null);
}
