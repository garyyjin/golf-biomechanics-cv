import { describe, expect, it } from "vitest";
import { buildChartGeometry, fitDomain, nearestPointIndex } from "./chartGeometry";
import type { SeriesPoint } from "./chartGeometry";

const OPTIONS = {
  width: 300,
  height: 120,
  padding: { left: 40, right: 20, top: 10, bottom: 30 },
};
// plot box: left 40, top 10, width 240, height 80

const DAY = 86_400_000;

function series(values: [number, number][]): SeriesPoint[] {
  return values.map(([t, value], i) => ({ t, value, id: `s${i}` }));
}

describe("fitDomain", () => {
  it("pads a normal range", () => {
    expect(fitDomain([10, 20])).toEqual({ min: 9, max: 21 });
  });

  it("widens a flat series proportionally instead of collapsing to zero height", () => {
    expect(fitDomain([50, 50, 50])).toEqual({ min: 45, max: 55 });
  });

  it("widens a flat series at zero without producing a zero-width domain", () => {
    expect(fitDomain([0])).toEqual({ min: -1, max: 1 });
  });

  it("handles an empty series", () => {
    expect(fitDomain([])).toEqual({ min: 0, max: 1 });
  });
});

describe("buildChartGeometry", () => {
  it("returns no path and no points for an empty series", () => {
    const geometry = buildChartGeometry([], OPTIONS);
    expect(geometry.points).toEqual([]);
    expect(geometry.path).toBe("");
    expect(geometry.xTicks).toEqual([]);
  });

  it("centres a lone point and draws no line through it", () => {
    const geometry = buildChartGeometry(series([[0, 50]]), OPTIONS);
    expect(geometry.points).toHaveLength(1);
    expect(geometry.points[0].x).toBe(160); // left 40 + width 240 / 2
    // Nothing to join -- a one-point "line" would be an invisible zero-length
    // stroke, and the marker carries the reading instead.
    expect(geometry.path).toBe("");
  });

  it("spans the plot box across the time range with value 0 at the bottom", () => {
    const geometry = buildChartGeometry(
      series([
        [0, 0],
        [DAY, 100],
      ]),
      { ...OPTIONS, domain: { min: 0, max: 100 } },
    );
    const [first, second] = geometry.points;
    expect(first.x).toBe(40);
    expect(second.x).toBe(280);
    expect(first.y).toBe(90); // top 10 + height 80, i.e. the baseline
    expect(second.y).toBe(10); // top of the plot
    expect(geometry.path).toBe("M40.00 90.00 L280.00 10.00");
  });

  it("positions points by real elapsed time, not by their index", () => {
    // Two swings a day apart, then a third a further nine days on. The middle
    // point must sit near the left, not at the midpoint.
    const geometry = buildChartGeometry(
      series([
        [0, 10],
        [DAY, 20],
        [10 * DAY, 30],
      ]),
      OPTIONS,
    );
    expect(geometry.points[1].x).toBeCloseTo(40 + 240 * 0.1, 6);
  });

  it("sorts out-of-order input before plotting", () => {
    const geometry = buildChartGeometry(
      series([
        [2 * DAY, 30],
        [0, 10],
        [DAY, 20],
      ]),
      OPTIONS,
    );
    expect(geometry.points.map((p) => p.value)).toEqual([10, 20, 30]);
    expect(geometry.points[0].x).toBeLessThan(geometry.points[2].x);
  });

  it("falls back to even spacing when every swing shares a timestamp", () => {
    // Several swings analyzed in the same instant have no time span to scale
    // against; without this they'd stack on one x and the line would vanish.
    const geometry = buildChartGeometry(
      series([
        [5, 10],
        [5, 20],
        [5, 30],
      ]),
      OPTIONS,
    );
    expect(geometry.points.map((p) => p.x)).toEqual([40, 160, 280]);
  });

  it("never emits more x ticks than there are points", () => {
    const geometry = buildChartGeometry(
      series([
        [0, 10],
        [DAY, 20],
      ]),
      { ...OPTIONS, xTickCount: 6 },
    );
    expect(geometry.xTicks).toHaveLength(2);
  });

  it("honours a fixed domain instead of fitting to the data", () => {
    const geometry = buildChartGeometry(
      series([
        [0, 40],
        [DAY, 60],
      ]),
      { ...OPTIONS, domain: { min: 0, max: 100 } },
    );
    expect(geometry.domain).toEqual({ min: 0, max: 100 });
    // 40 and 60 sit inside the band rather than pinned to the edges.
    expect(geometry.points[0].y).toBeCloseTo(90 - 0.4 * 80, 6);
    expect(geometry.points[1].y).toBeCloseTo(90 - 0.6 * 80, 6);
  });
});

describe("nearestPointIndex", () => {
  const geometry = buildChartGeometry(
    series([
      [0, 10],
      [DAY, 20],
      [2 * DAY, 30],
    ]),
    OPTIONS,
  );

  it("finds the closest point to a pixel x", () => {
    expect(nearestPointIndex(geometry.points, 41)).toBe(0);
    expect(nearestPointIndex(geometry.points, 158)).toBe(1);
    expect(nearestPointIndex(geometry.points, 400)).toBe(2);
  });

  it("returns null for an empty series", () => {
    expect(nearestPointIndex([], 100)).toBeNull();
  });
});
