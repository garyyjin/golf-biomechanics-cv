import { describe, expect, it } from "vitest";
import { computeSwingSamples } from "./calibration";
import { computeMetricValue } from "./feedback";
import {
  LEFT_HIP,
  LEFT_SHOULDER,
  LEFT_WRIST,
  RIGHT_HIP,
  RIGHT_SHOULDER,
  RIGHT_WRIST,
} from "./geometry";
import { detectPhases } from "./phases";
import { makeLandmarks } from "./testUtils";
import type { AnalysisResponse, PoseFrame } from "./types";

const FPS = 30;

function hold(value: number, n: number): number[] {
  return Array.from({ length: n }, () => value);
}

function ramp(from: number, to: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
}

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

const CLEAN_SWING_Y: number[] = [
  ...hold(0.9, 15),
  ...ramp(0.9, 0.3, 30),
  ...hold(0.3, 5),
  ...ramp(0.3, 0.88, 7),
  ...hold(0.88, 3),
  ...ramp(0.88, 0.25, 30),
];

function makeAnalysis(frames: PoseFrame[], view: AnalysisResponse["view"] = "face_on"): AnalysisResponse {
  return {
    fps: FPS,
    width: 100,
    height: 100,
    frame_count: frames.length,
    view,
    handedness: "right",
    quality: "accurate",
    frames,
  };
}

describe("computeSwingSamples", () => {
  it("cross-checks each sample's value against computeMetricValue for the same frame", () => {
    const frames = makeSwingFrames(CLEAN_SWING_Y, FPS);
    const analysis = makeAnalysis(frames);
    const samples = computeSwingSamples(analysis);

    expect(samples.length).toBeGreaterThan(0);

    const aspect = analysis.width / analysis.height;
    const phases = detectPhases(frames, analysis.handedness, analysis.fps);
    const addressFrame = phases.address !== null ? frames[phases.address] : null;

    for (const sample of samples) {
      const frameIndex = phases[sample.phase];
      expect(frameIndex).not.toBeNull();
      const expected = computeMetricValue(
        sample.metric,
        frames[frameIndex!],
        analysis.view,
        analysis.handedness,
        aspect,
        addressFrame,
      );
      expect(sample.value).toBeCloseTo(expected!, 6);
    }
  });

  it("only returns address-phase samples when no swing motion is detected", () => {
    const frames = makeSwingFrames(hold(0.5, 60), FPS);
    const analysis = makeAnalysis(frames);
    const samples = computeSwingSamples(analysis);
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.every((s) => s.phase === "address")).toBe(true);
  });

  it("pulls the down-the-line metric list for a down-the-line analysis", () => {
    const frames = makeSwingFrames(CLEAN_SWING_Y, FPS);
    const analysis = makeAnalysis(frames, "down_the_line");
    const samples = computeSwingSamples(analysis);

    const metrics = new Set(samples.map((s) => s.metric));
    expect(metrics.has("shoulderTurn")).toBe(false); // face_on-only metric
    expect([...metrics].some((m) => m === "hipTurn" || m === "planeAngle" || m === "spineRetention")).toBe(true);
  });
});
