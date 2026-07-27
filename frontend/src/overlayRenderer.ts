import { resolveClubTip } from "./club.ts";
import type { ClubPoint } from "./club.ts";
import { drawClubTracer, drawOverlayLines, drawSkeleton } from "./draw.ts";
import { computeOverlayLines } from "./geometry.ts";
import type { AddressRefs, ClubTrailPoint, OverlayLine } from "./geometry.ts";
import { LandmarkSmoother } from "./smoothing.ts";
import type { Handedness, PoseFrame, View } from "./types.ts";

/**
 * Per-video drawing state: the skeleton smoother is stateful across frames
 * (it damps jitter relative to whatever was drawn last), so each video (the
 * user's swing and a reference swing) needs its own bundle to draw
 * independently. `clubTrail` isn't accumulated state -- it's the trail
 * renderOverlayFrame derived on its most recent call, kept here only so
 * callers/tests can inspect what was drawn.
 */
export interface OverlayRenderState {
  smoother: LandmarkSmoother;
  clubTrail: ClubTrailPoint[];
}

export function createOverlayRenderState(): OverlayRenderState {
  return {
    smoother: new LandmarkSmoother(),
    clubTrail: [],
  };
}

/**
 * Draws one frame's full overlay (skeleton, angle lines, and optionally a
 * club tracer) onto a canvas context, returning the overlay lines so the
 * caller can feed the angle readout. drawSkeleton clears the canvas first,
 * so no explicit clear is needed.
 *
 * The club tracer is opt-in: ReferenceVideo never passes clubTracer (no
 * tracer on the reference swing), while PlayerScreen passes it whenever the
 * analysis has any YOLO clubhead detections at all (see hasClubTrack).
 * showSkeleton defaults to true (ReferenceVideo doesn't offer a toggle) and
 * only affects the bones/joints drawing.
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
  clubTracer?: {
    yoloTrack: (ClubPoint | null)[] | null;
    topIndex: number | null;
    impactIndex: number | null;
  },
  showSkeleton = true,
): OverlayLine[] {
  const smoothed = state.smoother.apply(frames[index].landmarks, index);
  const overlay = computeOverlayLines(view, smoothed, handedness, aspect, addressRefs);
  // drawSkeleton clears the canvas regardless of what it's given, so passing
  // null when the toggle is off still clears last frame's drawing without
  // drawing bones/joints -- the angle-line overlay and club tracer (drawn
  // below) are independent of this toggle and use the real `smoothed` data.
  drawSkeleton(ctx, showSkeleton ? smoothed : null, cssWidth, cssHeight);
  drawOverlayLines(ctx, overlay, cssWidth, cssHeight);

  if (clubTracer) {
    // Derived fresh from the full per-frame track every call, not
    // accumulated across renders -- a scrub straight to late in the swing
    // shows the whole trail up to that point instead of a truncated one that
    // only rebuilds forward from wherever playback resumed. Past impact, the
    // swing path is complete, so the trail stops growing there instead of
    // continuing through the follow-through (a real swing-path graphic
    // doesn't keep drawing after the ball's gone).
    const { impactIndex, yoloTrack } = clubTracer;
    const lastIndex = impactIndex === null ? index : Math.min(index, impactIndex);
    const trail: ClubTrailPoint[] = [];
    for (let i = 0; i <= lastIndex; i++) {
      const tip = resolveClubTip(i, yoloTrack, frames[i].landmarks, handedness);
      if (tip) trail.push({ ...tip, frameIndex: i });
    }
    state.clubTrail = trail;
    drawClubTracer(ctx, trail, cssWidth, cssHeight, clubTracer.topIndex);
  }

  return overlay;
}
