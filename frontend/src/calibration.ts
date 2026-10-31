import { DEFAULT_BENCHMARKS } from "./benchmarks.default.ts";
import type { MetricId, Phase } from "./benchmarks.ts";
import { SCORED_PHASES } from "./feedback.ts";
import { measureMetricAtPhase, phaseWindowFrames } from "./measurement.ts";
import { detectPhases } from "./phases.ts";
import type { AnalysisResponse } from "./types.ts";

export interface SwingSample {
  phase: Phase;
  metric: MetricId;
  value: number;
}

/**
 * Turns one already-analyzed reference swing into a flat list of calibration
 * samples, using the exact same detectPhases/measureMetricAtPhase path that
 * later scores a user's swing — including the same short-window median, so a
 * benchmark range and the reading it's compared against are measured the same
 * way.
 */
export function computeSwingSamples(analysis: AnalysisResponse): SwingSample[] {
  const aspect = analysis.width / analysis.height;
  const phases = detectPhases(analysis.frames, analysis.handedness, analysis.fps);
  const halfWindow = phaseWindowFrames(analysis.fps);

  const samples: SwingSample[] = [];
  for (const phase of SCORED_PHASES) {
    const frameIndex = phases[phase];
    if (frameIndex === null) continue;
    const metricEntries = DEFAULT_BENCHMARKS[analysis.view][phase] ?? [];
    for (const metricEntry of metricEntries) {
      const { value } = measureMetricAtPhase(
        metricEntry.metric,
        analysis.frames,
        frameIndex,
        analysis.view,
        analysis.handedness,
        aspect,
        phases.address,
        halfWindow,
      );
      if (value !== null) samples.push({ phase, metric: metricEntry.metric, value });
    }
  }
  return samples;
}
