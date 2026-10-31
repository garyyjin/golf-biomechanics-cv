import type { MetricId } from "./benchmarks.ts";
import {
  LEFT_HIP,
  LEFT_SHOULDER,
  RIGHT_HIP,
  RIGHT_SHOULDER,
  hipLine,
  shoulderLine,
  sideIndices,
  spineLine,
  swingPlaneLine,
} from "./geometry.ts";
import { VISIBILITY_THRESHOLD } from "./pose.ts";
import type { Handedness, Landmark, PoseFrame, View } from "./types.ts";

/**
 * Turns one pose frame's landmarks into one biomechanics metric.
 *
 * Kept separate from measureMetricAtPhase below (which wraps it) because it
 * is the definition of each metric, not a sampling policy: this is what
 * "spine tilt" or "X-factor" *means* in this app. Every caller that needs a
 * metric at a single instant goes through here, so a number shown in the
 * live readout and the same metric sampled for a benchmark range can never
 * drift apart.
 */
export function computeMetricValue(
  metric: MetricId,
  frame: PoseFrame,
  _view: View,
  handedness: Handedness,
  aspect: number,
  addressFrame: PoseFrame | null,
): number | null {
  switch (metric) {
    case "spineTilt":
      return spineLine(frame.landmarks, aspect)?.angleDeg ?? null;
    case "shoulderTurn":
      return shoulderLine(frame.landmarks, handedness, aspect)?.angleDeg ?? null;
    case "hipTurn":
      return hipLine(frame.landmarks, handedness, aspect)?.angleDeg ?? null;
    case "xFactor": {
      const s = shoulderLine(frame.landmarks, handedness, aspect);
      const h = hipLine(frame.landmarks, handedness, aspect);
      return s && h ? s.angleDeg - h.angleDeg : null;
    }
    case "planeAngle":
      return swingPlaneLine(frame.landmarks, handedness, aspect)?.angleDeg ?? null;
    case "spineRetention": {
      if (!addressFrame) return null;
      const atPhase = spineLine(frame.landmarks, aspect)?.angleDeg;
      const atAddress = spineLine(addressFrame.landmarks, aspect)?.angleDeg;
      return atPhase !== undefined && atAddress !== undefined && atPhase !== null && atAddress !== null
        ? Math.abs(atPhase - atAddress)
        : null;
    }
    default:
      return null;
  }
}

/**
 * The landmarks a metric's value is actually derived from, in the order its
 * geometry reads them. Confidence (below) is the mean visibility of exactly
 * these joints, so the number reflects how well *this* measurement was seen
 * rather than how well the whole pose scored.
 */
function metricLandmarkIndices(metric: MetricId, handedness: Handedness): number[] {
  const side = sideIndices(handedness);
  switch (metric) {
    case "spineTilt":
    case "spineRetention":
      return [LEFT_SHOULDER, RIGHT_SHOULDER, LEFT_HIP, RIGHT_HIP];
    case "shoulderTurn":
      return [side.leadShoulder, side.trailShoulder];
    case "hipTurn":
      return [side.leadHip, side.trailHip];
    case "xFactor":
      return [side.leadShoulder, side.trailShoulder, side.leadHip, side.trailHip];
    case "planeAngle":
      return [side.leadWrist, side.trailWrist, side.trailShoulder];
    default:
      return [];
  }
}

/**
 * Mean visibility of the given joints, or null when any of them falls under
 * VISIBILITY_THRESHOLD — the same gate computeMetricValue applies through
 * visiblePoint, so a metric that was measured always has a confidence and a
 * metric that wasn't never gets one.
 */
export function jointsVisibility(landmarks: Landmark[] | null, indices: number[]): number | null {
  if (!landmarks || indices.length === 0) return null;
  let sum = 0;
  for (const index of indices) {
    const visibility = landmarks[index]?.visibility ?? 0;
    if (visibility < VISIBILITY_THRESHOLD) return null;
    sum += visibility;
  }
  return sum / indices.length;
}

export interface MetricMeasurement {
  /** The metric's value at the phase, or null when it couldn't be measured. */
  value: number | null;
  /**
   * 0–1: how cleanly the measurement's own joints were seen, averaged over
   * the sampled frames. 0 when nothing could be measured. A joint resting
   * just above the visibility gate, or a window where most frames missed the
   * pose entirely, both pull this down — the two situations where a single
   * angle reading is least trustworthy.
   */
  confidence: number;
  /** How many frames in the window produced a measurable value. */
  samples: number;
}

const NULL_MEASUREMENT: MetricMeasurement = { value: null, confidence: 0, samples: 0 };

/**
 * Half-width of the sampling window, in seconds. A phase is an instant, but
 * pose landmarks wobble by a degree or two frame to frame even when the body
 * is barely moving, and the exact frame a phase lands on can shift by one or
 * two between phase-detection passes. Sampling a short window either side and
 * taking the median absorbs both, while staying far shorter than a phase
 * itself (~80ms is under a tenth of a typical backswing).
 */
export const MEASURE_WINDOW_SECONDS = 0.08;

/** Sampling window half-width for a given frame rate, in frames. Never 0, so
 * a very low-fps clip still gets a (tiny) neighbourhood rather than a single
 * frame. */
export function phaseWindowFrames(fps: number): number {
  return Math.max(1, Math.round(fps * MEASURE_WINDOW_SECONDS));
}

/**
 * Below this confidence a metric is treated as unmeasured rather than
 * measured: it's still shown (with the value and a warning) so nothing is
 * hidden, but it's left out of the swing score — see swingScore.ts.
 */
export const MIN_SCORE_CONFIDENCE = 0.5;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Measures one metric at one detected phase, robustly.
 *
 * Rather than reading the phase frame alone, samples `halfWindowFrames` on
 * either side of it, discards frames where the metric or its joints weren't
 * measurable, and takes the median of what's left — so one blurred or
 * mis-detected frame near the top of the backswing can't flip a "within
 * range" reading to "above range" and move the swing score with it. The
 * median (not the mean) is deliberate: pose errors in a window are symmetric
 * noise, and a mean would let a single wild frame drag the result.
 *
 * Both the value and its confidence come from the same samples, so they
 * always describe the same set of frames.
 */
export function measureMetricAtPhase(
  metric: MetricId,
  frames: PoseFrame[],
  frameIndex: number,
  view: View,
  handedness: Handedness,
  aspect: number,
  addressIndex: number | null,
  halfWindowFrames: number,
): MetricMeasurement {
  if (frameIndex < 0 || frameIndex >= frames.length) return NULL_MEASUREMENT;
  const addressFrame = addressIndex !== null ? (frames[addressIndex] ?? null) : null;
  const indices = metricLandmarkIndices(metric, handedness);

  const values: number[] = [];
  const confidences: number[] = [];
  const from = Math.max(0, frameIndex - halfWindowFrames);
  const to = Math.min(frames.length - 1, frameIndex + halfWindowFrames);

  for (let i = from; i <= to; i++) {
    const frame = frames[i];
    if (!frame.landmarks) continue;
    const value = computeMetricValue(metric, frame, view, handedness, aspect, addressFrame);
    if (value === null) continue;

    const own = jointsVisibility(frame.landmarks, indices);
    if (own === null) continue;

    // spineRetention is a *difference* against the address frame, so a clean
    // address pose matters as much as the phase frame's own joints.
    let confidence = own;
    if (metric === "spineRetention") {
      const atAddress = jointsVisibility(addressFrame?.landmarks ?? null, indices);
      if (atAddress === null) continue;
      confidence = (own + atAddress) / 2;
    }

    values.push(value);
    confidences.push(confidence);
  }

  if (values.length === 0) return NULL_MEASUREMENT;
  return {
    value: median(values),
    confidence: confidences.reduce((a, b) => a + b, 0) / confidences.length,
    samples: values.length,
  };
}
