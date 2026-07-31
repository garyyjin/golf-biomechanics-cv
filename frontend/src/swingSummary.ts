import type { BenchmarkTable } from "./benchmarks.ts";
import { computeFeedback } from "./feedback.ts";
import { computeSwingStats } from "./stats.ts";
import { computeSwingScore } from "./swingScore.ts";
import type { ScoreBand } from "./swingScore.ts";
import { computeSwingTempo } from "./tempo.ts";
import type { AnalysisResponse } from "./types.ts";

/** One swing's headline numbers, as stored in history.
 *
 * Every field is nullable because each has its own way of being unmeasurable
 * on a given clip: no phases detected (score, tempo), the clubhead never
 * tracked (speeds), a mishit launch direction (carry). A null means "couldn't
 * measure", never "zero".
 */
export interface SwingSummary {
  score: number | null;
  band: ScoreBand | null;
  clubheadSpeedMph: number | null;
  ballSpeedMph: number | null;
  estCarryYards: number | null;
  tempoRatio: number | null;
  tempoScore: number | null;
  /** Which benchmark generation `score` was computed against — the
   * `generatedAt` from the backend's benchmark table, or "defaults" when only
   * the published defaults were available. Empirical benchmarks shift as the
   * reference library grows, so a stored score is only comparable with others
   * carrying the same stamp; the history screen recomputes any that differ
   * from the current one. */
  benchmarksAt: string;
}

/**
 * Derives a swing's stored summary. Pure composition of the functions that
 * already score a swing in the player — nothing is recomputed differently
 * here, so a history row and the player always agree.
 *
 * This is the single place a summary is produced: both the save that follows
 * an analysis and the recompute that follows a benchmark change go through
 * it, the same way calibration.ts's computeSwingSamples is the one place a
 * reference swing's samples come from.
 */
export function computeSwingSummary(
  analysis: AnalysisResponse,
  benchmarks: BenchmarkTable,
  benchmarksAt: string,
): SwingSummary {
  const feedback = computeFeedback(analysis, benchmarks);
  const { overall, band } = computeSwingScore(feedback);
  const stats = computeSwingStats(analysis.frames, feedback.phases, analysis.handedness);
  const tempo = computeSwingTempo(feedback.phases, analysis.frames);

  return {
    score: overall,
    band,
    clubheadSpeedMph: stats.clubheadSpeedMph,
    ballSpeedMph: stats.ballSpeedMph,
    estCarryYards: stats.estCarryYards,
    tempoRatio: tempo.ratio,
    tempoScore: tempo.score,
    benchmarksAt,
  };
}
