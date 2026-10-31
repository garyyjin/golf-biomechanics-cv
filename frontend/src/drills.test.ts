import { describe, expect, it } from "vitest";
import { DEFAULT_BENCHMARKS } from "./benchmarks.default";
import type { MetricId } from "./benchmarks";
import { buildPracticePlan, getDrill } from "./drills";
import type { FeedbackItem, FeedbackResult } from "./feedback";

const PHASES = { address: 0, takeaway: 10, top: 40, downswing: 45, impact: 50, followThrough: 70 };

function item(overrides: Partial<FeedbackItem>): FeedbackItem {
  return {
    phase: "top",
    phaseLabel: "Top of backswing",
    frameIndex: 40,
    metric: "hipTurn",
    metricLabel: "Hip turn",
    value: 20,
    range: { min: 35, max: 55 },
    status: "below",
    source: "published",
    confidence: 1,
    ...overrides,
  };
}

function result(items: FeedbackItem[]): FeedbackResult {
  return { phases: PHASES, items };
}

describe("getDrill", () => {
  it("covers every benchmarked metric in both directions", () => {
    const metrics = new Set<MetricId>();
    for (const view of Object.values(DEFAULT_BENCHMARKS)) {
      for (const entries of Object.values(view)) {
        for (const entry of entries ?? []) metrics.add(entry.metric);
      }
    }

    expect(metrics.size).toBeGreaterThan(0);
    for (const metric of metrics) {
      expect(getDrill(metric, "below"), `${metric} below`).not.toBeNull();
      expect(getDrill(metric, "above"), `${metric} above`).not.toBeNull();
    }
  });

  it("gives every drill a cue and at least two steps", () => {
    const metrics: MetricId[] = [
      "spineTilt",
      "shoulderTurn",
      "hipTurn",
      "xFactor",
      "planeAngle",
      "spineRetention",
    ];
    for (const metric of metrics) {
      for (const direction of ["below", "above"] as const) {
        const drill = getDrill(metric, direction)!;
        expect(drill.cue.length).toBeGreaterThan(0);
        expect(drill.steps.length).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe("buildPracticePlan", () => {
  it("picks flagged metrics in the swing's own order", () => {
    const plan = buildPracticePlan(
      result([
        item({ phase: "impact", metric: "spineTilt", metricLabel: "Spine tilt", value: 25, range: { min: 8, max: 20 }, status: "above" }),
        item({ phase: "top", metric: "hipTurn" }),
      ]),
    );

    expect(plan.map((f) => f.item.metric)).toEqual(["spineTilt", "hipTurn"]);
    expect(plan[1].drill.name).toBe("Step-through drill");
  });

  it("leaves out readings that are within range or barely visible", () => {
    const plan = buildPracticePlan(
      result([
        item({ metric: "hipTurn", status: "within" }),
        item({ metric: "shoulderTurn", status: "below", confidence: 0.2 }),
        item({ metric: "xFactor", status: "above" }),
      ]),
    );

    expect(plan.map((f) => f.item.metric)).toEqual(["xFactor"]);
  });

  it("keeps one focus per metric and stops at the limit", () => {
    const plan = buildPracticePlan(
      result([
        item({ metric: "hipTurn" }),
        item({ phase: "impact", metric: "hipTurn" }),
        item({ metric: "shoulderTurn" }),
        item({ metric: "xFactor" }),
        item({ metric: "spineTilt" }),
      ]),
    );

    expect(plan).toHaveLength(3);
    expect(plan.map((f) => f.item.metric)).toEqual(["hipTurn", "shoulderTurn", "xFactor"]);
  });

  it("returns nothing when every reading is in range", () => {
    expect(buildPracticePlan(result([item({ status: "within" })]))).toEqual([]);
  });
});
