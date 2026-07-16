import { describe, expect, it, vi } from "vitest";
import { drawClubTracer } from "./draw";
import type { ClubTrailPoint } from "./geometry";

function fakeCtx() {
  const strokeStyles: string[] = [];
  return {
    ctx: {
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      get strokeStyle() {
        return "";
      },
      set strokeStyle(v: string) {
        strokeStyles.push(v);
      },
      stroke: vi.fn(),
      lineWidth: 0,
      lineCap: "",
      lineJoin: "",
      fillStyle: "",
    } as unknown as CanvasRenderingContext2D,
    strokeStyles,
  };
}

function point(frameIndex: number, x: number, y: number): ClubTrailPoint {
  return { x, y, frameIndex };
}

describe("drawClubTracer", () => {
  it("draws the whole trail red when the top of backswing is unknown", () => {
    const { ctx, strokeStyles } = fakeCtx();
    const trail = [point(0, 0.1, 0.1), point(1, 0.2, 0.2), point(2, 0.3, 0.3)];

    drawClubTracer(ctx, trail, 100, 100, null);

    expect(strokeStyles).toHaveLength(1);
    expect(strokeStyles[0]).toMatch(/rgba\(230, 30, 30/);
  });

  it("splits the trail red (backswing) then green (downswing) at topIndex", () => {
    const { ctx, strokeStyles } = fakeCtx();
    const trail = [point(0, 0.1, 0.1), point(1, 0.2, 0.2), point(2, 0.3, 0.3), point(3, 0.4, 0.4)];

    drawClubTracer(ctx, trail, 100, 100, 1);

    expect(strokeStyles).toHaveLength(2);
    expect(strokeStyles[0]).toMatch(/rgba\(230, 30, 30/);
    expect(strokeStyles[1]).toMatch(/rgba\(40, 190, 90/);
  });

  it("draws only the backswing color when nothing is past topIndex yet", () => {
    const { ctx, strokeStyles } = fakeCtx();
    const trail = [point(0, 0.1, 0.1), point(1, 0.2, 0.2)];

    drawClubTracer(ctx, trail, 100, 100, 5);

    expect(strokeStyles).toHaveLength(1);
    expect(strokeStyles[0]).toMatch(/rgba\(230, 30, 30/);
  });

  it("smooths a single noisy spike toward its neighbors instead of drawing through it", () => {
    const { ctx } = fakeCtx();
    // A single frame with a big x jump surrounded by ten steady points --
    // one bad detection, not real motion.
    const trail = Array.from({ length: 11 }, (_, i) => point(i, i === 5 ? 0.9 : 0.1, 0.1));

    drawClubTracer(ctx, trail, 100, 100, null);

    const quadCalls = (ctx.quadraticCurveTo as unknown as { mock: { calls: number[][] } }).mock.calls;
    const controlPointXs = quadCalls.map((args) => args[0]);
    // Raw spike would scale to x=90 on a 100px-wide canvas; averaged over
    // its 10 steady neighbors it should land far below that.
    expect(Math.max(...controlPointXs)).toBeLessThan(50);
  });
});
