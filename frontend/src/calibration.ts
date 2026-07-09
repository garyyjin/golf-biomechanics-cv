import { DEFAULT_BENCHMARKS } from "./benchmarks.default.ts";
import type { MetricId, Phase } from "./benchmarks.ts";
import { SCORED_PHASES, computeMetricValue } from "./feedback.ts";
import { detectPhases } from "./phases.ts";
import type { AnalysisResponse } from "./types.ts";

export interface SwingSample {
  phase: Phase;
  metric: MetricId;
  value: number;
}

/**
 * Turns one already-analyzed reference swing into a flat list of calibration
 * samples, using the exact same detectPhases/computeMetricValue functions
 * that later score a user's swing — the empirical benchmarks this feeds are
 * guaranteed to be measured the same way they're later compared against.
 */
export function computeSwingSamples(analysis: AnalysisResponse): SwingSample[] {
  const aspect = analysis.width / analysis.height;
  const phases = detectPhases(analysis.frames, analysis.handedness, analysis.fps);
  const addressFrame = phases.address !== null ? analysis.frames[phases.address] : null;

  const samples: SwingSample[] = [];
  for (const phase of SCORED_PHASES) {
    const frameIndex = phases[phase];
    if (frameIndex === null) continue;
    const frame = analysis.frames[frameIndex];
    const metricEntries = DEFAULT_BENCHMARKS[analysis.view][phase] ?? [];
    for (const metricEntry of metricEntries) {
      const value = computeMetricValue(
        metricEntry.metric,
        frame,
        analysis.view,
        analysis.handedness,
        aspect,
        addressFrame,
      );
      if (value !== null) samples.push({ phase, metric: metricEntry.metric, value });
    }
  }
  return samples;
}
