import { describe, expect, it, vi } from "vitest";
import { createOverlayRenderState, renderOverlayFrame } from "./overlayRenderer";
import type { AddressRefs } from "./geometry";
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
  } as unknown as CanvasRenderingContext2D;
}

const ADDRESS_REFS: AddressRefs = { swayX: null, plane: null };

function frame(index: number, yolo: { x: number; y: number } | null): PoseFrame {
  return { index, t: index / 30, landmarks: null, club_tip_yolo: yolo };
}

describe("renderOverlayFrame's club trail", () => {
  it("keeps appending points while at or before impact", () => {
    const ctx = fakeCtx();
    const state = createOverlayRenderState();
    const frames = [frame(0, { x: 0.1, y: 0.1 }), frame(1, { x: 0.2, y: 0.2 })];

    renderOverlayFrame(ctx, 100, 100, 0, frames, "face_on", "right", 1, ADDRESS_REFS, state, {
      yoloTrack: [frames[0].club_tip_yolo ?? null, frames[1].club_tip_yolo ?? null],
      topIndex: null,
      impactIndex: 5,
    });
    renderOverlayFrame(ctx, 100, 100, 1, frames, "face_on", "right", 1, ADDRESS_REFS, state, {
      yoloTrack: [frames[0].club_tip_yolo ?? null, frames[1].club_tip_yolo ?? null],
      topIndex: null,
      impactIndex: 5,
    });

    expect(state.clubTrail).toHaveLength(2);
  });

  it("stops appending points once past the impact frame", () => {
    const ctx = fakeCtx();
    const state = createOverlayRenderState();
    const track = [
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.2 },
      { x: 0.3, y: 0.3 },
    ];
    const frames = [frame(0, track[0]), frame(1, track[1]), frame(2, track[2])];

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
    const frames = [frame(0, track[0]), frame(1, track[1]), frame(2, track[2]), frame(3, track[3])];

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
});
