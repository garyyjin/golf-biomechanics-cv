import { describe, expect, it } from "vitest";
import type { SwingPhases } from "./phases";
import { computeTempoScore, describeTempoRatio, tempoRatioScore } from "./tempo";
import type { PoseFrame } from "./types";

const FPS = 30;
function frames(count: number): PoseFrame[] {
  return Array.from({ length: count }, (_, index) => ({ index, t: index / FPS, landmarks: null }));
}

function phases(overrides: Partial<SwingPhases> = {}): SwingPhases {
  return {
    address: 0,
    takeaway: 10,
    top: 40,
    downswing: 45,
    impact: 50,
    followThrough: 70,
    ...overrides,
  };
}

describe("tempoRatioScore", () => {
  it("gives 10 when the reference is untouched", () => {
    expect(tempoRatioScore(1)).toBe(10);
  });

  it("gives 0 at double or half speed", () => {
    expect(tempoRatioScore(2)).toBe(0);
    expect(tempoRatioScore(0.5)).toBe(0);
  });

  it("scores moderate deviations on a log scale", () => {
    expect(tempoRatioScore(1.2)).toBeCloseTo(7.37, 2);
    expect(tempoRatioScore(1 / 1.2)).toBeCloseTo(tempoRatioScore(1.2), 10);
  });

  it("clamps extreme ratios to 0", () => {
    expect(tempoRatioScore(4)).toBe(0);
    expect(tempoRatioScore(0.1)).toBe(0);
  });
});

describe("computeTempoScore", () => {
  it("scores 10 across the board for identical timings", () => {
    const result = computeTempoScore(phases(), phases(), frames(80), frames(80));
    expect(result.overall).toBe(10);
    expect(result.backswing).toEqual({ ratio: 1, score: 10 });
    expect(result.downswing).toEqual({ ratio: 1, score: 10 });
  });

  it("zeroes the backswing when the reference's takes twice as long", () => {
    // user takeaway→top spans 30 frames; reference spans 60.
    const ref = phases({ takeaway: 10, top: 70, impact: 80 });
    const result = computeTempoScore(phases(), ref, frames(80), frames(100));
    expect(result.backswing).toEqual({ ratio: 2, score: 0 });
    // downswing: user 10 frames, ref 10 frames → untouched.
    expect(result.downswing!.ratio).toBeCloseTo(1, 10);
    expect(result.downswing!.score).toBeCloseTo(10, 10);
    expect(result.overall).toBeCloseTo(5, 10);
  });

  it("drops the downswing when impact is undetected and averages what's left", () => {
    const result = computeTempoScore(
      phases({ impact: null }),
      phases(),
      frames(80),
      frames(80),
    );
    expect(result.downswing).toBeNull();
    expect(result.overall).toBe(result.backswing!.score);
  });

  it("returns null overall when top is missing on one side", () => {
    const result = computeTempoScore(phases({ top: null }), phases(), frames(80), frames(80));
    expect(result.backswing).toBeNull();
    expect(result.downswing).toBeNull();
    expect(result.overall).toBeNull();
  });

  it("treats zero-width segments as undetected instead of producing NaN", () => {
    const result = computeTempoScore(
      phases({ takeaway: 40, top: 40 }),
      phases(),
      frames(80),
      frames(80),
    );
    expect(result.backswing).toBeNull();
    expect(result.overall).toBe(result.downswing!.score);
  });
});

describe("describeTempoRatio", () => {
  it("describes speed-ups, slow-downs, and matches", () => {
    expect(describeTempoRatio(1.3)).toBe("reference sped up 1.30x");
    expect(describeTempoRatio(0.8)).toBe("reference slowed to 0.80x");
    expect(describeTempoRatio(1.0)).toBe("matched your tempo");
    expect(describeTempoRatio(1.01)).toBe("matched your tempo");
  });
});
