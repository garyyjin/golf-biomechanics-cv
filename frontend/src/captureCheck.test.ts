import { describe, expect, it } from "vitest";
import { checkCapture } from "./captureCheck";
import { LEFT_ANKLE, LEFT_HIP, LEFT_SHOULDER, RIGHT_ANKLE, RIGHT_HIP, RIGHT_SHOULDER } from "./geometry";
import type { SwingPhases } from "./phases";
import { makeLandmarks } from "./testUtils";
import type { AnalysisResponse, PoseFrame, View } from "./types";

const PHASES: SwingPhases = {
  address: 0,
  takeaway: 2,
  top: 8,
  downswing: 10,
  impact: 14,
  followThrough: 18,
};

interface FrameOptions {
  noseY?: number;
  ankleY?: number;
  ankleSpread?: number;
  visibility?: number;
  landmarks?: boolean;
}

function frame(index: number, options: FrameOptions = {}): PoseFrame {
  const {
    noseY = 0.2,
    ankleY = 0.85,
    ankleSpread = 0.02,
    visibility = 1,
    landmarks = true,
  } = options;
  return {
    index,
    t: index / 30,
    landmarks: landmarks
      ? makeLandmarks({
          0: { x: 0.5, y: noseY, z: 0, visibility },
          [LEFT_SHOULDER]: { x: 0.4, y: 0.4, z: 0, visibility },
          [RIGHT_SHOULDER]: { x: 0.6, y: 0.4, z: 0, visibility },
          [LEFT_HIP]: { x: 0.42, y: 0.62, z: 0, visibility },
          [RIGHT_HIP]: { x: 0.58, y: 0.62, z: 0, visibility },
          [LEFT_ANKLE]: { x: 0.5 - ankleSpread / 2, y: ankleY, z: 0, visibility },
          [RIGHT_ANKLE]: { x: 0.5 + ankleSpread / 2, y: ankleY, z: 0, visibility },
        })
      : null,
  };
}

function analysis(options: {
  frames?: PoseFrame[];
  fps?: number;
  view?: View;
} = {}): AnalysisResponse {
  const frames = options.frames ?? Array.from({ length: 20 }, (_, i) => frame(i));
  return {
    fps: options.fps ?? 30,
    width: 1000,
    height: 1000,
    frame_count: frames.length,
    view: options.view ?? "face_on",
    handedness: "right",
    quality: "fast",
    frames,
  };
}

function check(report: ReturnType<typeof checkCapture>, id: string) {
  return report.checks.find((c) => c.id === id)!;
}

describe("checkCapture", () => {
  it("grades clean footage as good", () => {
    const report = checkCapture(analysis(), PHASES);

    expect(report.grade).toBe("good");
    expect(report.checks.every((c) => c.level === "pass")).toBe(true);
  });

  it("fails body tracking when no pose was found", () => {
    const frames = Array.from({ length: 20 }, (_, i) => frame(i, { landmarks: false }));
    const report = checkCapture(analysis({ frames }), PHASES);

    expect(check(report, "pose").level).toBe("fail");
    expect(check(report, "pose").advice).not.toBeNull();
    expect(report.grade).toBe("poor");
  });

  it("warns when the feet are touching the frame edge", () => {
    const frames = Array.from({ length: 20 }, (_, i) => frame(i, { ankleY: 0.995 }));
    const report = checkCapture(analysis({ frames }), PHASES);

    expect(check(report, "framing").level).toBe("warn");
    expect(check(report, "framing").advice).toContain("camera");
    expect(report.grade).toBe("usable");
  });

  it("fails a clip filmed too far away to read joint angles", () => {
    const frames = Array.from({ length: 20 }, (_, i) => frame(i, { noseY: 0.45, ankleY: 0.55 }));
    const report = checkCapture(analysis({ frames }), PHASES);

    expect(check(report, "subject-size").level).toBe("fail");
  });

  it("flags a frame rate too low to resolve a downswing", () => {
    const report = checkCapture(analysis({ fps: 15 }), PHASES);
    expect(check(report, "frame-rate").level).toBe("fail");
  });

  it("warns when the swing's phases weren't fully detected", () => {
    const report = checkCapture(analysis(), { ...PHASES, top: null, impact: null });
    expect(check(report, "swing").level).toBe("warn");
  });

  it("fails when there's no swing at all", () => {
    const report = checkCapture(analysis(), {
      address: null,
      takeaway: null,
      top: null,
      downswing: null,
      impact: null,
      followThrough: null,
    });
    expect(check(report, "swing").level).toBe("fail");
  });

  it("only checks camera alignment for down-the-line footage", () => {
    const faceOn = checkCapture(analysis(), PHASES);
    expect(faceOn.checks.some((c) => c.id === "alignment")).toBe(false);

    const misaligned = Array.from({ length: 20 }, (_, i) => frame(i, { ankleSpread: 0.2 }));
    const report = checkCapture(analysis({ frames: misaligned, view: "down_the_line" }), PHASES);
    expect(check(report, "alignment").level).toBe("warn");
  });

  it("passes alignment for a down-the-line stance that looks square to the camera", () => {
    const aligned = Array.from({ length: 20 }, (_, i) => frame(i, { ankleSpread: 0.02 }));
    const report = checkCapture(analysis({ frames: aligned, view: "down_the_line" }), PHASES);
    expect(check(report, "alignment").level).toBe("pass");
  });
});
