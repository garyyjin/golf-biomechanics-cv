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
  // landmarks: null throughout, so clubTipEstimate — the shared last-resort
  // fallback — always yields null. That keeps these cases about detector
  // selection rather than about the body-pose estimator.
  const frames: PoseFrame[] = [
    { index: 0, t: 0, landmarks: null, club_tip: { x: 0.1, y: 0.1 } },
    { index: 1, t: 1 / 30, landmarks: null, club_tip: null },
  ];
  const yoloTrack = [{ x: 0.9, y: 0.9 }, null];

  it("draws the Hough point in hough mode", () => {
    expect(resolveClubTip("hough", frames, 0, yoloTrack, null, "right")).toEqual({ x: 0.1, y: 0.1 });
  });

  it("draws the YOLO point in yolo mode", () => {
    expect(resolveClubTip("yolo", frames, 0, yoloTrack, null, "right")).toEqual({ x: 0.9, y: 0.9 });
  });

  it("does not borrow the Hough point on a YOLO miss", () => {
    // Frame 1 has no YOLO detection but frame 0 does have a Hough one; the
    // toggle is a side-by-side, so YOLO mode must show its own gap here.
    expect(resolveClubTip("yolo", frames, 1, yoloTrack, null, "right")).toBeNull();
  });

  it("does not borrow the YOLO point in hough mode", () => {
    expect(resolveClubTip("hough", frames, 1, yoloTrack, null, "right")).toBeNull();
  });

  it("falls back to the body-pose estimate when the chosen detector has no point", () => {
    expect(resolveClubTip("yolo", frames, 0, null, null, "right")).toBeNull();
  });
});
