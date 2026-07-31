import { useMemo, useRef, useState } from "react";
import { buildChartGeometry, nearestPointIndex } from "./chartGeometry";
import type { SeriesPoint } from "./chartGeometry";
import { SERIES_OPTIONS } from "./chartSeries";
import type { SeriesKey } from "./chartSeries";

interface Props {
  series: SeriesPoint[];
  seriesKey: SeriesKey;
  onSelect?: (id: string) => void;
}

const WIDTH = 720;
const HEIGHT = 240;
const PADDING = { left: 48, right: 20, top: 16, bottom: 32 };

function formatDate(t: number): string {
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Score (or speed, or tempo) over time as a single-series line chart.
 *
 * One series at a time, by design: the three measures have unrelated scales,
 * and overlaying them on a shared axis would imply comparisons that don't
 * exist. The switcher swaps the series rather than adding a second y-axis.
 *
 * No legend — with one series the heading names it, and a legend box for a
 * lone line is chrome with nothing to disambiguate.
 */
export function ProgressChart({ series, seriesKey, onSelect }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const option = SERIES_OPTIONS.find((o) => o.value === seriesKey) ?? SERIES_OPTIONS[0];

  const geometry = useMemo(
    () =>
      buildChartGeometry(series, {
        width: WIDTH,
        height: HEIGHT,
        padding: PADDING,
        domain: option.domain,
      }),
    [series, option.domain],
  );

  if (series.length === 0) {
    return (
      <p className="hint chart-empty">
        No scored swings yet — analyze a swing and it'll be charted here.
      </p>
    );
  }

  const format = (value: number) => `${value.toFixed(option.decimals)}${option.unit}`;
  const hovered = hoverIndex !== null ? geometry.points[hoverIndex] : null;

  /** Maps a pointer position onto the SVG's own coordinate space — the
   * element is scaled by its viewBox, so clientX offsets can't be used raw. */
  function pointerToSvgX(clientX: number): number | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return null;
    return ((clientX - rect.left) / rect.width) * WIDTH;
  }

  return (
    <div className="chart-wrap">
      <svg
        ref={svgRef}
        className="progress-chart"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`${option.label} over time, ${series.length} swings`}
        onPointerMove={(e) => {
          const x = pointerToSvgX(e.clientX);
          if (x !== null) setHoverIndex(nearestPointIndex(geometry.points, x));
        }}
        onPointerLeave={() => setHoverIndex(null)}
        onClick={() => {
          if (hovered && onSelect) onSelect(hovered.id);
        }}
      >
        {geometry.yTicks.map((tick) => (
          <g key={`y${tick.value}`}>
            <line
              className="chart-grid"
              x1={geometry.plot.left}
              x2={geometry.plot.left + geometry.plot.width}
              y1={tick.pos}
              y2={tick.pos}
            />
            <text className="chart-axis-label" x={geometry.plot.left - 8} y={tick.pos + 4} textAnchor="end">
              {tick.value.toFixed(option.decimals)}
            </text>
          </g>
        ))}

        {geometry.xTicks.map((tick, i) => (
          <text
            key={`x${tick.value}-${i}`}
            className="chart-axis-label"
            x={tick.pos}
            y={geometry.plot.top + geometry.plot.height + 20}
            textAnchor="middle"
          >
            {formatDate(tick.value)}
          </text>
        ))}

        {geometry.path && <path className="chart-line" d={geometry.path} />}

        {hovered && (
          <line
            className="chart-crosshair"
            x1={hovered.x}
            x2={hovered.x}
            y1={geometry.plot.top}
            y2={geometry.plot.top + geometry.plot.height}
          />
        )}

        {geometry.points.map((point, i) => (
          <circle
            key={point.id}
            className={i === hoverIndex ? "chart-dot hovered" : "chart-dot"}
            cx={point.x}
            cy={point.y}
            r={i === hoverIndex ? 6 : 4}
          />
        ))}
      </svg>

      {hovered && (
        <div
          className="chart-tooltip"
          style={{
            left: `${(hovered.x / WIDTH) * 100}%`,
            top: `${(hovered.y / HEIGHT) * 100}%`,
          }}
        >
          <span className="chart-tooltip-value">{format(hovered.value)}</span>
          <span className="chart-tooltip-date">{formatDate(hovered.t)}</span>
        </div>
      )}
    </div>
  );
}
