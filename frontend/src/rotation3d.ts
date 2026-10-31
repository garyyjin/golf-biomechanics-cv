import { LEFT_HIP, LEFT_SHOULDER, RIGHT_HIP, RIGHT_SHOULDER } from "./geometry.ts";
import { jointsVisibility } from "./measurement.ts";
import type { SwingPhases } from "./phases.ts";
import type { PoseFrame, WorldLandmark } from "./types.ts";

/**
 * Rotation about the body's vertical axis, measured from MediaPipe's metric
 * world landmarks rather than from the 2D pose.
 *
 * This is the measurement the screen-space angles in geometry.ts can't make
 * honestly: a golfer turning 90° toward or away from a face-on camera
 * foreshortens the shoulder line toward zero width on screen, so any
 * screen-angle metric reads "less turn" exactly when the turn is largest.
 * World landmarks carry an estimated depth coordinate, so the shoulder and
 * hip lines are measured in the horizontal (x–z) plane — the plane a turn
 * actually rotates in — and the reading stays meaningful through the top of
 * the backswing.
 *
 * Everything here is *address-relative*: a golfer who sets up slightly
 * closed or open isn't penalised for it, because the same misalignment is in
 * both vectors. Values are magnitudes, so the sign of the turn (which way the
 * camera is looking) never flips a number's meaning; that also means impact
 * and the top of the backswing can both read "rotated", and only the amount
 * is being reported.
 *
 * Depth is inferred from a single camera, so these are close estimates rather
 * than marker- or radar-grade measurements — the UI says so next to them.
 */

export interface RotationDelta {
  /** Rotation away from the address alignment, in degrees (0–180). */
  degrees: number;
  /** 0–1 visibility of the two joints the reading depends on, in both the
   * address pose and this frame. */
  confidence: number;
}

export interface Rotation3d {
  /** Whether this clip carries 3D pose data at all — analyses stored before
   * world landmarks were returned, and clips with no pose at address, both
   * come back false with every reading null. */
  available: boolean;
  /** Chest (shoulder line) rotation at the top of the backswing. */
  torsoAtTop: RotationDelta | null;
  /** Pelvis (hip line) rotation at the top of the backswing. */
  pelvisAtTop: RotationDelta | null;
  /** torso − pelvis at the top, in degrees. The 3D counterpart of X-factor;
   * negative means the pelvis out-turned the chest. */
  separationAtTop: number | null;
  /** Chest rotation at impact — how square the chest is coming into the ball. */
  torsoAtImpact: RotationDelta | null;
  /** Pelvis rotation at impact. */
  pelvisAtImpact: RotationDelta | null;
  /** Largest chest rotation reached anywhere between address and the top. */
  peakTorso: RotationDelta | null;
  /** Largest pelvis rotation reached anywhere between address and the top. */
  peakPelvis: RotationDelta | null;
  /** 0–1 across the torso/pelvis readings above; 0 when none exist. */
  confidence: number;
}

const SHOULDER_PAIR: readonly [number, number] = [LEFT_SHOULDER, RIGHT_SHOULDER];
const HIP_PAIR: readonly [number, number] = [LEFT_HIP, RIGHT_HIP];

// A shoulder line is ~0.35m and a hip line ~0.25m wide for an adult, so a
// horizontal segment shorter than this is a degenerate reading (the model
// collapsed both joints onto each other), not a golfer standing sideways.
const MIN_SEGMENT_METERS = 0.05;

const DEG_PER_RAD = 180 / Math.PI;

/** Yaw of a landmark pair's connecting line in the horizontal plane, or null
 * when the pair is too bunched up for its direction to mean anything. */
function yawDeg(world: WorldLandmark[], pair: readonly [number, number]): number | null {
  const [a, b] = pair;
  const from = world[a];
  const to = world[b];
  if (!from || !to) return null;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (Math.hypot(dx, dz) < MIN_SEGMENT_METERS) return null;
  return Math.atan2(dz, dx) * DEG_PER_RAD;
}

function yawDeltaDeg(fromDeg: number, toDeg: number): number {
  const wrapped = (((toDeg - fromDeg) % 360) + 540) % 360 - 180;
  return Math.abs(wrapped);
}

/**
 * How far a landmark pair has rotated about the vertical axis between two
 * poses, in degrees (0–180). Null when either pose lacks the pair or the
 * segment is degenerate.
 */
export function rotationMagnitudeDeg(
  from: WorldLandmark[],
  to: WorldLandmark[],
  pair: readonly [number, number],
): number | null {
  const fromYaw = yawDeg(from, pair);
  const toYaw = yawDeg(to, pair);
  if (fromYaw === null || toYaw === null) return null;
  return yawDeltaDeg(fromYaw, toYaw);
}

function pairConfidence(
  frames: PoseFrame[],
  addressIndex: number,
  index: number,
  pair: readonly [number, number],
): number {
  const own = jointsVisibility(frames[index]?.landmarks ?? null, [...pair]);
  const base = jointsVisibility(frames[addressIndex]?.landmarks ?? null, [...pair]);
  if (own === null || base === null) return 0;
  return (own + base) / 2;
}

function readingAt(
  frames: PoseFrame[],
  addressIndex: number,
  index: number | null,
  pair: readonly [number, number],
): RotationDelta | null {
  if (index === null || index === addressIndex) return null;
  const base = frames[addressIndex]?.world_landmarks ?? null;
  const current = frames[index]?.world_landmarks ?? null;
  if (!base || !current) return null;
  const degrees = rotationMagnitudeDeg(base, current, pair);
  if (degrees === null) return null;
  return { degrees, confidence: pairConfidence(frames, addressIndex, index, pair) };
}

/** Largest reading between address and `endIndex`, inclusive. */
function peak(
  frames: PoseFrame[],
  addressIndex: number,
  endIndex: number | null,
  pair: readonly [number, number],
): RotationDelta | null {
  if (endIndex === null) return null;
  let best: RotationDelta | null = null;
  for (let i = addressIndex; i <= endIndex; i++) {
    const candidate = readingAt(frames, addressIndex, i, pair);
    if (candidate && (best === null || candidate.degrees > best.degrees)) best = candidate;
  }
  return best;
}

const UNAVAILABLE: Rotation3d = {
  available: false,
  torsoAtTop: null,
  pelvisAtTop: null,
  separationAtTop: null,
  torsoAtImpact: null,
  pelvisAtImpact: null,
  peakTorso: null,
  peakPelvis: null,
  confidence: 0,
};

/** Address-relative 3D rotation readings for one swing's detected phases. */
export function computeRotation3d(frames: PoseFrame[], phases: SwingPhases): Rotation3d {
  const addressIndex = phases.address;
  if (addressIndex === null) return UNAVAILABLE;
  const addressWorld = frames[addressIndex]?.world_landmarks ?? null;
  if (!addressWorld || addressWorld.length === 0) return UNAVAILABLE;

  const torsoAtTop = readingAt(frames, addressIndex, phases.top, SHOULDER_PAIR);
  const pelvisAtTop = readingAt(frames, addressIndex, phases.top, HIP_PAIR);
  const torsoAtImpact = readingAt(frames, addressIndex, phases.impact, SHOULDER_PAIR);
  const pelvisAtImpact = readingAt(frames, addressIndex, phases.impact, HIP_PAIR);

  const measured = [torsoAtTop, pelvisAtTop, torsoAtImpact, pelvisAtImpact].filter(
    (r): r is RotationDelta => r !== null,
  );

  return {
    available: true,
    torsoAtTop,
    pelvisAtTop,
    separationAtTop:
      torsoAtTop && pelvisAtTop ? torsoAtTop.degrees - pelvisAtTop.degrees : null,
    torsoAtImpact,
    pelvisAtImpact,
    peakTorso: peak(frames, addressIndex, phases.top, SHOULDER_PAIR),
    peakPelvis: peak(frames, addressIndex, phases.top, HIP_PAIR),
    confidence:
      measured.length === 0
        ? 0
        : measured.reduce((sum, r) => sum + r.confidence, 0) / measured.length,
  };
}
