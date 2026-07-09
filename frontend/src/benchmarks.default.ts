import type { BenchmarkTable } from "./benchmarks.ts";

/**
 * Illustrative default benchmark ranges, synthesized from general,
 * publicly-known golf-instruction reference points (e.g. "~90 degree
 * shoulder turn at the top," "~40-45 degree hip turn at impact"). These are
 * NOT sourced from a specific verified study — treat them as a reasonable
 * zero-setup starting point only. Running `npm run calibrate` over a set of
 * reference "good swing" videos produces an empirical override
 * (benchmarks.generated.json) that takes precedence per-metric and is the
 * more trustworthy path once available, since it's measured by this app's
 * own 2D camera-based geometry rather than 3D motion-capture literature.
 */
export const DEFAULT_BENCHMARKS: BenchmarkTable = {
  face_on: {
    address: [
      { metric: "spineTilt", label: "Spine tilt", range: { min: 4, max: 15 }, source: "published" },
      { metric: "shoulderTurn", label: "Shoulder tilt", range: { min: 2, max: 12 }, source: "published" },
      { metric: "hipTurn", label: "Hip tilt", range: { min: 0, max: 8 }, source: "published" },
    ],
    takeaway: [
      { metric: "shoulderTurn", label: "Shoulder turn", range: { min: 15, max: 45 }, source: "published" },
      { metric: "hipTurn", label: "Hip turn", range: { min: 0, max: 20 }, source: "published" },
    ],
    top: [
      { metric: "shoulderTurn", label: "Shoulder turn", range: { min: 70, max: 100 }, source: "published" },
      { metric: "hipTurn", label: "Hip turn", range: { min: 35, max: 55 }, source: "published" },
      { metric: "xFactor", label: "X-factor", range: { min: 30, max: 55 }, source: "published" },
    ],
    downswing: [
      { metric: "hipTurn", label: "Hip turn", range: { min: 20, max: 45 }, source: "published" },
      { metric: "xFactor", label: "X-factor", range: { min: 15, max: 50 }, source: "published" },
    ],
    impact: [
      { metric: "spineTilt", label: "Spine tilt", range: { min: 8, max: 20 }, source: "published" },
      { metric: "shoulderTurn", label: "Shoulder turn", range: { min: -10, max: 10 }, source: "published" },
      { metric: "hipTurn", label: "Hip turn", range: { min: 30, max: 50 }, source: "published" },
      { metric: "xFactor", label: "X-factor", range: { min: -10, max: 15 }, source: "published" },
    ],
    followThrough: [
      { metric: "shoulderTurn", label: "Shoulder turn", range: { min: 60, max: 110 }, source: "published" },
      { metric: "hipTurn", label: "Hip turn", range: { min: 50, max: 90 }, source: "published" },
    ],
  },
  down_the_line: {
    address: [
      { metric: "spineTilt", label: "Forward bend", range: { min: 25, max: 40 }, source: "published" },
      { metric: "hipTurn", label: "Hip turn", range: { min: 0, max: 10 }, source: "published" },
      { metric: "planeAngle", label: "Plane angle", range: { min: 50, max: 65 }, source: "published" },
    ],
    takeaway: [
      { metric: "spineRetention", label: "Spine angle change", range: { min: 0, max: 8 }, source: "published" },
      { metric: "planeAngle", label: "Plane angle", range: { min: 45, max: 70 }, source: "published" },
    ],
    top: [
      { metric: "hipTurn", label: "Hip turn", range: { min: 20, max: 40 }, source: "published" },
      { metric: "spineRetention", label: "Spine angle change", range: { min: 0, max: 12 }, source: "published" },
    ],
    downswing: [
      { metric: "spineRetention", label: "Spine angle change", range: { min: 0, max: 12 }, source: "published" },
      { metric: "planeAngle", label: "Plane angle", range: { min: 50, max: 70 }, source: "published" },
    ],
    impact: [
      { metric: "spineTilt", label: "Forward bend", range: { min: 25, max: 42 }, source: "published" },
      { metric: "hipTurn", label: "Hip turn", range: { min: 30, max: 55 }, source: "published" },
      { metric: "spineRetention", label: "Spine angle change", range: { min: 0, max: 12 }, source: "published" },
    ],
    followThrough: [
      { metric: "hipTurn", label: "Hip turn", range: { min: 40, max: 75 }, source: "published" },
    ],
  },
};
