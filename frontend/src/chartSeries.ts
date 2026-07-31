/** Which measure the progress chart plots.
 *
 * Separate from ProgressChart.tsx so that file exports only its component
 * (fast refresh breaks otherwise), and separate from chartGeometry.ts, which
 * is scale arithmetic with no notion of what's being measured.
 *
 * Keys match SwingSummary's fields, so a history entry's value for the
 * selected series is a plain lookup.
 */
export type SeriesKey = "score" | "clubheadSpeedMph" | "tempoRatio";

export interface SeriesOption {
  value: SeriesKey;
  label: string;
  unit: string;
  /** Fixed axis for a bounded measure. The swing score is 0–100, and pinning
   * it there stops a two-point wobble from looking like a transformation the
   * way an auto-fitted axis would. Open-ended measures omit it and fit to the
   * data instead. */
  domain?: { min: number; max: number };
  decimals: number;
}

export const SERIES_OPTIONS: SeriesOption[] = [
  { value: "score", label: "Swing score", unit: "", domain: { min: 0, max: 100 }, decimals: 0 },
  { value: "clubheadSpeedMph", label: "Clubhead speed", unit: " mph", decimals: 0 },
  { value: "tempoRatio", label: "Tempo ratio", unit: " : 1", decimals: 1 },
];
