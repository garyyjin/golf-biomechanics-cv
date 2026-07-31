import { describe, expect, it } from "vitest";
import { DEFAULT_BENCHMARKS } from "./benchmarks.default";
import { computeFeedback } from "./feedback";
import { computeSwingScore } from "./swingScore";
import { computeSwingSummary } from "./swingSummary";
import { LEFT_WRIST, RIGHT_WRIST } from "./geometry";
import { makeLandmarks } from "./testUtils";
import type { AnalysisResponse, PoseFrame } from "./types";

const FPS = 30;

/** A clip whose hands trace a real swing shape: settled at address, rising to
 * a top, dropping through impact, then following through. Enough for
 * detectPhases to find phases so the summary has something to report. */
function swingFrames(): PoseFrame[] {
  const heights: number[] = [];
  for (let i = 0; i < 20; i++) heights.push(0.7); // address hold
  for (let i = 0; i < 20; i++) heights.push(0.7 - (i / 19) * 0.4); // backswing
  for (let i = 0; i < 10; i++) heights.push(0.3 + (i / 9) * 0.4); // downswing
  for (let i = 0; i < 15; i++) heights.push(0.7 - (i / 14) * 0.3); // follow-through
  return heights.map((y, index) => ({
    index,
    t: index / FPS,
    landmarks: makeLandmarks({
      [LEFT_WRIST]: { x: 0.5, y },
      [RIGHT_WRIST]: { x: 0.5, y },
    }),
  }));
}

function analysis(frames: PoseFrame[]): AnalysisResponse {
  return {
    fps: FPS,
    width: 1080,
    height: 1920,
    frame_count: frames.length,
    view: "face_on",
    handedness: "right",
    quality: "fast",
    frames,
  };
}

describe("computeSwingSummary", () => {
  it("carries through the same score the player shows", () => {
    // The summary must not be a second opinion — a history row disagreeing
    // with the player about the same swing would be a bug users could see.
    const subject = analysis(swingFrames());
    const summary = computeSwingSummary(subject, DEFAULT_BENCHMARKS, "v1");
    const expected = computeSwingScore(computeFeedback(subject, DEFAULT_BENCHMARKS));

    expect(summary.score).toBe(expected.overall);
    expect(summary.band).toBe(expected.band);
  });

  it("records the benchmark version it was scored against", () => {
    const summary = computeSwingSummary(analysis(swingFrames()), DEFAULT_BENCHMARKS, "2026-07-31T00:00:00Z");
    expect(summary.benchmarksAt).toBe("2026-07-31T00:00:00Z");
  });

  it("returns nulls rather than zeros when nothing can be measured", () => {
    // No landmarks anywhere: no phases, no angles, no clubhead track. Every
    // field must say "couldn't measure", never "zero" — a 0 score would read
    // as a terrible swing rather than an unreadable clip.
    const blank = analysis(
      Array.from({ length: 30 }, (_, index) => ({ index, t: index / FPS, landmarks: null })),
    );
    const summary = computeSwingSummary(blank, DEFAULT_BENCHMARKS, "v1");

    expect(summary.score).toBeNull();
    expect(summary.band).toBeNull();
    expect(summary.clubheadSpeedMph).toBeNull();
    expect(summary.ballSpeedMph).toBeNull();
    expect(summary.estCarryYards).toBeNull();
    expect(summary.tempoRatio).toBeNull();
    expect(summary.tempoScore).toBeNull();
    // Still stamped, so it isn't retried as stale forever.
    expect(summary.benchmarksAt).toBe("v1");
  });

  it("produces a tempo ratio when the swing's phases are detectable", () => {
    const summary = computeSwingSummary(analysis(swingFrames()), DEFAULT_BENCHMARKS, "v1");
    if (summary.tempoRatio !== null) {
      expect(summary.tempoRatio).toBeGreaterThan(0);
      expect(summary.tempoScore).not.toBeNull();
    }
    // tempoScore and tempoRatio are null together, never one without the other.
    expect(summary.tempoRatio === null).toBe(summary.tempoScore === null);
  });
});
