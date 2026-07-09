import type { LineId, NormalizedPoint, OverlayLine } from "./geometry";
import { POSE_CONNECTIONS, VISIBILITY_THRESHOLD } from "./pose";
import type { Landmark } from "./types";

const BONE_COLOR = "rgba(80, 220, 130, 0.9)";
const JOINT_COLOR = "rgba(255, 255, 255, 0.95)";

export const LINE_COLORS: Record<LineId, string> = {
  spine: "#ff9f43",
  shoulder: "#4dd0e1",
  hip: "#f06292",
  sway: "#ffe082",
  plane: "#b388ff",
};

/**
 * Draw the skeleton onto a canvas whose context is already scaled so that
 * (cssWidth, cssHeight) covers the video display box. Landmarks are
 * normalized [0,1] coordinates. Null clears the canvas.
 */
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[] | null,
  cssWidth: number,
  cssHeight: number,
): void {
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  if (!landmarks) return;

  const visible = (i: number) => landmarks[i].visibility >= VISIBILITY_THRESHOLD;
  const scale = Math.max(cssWidth, cssHeight);

  ctx.lineWidth = Math.max(1.5, scale * 0.004);
  ctx.strokeStyle = BONE_COLOR;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (const [a, b] of POSE_CONNECTIONS) {
    if (!visible(a) || !visible(b)) continue;
    ctx.moveTo(landmarks[a].x * cssWidth, landmarks[a].y * cssHeight);
    ctx.lineTo(landmarks[b].x * cssWidth, landmarks[b].y * cssHeight);
  }
  ctx.stroke();

  ctx.fillStyle = JOINT_COLOR;
  const radius = Math.max(2, scale * 0.005);
  for (let i = 0; i < landmarks.length; i++) {
    if (!visible(i)) continue;
    ctx.beginPath();
    ctx.arc(landmarks[i].x * cssWidth, landmarks[i].y * cssHeight, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Draw the biomechanics lines on top of the skeleton (call after
 * drawSkeleton — this does not clear the canvas). Same coordinate
 * conventions as drawSkeleton: normalized endpoints, CSS-pixel context.
 */
export function drawOverlayLines(
  ctx: CanvasRenderingContext2D,
  lines: OverlayLine[],
  cssWidth: number,
  cssHeight: number,
): void {
  const lineWidth = Math.max(1.5, Math.max(cssWidth, cssHeight) * 0.003);
  const diagonal = Math.hypot(cssWidth, cssHeight);

  for (const line of lines) {
    const ax = line.a.x * cssWidth;
    const ay = line.a.y * cssHeight;
    const bx = line.b.x * cssWidth;
    const by = line.b.y * cssHeight;
    const length = Math.hypot(bx - ax, by - ay);

    let x1 = ax;
    let y1 = ay;
    let x2 = bx;
    let y2 = by;
    if (line.extend && length > 0) {
      const ux = (bx - ax) / length;
      const uy = (by - ay) / length;
      x1 = ax - ux * diagonal;
      y1 = ay - uy * diagonal;
      x2 = bx + ux * diagonal;
      y2 = by + uy * diagonal;
    }

    const color = LINE_COLORS[line.id];
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.setLineDash(line.fixed ? [6, 6] : []);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    const text =
      line.angleDeg !== null ? `${line.label} ${line.angleDeg.toFixed(1)}°` : line.label;
    let lx: number;
    let ly: number;
    if (line.id === "sway") {
      // Fixed vertical line: label near the top so it clears the body.
      lx = ax + 8;
      ly = cssHeight * 0.06;
    } else if (line.id === "plane") {
      // Anchor at the wrist-midpoint end of the plane line.
      lx = ax + 10;
      ly = ay - 12;
    } else if (line.id === "spine") {
      // Midpoint, offset perpendicular to the line.
      const nx = length > 0 ? -(by - ay) / length : 0;
      const ny = length > 0 ? (bx - ax) / length : -1;
      lx = (ax + bx) / 2 + nx * 14;
      ly = (ay + by) / 2 + ny * 14;
    } else {
      // Shoulders/hips: just beyond the lead endpoint, outside the body.
      const ux = length > 0 ? (bx - ax) / length : 1;
      const uy = length > 0 ? (by - ay) / length : 0;
      lx = ax - ux * 12;
      ly = ay - uy * 12;
    }
    drawLabelChip(ctx, text, lx, ly, color, cssWidth, cssHeight);
  }
  ctx.setLineDash([]);
}

// Tuned for the comparison canvas's light card background (unlike the video
// overlay's colors above, which assume a dark video underneath).
const COMPARISON_USER_BONE = "rgba(22, 163, 74, 0.95)";
const COMPARISON_USER_JOINT = "rgba(10, 10, 10, 0.9)";
const COMPARISON_REFERENCE_BONE = "rgba(23, 23, 23, 0.4)";
const COMPARISON_REFERENCE_JOINT = "rgba(23, 23, 23, 0.5)";

/**
 * Draws a single normalized skeleton (see geometry.ts's
 * normalizeLandmarksForComparison — torso length = 1 unit, hip-centered)
 * scaled by `unitScale` pixels-per-unit around (cx, cy).
 */
function drawNormalizedSkeleton(
  ctx: CanvasRenderingContext2D,
  points: NormalizedPoint[] | null,
  cx: number,
  cy: number,
  unitScale: number,
  boneColor: string,
  jointColor: string,
  dashed: boolean,
): void {
  if (!points) return;
  const px = (p: NormalizedPoint) => ({ x: cx + p.x * unitScale, y: cy + p.y * unitScale });

  ctx.strokeStyle = boneColor;
  ctx.lineWidth = Math.max(1.5, unitScale * 0.03);
  ctx.lineCap = "round";
  ctx.setLineDash(dashed ? [6, 5] : []);
  ctx.beginPath();
  for (const [a, b] of POSE_CONNECTIONS) {
    if (!points[a].visible || !points[b].visible) continue;
    const pa = px(points[a]);
    const pb = px(points[b]);
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = jointColor;
  const radius = Math.max(1.5, unitScale * 0.035);
  for (const point of points) {
    if (!point.visible) continue;
    const p = px(point);
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Draws a user skeleton (solid, green) over a reference skeleton (dashed,
 * gray "ghost"), both already hip-centered/torso-scaled by
 * normalizeLandmarksForComparison so differing camera framing doesn't
 * distort the comparison. Either skeleton may be null (drawn as absent, not
 * an error) so a phase that's missing on one side still shows the other.
 */
export function drawComparisonSkeletons(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  user: NormalizedPoint[] | null,
  reference: NormalizedPoint[] | null,
): void {
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  const cx = cssWidth / 2;
  // Head sits ~1.3 torso-lengths above the hip, feet ~2.3 below — cy is
  // biased toward the top and the scale kept conservative so a portrait
  // (taller-than-wide) canvas fits the full body without clipping feet.
  const cy = cssHeight * 0.4;
  const unitScale = Math.min(cssWidth, cssHeight) * 0.3;

  drawNormalizedSkeleton(
    ctx,
    reference,
    cx,
    cy,
    unitScale,
    COMPARISON_REFERENCE_BONE,
    COMPARISON_REFERENCE_JOINT,
    true,
  );
  drawNormalizedSkeleton(ctx, user, cx, cy, unitScale, COMPARISON_USER_BONE, COMPARISON_USER_JOINT, false);
}

function drawLabelChip(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  cssWidth: number,
  cssHeight: number,
): void {
  const padX = 4;
  const padY = 3;
  ctx.font = "12px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  const width = ctx.measureText(text).width + padX * 2;
  const height = 12 + padY * 2;
  const left = Math.min(Math.max(x - padX, 2), cssWidth - width - 2);
  const top = Math.min(Math.max(y - height / 2, 2), cssHeight - height - 2);
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
  ctx.beginPath();
  ctx.roundRect(left, top, width, height, 4);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(text, left + padX, top + height / 2);
}
