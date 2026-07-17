import type { ClubSegment, LineId, NormalizedPoint, OverlayLine, Point } from "./geometry";
import { POSE_CONNECTIONS, VISIBILITY_THRESHOLD } from "./pose";
import type { Landmark } from "./types";

const BONE_COLOR = "rgba(80, 220, 130, 0.72)";
const JOINT_COLOR = "rgba(255, 255, 255, 0.95)";
// Dims the angle-line strokes a bit without touching their labels (drawn
// separately, at full opacity, via drawLabelChip below) -- a translucent
// stroke reads better against the video than the labels would.
const LINE_STROKE_OPACITY = 0.8;

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
// Also used as the single generic "club" color outside the tracer (the
// comparison diagram's club segment, the video overlay's legend swatch).
export const CLUB_TRACER_COLOR = [230, 30, 30] as const;

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
    ctx.strokeStyle = hexToRgba(color, LINE_STROKE_OPACITY);
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

/**
 * Strokes the swing-path trail. Points are joined with quadratic curves
 * through each pair's midpoint (a standard curve-through-points trick: treat
 * every real point as a curve's control point, and the midpoints between
 * consecutive points as the on-curve anchors) rather than straight lineTo
 * segments, so the path reads as a smooth curve instead of an angular
 * polyline — this smooths the line's shape only, with no time delay, unlike
 * smoothing the point itself (PointSmoother in smoothing.ts) which would make
 * the tracer lag behind the actual clubhead.
 */
function strokeTrailSegment(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  cssWidth: number,
  cssHeight: number,
  color: readonly [number, number, number],
  lineWidth: number,
): void {
  if (points.length < 2) return;
  const [r, g, b] = color;
  const pts = points.map((p) => ({ x: p.x * cssWidth, y: p.y * cssHeight }));
  ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.9)`;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const midX = (pts[i].x + pts[i + 1].x) / 2;
    const midY = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  ctx.stroke();
}

// How many neighboring recorded points get averaged into each drawn point.
// The trail records one point per rendered video frame, but the drawn path
// shouldn't be that fine-grained -- at 30-60fps, per-frame detector noise
// (a pixel or two of jitter) reads as visible kinks when every single frame
// is a curve anchor. Averaging over a wider neighborhood than any one frame
// smooths those kinks out; this only affects what gets drawn; the
// underlying trail (and the live tip position derived from it elsewhere)
// keeps its real per-frame data.
const TRAIL_SMOOTHING_WINDOW = 11;

/**
 * Symmetric moving average over each point's (up to) `window` nearest
 * neighbors on both sides, clamped at the trail's ends where fewer are
 * available.
 */
function smoothTrailForDisplay(trail: Point[], window: number): Point[] {
  const half = Math.floor(window / 2);
  return trail.map((_, i) => {
    const start = Math.max(0, i - half);
    const end = Math.min(trail.length - 1, i + half);
    let sumX = 0;
    let sumY = 0;
    for (let j = start; j <= end; j++) {
      sumX += trail[j].x;
      sumY += trail[j].y;
    }
    const count = end - start + 1;
    return { x: sumX / count, y: sumY / count };
  });
}

/**
 * Draws the swing-path trail, solid and permanent (no fade) rather than
 * ghosting out — `trail` only shrinks back to empty on a scrub/seek (see
 * overlayRenderer.ts), so during a normal play-through it keeps growing for
 * as long as the swing plays out, covering the whole thing in one color.
 *
 * Deliberately doesn't split the trail by swing phase or freeze it at
 * impact: both depended on detectPhases' heuristic top-of-backswing/impact
 * frame indices, which can be wrong on hard footage (poor lighting, an
 * unusual camera angle) -- a wrong impact frame froze the trail early,
 * looking like it had stopped tracking partway through the swing. A single
 * continuous line has nothing to get wrong that way.
 */
export function drawClubTracer(
  ctx: CanvasRenderingContext2D,
  trail: Point[],
  cssWidth: number,
  cssHeight: number,
): void {
  if (trail.length === 0) return;
  const scale = Math.max(cssWidth, cssHeight);
  const lineWidth = Math.max(1.5, scale * 0.006);
  const smoothed = smoothTrailForDisplay(trail, TRAIL_SMOOTHING_WINDOW);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  strokeTrailSegment(ctx, smoothed, cssWidth, cssHeight, CLUB_TRACER_COLOR, lineWidth);

  // The tip marker deliberately uses the raw (unsmoothed) last point, not
  // `smoothed` -- it's the live tracked position while the trail is still
  // extending, and averaging it in with past points would lag it behind the
  // actual clubhead the same way over-smoothing PointSmoother would.
  const tip = trail[trail.length - 1];
  const [r, g, b] = CLUB_TRACER_COLOR;
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.95)`;
  ctx.beginPath();
  ctx.arc(tip.x * cssWidth, tip.y * cssHeight, Math.max(2.5, scale * 0.007), 0, Math.PI * 2);
  ctx.fill();
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
function drawClubSegment(
  ctx: CanvasRenderingContext2D,
  segment: ClubSegment | null,
  cx: number,
  cy: number,
  unitScale: number,
  dashed: boolean,
): void {
  if (!segment) return;
  const [r, g, b] = CLUB_TRACER_COLOR;
  const px = (p: NormalizedPoint) => ({ x: cx + p.x * unitScale, y: cy + p.y * unitScale });
  const hands = px(segment.hands);
  const tip = px(segment.tip);

  ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${dashed ? 0.55 : 0.9})`;
  ctx.lineWidth = Math.max(1.5, unitScale * 0.025);
  ctx.lineCap = "round";
  ctx.setLineDash(dashed ? [5, 4] : []);
  ctx.beginPath();
  ctx.moveTo(hands.x, hands.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${dashed ? 0.6 : 0.95})`;
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, Math.max(1.5, unitScale * 0.03), 0, Math.PI * 2);
  ctx.fill();
}

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Bounding box (in comparison-space units) over every point actually being
 * drawn — skeleton joints and club segments alike. The club can extend well
 * past the body silhouette in any direction depending on swing phase (e.g.
 * pointing up past the head at the top of the backswing), so a fixed
 * "assume the head/feet are the extremes" framing (the previous approach)
 * clips it; fitting to the real content each frame doesn't.
 */
function computeBounds(
  pointSets: (NormalizedPoint[] | null)[],
  segments: (ClubSegment | null)[],
): Bounds | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let found = false;

  const include = (p: { x: number; y: number }) => {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
    found = true;
  };

  for (const points of pointSets) {
    if (!points) continue;
    for (const p of points) {
      if (p.visible) include(p);
    }
  }
  for (const segment of segments) {
    if (!segment) continue;
    include(segment.hands);
    include(segment.tip);
  }

  return found ? { minX, maxX, minY, maxY } : null;
}

const COMPARISON_PADDING = 0.18;

export function drawComparisonSkeletons(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  user: NormalizedPoint[] | null,
  reference: NormalizedPoint[] | null,
  userClub?: ClubSegment | null,
  referenceClub?: ClubSegment | null,
): void {
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const bounds = computeBounds([user, reference], [userClub ?? null, referenceClub ?? null]);
  let cx = cssWidth / 2;
  let cy = cssHeight / 2;
  let unitScale = Math.min(cssWidth, cssHeight) * 0.22;

  if (bounds) {
    const contentWidth = Math.max(bounds.maxX - bounds.minX, 1e-6) * (1 + COMPARISON_PADDING * 2);
    const contentHeight = Math.max(bounds.maxY - bounds.minY, 1e-6) * (1 + COMPARISON_PADDING * 2);
    unitScale = Math.min(cssWidth / contentWidth, cssHeight / contentHeight);
    const contentCenterX = (bounds.minX + bounds.maxX) / 2;
    const contentCenterY = (bounds.minY + bounds.maxY) / 2;
    cx = cssWidth / 2 - contentCenterX * unitScale;
    cy = cssHeight / 2 - contentCenterY * unitScale;
  }

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
  drawClubSegment(ctx, referenceClub ?? null, cx, cy, unitScale, true);
  drawClubSegment(ctx, userClub ?? null, cx, cy, unitScale, false);
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
