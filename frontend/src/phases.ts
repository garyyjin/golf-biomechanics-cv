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
  const addressIndex = addressFrame ? frames.indexOf(addressFrame) : null;
  if (addressIndex === null) return empty;

  const raw = frames.map((f) => handY(f.landmarks, handedness));
  const validCount = raw.filter((v) => v !== null).length;
  if (validCount < MIN_VALID_FRAMES) return { ...empty, address: addressIndex };

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
  if (downswingIndex === null) return { ...empty, address: addressIndex };

  const topIndex = argmin(smoothed, addressIndex, downswingIndex);
  if (topIndex === null) return { ...empty, address: addressIndex };

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
