import { describe, expect, it } from "vitest";
import { LEFT_WRIST, RIGHT_WRIST } from "./geometry";
import { detectPhases } from "./phases";
import { makeLandmarks } from "./testUtils";
import type { PoseFrame } from "./types";

const FPS = 30;

function hold(value: number, n: number): number[] {
  return Array.from({ length: n }, () => value);
}

function ramp(from: number, to: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
}

function makeSwingFrames(handY: (number | null)[], fps: number): PoseFrame[] {
  return handY.map((y, index) => ({
    index,
    t: index / fps,
    landmarks:
      y === null
        ? null
        : makeLandmarks({
            [LEFT_WRIST]: { x: 0.5, y, z: 0, visibility: 1 },
            [RIGHT_WRIST]: { x: 0.5, y, z: 0, visibility: 1 },
          }),
  }));
}

const ADDRESS_Y = 0.9;
const TOP_Y = 0.3;
const IMPACT_Y = 0.88;
const FINISH_Y = 0.25;

// address hold [0,14], backswing ramp [15,44], top hold [45,49],
// downswing ramp [50,56], impact hold [57,59], follow-through ramp [60,89]
const CLEAN_SWING_Y: number[] = [
  ...hold(ADDRESS_Y, 15),
  ...ramp(ADDRESS_Y, TOP_Y, 30),
  ...hold(TOP_Y, 5),
  ...ramp(TOP_Y, IMPACT_Y, 7),
  ...hold(IMPACT_Y, 3),
  ...ramp(IMPACT_Y, FINISH_Y, 30),
];

describe("detectPhases", () => {
  it("detects an ordered set of phases from a clean synthetic swing", () => {
    const frames = makeSwingFrames(CLEAN_SWING_Y, FPS);
    const phases = detectPhases(frames, "right", FPS);

    // Refined past frame 0 to the end of the address hold ([0,14]) instead
    // of landing on the very first frame — see refineAddressIndex.
    expect(phases.address).toBeGreaterThan(0);
    expect(phases.address!).toBeLessThan(15);
    expect(phases.takeaway).not.toBeNull();
    expect(phases.top).not.toBeNull();
    expect(phases.downswing).not.toBeNull();
    expect(phases.impact).not.toBeNull();
    expect(phases.followThrough).not.toBeNull();

    expect(phases.address!).toBeLessThan(phases.takeaway!);
    expect(phases.takeaway!).toBeLessThan(phases.top!);
    expect(phases.top!).toBeLessThanOrEqual(phases.downswing!);
    expect(phases.downswing!).toBeLessThanOrEqual(phases.impact!);
    expect(phases.impact!).toBeLessThan(phases.followThrough!);

    // loose proximity to construction indices — this is a heuristic, not
    // pinned to exact frame numbers
    expect(phases.top!).toBeGreaterThan(40);
    expect(phases.top!).toBeLessThan(55);
    expect(phases.impact!).toBeGreaterThan(50);
    expect(phases.impact!).toBeLessThan(65);
  });

  it("returns all-null phases for a clip with no detected pose", () => {
    const frames = makeSwingFrames(hold(null as unknown as number, 60).map(() => null), FPS);
    const phases = detectPhases(frames, "right", FPS);
    expect(phases).toEqual({
      address: null,
      takeaway: null,
      top: null,
      downswing: null,
      impact: null,
      followThrough: null,
    });
  });

  it("only detects address on a too-short clip", () => {
    const frames = makeSwingFrames(CLEAN_SWING_Y.slice(0, 5), FPS);
    const phases = detectPhases(frames, "right", FPS);
    expect(phases.address).toBe(0);
    expect(phases.takeaway).toBeNull();
    expect(phases.top).toBeNull();
    expect(phases.impact).toBeNull();
    expect(phases.followThrough).toBeNull();
  });

  it("finds the settled stance even when it differs from frame 0's position", () => {
    // Frame 0 catches the golfer still settling (hand height 0.82, not yet
    // at address), which then transitions into the real address hold at
    // 0.9 — the exact "still adjusting when recording starts" case this
    // refinement is meant to fix. The true hold is frames [10,24].
    const settlingIn: number[] = [
      ...hold(0.82, 6),
      ...ramp(0.82, ADDRESS_Y, 4),
      ...hold(ADDRESS_Y, 15),
      ...ramp(ADDRESS_Y, TOP_Y, 30),
      ...hold(TOP_Y, 5),
      ...ramp(TOP_Y, IMPACT_Y, 7),
      ...hold(IMPACT_Y, 3),
      ...ramp(IMPACT_Y, FINISH_Y, 20),
    ];
    const frames = makeSwingFrames(settlingIn, FPS);
    const phases = detectPhases(frames, "right", FPS);

    expect(phases.address!).toBeGreaterThanOrEqual(10);
    expect(phases.address!).toBeLessThanOrEqual(24);
  });

  it("still detects an ordered set of phases with jitter added", () => {
    const jittered = CLEAN_SWING_Y.map((y, i) => y + (i % 2 === 0 ? 0.01 : -0.01));
    const frames = makeSwingFrames(jittered, FPS);
    const phases = detectPhases(frames, "right", FPS);

    expect(phases.address!).toBeLessThan(phases.takeaway!);
    expect(phases.takeaway!).toBeLessThan(phases.top!);
    expect(phases.top!).toBeLessThanOrEqual(phases.downswing!);
    expect(phases.downswing!).toBeLessThanOrEqual(phases.impact!);
    expect(phases.impact!).toBeLessThan(phases.followThrough!);
  });

  it("still detects phases across a spliced-in null gap during the backswing", () => {
    const withGap = [...CLEAN_SWING_Y];
    const gapped: (number | null)[] = withGap;
    gapped[25] = null;
    gapped[26] = null;
    gapped[27] = null;
    const frames = makeSwingFrames(gapped, FPS);
    const phases = detectPhases(frames, "right", FPS);

    expect(phases.address).toBeGreaterThan(0);
    expect(phases.address!).toBeLessThan(15);
    expect(phases.top).not.toBeNull();
    expect(phases.impact).not.toBeNull();
    expect(phases.top!).toBeLessThan(phases.impact!);
  });

  it("detects only address when there is no real motion", () => {
    const frames = makeSwingFrames(hold(0.5, 60), FPS);
    const phases = detectPhases(frames, "right", FPS);
    // A perfectly flat clip has no settled/moving distinction to find, so
    // the exact index isn't meaningful here — just that it resolved.
    expect(phases.address).not.toBeNull();
    expect(phases.takeaway).toBeNull();
    expect(phases.top).toBeNull();
    expect(phases.impact).toBeNull();
    expect(phases.followThrough).toBeNull();
  });
});
