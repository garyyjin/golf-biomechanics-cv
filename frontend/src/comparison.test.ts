import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_PLAYBACK_RATE,
  MIN_PLAYBACK_RATE,
  NATURAL_LEAD_IN,
  NATURAL_TAIL,
  anchorTimePairs,
  buildNaturalSync,
  correctedPlaybackRate,
  idealReferenceTime,
  idealTimeForPlan,
  loadReferenceSwing,
  mapUserFrameToReference,
  matchingReferenceEntries,
  referenceSeekTime,
  referenceSyncTarget,
  sharedPhaseAnchors,
  syncTargetForPlan,
} from "./comparison";
import type { SyncPlan, TimeAnchor } from "./comparison";
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
    // A flat 60-frame clip has no settled/moving distinction to find, so
    // the exact index isn't meaningful — just that phases were computed.
    expect(result.phases.address).not.toBeNull();
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

describe("sharedPhaseAnchors", () => {
  const userPhases: SwingPhases = {
    address: 0,
    takeaway: 10,
    top: 40,
    downswing: null,
    impact: 60,
    followThrough: null,
  };
  const referencePhases: SwingPhases = {
    address: 10,
    takeaway: null,
    top: 30,
    downswing: 35,
    impact: 40,
    followThrough: null,
  };

  it("keeps only phases detected on both sides, in swing order", () => {
    expect(sharedPhaseAnchors(userPhases, referencePhases)).toEqual([
      { user: 0, reference: 10 },
      { user: 40, reference: 30 },
      { user: 60, reference: 40 },
    ]);
  });

  it("returns empty when nothing is shared", () => {
    const none: SwingPhases = {
      address: null,
      takeaway: null,
      top: null,
      downswing: null,
      impact: null,
      followThrough: null,
    };
    expect(sharedPhaseAnchors(none, referencePhases)).toEqual([]);
  });
});

describe("anchorTimePairs", () => {
  const userFrames = frames(Array.from({ length: 100 }, () => 0.5));
  const refFrames = frames(Array.from({ length: 50 }, () => 0.5));

  it("converts frame indices to per-frame timestamps", () => {
    const pairs = anchorTimePairs(
      [
        { user: 0, reference: 10 },
        { user: 60, reference: 40 },
      ],
      userFrames,
      refFrames,
    );
    expect(pairs).toEqual([
      { userTime: 0, refTime: 10 / FPS },
      { userTime: 60 / FPS, refTime: 40 / FPS },
    ]);
  });

  it("clamps out-of-bounds indices to the frame range", () => {
    const pairs = anchorTimePairs([{ user: -5, reference: 500 }], userFrames, refFrames);
    expect(pairs).toEqual([{ userTime: 0, refTime: 49 / FPS }]);
  });

  it("drops pairs whose user time does not strictly increase", () => {
    const pairs = anchorTimePairs(
      [
        { user: 10, reference: 5 },
        { user: 10, reference: 8 },
        { user: 20, reference: 12 },
      ],
      userFrames,
      refFrames,
    );
    expect(pairs).toEqual([
      { userTime: 10 / FPS, refTime: 5 / FPS },
      { userTime: 20 / FPS, refTime: 12 / FPS },
    ]);
  });
});

describe("idealReferenceTime", () => {
  const anchors: TimeAnchor[] = [
    { userTime: 0, refTime: 1 },
    { userTime: 4, refTime: 3 },
    { userTime: 6, refTime: 4 },
  ];

  it("interpolates linearly inside a segment", () => {
    expect(idealReferenceTime(2, anchors)).toBeCloseTo(2);
    expect(idealReferenceTime(5, anchors)).toBeCloseTo(3.5);
  });

  it("lands exactly on anchors", () => {
    expect(idealReferenceTime(4, anchors)).toBe(3);
  });

  it("clamps outside the shared range", () => {
    expect(idealReferenceTime(-1, anchors)).toBe(1);
    expect(idealReferenceTime(100, anchors)).toBe(4);
  });
});

describe("referenceSyncTarget", () => {
  const anchors: TimeAnchor[] = [
    { userTime: 1, refTime: 2 },
    { userTime: 3, refTime: 3 },
    { userTime: 5, refTime: 7 },
  ];

  it("holds on the boundary anchors outside the shared range", () => {
    expect(referenceSyncTarget(0.5, anchors, 1)).toEqual({ mode: "hold", refTime: 2 });
    expect(referenceSyncTarget(9, anchors, 1)).toEqual({ mode: "hold", refTime: 7 });
  });

  it("holds when there is only one anchor", () => {
    expect(referenceSyncTarget(2, [{ userTime: 1, refTime: 2 }], 1)).toEqual({
      mode: "hold",
      refTime: 2,
    });
  });

  it("scales the segment rate by the master playback rate", () => {
    // Segment 1→3s user maps to 2→3s ref: ratio 0.5; at master 0.5x → 0.25.
    const target = referenceSyncTarget(2, anchors, 0.5);
    expect(target.mode).toBe("play");
    if (target.mode === "play") {
      expect(target.baseRate).toBeCloseTo(0.25);
      expect(target.refTime).toBeCloseTo(2.5);
    }
  });

  it("uses each segment's own tempo ratio", () => {
    // Segment 3→5s user maps to 3→7s ref: ratio 2 at master 1x.
    const target = referenceSyncTarget(4, anchors, 1);
    expect(target.mode).toBe("play");
    if (target.mode === "play") expect(target.baseRate).toBeCloseTo(2);
  });
});

describe("sync plans", () => {
  const anchors: TimeAnchor[] = [
    { userTime: 1, refTime: 2 },
    { userTime: 3, refTime: 3 },
  ];
  const phasePlan: SyncPlan = { kind: "phase", anchors };
  // Reference takeaway is 0.5s later than the user's; swing window [1, 5].
  const naturalPlan: SyncPlan = { kind: "natural", offset: 0.5, refStartTime: 1, refEndTime: 5 };

  it("natural plan shifts elapsed time by the takeaway offset, clamped to the swing window", () => {
    expect(idealTimeForPlan(2.5, naturalPlan)).toBe(3);
    expect(idealTimeForPlan(0, naturalPlan)).toBe(1);
    expect(idealTimeForPlan(9, naturalPlan)).toBe(5);
  });

  it("phase plan delegates to the anchor interpolation", () => {
    expect(idealTimeForPlan(2, phasePlan)).toBeCloseTo(2.5);
  });

  it("natural plan plays at the master rate inside the reference's swing window", () => {
    expect(syncTargetForPlan(2.5, naturalPlan, 0.5)).toEqual({
      mode: "play",
      refTime: 3,
      baseRate: 0.5,
    });
    expect(syncTargetForPlan(0.2, naturalPlan, 1)).toEqual({ mode: "hold", refTime: 1 });
    expect(syncTargetForPlan(6, naturalPlan, 1)).toEqual({ mode: "hold", refTime: 5 });
  });

  it("phase plan delegates to the segment-rate targeting", () => {
    expect(syncTargetForPlan(0.5, phasePlan, 1)).toEqual({ mode: "hold", refTime: 2 });
    const target = syncTargetForPlan(2, phasePlan, 1);
    expect(target.mode).toBe("play");
    if (target.mode === "play") expect(target.baseRate).toBeCloseTo(0.5);
  });
});

describe("buildNaturalSync", () => {
  const userFrames = frames(Array.from({ length: 120 }, () => 0.5));
  const refFrames = frames(Array.from({ length: 90 }, () => 0.5));
  const phases = (overrides: Partial<SwingPhases>): SwingPhases => ({
    address: null,
    takeaway: null,
    top: null,
    downswing: null,
    impact: null,
    followThrough: null,
    ...overrides,
  });

  it("offsets so the takeaways coincide and windows each swing", () => {
    const sync = buildNaturalSync(
      phases({ takeaway: 60, followThrough: 90 }), // t = 2s, 3s
      phases({ takeaway: 30, followThrough: 60 }), // t = 1s, 2s
      userFrames,
      refFrames,
    );
    expect(sync.masterStartTime).toBeCloseTo(2 - NATURAL_LEAD_IN);
    expect(sync.masterEndTime).toBeCloseTo(3 + NATURAL_TAIL);
    expect(sync.plan.offset).toBeCloseTo(-1);
    expect(sync.plan.refStartTime).toBeCloseTo(1 - NATURAL_LEAD_IN);
    expect(sync.plan.refEndTime).toBeCloseTo(2 + NATURAL_TAIL);
  });

  it("clamps the lead-in at the start of the footage", () => {
    const sync = buildNaturalSync(
      phases({ takeaway: 60, followThrough: 90 }),
      phases({ takeaway: 5, followThrough: 60 }), // t ≈ 0.167s — less than the lead-in
      userFrames,
      refFrames,
    );
    expect(sync.plan.refStartTime).toBe(0);
  });

  it("clamps the tail at the end of the footage", () => {
    const sync = buildNaturalSync(
      phases({ takeaway: 60, followThrough: 119 }), // last user frame
      phases({ takeaway: 30, followThrough: 60 }),
      userFrames,
      refFrames,
    );
    expect(sync.masterEndTime).toBeCloseTo(119 / FPS);
  });

  it("falls back along the swing when phases are undetected", () => {
    const sync = buildNaturalSync(
      phases({ address: 30, impact: 75 }), // no takeaway/followThrough
      phases({}), // nothing detected at all
      userFrames,
      refFrames,
    );
    expect(sync.masterStartTime).toBeCloseTo(1 - NATURAL_LEAD_IN); // address at t = 1s
    expect(sync.masterEndTime).toBeCloseTo(75 / FPS + NATURAL_TAIL); // impact + tail
    expect(sync.plan.refStartTime).toBe(0); // frame 0 fallback
    expect(sync.plan.refEndTime).toBeCloseTo(89 / FPS); // last-frame fallback
  });
});

describe("correctedPlaybackRate", () => {
  it("returns the base rate at zero error", () => {
    expect(correctedPlaybackRate(1.5, 0)).toBeCloseTo(1.5);
  });

  it("speeds up when behind and slows down when ahead", () => {
    expect(correctedPlaybackRate(1, 0.05)).toBeCloseTo(1.1);
    expect(correctedPlaybackRate(1, -0.05)).toBeCloseTo(0.9);
  });

  it("caps the nudge at ±15% of the base rate", () => {
    expect(correctedPlaybackRate(1, 10)).toBeCloseTo(1.15);
    expect(correctedPlaybackRate(1, -10)).toBeCloseTo(0.85);
  });

  it("clamps to the browser-supported rate range", () => {
    expect(correctedPlaybackRate(0.05, 0)).toBe(MIN_PLAYBACK_RATE);
    expect(correctedPlaybackRate(20, 0)).toBe(MAX_PLAYBACK_RATE);
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
