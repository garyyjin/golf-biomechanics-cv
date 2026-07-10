import { describe, expect, it } from "vitest";
import { fillClubGaps } from "./club";
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
