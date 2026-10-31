import { describe, expect, it } from "vitest";
import { LEFT_HIP, LEFT_SHOULDER, RIGHT_HIP, RIGHT_SHOULDER } from "./geometry";
import { measureMetricAtPhase, phaseWindowFrames } from "./measurement";
import { makeLandmarks } from "./testUtils";
import type { PoseFrame } from "./types";

const FPS = 30;
const ASPECT = 1;

// Upright shoulder/hip stack -> spineTilt 0. Callers shift a shoulder to
// create an off-value frame.
function frame(index: number, options: { spineTiltDeg?: number; visibility?: number } = {}): PoseFrame {
  const { spineTiltDeg = 0, visibility = 1 } = options;
  const shoulderX = 0.5 + Math.tan((spineTiltDeg * Math.PI) / 180) * 0.22;
  return {
    index,
    t: index / FPS,
    landmarks: makeLandmarks({
      [LEFT_SHOULDER]: { x: shoulderX, y: 0.4, z: 0, visibility },
      [RIGHT_SHOULDER]: { x: shoulderX, y: 0.4, z: 0, visibility },
      [LEFT_HIP]: { x: 0.5, y: 0.62, z: 0, visibility },
      [RIGHT_HIP]: { x: 0.5, y: 0.62, z: 0, visibility },
    }),
  };
}

function framesWithOutlier(outlierIndex: number, outlierDeg: number): PoseFrame[] {
  return Array.from({ length: 9 }, (_, i) =>
    frame(i, { spineTiltDeg: i === outlierIndex ? outlierDeg : 0 }),
  );
}

describe("phaseWindowFrames", () => {
  it("never returns zero, even for a very low frame rate", () => {
    expect(phaseWindowFrames(1)).toBe(1);
    expect(phaseWindowFrames(30)).toBe(2);
    expect(phaseWindowFrames(60)).toBe(5);
  });
});

describe("measureMetricAtPhase", () => {
  it("takes the median across the window so one bad frame can't move the reading", () => {
    const frames = framesWithOutlier(4, 40);
    const measurement = measureMetricAtPhase("spineTilt", frames, 4, "face_on", "right", ASPECT, 0, 2);

    expect(measurement.samples).toBe(5);
    // A single-frame read at index 4 would report 40deg; the median of the
    // window (four clean frames, one outlier) stays at 0.
    expect(measurement.value).toBeCloseTo(0, 6);
  });

  it("skips frames where the metric couldn't be measured at all", () => {
    const frames = framesWithOutlier(4, 40);
    frames[3] = { index: 3, t: 3 / FPS, landmarks: null }; // detector miss
    const measurement = measureMetricAtPhase("spineTilt", frames, 4, "face_on", "right", ASPECT, 0, 2);

    expect(measurement.samples).toBe(4);
    expect(measurement.value).toBeCloseTo(0, 6);
  });

  it("drops to a null measurement when the metric's joints are barely visible", () => {
    const frames = [frame(4, { visibility: 0.2 })];
    const measurement = measureMetricAtPhase("spineTilt", frames, 0, "face_on", "right", ASPECT, null, 2);

    expect(measurement.value).toBeNull();
    expect(measurement.confidence).toBe(0);
    expect(measurement.samples).toBe(0);
  });

  it("reports confidence as the mean visibility of the metric's own joints", () => {
    const frames = [frame(4, { visibility: 0.7 })];
    const measurement = measureMetricAtPhase("spineTilt", frames, 0, "face_on", "right", ASPECT, null, 2);

    expect(measurement.confidence).toBeCloseTo(0.7, 6);
  });

  it("counts the address frame's visibility for spine retention", () => {
    const address = frame(0, { visibility: 0.6 });
    const phaseFrame = frame(4, { visibility: 1 });
    const measurement = measureMetricAtPhase(
      "spineRetention",
      [address, phaseFrame],
      1,
      "face_on",
      "right",
      ASPECT,
      0,
      0,
    );

    // Halfway between the phase frame's own joints and the address pose it's
    // differenced against -- a clean phase frame can't rescue a poor address.
    expect(measurement.confidence).toBeCloseTo(0.8, 6);
    expect(measurement.value).toBeCloseTo(0, 6);
  });

  it("clamps the window to the frames that exist", () => {
    const frames = framesWithOutlier(0, 0);
    const measurement = measureMetricAtPhase("spineTilt", frames, 0, "face_on", "right", ASPECT, 0, 4);

    expect(measurement.samples).toBe(5); // indices 0-4, not -4..4
  });
});
