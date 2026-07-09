import type { Landmark } from "./types";

const ALPHA = 0.4; // weight of the incoming frame at full visibility
// Landmarks poorly seen (self-occlusion from body turn, edge-of-frame,
// club/body occlusion) tend to have low MediaPipe visibility; scaling alpha
// by visibility trusts noisy low-confidence samples less. The 0.1 floor
// keeps a persistently low-visibility landmark from freezing forever while
// still strongly damping jitter.
const MIN_TRUST = 0.1;

/**
 * Exponential smoothing for drawing only — the raw analysis data is never
 * mutated. State resets whenever playback is discontinuous (scrub, step
 * backwards, a skipped or null frame) so the skeleton never drags across a
 * jump.
 */
export class LandmarkSmoother {
  private previous: Landmark[] | null = null;
  private previousIndex = -1;

  apply(landmarks: Landmark[] | null, frameIndex: number): Landmark[] | null {
    if (landmarks === null) {
      this.reset();
      return null;
    }

    const continuous =
      this.previous !== null &&
      (frameIndex === this.previousIndex || frameIndex === this.previousIndex + 1);

    let result: Landmark[];
    if (!continuous) {
      result = landmarks;
    } else if (frameIndex === this.previousIndex) {
      // Same frame redrawn (resize, repeated callback) — keep prior output.
      return this.previous;
    } else {
      const prev = this.previous!;
      result = landmarks.map((lm, i) => {
        const trust = Math.max(MIN_TRUST, Math.min(1, lm.visibility));
        const alpha = ALPHA * trust;
        return {
          x: prev[i].x + alpha * (lm.x - prev[i].x),
          y: prev[i].y + alpha * (lm.y - prev[i].y),
          z: prev[i].z + alpha * (lm.z - prev[i].z),
          visibility: lm.visibility,
        };
      });
    }

    this.previous = result;
    this.previousIndex = frameIndex;
    return result;
  }

  reset(): void {
    this.previous = null;
    this.previousIndex = -1;
  }
}

/**
 * Same exponential-smoothing/discontinuity-reset shape as LandmarkSmoother,
 * for a single 2D point instead of a landmark array — used for the club-tip
 * tracer, whose position (whether Hough-detected or body-pose-estimated)
 * isn't otherwise touched by LandmarkSmoother and can jitter frame to frame.
 */
export class PointSmoother {
  private previous: { x: number; y: number } | null = null;
  private previousIndex = -1;

  apply(point: { x: number; y: number } | null, frameIndex: number): { x: number; y: number } | null {
    if (point === null) {
      this.reset();
      return null;
    }

    const continuous =
      this.previous !== null &&
      (frameIndex === this.previousIndex || frameIndex === this.previousIndex + 1);

    let result: { x: number; y: number };
    if (!continuous) {
      result = point;
    } else if (frameIndex === this.previousIndex) {
      return this.previous;
    } else {
      const prev = this.previous!;
      result = {
        x: prev.x + ALPHA * (point.x - prev.x),
        y: prev.y + ALPHA * (point.y - prev.y),
      };
    }

    this.previous = result;
    this.previousIndex = frameIndex;
    return result;
  }

  reset(): void {
    this.previous = null;
    this.previousIndex = -1;
  }
}
