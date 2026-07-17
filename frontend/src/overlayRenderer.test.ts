import { describe, expect, it, vi } from "vitest";
import { createOverlayRenderState, renderOverlayFrame } from "./overlayRenderer";
import {
  LEFT_HIP,
  LEFT_INDEX,
  LEFT_SHOULDER,
  LEFT_WRIST,
  RIGHT_HIP,
  RIGHT_INDEX,
  RIGHT_SHOULDER,
  RIGHT_WRIST,
} from "./geometry";
import type { AddressRefs } from "./geometry";
import { makeLandmarks } from "./testUtils";
import type { PoseFrame } from "./types";

function fakeCtx(): CanvasRenderingContext2D {
  return {
    clearRect: vi.fn(),
    setLineDash: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    roundRect: vi.fn(),
    fillText: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

const ADDRESS_REFS: AddressRefs = { swayX: null, plane: null };

function frame(index: number, yolo: { x: number; y: number } | null): PoseFrame {
  return { index, t: index / 30, landmarks: null, club_tip_yolo: yolo };
}

describe("renderOverlayFrame's club trail", () => {
  it("keeps appending points across a continuous play-through", () => {
    const ctx = fakeCtx();
    const state = createOverlayRenderState();
    const frames = [frame(0, { x: 0.1, y: 0.1 }), frame(1, { x: 0.2, y: 0.2 }), frame(2, { x: 0.3, y: 0.3 })];
    const yoloTrack = frames.map((f) => f.club_tip_yolo ?? null);

    for (let i = 0; i < frames.length; i++) {
      renderOverlayFrame(ctx, 100, 100, i, frames, "face_on", "right", 1, ADDRESS_REFS, state, {
        yoloTrack,
        topIndex: null,
        impactIndex: null,
      });
    }

    expect(state.clubTrail).toHaveLength(3);
  });

  it("stops appending points once past the impact frame", () => {
    const ctx = fakeCtx();
    const state = createOverlayRenderState();
    const track = [
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.2 },
      { x: 0.3, y: 0.3 },
    ];
    const frames = track.map((yolo, index) => frame(index, yolo));

    for (let i = 0; i <= 2; i++) {
      renderOverlayFrame(ctx, 100, 100, i, frames, "face_on", "right", 1, ADDRESS_REFS, state, {
        yoloTrack: track,
        topIndex: null,
        impactIndex: 1, // frame 1 is impact -- frame 2 should not extend the trail
      });
    }

    expect(state.clubTrail).toHaveLength(2);
    expect(state.clubTrail.map((p) => p.frameIndex)).toEqual([0, 1]);
  });

  it("does not reset the frozen trail on subsequent past-impact frames", () => {
    const ctx = fakeCtx();
    const state = createOverlayRenderState();
    const track = [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }, null, { x: 0.4, y: 0.4 }];
    const frames = track.map((yolo, index) => frame(index, yolo));

    for (let i = 0; i <= 3; i++) {
      renderOverlayFrame(ctx, 100, 100, i, frames, "face_on", "right", 1, ADDRESS_REFS, state, {
        yoloTrack: track,
        topIndex: null,
        impactIndex: 0,
      });
    }

    expect(state.clubTrail).toHaveLength(1);
    expect(state.clubTrail[0].frameIndex).toBe(0);
  });

  it("resets the trail on a scrub (a big index jump)", () => {
    const ctx = fakeCtx();
    const state = createOverlayRenderState();
    const yoloTrack = [
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.2 },
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      { x: 0.9, y: 0.9 },
    ];
    const frames = yoloTrack.map((club_tip_yolo, index) => frame(index, club_tip_yolo));

    renderOverlayFrame(ctx, 100, 100, 0, frames, "face_on", "right", 1, ADDRESS_REFS, state, { yoloTrack, topIndex: null, impactIndex: null });
    renderOverlayFrame(ctx, 100, 100, 1, frames, "face_on", "right", 1, ADDRESS_REFS, state, { yoloTrack, topIndex: null, impactIndex: null });
    expect(state.clubTrail).toHaveLength(2);

    // Jump straight to frame 9 (a scrub).
    renderOverlayFrame(ctx, 100, 100, 9, frames, "face_on", "right", 1, ADDRESS_REFS, state, { yoloTrack, topIndex: null, impactIndex: null });
    expect(state.clubTrail).toHaveLength(1);
  });

  it("falls back to the body-pose estimate on a YOLO miss instead of stopping the trail short", () => {
    const ctx = fakeCtx();
    const state = createOverlayRenderState();
    // shoulder-mid (0.5,0.3) to hip-mid (0.5,0.7): torso length 0.4, shaft
    // length 0.4 * 1.6 = 0.64; knuckles straight above the wrists -> estimate
    // extends straight up to (0.5, -0.04).
    const landmarks = makeLandmarks({
      [LEFT_SHOULDER]: { x: 0.4, y: 0.3 },
      [RIGHT_SHOULDER]: { x: 0.6, y: 0.3 },
      [LEFT_HIP]: { x: 0.4, y: 0.7 },
      [RIGHT_HIP]: { x: 0.6, y: 0.7 },
      [LEFT_WRIST]: { x: 0.5, y: 0.6 },
      [RIGHT_WRIST]: { x: 0.5, y: 0.6 },
      [LEFT_INDEX]: { x: 0.5, y: 0.5 },
      [RIGHT_INDEX]: { x: 0.5, y: 0.5 },
    });
    const frames: PoseFrame[] = [{ index: 0, t: 0, landmarks, club_tip_yolo: null }];

    renderOverlayFrame(ctx, 100, 100, 0, frames, "face_on", "right", 1, ADDRESS_REFS, state, {
      yoloTrack: [null],
      topIndex: null,
      impactIndex: null,
    });

    expect(state.clubTrail).toHaveLength(1);
    expect(state.clubTrail[0].x).toBeCloseTo(0.5, 1);
    expect(state.clubTrail[0].y).toBeCloseTo(-0.04, 1);
  });
});
