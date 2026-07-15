import { findAddressFrame, midpoint, sideIndices, visiblePoint } from "./geometry.ts";
import type { Handedness, Landmark, PoseFrame } from "./types.ts";

export interface SwingPhases {
  address: number | null;
  takeaway: number | null;
  top: number | null;
  downswing: number | null;
  impact: number | null;
  followThrough: number | null;
}

const MIN_VALID_FRAMES = 10;
const MIN_RISE = 0.03; // normalized-y units; below this, no detectable backswing motion
const TAKEAWAY_FRACTION = 0.25;
const ADDRESS_SETTLE_SECONDS = 2; // how far past the clip's start to look for a settled stance
const ADDRESS_SETTLE_STEP_TOLERANCE = 0.008; // normalized-y units per frame; below this counts as "not moving"
const ADDRESS_MIN_HOLD_SECONDS = 0.3; // how long a still stretch must last to count as a real hold, not a pause

function handY(landmarks: Landmark[] | null, handedness: Handedness): number | null {
  if (!landmarks) return null;
  const side = sideIndices(handedness);
  const lead = visiblePoint(landmarks, side.leadWrist);
  const trail = visiblePoint(landmarks, side.trailWrist);
  if (lead && trail) return midpoint(lead, trail).y;
  if (lead) return lead.y;
  if (trail) return trail.y;
  return null;
}

/** Linearly interpolate internal null runs bounded by two valid samples. */
export function interpolateGaps(raw: (number | null)[]): (number | null)[] {
  const result = [...raw];
  let i = 0;
  while (i < result.length) {
    if (result[i] !== null) {
      i++;
      continue;
    }
    const gapStart = i;
    while (i < result.length && result[i] === null) i++;
    const gapEnd = i; // exclusive
    const before = gapStart - 1;
    const after = gapEnd;
    if (before >= 0 && after < result.length && result[before] !== null && result[after] !== null) {
      const a = result[before]!;
      const b = result[after]!;
      for (let j = gapStart; j < gapEnd; j++) {
        const t = (j - before) / (after - before);
        result[j] = a + t * (b - a);
      }
    }
  }
  return result;
}

function movingAverage(series: (number | null)[], window: number): (number | null)[] {
  const half = Math.floor(window / 2);
  return series.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(series.length - 1, i + half); j++) {
      const v = series[j];
      if (v !== null) {
        sum += v;
        count++;
      }
    }
    return count > 0 ? sum / count : null;
  });
}

function argmin(series: (number | null)[], from: number, to: number): number | null {
  let best: number | null = null;
  let bestValue = Infinity;
  for (let i = from; i <= to; i++) {
    const v = series[i];
    if (v !== null && v < bestValue) {
      bestValue = v;
      best = i;
    }
  }
  return best;
}

function argmax(series: (number | null)[], from: number, to: number): number | null {
  let best: number | null = null;
  let bestValue = -Infinity;
  for (let i = from; i <= to; i++) {
    const v = series[i];
    if (v !== null && v > bestValue) {
      bestValue = v;
      best = i;
    }
  }
  return best;
}

/**
 * Golfers often keep settling into their stance — a waggle, a bit more
 * forward bend — for a moment after recording starts, so the very first
 * detected frame can catch that transient instead of the setup position
 * actually held right before the swing begins. Sometimes that settling
 * changes hand height too (bending in further tends to lower it), so
 * comparing everything back to the first frame's own value isn't enough —
 * this instead looks for the LATEST run of consecutive frames where
 * (already smoothed, denoised) hand height barely moves frame-to-frame,
 * long enough to count as a real hold rather than a momentary pause, and
 * lands on that run's last frame.
 *
 * `upperBoundExclusive` must be the already-detected top of the backswing
 * (found using the unrefined, frame-0 address) — a real takeaway is often
 * slow and gentle at first, so bounding only by elapsed time isn't enough
 * to stop this from mistaking the start of a gradual backswing for
 * continued stillness and swallowing it into "address," which cascades
 * into top/downswing/impact/follow-through all coming back null.
 */
function refineAddressIndex(
  smoothed: (number | null)[],
  bootstrapIndex: number,
  upperBoundExclusive: number,
  fps: number,
): number {
  const timeWindowEnd = bootstrapIndex + Math.round(fps * ADDRESS_SETTLE_SECONDS);
  const windowEnd = Math.min(upperBoundExclusive - 1, timeWindowEnd, smoothed.length - 1);
  if (windowEnd <= bootstrapIndex) return bootstrapIndex;

  const minHoldFrames = Math.max(3, Math.round(fps * ADDRESS_MIN_HOLD_SECONDS));
  let runStart: number | null = null;
  let chosenEnd: number | null = null;
  for (let i = bootstrapIndex + 1; i <= windowEnd; i++) {
    const prev = smoothed[i - 1];
    const cur = smoothed[i];
    const stable = prev !== null && cur !== null && Math.abs(cur - prev) <= ADDRESS_SETTLE_STEP_TOLERANCE;
    if (stable) {
      if (runStart === null) runStart = i - 1;
      if (i - runStart + 1 >= minHoldFrames) chosenEnd = i;
    } else {
      runStart = null;
    }
  }
  return chosenEnd ?? bootstrapIndex;
}

/**
 * Detects swing-phase frame indices from lead/trail wrist height over time.
 * Heuristic, not ML: a golf swing's hand-height trajectory has a distinctive
 * shape (flat at address, rising through backswing, peak at the top, sharp
 * drop through downswing/impact, rising again through follow-through) that a
 * centered moving average + extrema search segments reliably without needing
 * club/ball tracking.
 *
 * All indices are `number | null` — a phase that can't be confidently
 * detected (too little motion, too few valid frames, noisy tail) is null
 * rather than a guess; downstream phases that depend on an earlier phase
 * cascade to null too.
 */
export function detectPhases(frames: PoseFrame[], handedness: Handedness, fps: number): SwingPhases {
  const empty: SwingPhases = {
    address: null,
    takeaway: null,
    top: null,
    downswing: null,
    impact: null,
    followThrough: null,
  };

  const addressFrame = findAddressFrame(frames);
  const bootstrapAddressIndex = addressFrame ? frames.indexOf(addressFrame) : null;
  if (bootstrapAddressIndex === null) return empty;

  const raw = frames.map((f) => handY(f.landmarks, handedness));
  const validCount = raw.filter((v) => v !== null).length;
  if (validCount < MIN_VALID_FRAMES) return { ...empty, address: bootstrapAddressIndex };

  const interpolated = interpolateGaps(raw);
  const window = Math.max(3, Math.round(fps / 6));
  const smoothed = movingAverage(interpolated, window);

  const velocity: (number | null)[] = smoothed.map((_, i) => {
    if (i === 0 || i === smoothed.length - 1) return null;
    const prev = smoothed[i - 1];
    const next = smoothed[i + 1];
    if (prev === null || next === null) return null;
    return (next - prev) / (2 / fps);
  });

  const downswingIndex = argmax(velocity, 0, velocity.length - 1);
  if (downswingIndex === null) return { ...empty, address: bootstrapAddressIndex };

  // Top must be found with the unrefined address first — it's the safe
  // upper bound the address refinement below needs so it can never wander
  // into the actual backswing.
  const bootstrapTopIndex = argmin(smoothed, bootstrapAddressIndex, downswingIndex);
  if (bootstrapTopIndex === null) return { ...empty, address: bootstrapAddressIndex };

  const bootstrapRise = (smoothed[bootstrapAddressIndex] ?? 0) - (smoothed[bootstrapTopIndex] ?? 0);
  if (bootstrapRise < MIN_RISE) return { ...empty, address: bootstrapAddressIndex };

  const addressIndex = refineAddressIndex(smoothed, bootstrapAddressIndex, bootstrapTopIndex, fps);

  // Re-derived off the refined address; top itself can't have moved (it's
  // still inside [addressIndex, downswingIndex] since refinement stopped
  // strictly before it), but the rise it's measured against can shift a
  // little if settling changed the address hand height.
  const topIndex = argmin(smoothed, addressIndex, downswingIndex) ?? bootstrapTopIndex;
  const rise = (smoothed[addressIndex] ?? 0) - (smoothed[topIndex] ?? 0);
  if (rise < MIN_RISE) return { ...empty, address: addressIndex };

  const impactSearchEnd = Math.min(smoothed.length - 1, downswingIndex + Math.round(fps * 0.5));
  const impactIndex = argmax(smoothed, downswingIndex + 1, impactSearchEnd);

  let takeawayIndex: number | null = null;
  const targetDrop = TAKEAWAY_FRACTION * rise;
  for (let i = addressIndex + 1; i <= topIndex; i++) {
    const v = smoothed[i];
    if (v !== null && (smoothed[addressIndex] ?? 0) - v >= targetDrop) {
      takeawayIndex = i;
      break;
    }
  }

  let followThroughIndex: number | null = null;
  if (impactIndex !== null) {
    const candidate = argmin(smoothed, impactIndex + 1, smoothed.length - 1);
    if (candidate !== null) {
      const followRise = (smoothed[impactIndex] ?? 0) - (smoothed[candidate] ?? 0);
      if (followRise >= MIN_RISE) followThroughIndex = candidate;
    }
  }

  return {
    address: addressIndex,
    takeaway: takeawayIndex,
    top: topIndex,
    downswing: downswingIndex,
    impact: impactIndex,
    followThrough: followThroughIndex,
  };
}
