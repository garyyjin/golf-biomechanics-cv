import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadReferenceSwing,
  mapUserFrameToReference,
  matchingReferenceEntries,
  referenceSeekTime,
} from "./comparison";
import { LEFT_WRIST, RIGHT_WRIST } from "./geometry";
import type { LibraryEntry } from "./libraryApi";
import type { SwingPhases } from "./phases";
import { makeLandmarks } from "./testUtils";
import type { AnalysisResponse, PoseFrame } from "./types";

afterEach(() => {
  vi.unstubAllGlobals();
});

const ENTRIES: LibraryEntry[] = [
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

describe("matchingReferenceEntries", () => {
  it("filters to matching view/handedness and sorts newest first", () => {
    const matches = matchingReferenceEntries(ENTRIES, "face_on", "right");
    expect(matches.map((e) => e.id)).toEqual(["new", "old"]);
  });

  it("returns an empty list when no entry matches", () => {
    expect(matchingReferenceEntries(ENTRIES, "down_the_line", "left")).toEqual([]);
  });
});

describe("loadReferenceSwing", () => {
  it("fetches the entry's analysis and detects its phases", async () => {
    stubFetch();
    const result = await loadReferenceSwing(ENTRIES[1]);
    expect(result.entry.id).toBe("new");
    expect(result.analysis.view).toBe("face_on");
    expect(result.phases.address).toBe(0);
  });
});

describe("referenceSeekTime", () => {
  const analysis = {
    fps: FPS,
    frames: frames(Array.from({ length: 60 }, () => 0.5)),
  } as AnalysisResponse;

  it("nudges a quarter-frame past the frame's timestamp", () => {
    expect(referenceSeekTime(analysis, 10)).toBeCloseTo(10 / FPS + 0.25 / FPS);
  });

  it("rounds back to the requested index", () => {
    for (const index of [0, 1, 29, 59]) {
      expect(Math.round(referenceSeekTime(analysis, index) * FPS)).toBe(index);
    }
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
