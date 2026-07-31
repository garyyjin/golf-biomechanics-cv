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
 * Symmetric log-scale mapping from an off-target ratio to a 0–10 score: 10 at
 * ratio 1 (dead on target), 0 at 2x or ½x, so missing high and missing low by
 * the same factor score the same.
 *
 * Used for both tempo readings in this module. For the reference comparison
 * the input is the speed-modification factor directly (1 = the reference's
 * playback was never touched); for the tour-standard comparison the input is
 * the swing's own ratio divided by TOUR_TEMPO_RATIO, which puts "how far off
 * the target am I, multiplicatively" on the same footing.
 */
export function tempoRatioScore(ratio: number): number {
  return Math.min(10, Math.max(0, 10 * (1 - Math.abs(Math.log2(ratio)))));
}

/** Timestamp of a frame index, clamped into range. */
function timeOf(frames: PoseFrame[], index: number): number {
  return frames[Math.min(frames.length - 1, Math.max(0, index))].t;
}

/** Seconds between two phase frames, or null if either is undetected or the
 * span isn't positive. */
function phaseSeconds(
  frames: PoseFrame[],
  from: number | null,
  to: number | null,
): number | null {
  if (from === null || to === null) return null;
  const seconds = timeOf(frames, to) - timeOf(frames, from);
  return seconds > 0 ? seconds : null;
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
  const segment = (from: keyof SwingPhases, to: keyof SwingPhases): TempoSegment | null => {
    const userDur = phaseSeconds(userFrames, userPhases[from], userPhases[to]);
    const refDur = phaseSeconds(refFrames, refPhases[from], refPhases[to]);
    if (userDur === null || refDur === null) return null;
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

// The backswing:downswing time ratio tour players cluster around, popularized
// as "Tour Tempo" (John Novosel) — measured in frames at 30fps, the pros come
// out near 24:8, 21:7, or 18:6, all of which are 3:1. The absolute durations
// vary between players; the *ratio* is what stays put, which is exactly what
// makes it usable as a fixed target from a single video with no reference
// swing to compare against.
export const TOUR_TEMPO_RATIO = 3;

export interface SwingTempo {
  /** backswing seconds / downswing seconds — 3.0 means a textbook 3:1. Null
   * when either segment's phases weren't detected or had no positive
   * duration. */
  ratio: number | null;
  /** 0–10 against TOUR_TEMPO_RATIO: 10 at exactly 3:1, falling off
   * symmetrically in log space so 6:1 and 1.5:1 both score 0. Null alongside
   * a null ratio. */
  score: number | null;
  /** takeaway → top */
  backswingSeconds: number | null;
  /** top → impact */
  downswingSeconds: number | null;
}

/**
 * The swing's own tempo, scored against the 3:1 tour standard rather than
 * against a reference swing.
 *
 * computeTempoScore above needs a library swing to compare with, so it says
 * nothing at all until the user has uploaded references — and what it scores
 * is agreement with whoever that reference happens to be. This is the
 * absolute reading: it needs nothing but the user's own detected phases, and
 * it's the number a golfer would recognize from any tempo trainer.
 *
 * The two segment durations are reported alongside the ratio because the
 * ratio alone hides a real distinction — a 3:1 swing can be languid or
 * lightning-quick, and only the raw seconds tell them apart.
 */
export function computeSwingTempo(phases: SwingPhases, frames: PoseFrame[]): SwingTempo {
  const backswingSeconds = phaseSeconds(frames, phases.takeaway, phases.top);
  const downswingSeconds = phaseSeconds(frames, phases.top, phases.impact);
  if (backswingSeconds === null || downswingSeconds === null) {
    return { ratio: null, score: null, backswingSeconds, downswingSeconds };
  }
  const ratio = backswingSeconds / downswingSeconds;
  return {
    ratio,
    score: tempoRatioScore(ratio / TOUR_TEMPO_RATIO),
    backswingSeconds,
    downswingSeconds,
  };
}

/** A tempo ratio in the "3.0 : 1" form golfers read it in. */
export function formatTempoRatio(ratio: number): string {
  return `${ratio.toFixed(1)} : 1`;
}

/** Plain-English reading of how a swing's tempo sits against the tour
 * standard — which side of 3:1 it falls on is actionable coaching (too quick
 * a backswing vs. a downswing that rushes), where the bare number isn't. */
export function describeSwingTempo(ratio: number): string {
  if (Math.abs(ratio - TOUR_TEMPO_RATIO) < 0.15) return "right on the 3:1 tour standard";
  return ratio > TOUR_TEMPO_RATIO
    ? "backswing is slow relative to your downswing"
    : "backswing is quick relative to your downswing";
}
