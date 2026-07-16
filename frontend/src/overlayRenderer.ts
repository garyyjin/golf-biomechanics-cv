import { resolveClubTip } from "./club.ts";
import type { ClubPoint } from "./club.ts";
import { drawClubTracer, drawOverlayLines, drawSkeleton } from "./draw.ts";
import { computeOverlayLines } from "./geometry.ts";
import type { AddressRefs, ClubTrailPoint, OverlayLine } from "./geometry.ts";
import { LandmarkSmoother, PointSmoother } from "./smoothing.ts";
import type { Handedness, PoseFrame, View } from "./types.ts";

const CLUB_TRAIL_JUMP_THRESHOLD = 2;

/**
 * Per-video drawing state: smoothing and the club tracer trail are stateful
 * across frames, so each video (the user's swing and a reference swing) needs
 * its own bundle to draw independently.
 */
export interface OverlayRenderState {
  smoother: LandmarkSmoother;
  clubSmoother: PointSmoother;
  clubTrail: ClubTrailPoint[];
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
    // A big jump (scrub/seek) starts a fresh tracer instead of drawing a
    // straight streak across the skipped frames.
    const prevIndex = state.prevIndex;
    if (prevIndex === null || Math.abs(index - prevIndex) > CLUB_TRAIL_JUMP_THRESHOLD) {
      state.clubTrail = [];
    }
    state.prevIndex = index;

    // Past impact, the swing path is complete -- freeze the trail (a real
    // swing-path graphic doesn't keep drawing through the follow-through)
    // instead of continuing to append points.
    const { impactIndex } = clubTracer;
    if (impactIndex === null || index <= impactIndex) {
      const rawTip = resolveClubTip(index, clubTracer.yoloTrack);
      const tip = state.clubSmoother.apply(rawTip, index);
      if (tip) {
        state.clubTrail = [...state.clubTrail, { ...tip, frameIndex: index }];
      }
    }
    drawClubTracer(ctx, state.clubTrail, cssWidth, cssHeight, clubTracer.topIndex);
  }

  return overlay;
}
