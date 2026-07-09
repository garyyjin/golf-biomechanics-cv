import { afterEach, describe, expect, it, vi } from "vitest";
import { findLatestReferenceSwing, mapUserFrameToReference } from "./comparison";
import { LEFT_WRIST, RIGHT_WRIST } from "./geometry";
import type { SwingPhases } from "./phases";
import { makeLandmarks } from "./testUtils";
import type { PoseFrame } from "./types";

afterEach(() => {
  vi.unstubAllGlobals();
});

const ENTRIES = [
  { id: "old", filename: "old.mp4", view: "face_on", handedness: "right", createdAt: "2026-01-01T00:00:00Z" },
  { id: "new", filename: "new.mp4", view: "face_on", handedness: "right", createdAt: "2026-06-01T00:00:00Z" },
  { id: "other-view", filename: "dtl.mp4", view: "down_the_line", handedness: "right", createdAt: "2026-07-01T00:00:00Z" },
];

const FPS = 30;
function frames(handY: number[]): PoseFrame[] {
  return handY.map((y, index) => ({
    index,
    t: index / FPS,
    landmarks: makeLandmarks({
      [LEFT_WRIST]: { x: 0.5, y, z: 0, visibility: 1 },
      [RIGHT_WRIST]: { x: 0.5, y, z: 0, visibility: 1 },
    }),
  }));
}

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/reference-swings")) {
        return { ok: true, json: async () => ENTRIES };
      }
      if (url.endsWith("/reference-swings/new/analysis")) {
        return {
          ok: true,
          json: async () => ({
            fps: FPS,
            width: 1,
            height: 1,
            frame_count: 60,
            view: "face_on",
            handedness: "right",
            quality: "accurate",
            frames: frames(Array.from({ length: 60 }, () => 0.5)),
          }),
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

describe("findLatestReferenceSwing", () => {
  it("picks the most recently created matching-view/handedness entry", async () => {
    stubFetch();
    const result = await findLatestReferenceSwing("face_on", "right");
    expect(result).not.toBeNull();
    expect(result!.entry.id).toBe("new");
    expect(result!.analysis.view).toBe("face_on");
    expect(result!.phases.address).toBe(0);
  });

  it("returns null when no entry matches the view/handedness", async () => {
    stubFetch();
    const result = await findLatestReferenceSwing("down_the_line", "left");
    expect(result).toBeNull();
  });
});

describe("mapUserFrameToReference", () => {
  const userPhases: SwingPhases = {
    address: 0,
    takeaway: null,
    top: 40,
    downswing: null,
    impact: 60,
    followThrough: null,
  };
  const referencePhases: SwingPhases = {
    address: 10,
    takeaway: null,
    top: 30,
    downswing: null,
    impact: 40,
    followThrough: null,
  };

  it("interpolates linearly between two shared phase anchors", () => {
    // Halfway between address (user 0 -> ref 10) and top (user 40 -> ref 30).
    expect(mapUserFrameToReference(20, userPhases, referencePhases, 100)).toBe(20);
  });

  it("lands exactly on an anchor's reference frame", () => {
    expect(mapUserFrameToReference(40, userPhases, referencePhases, 100)).toBe(30);
    expect(mapUserFrameToReference(60, userPhases, referencePhases, 100)).toBe(40);
  });

  it("clamps to the first anchor's reference frame before it", () => {
    expect(mapUserFrameToReference(-5, userPhases, referencePhases, 100)).toBe(10);
  });

  it("clamps to the last anchor's reference frame after it", () => {
    expect(mapUserFrameToReference(200, userPhases, referencePhases, 100)).toBe(40);
  });

  it("returns null when no phase is detected on both sides", () => {
    const noOverlap: SwingPhases = {
      address: null,
      takeaway: null,
      top: null,
      downswing: null,
      impact: null,
      followThrough: null,
    };
    expect(mapUserFrameToReference(20, noOverlap, referencePhases, 100)).toBeNull();
  });

  it("clamps the interpolated result within the reference frame count", () => {
    const wide: SwingPhases = { ...userPhases, top: 40 };
    const farReference: SwingPhases = { ...referencePhases, top: 500 };
    expect(mapUserFrameToReference(40, wide, farReference, 100)).toBe(99);
  });
});
