/** Scale and path math for the progress chart.
 *
 * Kept separate from the component, and pure, for the same reason draw.ts is
 * separate from the canvas that hosts it: the arithmetic is what's worth
 * testing, and it's untestable once it's tangled up with rendering.
 */

export interface SeriesPoint {
  /** Milliseconds since epoch — swings are plotted against real time, not
   * their position in the list, so a month-long gap between range sessions
   * reads as a gap rather than as one even step. */
  t: number;
  value: number;
  /** Identifies the swing this point came from, for hover and click. */
  id: string;
}

export interface PlotBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PlacedPoint extends SeriesPoint {
  x: number;
  y: number;
}

export interface AxisTick {
  /** Pixel position along the relevant axis. */
  pos: number;
  value: number;
}

export interface ChartGeometry {
  plot: PlotBox;
  points: PlacedPoint[];
  /** SVG path for the connecting line; empty when there's nothing to join
   * (fewer than two points). */
  path: string;
  yTicks: AxisTick[];
  xTicks: AxisTick[];
  domain: { min: number; max: number };
}

export interface ChartOptions {
  width: number;
  height: number;
  padding: { left: number; right: number; top: number; bottom: number };
  /** Fixed y-domain, for bounded measures. The swing score is 0–100, and
   * pinning it there keeps a two-point improvement from looking like a
   * transformation the way an auto-fitted axis would. Omit for open-ended
   * measures like clubhead speed, which get a data-fitted domain. */
  domain?: { min: number; max: number };
  yTickCount?: number;
  xTickCount?: number;
}

/**
 * A domain that covers the data with a little headroom, widened to something
 * sane when the data can't imply one: a single point, or a run of identical
 * values, would otherwise collapse to zero height and divide by zero.
 */
export function fitDomain(values: number[]): { min: number; max: number } {
  if (values.length === 0) return { min: 0, max: 1 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    // A flat series still deserves a readable axis; centre it in a band
    // proportional to the value itself (or ±1 at zero).
    const pad = Math.abs(min) > 1e-9 ? Math.abs(min) * 0.1 : 1;
    return { min: min - pad, max: max + pad };
  }
  const pad = (max - min) * 0.1;
  return { min: min - pad, max: max + pad };
}

function ticks(min: number, max: number, count: number): number[] {
  if (count < 2 || max <= min) return [min];
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, i) => min + i * step);
}

/**
 * Places a series into pixel space.
 *
 * Points are laid out by timestamp. When every point shares one timestamp
 * (several swings analyzed in the same instant, or a single swing) there's no
 * time span to scale against, so they fall back to even index spacing —
 * otherwise they'd all stack on one x and the line would vanish.
 */
export function buildChartGeometry(series: SeriesPoint[], options: ChartOptions): ChartGeometry {
  const { width, height, padding } = options;
  const plot: PlotBox = {
    left: padding.left,
    top: padding.top,
    width: Math.max(0, width - padding.left - padding.right),
    height: Math.max(0, height - padding.top - padding.bottom),
  };

  const sorted = [...series].sort((a, b) => a.t - b.t);
  const domain = options.domain ?? fitDomain(sorted.map((p) => p.value));
  const span = domain.max - domain.min || 1;

  const tMin = sorted.length ? sorted[0].t : 0;
  const tMax = sorted.length ? sorted[sorted.length - 1].t : 0;
  const tSpan = tMax - tMin;

  const xFor = (point: SeriesPoint, index: number): number => {
    if (sorted.length === 1) return plot.left + plot.width / 2;
    if (tSpan <= 0) return plot.left + (index / (sorted.length - 1)) * plot.width;
    return plot.left + ((point.t - tMin) / tSpan) * plot.width;
  };
  // y grows downward in SVG, so a higher value sits nearer the top.
  const yFor = (value: number): number =>
    plot.top + plot.height - ((value - domain.min) / span) * plot.height;

  const points: PlacedPoint[] = sorted.map((point, index) => ({
    ...point,
    x: xFor(point, index),
    y: yFor(point.value),
  }));

  const path =
    points.length < 2
      ? ""
      : points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");

  const yTicks = ticks(domain.min, domain.max, options.yTickCount ?? 4).map((value) => ({
    pos: yFor(value),
    value,
  }));

  // Never more x ticks than there are points -- a date axis with more labels
  // than data invents readings that were never taken.
  const xTickCount = Math.min(options.xTickCount ?? 4, Math.max(1, points.length));
  const xTicks =
    points.length === 0
      ? []
      : tSpan <= 0
        ? [{ pos: points[0].x, value: tMin }]
        : ticks(tMin, tMax, xTickCount).map((value) => ({
            pos: plot.left + ((value - tMin) / tSpan) * plot.width,
            value,
          }));

  return { plot, points, path, yTicks, xTicks, domain };
}

/** Index of the point nearest a pixel x, for the hover crosshair. Returns
 * null for an empty series so callers don't have to special-case it. */
export function nearestPointIndex(points: PlacedPoint[], pixelX: number): number | null {
  if (points.length === 0) return null;
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < points.length; i++) {
    const distance = Math.abs(points[i].x - pixelX);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}
