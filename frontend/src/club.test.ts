import { describe, expect, it } from "vitest";
import {
  LEFT_HIP,
  LEFT_SHOULDER,
  LEFT_WRIST,
  RIGHT_HIP,
  RIGHT_SHOULDER,
  RIGHT_WRIST,
} from "./geometry";
import { buildClubTrack, fillClubGaps, hasClubTrack } from "./club";
import { makeLandmarks } from "./testUtils";
import type { PoseFrame } from "./types";

function makeFrames(clubs: ({ x: number; y: number } | null)[]): PoseFrame[] {
  return clubs.map((club_tip_yolo, index) => ({ index, t: index / 30, landmarks: null, club_tip_yolo }));
}

// Torso length 0.4 (shoulder-mid y=0.3 to hip-mid y=0.7), grip at (0.5, 0.5).
// A detection at (0.5, 0.9) is therefore exactly one torso length from the
// grip, pointing straight down.
const LANDMARKS = makeLandmarks({
  [LEFT_SHOULDER]: { x: 0.4, y: 0.3 },
  [RIGHT_SHOULDER]: { x: 0.6, y: 0.3 },
  [LEFT_HIP]: { x: 0.4, y: 0.7 },
  [RIGHT_HIP]: { x: 0.6, y: 0.7 },
  [LEFT_WRIST]: { x: 0.5, y: 0.5 },
  [RIGHT_WRIST]: { x: 0.5, y: 0.5 },
});

function landmarkFrames(clubs: ({ x: number; y: number } | null)[]): PoseFrame[] {
  return clubs.map((club_tip_yolo, index) => ({ index, t: index / 30, landmarks: LANDMARKS, club_tip_yolo }));
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

describe("buildClubTrack's rigid-club model", () => {
  it("keeps a consistent grip-anchored track where the detector agrees with the club", () => {
    const track = buildClubTrack(landmarkFrames(Array(5).fill({ x: 0.5, y: 0.9 })));
    for (const point of track) {
      expect(point?.x).toBeCloseTo(0.5, 6);
      expect(point?.y).toBeCloseTo(0.9, 6);
    }
  });

  it("drops a reading at an impossible distance from the grip and bridges across it", () => {
    const track = buildClubTrack(
      landmarkFrames([{ x: 0.5, y: 0.9 }, { x: 0.5, y: 0.9 }, { x: 1.5, y: 0.9 }, { x: 0.5, y: 0.9 }, { x: 0.5, y: 0.9 }]),
    );
    // The 1.0-unit reading is 2.5x this swing's club length, so it's a false
    // detection; the bridged point sits back on the club's real length.
    expect(track[2]?.x).toBeCloseTo(0.5, 6);
    expect(track[2]?.y).toBeCloseTo(0.9, 6);
  });

  it("drops a reading that lands on the grip itself", () => {
    const track = buildClubTrack(
      landmarkFrames([{ x: 0.5, y: 0.9 }, { x: 0.5, y: 0.9 }, { x: 0.51, y: 0.51 }, { x: 0.5, y: 0.9 }, { x: 0.5, y: 0.9 }]),
    );
    expect(track[2]?.x).toBeCloseTo(0.5, 6);
    expect(track[2]?.y).toBeCloseTo(0.9, 6);
  });

  it("anchors each frame's tip to that frame's grip, so hand travel carries the club", () => {
    const shifted = makeLandmarks({
      [LEFT_SHOULDER]: { x: 0.5, y: 0.3 },
      [RIGHT_SHOULDER]: { x: 0.7, y: 0.3 },
      [LEFT_HIP]: { x: 0.5, y: 0.7 },
      [RIGHT_HIP]: { x: 0.7, y: 0.7 },
      [LEFT_WRIST]: { x: 0.6, y: 0.5 },
      [RIGHT_WRIST]: { x: 0.6, y: 0.5 },
    });
    const frames: PoseFrame[] = [
      { index: 0, t: 0, landmarks: LANDMARKS, club_tip_yolo: { x: 0.5, y: 0.9 } },
      { index: 1, t: 1 / 30, landmarks: shifted, club_tip_yolo: { x: 0.6, y: 0.9 } },
      { index: 2, t: 2 / 30, landmarks: LANDMARKS, club_tip_yolo: { x: 0.5, y: 0.9 } },
    ];
    const track = buildClubTrack(frames);
    expect(track[1]?.x).toBeCloseTo(0.6, 6);
    expect(track[1]?.y).toBeCloseTo(0.9, 6);
  });

  it("extends only a few frames past the last real detection, then stops", () => {
    const clubs = Array(10).fill(null) as ({ x: number; y: number } | null)[];
    clubs[0] = { x: 0.5, y: 0.9 };
    clubs[1] = { x: 0.5, y: 0.9 };
    const track = buildClubTrack(landmarkFrames(clubs));
    expect(track[2]).not.toBeNull();
    expect(track[4]).not.toBeNull();
    expect(track[5]).toBeNull();
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
