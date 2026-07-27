import { describe, expect, it } from "vitest";
import { LEFT_WRIST, RIGHT_WRIST } from "./geometry";
import { computeSwingStats, DRIVER_CARRY_REGRESSION, estimateCarryYards } from "./stats";
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

function frame(
  index: number,
  t: number,
  landmarks: PoseFrame["landmarks"] = null,
  club_tip_yolo: PoseFrame["club_tip_yolo"] = null,
): PoseFrame {
  return { index, t, landmarks, club_tip_yolo };
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
    const stats = computeSwingStats(frames, NO_PHASES, "right");
    expect(stats.clubheadSpeedMph).toBeNull();
    expect(stats.ballSpeedMph).toBeNull();
    expect(stats.ballSpeedSource).toBeNull();
    expect(stats.estCarryYards).toBeNull();
    expect(stats.diagnostic).toEqual({ gate: "phase-detection", address: null, impact: null });
  });

  it("returns all-null when impact is at the very edge (no before/after frame)", () => {
    const frames = [frame(0, 0, ADDRESS_LANDMARKS, { x: 0.5, y: 0.8 }), frame(1, 1 / 30)];
    const phases = { ...NO_PHASES, address: 0, impact: 1 }; // impact is the last frame
    const stats = computeSwingStats(frames, phases, "right");
    expect(stats.clubheadSpeedMph).toBeNull();
    expect(stats.diagnostic).toEqual({ gate: "impact-at-clip-edge", impact: 1, frameCount: 2 });
  });

  it("returns all-null when the clubhead wasn't tracked anywhere near address (no calibration)", () => {
    const frames = [frame(0, 0, ADDRESS_LANDMARKS), frame(1, 0.1), frame(2, 0.2)];
    const phases = { ...NO_PHASES, address: 0, impact: 1 };
    const stats = computeSwingStats(frames, phases, "right");
    expect(stats.clubheadSpeedMph).toBeNull();
    expect(stats.diagnostic).toEqual({ gate: "scale-calibration" });
  });

  it("calibrates from a nearby frame within the address window when the exact address frame has no detection", () => {
    // Address is frame 5; no detection there, but frame 3 (within the
    // +/-5-frame calibration window) has one -- should still calibrate.
    const frames = [
      frame(0, 0),
      frame(1, 1),
      frame(2, 2),
      frame(3, 3, null, { x: 0.5, y: 0.8 }), // near-address calibration point
      frame(4, 4, ADDRESS_LANDMARKS),
      frame(5, 5, ADDRESS_LANDMARKS), // address itself -- no detection here
      frame(6, 6),
      frame(7, 7, null, { x: 0.45, y: 0.8 }),
      frame(8, 8, null, { x: 0.55, y: 0.6 }),
    ];
    const phases = { ...NO_PHASES, address: 5, impact: 7 };
    const stats = computeSwingStats(frames, phases, "right");
    expect(stats.clubheadSpeedMph).not.toBeNull();
  });

  it("returns all-null when no real detection exists within the search window on either side of impact", () => {
    // impact=2; frames 1 and 3 (its immediate neighbors) have no real
    // detection, and neither does anything else within the search radius.
    const frames = [
      frame(0, 0, ADDRESS_LANDMARKS, { x: 0.5, y: 0.8 }),
      frame(1, 1),
      frame(2, 2),
      frame(3, 3),
    ];
    const phases = { ...NO_PHASES, address: 0, impact: 2 };
    const stats = computeSwingStats(frames, phases, "right");
    expect(stats.clubheadSpeedMph).toBeNull();
    expect(stats.diagnostic).toEqual({ gate: "no-detection-near-impact", impact: 2 });
  });

  it("finds a real detection pair within the search window when impact's immediate neighbors have none", () => {
    // impact=5; frame 4 (before) has no real detection but frame 2 does,
    // within IMPACT_SEARCH_WINDOW_FRAMES -- same for frame 6 (after) via frame 8.
    const frames = [
      frame(0, 0, ADDRESS_LANDMARKS, { x: 0.5, y: 0.8 }), // address
      frame(1, 1),
      frame(2, 2, null, { x: 0.45, y: 0.8 }), // real detection before impact
      frame(3, 3),
      frame(4, 4), // impact's immediate predecessor -- no detection
      frame(5, 5), // impact
      frame(6, 6), // impact's immediate successor -- no detection
      frame(7, 7),
      frame(8, 8, null, { x: 0.55, y: 0.6 }), // real detection after impact
    ];
    const phases = { ...NO_PHASES, address: 0, impact: 5 };

    const stats = computeSwingStats(frames, phases, "right");

    // Only one adjacent real pair exists in the window (frames[2], frames[8]),
    // so it's the one used regardless of how far each sits from impact.
    const expectedInches = Math.hypot(0.1, 0.2) * 225;
    const expectedMph = (expectedInches / 6) * (3600 / 63360);
    expect(stats.clubheadSpeedMph).toBeCloseTo(expectedMph, 6);
  });

  it("prefers a faster, tighter segment over the pair literally adjacent to impact", () => {
    // impact=15. Frames 14/16 (impact's immediate neighbors) barely moved --
    // a real but misleadingly slow reading, the kind motion-blur smearing a
    // detection box can produce right at the moment that matters most. A
    // much faster, still-real segment (frames 8 -> 14) exists a bit further
    // out; that's the one that should win, not whatever's nearest to impact.
    // All points sit on one straight line from address onward so none of
    // them trip rejectOutliers' unrelated "big detour off the chord between
    // neighbors" check -- this test is only about segment *speed* ranking.
    const frames = [
      frame(0, 0, ADDRESS_LANDMARKS, { x: 0.5, y: 0.8 }), // address
      ...Array.from({ length: 24 }, (_, i) => frame(i + 1, i + 1)),
    ];
    frames[8].club_tip_yolo = { x: 0.56, y: 0.86 };
    frames[14].club_tip_yolo = { x: 0.68, y: 0.98 }; // fast segment: frames[8] -> frames[14]
    frames[16].club_tip_yolo = { x: 0.685, y: 0.985 }; // impact's neighbors barely move...
    frames[24].club_tip_yolo = { x: 0.7, y: 1.0 }; // ...same for this trailing segment
    const phases = { ...NO_PHASES, address: 0, impact: 15 };

    const stats = computeSwingStats(frames, phases, "right");

    const expectedInches = Math.hypot(0.12, 0.12) * 225; // frames[8] -> frames[14]
    const expectedMph = (expectedInches / 6) * (3600 / 63360);
    expect(stats.clubheadSpeedMph).toBeCloseTo(expectedMph, 6);
  });

  it("returns all-null when the only real detections are outside the search window", () => {
    const frames = Array.from({ length: 50 }, (_, i) => frame(i, i, i === 0 ? ADDRESS_LANDMARKS : null));
    frames[0].club_tip_yolo = { x: 0.5, y: 0.8 }; // address -- excluded from the window by construction
    frames[1].club_tip_yolo = { x: 0.45, y: 0.8 }; // real, but well outside the window around impact
    const phases = { ...NO_PHASES, address: 0, impact: 25 }; // frame 1 is 24 frames away -- outside +/-20
    const stats = computeSwingStats(frames, phases, "right");
    expect(stats.clubheadSpeedMph).toBeNull();
    expect(stats.diagnostic).toEqual({ gate: "no-detection-near-impact", impact: 25 });
  });

  it("returns all-null when the wrists aren't visible at address", () => {
    const invisibleWrists = makeLandmarks({
      [LEFT_WRIST]: { x: 0.5, y: 0.6, visibility: 0 },
      [RIGHT_WRIST]: { x: 0.5, y: 0.6, visibility: 0 },
    });
    const frames = [frame(0, 0, invisibleWrists), frame(1, 0.1), frame(2, 0.2)];
    const phases = { ...NO_PHASES, address: 0, impact: 1 };
    const stats = computeSwingStats(frames, phases, "right");
    expect(stats.clubheadSpeedMph).toBeNull();
    expect(stats.diagnostic).toEqual({ gate: "scale-calibration" });
  });

  it("computes clubhead speed and an estimated (not measured) ball speed/carry when no ball is tracked", () => {
    const frames = [
      frame(0, 0, ADDRESS_LANDMARKS, { x: 0.5, y: 0.8 }), // address: 0.2 below grip -> scale 225 in/unit
      frame(1, 1, null, { x: 0.45, y: 0.8 }), // just before impact
      frame(2, 2), // impact frame itself is unused by the calculation
      frame(3, 3, null, { x: 0.55, y: 0.6 }), // just after impact
    ];
    const phases = { ...NO_PHASES, address: 0, impact: 2 };

    const stats = computeSwingStats(frames, phases, "right");

    // distance moved (1,3) = hypot(0.1, 0.2) normalized units * 225 in/unit,
    // over (frames[3].t - frames[1].t) = 2 seconds.
    const expectedInches = Math.hypot(0.1, 0.2) * 225;
    const expectedMph = (expectedInches / 2) * (3600 / 63360);
    expect(stats.clubheadSpeedMph).toBeCloseTo(expectedMph, 6);
    expect(stats.ballSpeedSource).toBe("estimated");
    expect(stats.ballSpeedMph).toBeCloseTo(expectedMph * 1.48, 6);
    expect(stats.estCarryYards).not.toBeNull();
    expect(stats.estCarryYards!).toBeGreaterThan(0);
    expect(stats.diagnostic).toEqual({ gate: "ok" });
  });

  it("falls back to the classical club_tip detector when YOLO has nothing anywhere", () => {
    // Same geometry as the estimated-ball-speed test above, but every point
    // is on club_tip instead of club_tip_yolo, and club_tip_yolo is null
    // throughout -- the YOLO attempt should fail cleanly and the classical
    // attempt should reproduce the identical result.
    const frames: PoseFrame[] = [
      { index: 0, t: 0, landmarks: ADDRESS_LANDMARKS, club_tip: { x: 0.5, y: 0.8 } },
      { index: 1, t: 1, landmarks: null, club_tip: { x: 0.45, y: 0.8 } },
      { index: 2, t: 2, landmarks: null },
      { index: 3, t: 3, landmarks: null, club_tip: { x: 0.55, y: 0.6 } },
    ];
    const phases = { ...NO_PHASES, address: 0, impact: 2 };

    const stats = computeSwingStats(frames, phases, "right");

    const expectedInches = Math.hypot(0.1, 0.2) * 225;
    const expectedMph = (expectedInches / 2) * (3600 / 63360);
    expect(stats.clubheadSpeedMph).toBeCloseTo(expectedMph, 6);
  });

  it("measures ball speed directly when the ball is tracked after impact, instead of estimating it", () => {
    const frames: PoseFrame[] = [
      { index: 0, t: 0, landmarks: ADDRESS_LANDMARKS, club_tip_yolo: { x: 0.5, y: 0.8 } },
      { index: 1, t: 1, landmarks: null, club_tip_yolo: { x: 0.45, y: 0.8 } },
      { index: 2, t: 2, landmarks: null }, // impact
      { index: 3, t: 3, landmarks: null, club_tip_yolo: { x: 0.55, y: 0.6 }, ball_tip: { x: 0.56, y: 0.55 } },
      { index: 4, t: 4, landmarks: null, ball_tip: { x: 0.66, y: 0.35 } },
    ];
    const phases = { ...NO_PHASES, address: 0, impact: 2 };

    const stats = computeSwingStats(frames, phases, "right");

    expect(stats.ballSpeedSource).toBe("measured");
    const expectedInches = Math.hypot(0.1, 0.2) * 225; // frames[3] -> frames[4] ball_tip
    const expectedMph = (expectedInches / 1) * (3600 / 63360);
    expect(stats.ballSpeedMph).toBeCloseTo(expectedMph, 6);
  });

  it("rejects an implausibly fast result as bad tracking rather than reporting it", () => {
    const frames = [
      frame(0, 0, ADDRESS_LANDMARKS, { x: 0.5, y: 0.8 }),
      frame(1, 0, null, { x: 0, y: 0 }),
      frame(2, 0.001),
      frame(3, 0.002, null, { x: 1, y: 1 }), // huge jump in a tiny amount of time
    ];
    const phases = { ...NO_PHASES, address: 0, impact: 2 };
    const stats = computeSwingStats(frames, phases, "right");
    expect(stats.clubheadSpeedMph).toBeNull();
  });

  it("does not estimate a carry distance for a purely horizontal or downward impact direction", () => {
    const frames = [
      frame(0, 0, ADDRESS_LANDMARKS, { x: 0.5, y: 0.8 }),
      frame(1, 1, null, { x: 0.4, y: 0.6 }),
      frame(2, 2),
      frame(3, 3, null, { x: 0.6, y: 0.6 }), // purely horizontal travel -> 0 launch angle -> 0 range
    ];
    const phases = { ...NO_PHASES, address: 0, impact: 2 };
    const stats = computeSwingStats(frames, phases, "right");
    expect(stats.estCarryYards).toBeNull();
  });
});

describe("estimateCarryYards", () => {
  it("matches the fitted regression within the training range", () => {
    const { slopeYardsPerMph, interceptYards } = DRIVER_CARRY_REGRESSION;
    const mph = 120;
    expect(estimateCarryYards(mph)).toBeCloseTo(slopeYardsPerMph * mph + interceptYards, 6);
  });

  it("clamps below the training range instead of extrapolating to a negative carry", () => {
    const { minBallSpeedMph, slopeYardsPerMph, interceptYards } = DRIVER_CARRY_REGRESSION;
    expect(estimateCarryYards(5)).toBeCloseTo(slopeYardsPerMph * minBallSpeedMph + interceptYards, 6);
    expect(estimateCarryYards(5)).toBeGreaterThan(0);
  });

  it("clamps above the training range instead of extrapolating past real driver shots", () => {
    const { maxBallSpeedMph, slopeYardsPerMph, interceptYards } = DRIVER_CARRY_REGRESSION;
    expect(estimateCarryYards(300)).toBeCloseTo(slopeYardsPerMph * maxBallSpeedMph + interceptYards, 6);
  });
});
