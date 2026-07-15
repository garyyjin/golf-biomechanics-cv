import { resolveClubTip } from "./club.ts";
import type { ClubDetector, ClubPoint } from "./club.ts";
import { drawClubTracer, drawOverlayLines, drawSkeleton } from "./draw.ts";
import { computeOverlayLines } from "./geometry.ts";
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
 * Draws one frame's full overlay (skeleton, angle lines, and optionally a
 * club tracer) onto a canvas context, returning the overlay lines so the
 * caller can feed the angle readout. drawSkeleton clears the canvas first,
 * so no explicit clear is needed.
 *
 * The club tracer is opt-in (off by default) — both detectors behind it
 * (Hough-line shaft detection, and the geometric fallback estimate it uses
 * when detection fails) are too erratic to show right now. See
 * project_club_tracking_* history for why; the drawing/resolution code is
 * left in place so it's cheap to turn back on once that's fixed.
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
  clubTracer?: { detector: ClubDetector; yoloTrack: (ClubPoint | null)[] | null },
): OverlayLine[] {
  const smoothed = state.smoother.apply(frames[index].landmarks, index);
  const overlay = computeOverlayLines(view, smoothed, handedness, aspect, addressRefs);
  drawSkeleton(ctx, smoothed, cssWidth, cssHeight);
  drawOverlayLines(ctx, overlay, cssWidth, cssHeight);

  if (clubTracer) {
    // A big jump (scrub/seek) starts a fresh tracer instead of drawing a
    // straight streak across the skipped frames.
    const prevIndex = state.prevIndex;
    if (prevIndex === null || Math.abs(index - prevIndex) > CLUB_TRAIL_JUMP_THRESHOLD) {
      state.clubTrail = [];
    }
    state.prevIndex = index;

    const rawTip = resolveClubTip(clubTracer.detector, frames, index, clubTracer.yoloTrack, smoothed, handedness);
    const tip = state.clubSmoother.apply(rawTip, index);
    if (tip) {
      state.clubTrail = [...state.clubTrail, tip].slice(-CLUB_TRAIL_MAX_LENGTH);
    }
    drawClubTracer(ctx, state.clubTrail, cssWidth, cssHeight);
  }

  return overlay;
}
