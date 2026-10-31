import { describe, expect, it } from "vitest";
import { LEFT_HIP, LEFT_SHOULDER, RIGHT_HIP, RIGHT_SHOULDER } from "./geometry";
import type { SwingPhases } from "./phases";
import { computeRotation3d, rotationMagnitudeDeg } from "./rotation3d";
import { makeLandmarks } from "./testUtils";
import type { PoseFrame, WorldLandmark } from "./types";

const SHOULDER_HALF = 0.2;
const HIP_HALF = 0.12;

/** A 33-point world pose with the shoulder and hip lines set to the given
 * yaw angles (degrees) in the horizontal plane. */
function worldPose(torsoYawDeg: number, pelvisYawDeg: number): WorldLandmark[] {
  const world: WorldLandmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  const setPair = (leftIndex: number, rightIndex: number, yawDeg: number, half: number) => {
    const rad = (yawDeg * Math.PI) / 180;
    const dx = Math.cos(rad) * half;
    const dz = Math.sin(rad) * half;
    world[leftIndex] = { x: -dx, y: 0, z: -dz };
    world[rightIndex] = { x: dx, y: 0, z: dz };
  };
  setPair(LEFT_SHOULDER, RIGHT_SHOULDER, torsoYawDeg, SHOULDER_HALF);
  setPair(LEFT_HIP, RIGHT_HIP, pelvisYawDeg, HIP_HALF);
  return world;
}

function frame(
  index: number,
  torsoYawDeg: number,
  pelvisYawDeg: number,
  options: { visibility?: number; world?: boolean } = {},
): PoseFrame {
  const { visibility = 1, world = true } = options;
  return {
    index,
    t: index / 30,
    landmarks: makeLandmarks({
      [LEFT_SHOULDER]: { visibility },
      [RIGHT_SHOULDER]: { visibility },
      [LEFT_HIP]: { visibility },
      [RIGHT_HIP]: { visibility },
    }),
    world_landmarks: world ? worldPose(torsoYawDeg, pelvisYawDeg) : null,
  };
}

const PHASES: SwingPhases = {
  address: 0,
  takeaway: 3,
  top: 10,
  downswing: 12,
  impact: 20,
  followThrough: 26,
};

function swingFrames(options: { visibility?: number; world?: boolean } = {}): PoseFrame[] {
  return Array.from({ length: 30 }, (_, i) => {
    if (i <= 10) {
      // Turn progressively to 90deg torso / 45deg pelvis at the top.
      const progress = i / 10;
      return frame(i, 90 * progress, 45 * progress, options);
    }
    // Unwind back to square by impact.
    const progress = Math.min(1, (i - 10) / 10);
    return frame(i, 90 * (1 - progress), 45 * (1 - progress), options);
  });
}

describe("rotationMagnitudeDeg", () => {
  it("measures a 90 degree turn in the horizontal plane", () => {
    const from = worldPose(0, 0);
    const to = worldPose(90, 0);
    expect(rotationMagnitudeDeg(from, to, [LEFT_SHOULDER, RIGHT_SHOULDER])).toBeCloseTo(90, 5);
  });

  it("wraps past a half turn instead of reporting a reflex angle", () => {
    const from = worldPose(0, 0);
    const to = worldPose(-120, 0);
    expect(rotationMagnitudeDeg(from, to, [LEFT_SHOULDER, RIGHT_SHOULDER])).toBeCloseTo(120, 5);
  });

  it("returns null for a degenerate segment", () => {
    const collapsed: WorldLandmark[] = Array.from({ length: 33 }, () => ({ x: 0.1, y: 0, z: 0.1 }));
    const from = worldPose(0, 0);
    expect(rotationMagnitudeDeg(from, collapsed, [LEFT_SHOULDER, RIGHT_SHOULDER])).toBeNull();
  });
});

describe("computeRotation3d", () => {
  it("reports address-relative torso, pelvis and separation at the top", () => {
    const rotation = computeRotation3d(swingFrames(), PHASES);

    expect(rotation.available).toBe(true);
    expect(rotation.torsoAtTop?.degrees).toBeCloseTo(90, 5);
    expect(rotation.pelvisAtTop?.degrees).toBeCloseTo(45, 5);
    expect(rotation.separationAtTop).toBeCloseTo(45, 5);
    expect(rotation.torsoAtImpact?.degrees).toBeCloseTo(0, 5);
    expect(rotation.confidence).toBeCloseTo(1, 5);
  });

  it("finds the peak backswing rotation, not just the top frame", () => {
    const frames = swingFrames();
    // Overshoot past the detected top frame and unwind back to 80 there.
    frames[7] = frame(7, 110, 50);
    const rotation = computeRotation3d(frames, PHASES);

    expect(rotation.peakTorso?.degrees).toBeCloseTo(110, 5);
    expect(rotation.peakPelvis?.degrees).toBeCloseTo(50, 5);
    expect(rotation.torsoAtTop?.degrees).toBeCloseTo(90, 5);
  });

  it("carries a low confidence through when the joints are barely visible", () => {
    const rotation = computeRotation3d(swingFrames({ visibility: 0.2 }), PHASES);

    expect(rotation.torsoAtTop?.degrees).toBeCloseTo(90, 5);
    expect(rotation.torsoAtTop?.confidence).toBe(0);
    expect(rotation.confidence).toBe(0);
  });

  it("reports unavailable for a clip with no 3D pose data", () => {
    const rotation = computeRotation3d(swingFrames({ world: false }), PHASES);

    expect(rotation.available).toBe(false);
    expect(rotation.torsoAtTop).toBeNull();
    expect(rotation.pelvisAtTop).toBeNull();
    expect(rotation.peakTorso).toBeNull();
  });

  it("reports unavailable when the address frame itself has no 3D pose", () => {
    const frames = swingFrames();
    frames[0] = frame(0, 0, 0, { world: false });
    const rotation = computeRotation3d(frames, PHASES);

    expect(rotation.available).toBe(false);
    expect(rotation.torsoAtTop).toBeNull();
  });

  it("returns null readings when the top of the backswing wasn't detected", () => {
    const rotation = computeRotation3d(swingFrames(), { ...PHASES, top: null, impact: null });

    expect(rotation.available).toBe(true);
    expect(rotation.torsoAtTop).toBeNull();
    expect(rotation.torsoAtImpact).toBeNull();
    expect(rotation.confidence).toBe(0);
  });
});
