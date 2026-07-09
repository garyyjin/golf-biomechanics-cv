import { describe, expect, it } from "vitest";
import { LandmarkSmoother, PointSmoother } from "./smoothing";
import type { Landmark } from "./types";

function makeFrame(x: number, visibility: number): Landmark[] {
  return [{ x, y: 0, z: 0, visibility }];
}

describe("LandmarkSmoother", () => {
  it("reproduces the fixed-alpha output at visibility=1", () => {
    const smoother = new LandmarkSmoother();
    smoother.apply(makeFrame(0, 1), 0);
    const result = smoother.apply(makeFrame(1, 1), 1);
    expect(result![0].x).toBeCloseTo(0.4);
  });

  it("blends a low-visibility sample less aggressively than a high-visibility one", () => {
    const lowVis = new LandmarkSmoother();
    lowVis.apply(makeFrame(0, 1), 0);
    const lowResult = lowVis.apply(makeFrame(1, 0.1), 1);

    const highVis = new LandmarkSmoother();
    highVis.apply(makeFrame(0, 1), 0);
    const highResult = highVis.apply(makeFrame(1, 1), 1);

    expect(lowResult![0].x).toBeLessThan(highResult![0].x);
  });

  it("resets on a null frame", () => {
    const smoother = new LandmarkSmoother();
    smoother.apply(makeFrame(0, 1), 0);
    expect(smoother.apply(null, 1)).toBeNull();
    const result = smoother.apply(makeFrame(1, 1), 2);
    // No prior state after reset — raw landmarks pass through unblended.
    expect(result![0].x).toBe(1);
  });

  it("resets on a discontinuous frame jump", () => {
    const smoother = new LandmarkSmoother();
    smoother.apply(makeFrame(0, 1), 0);
    const result = smoother.apply(makeFrame(1, 1), 5);
    expect(result![0].x).toBe(1);
  });

  it("returns the prior output when the same frame is redrawn", () => {
    const smoother = new LandmarkSmoother();
    smoother.apply(makeFrame(0, 1), 0);
    const first = smoother.apply(makeFrame(1, 1), 1);
    const second = smoother.apply(makeFrame(1, 1), 1);
    expect(second).toBe(first);
  });
});

describe("PointSmoother", () => {
  it("reproduces the fixed-alpha output", () => {
    const smoother = new PointSmoother();
    smoother.apply({ x: 0, y: 0 }, 0);
    const result = smoother.apply({ x: 1, y: 1 }, 1);
    expect(result!.x).toBeCloseTo(0.4);
    expect(result!.y).toBeCloseTo(0.4);
  });

  it("resets on a null point", () => {
    const smoother = new PointSmoother();
    smoother.apply({ x: 0, y: 0 }, 0);
    expect(smoother.apply(null, 1)).toBeNull();
    const result = smoother.apply({ x: 1, y: 1 }, 2);
    expect(result!.x).toBe(1);
  });

  it("resets on a discontinuous frame jump", () => {
    const smoother = new PointSmoother();
    smoother.apply({ x: 0, y: 0 }, 0);
    const result = smoother.apply({ x: 1, y: 1 }, 5);
    expect(result!.x).toBe(1);
  });

  it("returns the prior output when the same frame is redrawn", () => {
    const smoother = new PointSmoother();
    smoother.apply({ x: 0, y: 0 }, 0);
    const first = smoother.apply({ x: 1, y: 1 }, 1);
    const second = smoother.apply({ x: 1, y: 1 }, 1);
    expect(second).toBe(first);
  });
});
