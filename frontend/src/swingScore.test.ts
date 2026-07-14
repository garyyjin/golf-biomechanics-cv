import { describe, expect, it } from "vitest";
import type { FeedbackItem, FeedbackResult } from "./feedback";
import { computeSwingScore, scoreBand } from "./swingScore";

const PHASES = { address: 0, takeaway: 10, top: 40, downswing: 45, impact: 50, followThrough: 70 };

function item(overrides: Partial<FeedbackItem>): FeedbackItem {
  return {
    phase: "address",
    phaseLabel: "Address",
    frameIndex: 0,
    metric: "spineTilt",
    metricLabel: "Spine tilt",
    value: 10,
    range: { min: 4, max: 15 },
    status: "within",
    source: "published",
    ...overrides,
  };
}

function result(items: FeedbackItem[]): FeedbackResult {
  return { phases: PHASES, items };
}

describe("scoreBand", () => {
  it("bands scores into good/fair/poor", () => {
    expect(scoreBand(100)).toBe("good");
    expect(scoreBand(80)).toBe("good");
    expect(scoreBand(79.9)).toBe("fair");
    expect(scoreBand(55)).toBe("fair");
    expect(scoreBand(54.9)).toBe("poor");
    expect(scoreBand(0)).toBe("poor");
  });
});

describe("computeSwingScore", () => {
  it("scores 100 when every metric is within range", () => {
    const score = computeSwingScore(result([item({ status: "within" }), item({ status: "within" })]));
    expect(score.overall).toBe(100);
    expect(score.band).toBe("good");
  });

  it("scores 0 for a metric that misses by a full range-width or more", () => {
    // range 4–15 (width 11), value 3 below min -> misses by 11, a full width.
    const score = computeSwingScore(result([item({ status: "below", value: -8, range: { min: 4, max: 15 } })]));
    expect(score.overall).toBe(0);
    expect(score.band).toBe("poor");
  });

  it("decays linearly for a partial miss", () => {
    // range 4-15 (width 11), value 20.5 above max -> misses by 5.5, half the width.
    const score = computeSwingScore(
      result([item({ status: "above", value: 20.5, range: { min: 4, max: 15 } })]),
    );
    expect(score.overall).toBeCloseTo(50, 5);
  });

  it("averages across multiple scored metrics", () => {
    const perfect = item({ status: "within" });
    const missed = item({ status: "below", value: -7, range: { min: 4, max: 15 } });
    const score = computeSwingScore(result([perfect, missed]));
    expect(score.overall).toBeCloseTo(50, 5);
  });

  it("excludes undetected metrics instead of scoring them as 0", () => {
    const withinScore = computeSwingScore(
      result([item({ status: "within" }), item({ status: "undetected", value: null, range: null })]),
    );
    expect(withinScore.overall).toBe(100);
  });

  it("returns null when nothing could be scored", () => {
    const score = computeSwingScore(result([item({ status: "undetected", value: null, range: null })]));
    expect(score.overall).toBeNull();
    expect(score.band).toBeNull();
  });

  it("returns null for an empty result", () => {
    const score = computeSwingScore(result([]));
    expect(score.overall).toBeNull();
    expect(score.band).toBeNull();
  });
});
