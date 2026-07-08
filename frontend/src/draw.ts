import { POSE_CONNECTIONS, VISIBILITY_THRESHOLD } from "./pose";
import type { Landmark } from "./types";

const BONE_COLOR = "rgba(80, 220, 130, 0.9)";
const JOINT_COLOR = "rgba(255, 255, 255, 0.95)";

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
