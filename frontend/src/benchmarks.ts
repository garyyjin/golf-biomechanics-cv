import { DEFAULT_BENCHMARKS } from "./benchmarks.default.ts";
import { fetchBenchmarks } from "./libraryApi.ts";
import type { RawBenchmarkResponse } from "./libraryApi.ts";
import type { View } from "./types.ts";

export type Phase = "address" | "takeaway" | "top" | "downswing" | "impact" | "followThrough";

export type MetricId = "spineTilt" | "shoulderTurn" | "hipTurn" | "xFactor" | "planeAngle" | "spineRetention";

export interface MetricRange {
  min: number;
  max: number;
}

export interface BenchmarkEntry {
  metric: MetricId;
  label: string;
  range: MetricRange;
  source: "published" | "empirical";
  sampleSize?: number; // set only when source === "empirical"
}

export type BenchmarkTable = Record<View, Partial<Record<Phase, BenchmarkEntry[]>>>;

function mergeBenchmarks(base: BenchmarkTable, override: BenchmarkTable): BenchmarkTable {
  const result: BenchmarkTable = { face_on: {}, down_the_line: {} };
  for (const view of Object.keys(result) as View[]) {
    const phases = new Set<Phase>([
      ...(Object.keys(base[view]) as Phase[]),
      ...(Object.keys(override[view] ?? {}) as Phase[]),
    ]);
    for (const phase of phases) {
      const baseEntries = base[view][phase] ?? [];
      const overrideEntries = override[view]?.[phase] ?? [];
      const overrideMetrics = new Set(overrideEntries.map((e) => e.metric));
      result[view][phase] = [...baseEntries.filter((e) => !overrideMetrics.has(e.metric)), ...overrideEntries];
    }
  }
  return result;
}

/**
 * The server only knows bare metric ids, ranges, and sample sizes — labels
 * are frontend-only knowledge, filled in here by matching against the
 * published defaults (same fallback `?? metric` the old calibration script
 * used when generating its static file).
 */
function hydrateEmpiricalTable(raw: RawBenchmarkResponse["table"], base: BenchmarkTable): BenchmarkTable {
  const result: BenchmarkTable = { face_on: {}, down_the_line: {} };
  for (const view of Object.keys(result) as View[]) {
    const phases = raw[view] ?? {};
    for (const phase of Object.keys(phases) as Phase[]) {
      const rawEntries = phases[phase] ?? [];
      const baseEntries = base[view][phase] ?? [];
      result[view][phase] = rawEntries.map((e) => ({
        metric: e.metric,
        label: baseEntries.find((b) => b.metric === e.metric)?.label ?? e.metric,
        range: e.range,
        source: "empirical" as const,
        sampleSize: e.sampleSize,
      }));
    }
  }
  return result;
}

/**
 * Fetches the server's current aggregate benchmarks and merges them over the
 * published defaults. Falls back to defaults alone if the backend isn't
 * reachable — same graceful-degradation shape used elsewhere in this app.
 */
export async function loadBenchmarks(): Promise<BenchmarkTable> {
  try {
    const raw = await fetchBenchmarks();
    return mergeBenchmarks(DEFAULT_BENCHMARKS, hydrateEmpiricalTable(raw.table, DEFAULT_BENCHMARKS));
  } catch {
    return DEFAULT_BENCHMARKS;
  }
}
