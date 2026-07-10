import { drawClubTracer, drawOverlayLines, drawSkeleton } from "./draw.ts";
import { clubTipEstimate, computeOverlayLines } from "./geometry.ts";
import type { AddressRefs, OverlayLine, Point } from "./geometry.ts";
import { LandmarkSmoother, PointSmoother } from "./smoothing.ts";
import type { Handedness, PoseFrame, View } from "./types.ts";

const CLUB_TRAIL_MAX_LENGTH = 18;
const CLUB_TRAIL_JUMP_THRESHOLD = 2;

/**
 * Per-video drawing state: smoothing and the club tracer trail are stateful
 * across frames, so each video (the user's swing and a reference swing) needs
 * its own bundle to draw independently.
 */
export interface OverlayRenderState {
  smoother: LandmarkSmoother;
  clubSmoother: PointSmoother;
  clubTrail: Point[];
  prevIndex: number | null;
}

export function createOverlayRenderState(): OverlayRenderState {
  return {
    smoother: new LandmarkSmoother(),
    clubSmoother: new PointSmoother(),
    clubTrail: [],
    prevIndex: null,
  };
}

/**
 * Draws one frame's full overlay (skeleton, angle lines, club tracer) onto a
 * canvas context, returning the overlay lines so the caller can feed the
 * angle readout. drawSkeleton clears the canvas first, so no explicit clear
 * is needed.
 */
export function renderOverlayFrame(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  index: number,
  frames: PoseFrame[],
  view: View,
  handedness: Handedness,
  aspect: number,
  addressRefs: AddressRefs,
  state: OverlayRenderState,
): OverlayLine[] {
  const smoothed = state.smoother.apply(frames[index].landmarks, index);
  const overlay = computeOverlayLines(view, smoothed, handedness, aspect, addressRefs);
  drawSkeleton(ctx, smoothed, cssWidth, cssHeight);
  drawOverlayLines(ctx, overlay, cssWidth, cssHeight);

  // A big jump (scrub/seek) starts a fresh tracer instead of drawing a
  // straight streak across the skipped frames.
  const prevIndex = state.prevIndex;
  if (prevIndex === null || Math.abs(index - prevIndex) > CLUB_TRAIL_JUMP_THRESHOLD) {
    state.clubTrail = [];
  }
  state.prevIndex = index;

  // Prefer the backend's Hough-line detection; fall back to the
  // body-pose estimate when no confident line was found for this frame.
  const detectedTip = frames[index].club_tip ?? null;
  const rawTip = detectedTip ?? clubTipEstimate(smoothed, handedness);
  const tip = state.clubSmoother.apply(rawTip, index);
  if (tip) {
    state.clubTrail = [...state.clubTrail, tip].slice(-CLUB_TRAIL_MAX_LENGTH);
  }
  drawClubTracer(ctx, state.clubTrail, cssWidth, cssHeight);

  return overlay;
}
