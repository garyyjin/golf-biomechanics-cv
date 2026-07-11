import type { SwingPhases } from "./phases.ts";
import type { PoseFrame } from "./types.ts";

export interface TempoSegment {
  /** 0–10; 10 means the reference needed no speed change for this segment. */
  score: number;
  /** refDuration / userDuration — the playback-rate factor the phase-aligned
   * sync applies to the reference over this segment (comparison.ts's
   * referenceSyncTarget baseRate at masterRate 1). >1 means the reference had
   * to be sped up because the user swings this segment faster. */
  ratio: number;
}

export interface TempoScore {
  /** Average of the available segment scores; null when neither segment's
   * phases were detected on both swings. */
  overall: number | null;
  /** takeaway → top */
  backswing: TempoSegment | null;
  /** top → impact */
  downswing: TempoSegment | null;
}

/**
 * Symmetric log-scale mapping from a speed-modification ratio to a 0–10
 * score: 10 at ratio 1 (reference untouched), 0 at 2x or ½x, so being too
 * fast and too slow by the same factor score the same.
 */
export function tempoRatioScore(ratio: number): number {
  return Math.min(10, Math.max(0, 10 * (1 - Math.abs(Math.log2(ratio)))));
}

/** Plain-English reading of a segment's ratio for the breakdown rows. */
export function describeTempoRatio(ratio: number): string {
  if (Math.abs(ratio - 1) < 0.02) return "matched your tempo";
  return ratio > 1
    ? `reference sped up ${ratio.toFixed(2)}x`
    : `reference slowed to ${ratio.toFixed(2)}x`;
}

/**
 * Tempo score for the phase-aligned comparison: how much the reference's
 * playback speed must be modified over the backswing (takeaway→top) and
 * downswing (top→impact) to stay in sync with the user's swing. A segment is
 * null when either endpoint phase is undetected on either swing, or a
 * segment has no positive duration.
 */
export function computeTempoScore(
  userPhases: SwingPhases,
  refPhases: SwingPhases,
  userFrames: PoseFrame[],
  refFrames: PoseFrame[],
): TempoScore {
  const timeOf = (frames: PoseFrame[], index: number) =>
    frames[Math.min(frames.length - 1, Math.max(0, index))].t;

  const segment = (from: keyof SwingPhases, to: keyof SwingPhases): TempoSegment | null => {
    const userFrom = userPhases[from];
    const userTo = userPhases[to];
    const refFrom = refPhases[from];
    const refTo = refPhases[to];
    if (userFrom === null || userTo === null || refFrom === null || refTo === null) return null;
    const userDur = timeOf(userFrames, userTo) - timeOf(userFrames, userFrom);
    const refDur = timeOf(refFrames, refTo) - timeOf(refFrames, refFrom);
    if (userDur <= 0 || refDur <= 0) return null;
    const ratio = refDur / userDur;
    return { ratio, score: tempoRatioScore(ratio) };
  };

  const backswing = segment("takeaway", "top");
  const downswing = segment("top", "impact");
  const scores = [backswing, downswing]
    .filter((s): s is TempoSegment => s !== null)
    .map((s) => s.score);
  const overall = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  return { overall, backswing, downswing };
}
