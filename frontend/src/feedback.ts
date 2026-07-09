import type { BenchmarkTable, MetricId, MetricRange, Phase } from "./benchmarks.ts";
import { hipLine, shoulderLine, spineLine, swingPlaneLine } from "./geometry.ts";
import { detectPhases } from "./phases.ts";
import type { SwingPhases } from "./phases.ts";
import type { AnalysisResponse, Handedness, PoseFrame, View } from "./types.ts";

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
}

export interface FeedbackResult {
  phases: SwingPhases;
  items: FeedbackItem[];
}

export const SCORED_PHASES: Phase[] = ["address", "takeaway", "top", "downswing", "impact", "followThrough"];

export const PHASE_ORDER: Phase[] = ["address", "takeaway", "top", "downswing", "impact", "followThrough"];

export const PHASE_LABELS: Record<Phase, string> = {
  address: "Address",
  takeaway: "Takeaway",
  top: "Top of backswing",
  downswing: "Downswing",
  impact: "Impact",
  followThrough: "Follow-through",
};

/**
 * Computes a single metric's value at one frame. Exported so calibration.ts
 * can call the exact same function used here — the empirical benchmarks it
 * produces are guaranteed to be measured the same way a user's swing is
 * later scored.
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

function classify(value: number, range: MetricRange): FeedbackStatus {
  if (value < range.min) return "below";
  if (value > range.max) return "above";
  return "within";
}

export function computeFeedback(analysis: AnalysisResponse, benchmarks: BenchmarkTable): FeedbackResult {
  const phases = detectPhases(analysis.frames, analysis.handedness, analysis.fps);
  const aspect = analysis.width / analysis.height;
  const addressFrame = phases.address !== null ? analysis.frames[phases.address] : null;

  const items: FeedbackItem[] = [];
  for (const phase of SCORED_PHASES) {
    const entries = benchmarks[analysis.view][phase] ?? [];
    const frameIndex = phases[phase];
    for (const entry of entries) {
      if (frameIndex === null) {
        items.push({
          phase,
          phaseLabel: PHASE_LABELS[phase],
          frameIndex: null,
          metric: entry.metric,
          metricLabel: entry.label,
          value: null,
          range: entry.range,
          status: "undetected",
          source: entry.source,
        });
        continue;
      }
      const frame = analysis.frames[frameIndex];
      const value = computeMetricValue(entry.metric, frame, analysis.view, analysis.handedness, aspect, addressFrame);
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
      });
    }
  }

  return { phases, items };
}
