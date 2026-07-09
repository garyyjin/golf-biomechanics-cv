import { describe, expect, it } from "vitest";
import type { BenchmarkTable } from "./benchmarks";
import { DEFAULT_BENCHMARKS } from "./benchmarks.default";
import { SCORED_PHASES, computeFeedback } from "./feedback";
import { LEFT_HIP, LEFT_SHOULDER, LEFT_WRIST, RIGHT_HIP, RIGHT_SHOULDER, RIGHT_WRIST } from "./geometry";
import { makeLandmarks } from "./testUtils";
import type { AnalysisResponse, PoseFrame } from "./types";

const FPS = 30;

function hold(value: number, n: number): number[] {
  return Array.from({ length: n }, () => value);
}

function ramp(from: number, to: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
}

// Fixed body landmarks reused across every frame (same hand-computed values
// as geometry.test.ts): shoulderTurn = atan(0.1/0.2) = 26.5651deg,
// hipTurn = atan(0.04/0.1) = 21.8014deg, spineTilt = 0deg (upright).
const BODY_OVERRIDES = {
  [LEFT_SHOULDER]: { x: 0.6, y: 0.4, z: 0, visibility: 1 },
  [RIGHT_SHOULDER]: { x: 0.4, y: 0.5, z: 0, visibility: 1 },
  [LEFT_HIP]: { x: 0.55, y: 0.62, z: 0, visibility: 1 },
  [RIGHT_HIP]: { x: 0.45, y: 0.66, z: 0, visibility: 1 },
};

function makeSwingFrames(handY: (number | null)[], fps: number): PoseFrame[] {
  return handY.map((y, index) => ({
    index,
    t: index / fps,
    landmarks:
      y === null
        ? null
        : makeLandmarks({
            ...BODY_OVERRIDES,
            [LEFT_WRIST]: { x: 0.5, y, z: 0, visibility: 1 },
            [RIGHT_WRIST]: { x: 0.5, y, z: 0, visibility: 1 },
          }),
  }));
}

const CLEAN_SWING_Y: number[] = [...hold(0.9, 15), ...ramp(0.9, 0.3, 30), ...hold(0.3, 5), ...ramp(0.3, 0.88, 7)];

function makeAnalysis(frames: PoseFrame[]): AnalysisResponse {
  return {
    fps: FPS,
    width: 100,
    height: 100,
    frame_count: frames.length,
    view: "face_on",
    handedness: "right",
    quality: "fast",
    frames,
  };
}

const CUSTOM_BENCHMARKS: BenchmarkTable = {
  face_on: {
    address: [{ metric: "spineTilt", label: "Spine tilt", range: { min: 10, max: 20 }, source: "published" }],
    top: [{ metric: "shoulderTurn", label: "Shoulder turn", range: { min: 20, max: 30 }, source: "published" }],
    impact: [{ metric: "hipTurn", label: "Hip turn", range: { min: 5, max: 15 }, source: "published" }],
  },
  down_the_line: {},
};

describe("computeFeedback", () => {
  it("classifies below/within/above from a detected swing", () => {
    const analysis = makeAnalysis(makeSwingFrames(CLEAN_SWING_Y, FPS));
    const result = computeFeedback(analysis, CUSTOM_BENCHMARKS);

    expect(result.phases.address).not.toBeNull();
    expect(result.phases.top).not.toBeNull();

    const spineItem = result.items.find((i) => i.metric === "spineTilt")!;
    expect(spineItem.value).toBeCloseTo(0, 3);
    expect(spineItem.status).toBe("below");

    const shoulderItem = result.items.find((i) => i.metric === "shoulderTurn")!;
    expect(shoulderItem.value).toBeCloseTo(26.5651, 3);
    expect(shoulderItem.status).toBe("within");

    const hipItem = result.items.find((i) => i.metric === "hipTurn")!;
    expect(hipItem.value).toBeCloseTo(21.8014, 3);
    expect(hipItem.status).toBe("above");
  });

  it("marks items undetected when the phase can't be found", () => {
    const flatFrames = makeSwingFrames(hold(0.5, 60), FPS);
    const analysis = makeAnalysis(flatFrames);
    const result = computeFeedback(analysis, CUSTOM_BENCHMARKS);

    expect(result.phases.top).toBeNull();
    expect(result.phases.impact).toBeNull();

    const shoulderItem = result.items.find((i) => i.metric === "shoulderTurn")!;
    expect(shoulderItem.status).toBe("undetected");
    expect(shoulderItem.value).toBeNull();
    expect(shoulderItem.frameIndex).toBeNull();

    const hipItem = result.items.find((i) => i.metric === "hipTurn")!;
    expect(hipItem.status).toBe("undetected");
  });

  it("scores all six phases against the default benchmarks", () => {
    // Like CLEAN_SWING_Y but with a post-impact rise so follow-through is
    // detectable too.
    const fullSwingY = [...hold(0.9, 15), ...ramp(0.9, 0.3, 30), ...hold(0.3, 5), ...ramp(0.3, 0.88, 7), ...ramp(0.88, 0.35, 12)];
    const analysis = makeAnalysis(makeSwingFrames(fullSwingY, FPS));
    const result = computeFeedback(analysis, DEFAULT_BENCHMARKS);

    expect(SCORED_PHASES).toEqual(["address", "takeaway", "top", "downswing", "impact", "followThrough"]);
    for (const phase of SCORED_PHASES) {
      expect(result.phases[phase], `${phase} frame`).not.toBeNull();
      const items = result.items.filter((i) => i.phase === phase);
      expect(items.length, `${phase} items`).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.value, `${phase}/${item.metric} value`).not.toBeNull();
        expect(item.status, `${phase}/${item.metric} status`).not.toBe("undetected");
      }
    }
  });

  it("produces no items for a phase with no benchmark entries", () => {
    const analysis = makeAnalysis(makeSwingFrames(CLEAN_SWING_Y, FPS));
    const emptyTable: BenchmarkTable = { face_on: {}, down_the_line: {} };
    const result = computeFeedback(analysis, emptyTable);
    expect(result.items).toEqual([]);
  });
});
