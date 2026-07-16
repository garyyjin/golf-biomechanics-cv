import { describe, expect, it } from "vitest";
import { fillClubGaps, hasClubTrack, resolveClubTip } from "./club";
import type { PoseFrame } from "./types";

function makeFrames(clubs: ({ x: number; y: number } | null)[]): PoseFrame[] {
  return clubs.map((club_tip_yolo, index) => ({ index, t: index / 30, landmarks: null, club_tip_yolo }));
}

describe("fillClubGaps", () => {
  it("passes through frames with no gaps", () => {
    const frames = makeFrames([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    expect(fillClubGaps(frames)).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  });

  it("linearly interpolates a bounded gap", () => {
    const frames = makeFrames([{ x: 0, y: 0 }, null, null, { x: 4, y: 8 }]);
    expect(fillClubGaps(frames)).toEqual([
      { x: 0, y: 0 },
      { x: 4 / 3, y: 8 / 3 },
      { x: 8 / 3, y: 16 / 3 },
      { x: 4, y: 8 },
    ]);
  });

  it("leaves an unbounded leading/trailing gap null", () => {
    const frames = makeFrames([null, { x: 1, y: 1 }, null]);
    expect(fillClubGaps(frames)).toEqual([null, { x: 1, y: 1 }, null]);
  });

  it("treats missing club_tip_yolo field the same as null", () => {
    const frames: PoseFrame[] = [
      { index: 0, t: 0, landmarks: null, club_tip_yolo: { x: 0, y: 0 } },
      { index: 1, t: 1 / 30, landmarks: null },
      { index: 2, t: 2 / 30, landmarks: null, club_tip_yolo: { x: 2, y: 2 } },
    ];
    expect(fillClubGaps(frames)).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }]);
  });

  it("treats a lone false detection (e.g. locking onto the grip) as a miss and interpolates over it", () => {
    const frames = makeFrames([
      { x: 0, y: 0 },
      { x: 0.1, y: 0.1 },
      { x: 0.8, y: 0.8 }, // way off the path its neighbors describe
      { x: 0.2, y: 0.2 },
      { x: 0.3, y: 0.3 },
    ]);
    const result = fillClubGaps(frames);
    // Interpolated between {0.1, 0.1} and {0.2, 0.2}, not the raw spike.
    expect(result[2]?.x).toBeCloseTo(0.15);
    expect(result[2]?.y).toBeCloseTo(0.15);
  });

  it("does not reject genuine fast, roughly-collinear motion", () => {
    const frames = makeFrames([
      { x: 0, y: 0 },
      { x: 0.3, y: 0.3 },
      { x: 0.6, y: 0.6 },
      { x: 0.9, y: 0.9 },
    ]);
    expect(fillClubGaps(frames)).toEqual([
      { x: 0, y: 0 },
      { x: 0.3, y: 0.3 },
      { x: 0.6, y: 0.6 },
      { x: 0.9, y: 0.9 },
    ]);
  });

  it("does not reject small jitter around an almost-stationary point", () => {
    const frames = makeFrames([
      { x: 0.5, y: 0.5 },
      { x: 0.503, y: 0.501 },
      { x: 0.5, y: 0.5 },
    ]);
    expect(fillClubGaps(frames)).toEqual([
      { x: 0.5, y: 0.5 },
      { x: 0.503, y: 0.501 },
      { x: 0.5, y: 0.5 },
    ]);
  });
});

describe("hasClubTrack", () => {
  it("is false when the model never fired (no clubhead.pt installed)", () => {
    expect(hasClubTrack([null, null, null])).toBe(false);
  });

  it("is true when at least one frame has a detection", () => {
    expect(hasClubTrack([null, { x: 0.5, y: 0.5 }, null])).toBe(true);
  });
});

describe("resolveClubTip", () => {
  const yoloTrack = [{ x: 0.9, y: 0.9 }, null];

  it("returns the track's point for that frame", () => {
    expect(resolveClubTip(0, yoloTrack)).toEqual({ x: 0.9, y: 0.9 });
  });

  it("returns null on a miss rather than estimating a fallback", () => {
    expect(resolveClubTip(1, yoloTrack)).toBeNull();
  });

  it("returns null when there's no track at all", () => {
    expect(resolveClubTip(0, null)).toBeNull();
  });
});
