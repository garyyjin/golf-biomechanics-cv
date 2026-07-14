import type { FeedbackItem, FeedbackResult } from "./feedback.ts";

export type ScoreBand = "good" | "fair" | "poor";

export interface SwingScore {
  /** 0–100, or null when no scored metric was detected on this swing. */
  overall: number | null;
  band: ScoreBand | null;
}

/** Overshoot (as a multiple of the range's own width) past which a missed
 * metric bottoms out at 0 — one full range-width off scores nothing. */
const OVERSHOOT_TOLERANCE = 1;

/**
 * One metric's contribution: 100 when it lands inside its benchmark range,
 * decaying linearly to 0 as it misses by up to a full range-width, matching
 * the below/within/above classification computeFeedback already produces.
 * Null (excluded from the average, not scored as 0) when the metric or its
 * range couldn't be measured at all.
 */
function metricScore(item: FeedbackItem): number | null {
  if (item.status === "undetected" || item.value === null || item.range === null) return null;
  if (item.status === "within") return 100;
  const { min, max } = item.range;
  const width = Math.max(max - min, 1e-6);
  const distance = item.status === "below" ? min - item.value : item.value - max;
  const overshoot = distance / width / OVERSHOOT_TOLERANCE;
  return Math.max(0, 100 * (1 - overshoot));
}

export function scoreBand(overall: number): ScoreBand {
  if (overall >= 80) return "good";
  if (overall >= 55) return "fair";
  return "poor";
}

/**
 * Overall swing score: the average of every benchmarked metric's closeness
 * to its target range at the scored phases (feedback.ts's SCORED_PHASES —
 * address, top, impact). A metric scores 100 inside its range and decays to
 * 0 the further it misses, so the result rewards being close even when it
 * isn't quite within range, rather than a blunt pass/fail count. Null when
 * nothing could be measured, e.g. no pose was detected at any scored phase.
 */
export function computeSwingScore(result: FeedbackResult): SwingScore {
  const scores = result.items.map(metricScore).filter((s): s is number => s !== null);
  if (scores.length === 0) return { overall: null, band: null };
  const overall = scores.reduce((a, b) => a + b, 0) / scores.length;
  return { overall, band: scoreBand(overall) };
}
