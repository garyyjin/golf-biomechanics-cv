import { describe, expect, it } from "vitest";
import type { SwingPhases } from "./phases";
import {
  computeSwingTempo,
  computeTempoScore,
  describeSwingTempo,
  describeTempoRatio,
  formatTempoRatio,
  tempoRatioScore,
} from "./tempo";
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

describe("computeSwingTempo", () => {
  it("scores a textbook 3:1 swing a perfect 10", () => {
    // takeaway→top 30 frames (1.0s), top→impact 10 frames (0.333s) → 3:1.
    const result = computeSwingTempo(phases({ takeaway: 10, top: 40, impact: 50 }), frames(80));
    expect(result.ratio).toBeCloseTo(3, 10);
    expect(result.score).toBeCloseTo(10, 10);
    expect(result.backswingSeconds).toBeCloseTo(1, 10);
    expect(result.downswingSeconds).toBeCloseTo(1 / 3, 10);
  });

  it("needs no reference swing at all, unlike computeTempoScore", () => {
    // The whole point of this reading: one swing's own phases are enough.
    const result = computeSwingTempo(phases(), frames(80));
    expect(result.ratio).not.toBeNull();
    expect(result.score).not.toBeNull();
  });

  it("zeroes a swing twice or half the tour ratio, symmetrically", () => {
    // 6:1 — backswing 60 frames, downswing 10.
    // toBeCloseTo, not toBe(0): frame times are thirds of a second, so the
    // ratio lands a hair off exactly 6 and the clamp doesn't quite bite.
    const slow = computeSwingTempo(phases({ takeaway: 0, top: 60, impact: 70 }), frames(80));
    expect(slow.ratio).toBeCloseTo(6, 10);
    expect(slow.score).toBeCloseTo(0, 10);

    // 1.5:1 — backswing 15 frames, downswing 10.
    const quick = computeSwingTempo(phases({ takeaway: 0, top: 15, impact: 25 }), frames(80));
    expect(quick.ratio).toBeCloseTo(1.5, 10);
    expect(quick.score).toBeCloseTo(0, 10);
  });

  it("scores a common amateur 2:1 well below a 3:1", () => {
    const amateur = computeSwingTempo(phases({ takeaway: 0, top: 20, impact: 30 }), frames(80));
    expect(amateur.ratio).toBeCloseTo(2, 10);
    expect(amateur.score!).toBeGreaterThan(0);
    expect(amateur.score!).toBeLessThan(5);
  });

  it("keeps the ratio independent of how fast the whole swing is", () => {
    // Same 3:1 shape, one swing taking twice as long as the other. The ratio
    // is identical; only the raw seconds distinguish them.
    const quick = computeSwingTempo(phases({ takeaway: 0, top: 15, impact: 20 }), frames(80));
    const slow = computeSwingTempo(phases({ takeaway: 0, top: 30, impact: 40 }), frames(80));
    expect(quick.ratio).toBeCloseTo(slow.ratio!, 10);
    expect(slow.backswingSeconds).toBeCloseTo(quick.backswingSeconds! * 2, 10);
  });

  it("returns nulls when a phase is undetected", () => {
    const result = computeSwingTempo(phases({ top: null }), frames(80));
    expect(result).toEqual({
      ratio: null,
      score: null,
      backswingSeconds: null,
      downswingSeconds: null,
    });
  });

  it("treats a zero-width downswing as undetected instead of dividing by zero", () => {
    const result = computeSwingTempo(phases({ top: 40, impact: 40 }), frames(80));
    expect(result.ratio).toBeNull();
    expect(result.score).toBeNull();
    expect(result.backswingSeconds).not.toBeNull();
  });
});

describe("formatTempoRatio", () => {
  it("renders the ratio the way golfers read it", () => {
    expect(formatTempoRatio(3)).toBe("3.0 : 1");
    expect(formatTempoRatio(2.34)).toBe("2.3 : 1");
  });
});

describe("describeSwingTempo", () => {
  it("names which side of the standard the swing falls on", () => {
    expect(describeSwingTempo(3)).toBe("right on the 3:1 tour standard");
    expect(describeSwingTempo(3.1)).toBe("right on the 3:1 tour standard");
    expect(describeSwingTempo(4)).toBe("backswing is slow relative to your downswing");
    expect(describeSwingTempo(2)).toBe("backswing is quick relative to your downswing");
  });
});
