import { describe, expect, it } from "vitest";
import {
  LEFT_HIP,
  LEFT_SHOULDER,
  LEFT_WRIST,
  RIGHT_HIP,
  RIGHT_SHOULDER,
  RIGHT_WRIST,
  angleFromHorizontalDeg,
  angleFromVerticalDeg,
  computeAddressRefs,
  computeOverlayLines,
  findAddressFrame,
  hipLine,
  midpoint,
  normalizeLandmarksForComparison,
  shoulderLine,
  sideIndices,
  spineLine,
  swayReferenceX,
  swingPlaneLine,
  visiblePoint,
} from "./geometry";
import type { AddressRefs } from "./geometry";
import { makeLandmarks } from "./testUtils";
import type { PoseFrame } from "./types";

const EMPTY_REFS: AddressRefs = { swayX: null, plane: null };

describe("sideIndices", () => {
  it("right-handed: lead is the MediaPipe left side", () => {
    expect(sideIndices("right")).toEqual({
      leadShoulder: LEFT_SHOULDER,
      trailShoulder: RIGHT_SHOULDER,
      leadHip: LEFT_HIP,
      trailHip: RIGHT_HIP,
      leadWrist: LEFT_WRIST,
      trailWrist: RIGHT_WRIST,
    });
  });

  it("left-handed: sides swap", () => {
    expect(sideIndices("left")).toEqual({
      leadShoulder: RIGHT_SHOULDER,
      trailShoulder: LEFT_SHOULDER,
      leadHip: RIGHT_HIP,
      trailHip: LEFT_HIP,
      leadWrist: RIGHT_WRIST,
      trailWrist: LEFT_WRIST,
    });
  });
});

describe("midpoint", () => {
  it("averages both coordinates", () => {
    expect(midpoint({ x: 0.25, y: 0.5 }, { x: 0.75, y: 1 })).toEqual({ x: 0.5, y: 0.75 });
  });
});

describe("visiblePoint", () => {
  it("returns the point at the visibility threshold", () => {
    const landmarks = makeLandmarks({ 5: { x: 0.3, y: 0.7, visibility: 0.5 } });
    expect(visiblePoint(landmarks, 5)).toEqual({ x: 0.3, y: 0.7, z: 0 });
  });

  it("returns null below the visibility threshold", () => {
    const landmarks = makeLandmarks({ 5: { x: 0.3, y: 0.7, visibility: 0.4 } });
    expect(visiblePoint(landmarks, 5)).toBeNull();
  });
});

describe("angleFromVerticalDeg", () => {
  it("is 0 for a vertical line", () => {
    expect(angleFromVerticalDeg({ x: 0.5, y: 0.8 }, { x: 0.5, y: 0.4 }, 1)).toBe(0);
  });

  it("is 45 when dx equals the upward dy at aspect 1", () => {
    expect(angleFromVerticalDeg({ x: 0.5, y: 0.8 }, { x: 0.9, y: 0.4 }, 1)).toBeCloseTo(45, 6);
  });

  it("matches a hand-computed 3-4-5 triangle: atan(0.3/0.4) = 36.8699", () => {
    expect(angleFromVerticalDeg({ x: 0.2, y: 0.6 }, { x: 0.5, y: 0.2 }, 1)).toBeCloseTo(
      36.8699,
      3,
    );
  });

  it("corrects for aspect ratio: same points at aspect 2 give atan(0.6/0.4) = 56.3099", () => {
    expect(angleFromVerticalDeg({ x: 0.2, y: 0.6 }, { x: 0.5, y: 0.2 }, 2)).toBeCloseTo(
      56.3099,
      3,
    );
  });

  it("is negative when the top leans toward -x", () => {
    expect(angleFromVerticalDeg({ x: 0.5, y: 0.6 }, { x: 0.2, y: 0.2 }, 1)).toBeCloseTo(
      -36.8699,
      3,
    );
  });
});

describe("angleFromHorizontalDeg", () => {
  it("is 0 for a level line", () => {
    expect(angleFromHorizontalDeg({ x: 0.3, y: 0.5 }, { x: 0.7, y: 0.5 }, 1)).toBe(0);
  });

  it("is +45 when the lead end is higher on screen", () => {
    expect(angleFromHorizontalDeg({ x: 0.3, y: 0.3 }, { x: 0.7, y: 0.7 }, 1)).toBeCloseTo(45, 6);
  });

  it("is -45 when the trail end is higher on screen", () => {
    expect(angleFromHorizontalDeg({ x: 0.3, y: 0.7 }, { x: 0.7, y: 0.3 }, 1)).toBeCloseTo(-45, 6);
  });

  it("matches a hand-computed 3-4-5 triangle: atan(0.3/0.4) = 36.8699", () => {
    expect(angleFromHorizontalDeg({ x: 0.2, y: 0.5 }, { x: 0.6, y: 0.8 }, 1)).toBeCloseTo(
      36.8699,
      3,
    );
  });

  it("corrects for aspect ratio: dx 0.4 at aspect 0.5 gives atan(0.3/0.2) = 56.3099", () => {
    expect(angleFromHorizontalDeg({ x: 0.2, y: 0.5 }, { x: 0.6, y: 0.8 }, 0.5)).toBeCloseTo(
      56.3099,
      3,
    );
  });

  it("is mirror-safe: swapping x positions keeps the sign", () => {
    expect(angleFromHorizontalDeg({ x: 0.7, y: 0.3 }, { x: 0.3, y: 0.7 }, 1)).toBeCloseTo(45, 6);
  });
});

describe("spineLine", () => {
  const symmetric = makeLandmarks({
    [LEFT_SHOULDER]: { x: 0.4, y: 0.3 },
    [RIGHT_SHOULDER]: { x: 0.6, y: 0.3 },
    [LEFT_HIP]: { x: 0.4, y: 0.7 },
    [RIGHT_HIP]: { x: 0.6, y: 0.7 },
  });

  it("runs mid-hip to mid-shoulder with angle 0 for an upright pose", () => {
    const result = spineLine(symmetric, 1);
    expect(result).not.toBeNull();
    expect(result!.a).toEqual({ x: 0.5, y: 0.7, z: 0 });
    expect(result!.b).toEqual({ x: 0.5, y: 0.3, z: 0 });
    expect(result!.angleDeg).toBe(0);
  });

  it("matches a hand-computed tilt: shoulders shifted +0.2 give atan(0.2/0.4) = 26.5651", () => {
    const tilted = makeLandmarks({
      [LEFT_SHOULDER]: { x: 0.6, y: 0.3 },
      [RIGHT_SHOULDER]: { x: 0.8, y: 0.3 },
      [LEFT_HIP]: { x: 0.4, y: 0.7 },
      [RIGHT_HIP]: { x: 0.6, y: 0.7 },
    });
    expect(spineLine(tilted, 1)!.angleDeg).toBeCloseTo(26.5651, 3);
  });

  it("returns null for null landmarks", () => {
    expect(spineLine(null, 1)).toBeNull();
  });

  it("returns null when one hip is below the visibility threshold", () => {
    const hidden = makeLandmarks({
      [LEFT_SHOULDER]: { x: 0.4, y: 0.3 },
      [RIGHT_SHOULDER]: { x: 0.6, y: 0.3 },
      [LEFT_HIP]: { x: 0.4, y: 0.7, visibility: 0.3 },
      [RIGHT_HIP]: { x: 0.6, y: 0.7 },
    });
    expect(spineLine(hidden, 1)).toBeNull();
  });
});

describe("shoulderLine", () => {
  const landmarks = makeLandmarks({
    [LEFT_SHOULDER]: { x: 0.6, y: 0.4 },
    [RIGHT_SHOULDER]: { x: 0.4, y: 0.5 },
  });

  it("right-handed: lead shoulder higher gives a positive hand-computed angle", () => {
    const result = shoulderLine(landmarks, "right", 1);
    expect(result!.a).toEqual({ x: 0.6, y: 0.4, z: 0 });
    expect(result!.b).toEqual({ x: 0.4, y: 0.5, z: 0 });
    expect(result!.angleDeg).toBeCloseTo(26.5651, 3); // atan(0.1/0.2)
  });

  it("left-handed: the same pose flips sign", () => {
    expect(shoulderLine(landmarks, "left", 1)!.angleDeg).toBeCloseTo(-26.5651, 3);
  });

  it("returns null for null landmarks or a hidden shoulder", () => {
    expect(shoulderLine(null, "right", 1)).toBeNull();
    const hidden = makeLandmarks({
      [LEFT_SHOULDER]: { x: 0.6, y: 0.4, visibility: 0.2 },
      [RIGHT_SHOULDER]: { x: 0.4, y: 0.5 },
    });
    expect(shoulderLine(hidden, "right", 1)).toBeNull();
  });
});

describe("hipLine", () => {
  const landmarks = makeLandmarks({
    [LEFT_HIP]: { x: 0.55, y: 0.62 },
    [RIGHT_HIP]: { x: 0.45, y: 0.66 },
  });

  it("right-handed: lead hip higher gives a positive hand-computed angle", () => {
    const result = hipLine(landmarks, "right", 1);
    expect(result!.a).toEqual({ x: 0.55, y: 0.62, z: 0 });
    expect(result!.b).toEqual({ x: 0.45, y: 0.66, z: 0 });
    expect(result!.angleDeg).toBeCloseTo(21.8014, 3); // atan(0.04/0.1)
  });

  it("left-handed: the same pose flips sign", () => {
    expect(hipLine(landmarks, "left", 1)!.angleDeg).toBeCloseTo(-21.8014, 3);
  });

  it("returns null for null landmarks or a hidden hip", () => {
    expect(hipLine(null, "right", 1)).toBeNull();
    const hidden = makeLandmarks({
      [LEFT_HIP]: { x: 0.55, y: 0.62 },
      [RIGHT_HIP]: { x: 0.45, y: 0.66, visibility: 0.1 },
    });
    expect(hipLine(hidden, "right", 1)).toBeNull();
  });
});

describe("swayReferenceX", () => {
  const landmarks = makeLandmarks({
    [LEFT_HIP]: { x: 0.55, y: 0.62 },
    [RIGHT_HIP]: { x: 0.45, y: 0.66 },
  });

  it("right-handed: uses the hip midpoint", () => {
    expect(swayReferenceX(landmarks, "right")).toBe(0.5);
  });

  it("left-handed: uses the hip midpoint", () => {
    expect(swayReferenceX(landmarks, "left")).toBe(0.5);
  });

  it("returns null for null landmarks or a hidden lead hip", () => {
    expect(swayReferenceX(null, "right")).toBeNull();
    const hidden = makeLandmarks({
      [LEFT_HIP]: { x: 0.55, y: 0.62, visibility: 0.3 },
      [RIGHT_HIP]: { x: 0.45, y: 0.66 },
    });
    expect(swayReferenceX(hidden, "right")).toBeNull();
  });

  it("returns null for a hidden trail hip", () => {
    const hidden = makeLandmarks({
      [LEFT_HIP]: { x: 0.55, y: 0.62 },
      [RIGHT_HIP]: { x: 0.45, y: 0.66, visibility: 0.3 },
    });
    expect(swayReferenceX(hidden, "right")).toBeNull();
  });
});

describe("swingPlaneLine", () => {
  const landmarks = makeLandmarks({
    [LEFT_WRIST]: { x: 0.5, y: 0.9 },
    [RIGHT_WRIST]: { x: 0.54, y: 0.9 },
    [RIGHT_SHOULDER]: { x: 0.6, y: 0.5 },
    [LEFT_SHOULDER]: { x: 0.44, y: 0.5 },
  });

  it("runs wrist midpoint to trail shoulder with a hand-computed inclination", () => {
    const result = swingPlaneLine(landmarks, "right", 1);
    expect(result!.a).toEqual({ x: 0.52, y: 0.9, z: 0 });
    expect(result!.b).toEqual({ x: 0.6, y: 0.5, z: 0 });
    expect(result!.angleDeg).toBeCloseTo(78.6901, 3); // atan(0.4/0.08)
  });

  it("left-handed: uses the MediaPipe left shoulder as trail", () => {
    expect(swingPlaneLine(landmarks, "left", 1)!.b).toEqual({ x: 0.44, y: 0.5, z: 0 });
  });

  it("returns null for null landmarks or a hidden wrist", () => {
    expect(swingPlaneLine(null, "right", 1)).toBeNull();
    const hidden = makeLandmarks({
      [LEFT_WRIST]: { x: 0.5, y: 0.9, visibility: 0.2 },
      [RIGHT_WRIST]: { x: 0.54, y: 0.9 },
      [RIGHT_SHOULDER]: { x: 0.6, y: 0.5 },
    });
    expect(swingPlaneLine(hidden, "right", 1)).toBeNull();
  });
});

describe("normalizeLandmarksForComparison", () => {
  const landmarks = makeLandmarks({
    [LEFT_SHOULDER]: { x: 0.4, y: 0.3 },
    [RIGHT_SHOULDER]: { x: 0.6, y: 0.3 },
    [LEFT_HIP]: { x: 0.4, y: 0.7 },
    [RIGHT_HIP]: { x: 0.6, y: 0.7 },
    [LEFT_WRIST]: { x: 0.4, y: 0.9, visibility: 0.2 },
  });

  it("centers on the hip midpoint with torso length as 1 unit", () => {
    const result = normalizeLandmarksForComparison(landmarks, 1);
    expect(result).not.toBeNull();
    expect(result![LEFT_HIP].x).toBeCloseTo(-0.25, 6);
    expect(result![LEFT_HIP].y).toBeCloseTo(0, 6);
    expect(result![LEFT_HIP].visible).toBe(true);
    expect(result![RIGHT_HIP].x).toBeCloseTo(0.25, 6);
    expect(result![RIGHT_HIP].y).toBeCloseTo(0, 6);
    expect(result![LEFT_SHOULDER].y).toBeCloseTo(-1, 6);
  });

  it("marks low-visibility landmarks as not visible", () => {
    const result = normalizeLandmarksForComparison(landmarks, 1);
    expect(result![LEFT_WRIST].visible).toBe(false);
  });

  it("corrects for aspect ratio", () => {
    const shifted = makeLandmarks({
      [LEFT_SHOULDER]: { x: 0.3, y: 0.3 },
      [RIGHT_SHOULDER]: { x: 0.7, y: 0.3 },
      [LEFT_HIP]: { x: 0.4, y: 0.7 },
      [RIGHT_HIP]: { x: 0.6, y: 0.7 },
    });
    const aspect2 = normalizeLandmarksForComparison(shifted, 2);
    const aspect1 = normalizeLandmarksForComparison(shifted, 1);
    expect(aspect2![LEFT_SHOULDER].x).not.toBeCloseTo(aspect1![LEFT_SHOULDER].x, 3);
  });

  it("returns null for null landmarks", () => {
    expect(normalizeLandmarksForComparison(null, 1)).toBeNull();
  });

  it("returns null when a torso landmark is hidden", () => {
    const hidden = makeLandmarks({
      [LEFT_SHOULDER]: { x: 0.4, y: 0.3, visibility: 0.1 },
      [RIGHT_SHOULDER]: { x: 0.6, y: 0.3 },
      [LEFT_HIP]: { x: 0.4, y: 0.7 },
      [RIGHT_HIP]: { x: 0.6, y: 0.7 },
    });
    expect(normalizeLandmarksForComparison(hidden, 1)).toBeNull();
  });
});

describe("findAddressFrame", () => {
  it("prefers frame 0 when it has landmarks", () => {
    const frames: PoseFrame[] = [
      { index: 0, t: 0, landmarks: makeLandmarks({}) },
      { index: 1, t: 0.033, landmarks: makeLandmarks({}) },
    ];
    expect(findAddressFrame(frames)).toBe(frames[0]);
  });

  it("falls back to the first frame with landmarks", () => {
    const frames: PoseFrame[] = [
      { index: 0, t: 0, landmarks: null },
      { index: 1, t: 0.033, landmarks: makeLandmarks({}) },
    ];
    expect(findAddressFrame(frames)).toBe(frames[1]);
  });

  it("returns null when no frame has landmarks", () => {
    expect(findAddressFrame([{ index: 0, t: 0, landmarks: null }])).toBeNull();
  });
});

describe("computeAddressRefs", () => {
  it("computes sway x and plane from the address frame", () => {
    const frames: PoseFrame[] = [
      { index: 0, t: 0, landmarks: null },
      {
        index: 1,
        t: 0.033,
        landmarks: makeLandmarks({
          [LEFT_HIP]: { x: 0.55, y: 0.62 },
          [RIGHT_HIP]: { x: 0.45, y: 0.66 },
          [LEFT_WRIST]: { x: 0.5, y: 0.9 },
          [RIGHT_WRIST]: { x: 0.54, y: 0.9 },
          [RIGHT_SHOULDER]: { x: 0.6, y: 0.5 },
        }),
      },
    ];
    const refs = computeAddressRefs(frames, "right", 1);
    expect(refs.swayX).toBe(0.5);
    expect(refs.plane!.a).toEqual({ x: 0.52, y: 0.9, z: 0 });
    expect(refs.plane!.b).toEqual({ x: 0.6, y: 0.5, z: 0 });
  });

  it("returns all-null refs when no pose was ever detected", () => {
    const frames: PoseFrame[] = [{ index: 0, t: 0, landmarks: null }];
    expect(computeAddressRefs(frames, "right", 1)).toEqual({ swayX: null, plane: null });
  });
});

describe("computeOverlayLines", () => {
  const fullPose = makeLandmarks({
    [LEFT_SHOULDER]: { x: 0.4, y: 0.3 },
    [RIGHT_SHOULDER]: { x: 0.6, y: 0.3 },
    [LEFT_HIP]: { x: 0.4, y: 0.7 },
    [RIGHT_HIP]: { x: 0.6, y: 0.7 },
    [LEFT_WRIST]: { x: 0.5, y: 0.9 },
    [RIGHT_WRIST]: { x: 0.54, y: 0.9 },
  });
  const refs: AddressRefs = {
    swayX: 0.4,
    plane: { a: { x: 0.52, y: 0.9 }, b: { x: 0.6, y: 0.5 }, angleDeg: 78.7 },
  };

  it("face-on: spine, shoulder, hip, sway in order", () => {
    const lines = computeOverlayLines("face_on", fullPose, "right", 1, refs);
    expect(lines.map((l) => l.id)).toEqual(["spine", "shoulder", "hip", "sway"]);
    const sway = lines[3];
    expect(sway.a).toEqual({ x: 0.4, y: 0 });
    expect(sway.b).toEqual({ x: 0.4, y: 1 });
    expect(sway.angleDeg).toBeNull();
    expect(sway.fixed).toBe(true);
    expect(lines[0].label).toBe("Spine tilt");
  });

  it("down-the-line: plane, spine, hip in order, with the approx plane extended", () => {
    const lines = computeOverlayLines("down_the_line", fullPose, "right", 1, refs);
    expect(lines.map((l) => l.id)).toEqual(["plane", "spine", "hip"]);
    expect(lines[0].label).toBe("Plane (approx)");
    expect(lines[0].extend).toBe(true);
    expect(lines[0].fixed).toBe(true);
    expect(lines[0].angleDeg).toBe(78.7);
    expect(lines[1].label).toBe("Forward bend");
  });

  it("null current landmarks: only the fixed references remain", () => {
    expect(computeOverlayLines("face_on", null, "right", 1, refs).map((l) => l.id)).toEqual([
      "sway",
    ]);
    expect(
      computeOverlayLines("down_the_line", null, "right", 1, refs).map((l) => l.id),
    ).toEqual(["plane"]);
  });

  it("missing references are omitted", () => {
    expect(computeOverlayLines("face_on", null, "right", 1, EMPTY_REFS)).toEqual([]);
    expect(computeOverlayLines("down_the_line", null, "right", 1, EMPTY_REFS)).toEqual([]);
  });
});
