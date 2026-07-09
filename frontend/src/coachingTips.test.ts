import { describe, expect, it } from "vitest";
import { DEFAULT_BENCHMARKS } from "./benchmarks.default";
import type { Phase } from "./benchmarks";
import { getCoachingTip } from "./coachingTips";
import type { View } from "./types";

describe("getCoachingTip", () => {
  it("has copy for every benchmarked metric in both directions", () => {
    for (const view of Object.keys(DEFAULT_BENCHMARKS) as View[]) {
      const phases = DEFAULT_BENCHMARKS[view];
      for (const phase of Object.keys(phases) as Phase[]) {
        for (const entry of phases[phase] ?? []) {
          expect(getCoachingTip(view, phase, entry.metric, "above")).not.toBeNull();
          // spineRetention is an absolute-value metric (can't go negative),
          // so its range.min is always 0 and "below" can never actually
          // occur — no copy is authored for that unreachable case.
          if (entry.metric !== "spineRetention") {
            expect(getCoachingTip(view, phase, entry.metric, "below")).not.toBeNull();
          }
        }
      }
    }
  });

  it("returns null for an unauthored combination", () => {
    expect(getCoachingTip("face_on", "takeaway", "spineTilt", "below")).toBeNull();
  });
});
