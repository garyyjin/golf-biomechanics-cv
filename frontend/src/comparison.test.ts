import { afterEach, describe, expect, it, vi } from "vitest";
import { findLatestReferenceSwing } from "./comparison";
import { LEFT_WRIST, RIGHT_WRIST } from "./geometry";
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
