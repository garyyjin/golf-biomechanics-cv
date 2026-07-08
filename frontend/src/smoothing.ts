import type { Landmark } from "./types";

const ALPHA = 0.4; // weight of the incoming frame

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
      result = landmarks.map((lm, i) => ({
        x: prev[i].x + ALPHA * (lm.x - prev[i].x),
        y: prev[i].y + ALPHA * (lm.y - prev[i].y),
        z: prev[i].z + ALPHA * (lm.z - prev[i].z),
        visibility: lm.visibility,
      }));
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
