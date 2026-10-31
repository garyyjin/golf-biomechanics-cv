import type { BenchmarkTable, MetricId, MetricRange, Phase } from "./benchmarks.ts";
import { detectPhases } from "./phases.ts";
import type { SwingPhases } from "./phases.ts";
import { measureMetricAtPhase, phaseWindowFrames } from "./measurement.ts";
import type { AnalysisResponse } from "./types.ts";

export { computeMetricValue } from "./measurement.ts";

export type FeedbackStatus = "below" | "within" | "above" | "undetected";

export interface FeedbackItem {
  phase: Phase;
  phaseLabel: string;
  frameIndex: number | null;
  metric: MetricId;
  metricLabel: string;
  value: number | null;
  range: MetricRange | null;
  status: FeedbackStatus;
  source: "published" | "empirical" | null;
  /**
   * 0–1 measurement confidence (see measurement.ts) — how cleanly the joints
   * this metric depends on were seen around the phase. 0 alongside an
   * undetected item. Surfaced in the UI and used by swingScore.ts to keep a
   * barely-visible joint from moving the score.
   */
  confidence: number;
}

export interface FeedbackResult {
  phases: SwingPhases;
  items: FeedbackItem[];
}

export const SCORED_PHASES: Phase[] = ["address", "top", "impact"];

export const PHASE_ORDER: Phase[] = ["address", "takeaway", "top", "downswing", "impact", "followThrough"];

export const PHASE_LABELS: Record<Phase, string> = {
  address: "Address",
  takeaway: "Takeaway",
  top: "Top of backswing",
  downswing: "Downswing",
  impact: "Impact",
  followThrough: "Follow-through",
};

function classify(value: number, range: MetricRange): FeedbackStatus {
  if (value < range.min) return "below";
  if (value > range.max) return "above";
  return "within";
}

/**
 * Scores every benchmarked metric at address, top, and impact.
 *
 * Each value is a short-window median rather than a single-frame read (see
 * measurement.ts) — the phase frame alone is the noisiest possible sample of
 * an angle, and a score that swings on one blurred frame isn't a score of the
 * golfer's swing.
 */
export function computeFeedback(analysis: AnalysisResponse, benchmarks: BenchmarkTable): FeedbackResult {
  const phases = detectPhases(analysis.frames, analysis.handedness, analysis.fps);
  const aspect = analysis.width / analysis.height;
  const halfWindow = phaseWindowFrames(analysis.fps);

  const items: FeedbackItem[] = [];
  for (const phase of SCORED_PHASES) {
    const entries = benchmarks[analysis.view][phase] ?? [];
    const frameIndex = phases[phase];
    for (const entry of entries) {
      const measurement =
        frameIndex === null
          ? null
          : measureMetricAtPhase(
              entry.metric,
              analysis.frames,
              frameIndex,
              analysis.view,
              analysis.handedness,
              aspect,
              phases.address,
              halfWindow,
            );
      const value = measurement?.value ?? null;
      items.push({
        phase,
        phaseLabel: PHASE_LABELS[phase],
        frameIndex,
        metric: entry.metric,
        metricLabel: entry.label,
        value,
        range: entry.range,
        status: value === null ? "undetected" : classify(value, entry.range),
        source: entry.source,
        confidence: measurement?.confidence ?? 0,
      });
    }
  }

  return { phases, items };
}
