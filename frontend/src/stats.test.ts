import { describe, expect, it } from "vitest";
import type { ClubPoint } from "./club";
import { LEFT_WRIST, RIGHT_WRIST } from "./geometry";
import { computeSwingStats } from "./stats";
import { makeLandmarks } from "./testUtils";
import type { PoseFrame } from "./types";
import type { SwingPhases } from "./phases";

const NO_PHASES: SwingPhases = {
  address: null,
  takeaway: null,
  top: null,
  downswing: null,
  impact: null,
  followThrough: null,
};

function frame(index: number, t: number, landmarks: PoseFrame["landmarks"] = null): PoseFrame {
  return { index, t, landmarks };
}

// Grip fixed at (0.5, 0.6); clubhead at address 0.2 normalized units below
// it -- with the assumed 45in club length, that's a scale of 225in/unit.
const ADDRESS_LANDMARKS = makeLandmarks({
  [LEFT_WRIST]: { x: 0.5, y: 0.6 },
  [RIGHT_WRIST]: { x: 0.5, y: 0.6 },
});

describe("computeSwingStats", () => {
  it("returns all-null when address or impact wasn't detected", () => {
    const frames = [frame(0, 0, ADDRESS_LANDMARKS)];
    const track: (ClubPoint | null)[] = [{ x: 0.5, y: 0.8 }];
    expect(computeSwingStats(frames, track, NO_PHASES, "right")).toEqual({
      clubheadSpeedMph: null,
      ballSpeedMph: null,
      estCarryYards: null,
    });
  });

  it("returns all-null when impact is at the very edge (no before/after frame)", () => {
    const frames = [frame(0, 0, ADDRESS_LANDMARKS), frame(1, 1 / 30)];
    const track: (ClubPoint | null)[] = [{ x: 0.5, y: 0.8 }, { x: 0.5, y: 0.8 }];
    const phases = { ...NO_PHASES, address: 0, impact: 1 }; // impact is the last frame
    expect(computeSwingStats(frames, track, phases, "right").clubheadSpeedMph).toBeNull();
  });

  it("returns all-null when the clubhead wasn't tracked at address (no calibration)", () => {
    const frames = [frame(0, 0, ADDRESS_LANDMARKS), frame(1, 0.1), frame(2, 0.2)];
    const track: (ClubPoint | null)[] = [null, { x: 0.45, y: 0.8 }, { x: 0.55, y: 0.6 }];
    const phases = { ...NO_PHASES, address: 0, impact: 1 };
    expect(computeSwingStats(frames, track, phases, "right").clubheadSpeedMph).toBeNull();
  });

  it("returns all-null when the clubhead wasn't tracked around impact", () => {
    const frames = [frame(0, 0, ADDRESS_LANDMARKS), frame(1, 0.1), frame(2, 0.2)];
    // impact=1 needs track[0] (before) and track[2] (after); null out `after`.
    const track: (ClubPoint | null)[] = [{ x: 0.5, y: 0.8 }, { x: 0.45, y: 0.8 }, null];
    const phases = { ...NO_PHASES, address: 0, impact: 1 };
    expect(computeSwingStats(frames, track, phases, "right").clubheadSpeedMph).toBeNull();
  });

  it("returns all-null when the wrists aren't visible at address", () => {
    const invisibleWrists = makeLandmarks({
      [LEFT_WRIST]: { x: 0.5, y: 0.6, visibility: 0 },
      [RIGHT_WRIST]: { x: 0.5, y: 0.6, visibility: 0 },
    });
    const frames = [frame(0, 0, invisibleWrists), frame(1, 0.1), frame(2, 0.2)];
    const track: (ClubPoint | null)[] = [{ x: 0.5, y: 0.8 }, { x: 0.45, y: 0.8 }, { x: 0.55, y: 0.6 }];
    const phases = { ...NO_PHASES, address: 0, impact: 1 };
    expect(computeSwingStats(frames, track, phases, "right").clubheadSpeedMph).toBeNull();
  });

  it("computes clubhead speed, ball speed, and an estimated carry from tracked positions", () => {
    const frames = [
      frame(0, 0, ADDRESS_LANDMARKS), // address
      frame(1, 1), // just before impact
      frame(2, 2), // impact
      frame(3, 3), // just after impact
    ];
    const track: (ClubPoint | null)[] = [
      { x: 0.5, y: 0.8 }, // address: 0.2 below grip -> scale 225 in/unit
      { x: 0.45, y: 0.8 },
      null, // impact frame itself is unused by the calculation
      { x: 0.55, y: 0.6 },
    ];
    const phases = { ...NO_PHASES, address: 0, impact: 2 };

    const stats = computeSwingStats(frames, track, phases, "right");

    // distance moved (1,3) = hypot(0.1, 0.2) normalized units * 225 in/unit,
    // over (frames[3].t - frames[1].t) = 2 seconds.
    const expectedInches = Math.hypot(0.1, 0.2) * 225;
    const expectedMph = (expectedInches / 2) * (3600 / 63360);
    expect(stats.clubheadSpeedMph).toBeCloseTo(expectedMph, 6);
    expect(stats.ballSpeedMph).toBeCloseTo(expectedMph * 1.48, 6);
    expect(stats.estCarryYards).not.toBeNull();
    expect(stats.estCarryYards!).toBeGreaterThan(0);
  });

  it("rejects an implausibly fast result as bad tracking rather than reporting it", () => {
    const frames = [frame(0, 0, ADDRESS_LANDMARKS), frame(1, 0), frame(2, 0.001), frame(3, 0.002)];
    const track: (ClubPoint | null)[] = [
      { x: 0.5, y: 0.8 },
      { x: 0, y: 0 },
      null,
      { x: 1, y: 1 }, // huge jump in a tiny amount of time
    ];
    const phases = { ...NO_PHASES, address: 0, impact: 2 };
    expect(computeSwingStats(frames, track, phases, "right").clubheadSpeedMph).toBeNull();
  });

  it("does not estimate a carry distance for a purely horizontal or downward impact direction", () => {
    const frames = [frame(0, 0, ADDRESS_LANDMARKS), frame(1, 1), frame(2, 2), frame(3, 3)];
    const track: (ClubPoint | null)[] = [
      { x: 0.5, y: 0.8 },
      { x: 0.4, y: 0.6 },
      null,
      { x: 0.6, y: 0.6 }, // purely horizontal travel -> 0 launch angle -> 0 range
    ];
    const phases = { ...NO_PHASES, address: 0, impact: 2 };
    const stats = computeSwingStats(frames, track, phases, "right");
    expect(stats.estCarryYards).toBeNull();
  });
});
