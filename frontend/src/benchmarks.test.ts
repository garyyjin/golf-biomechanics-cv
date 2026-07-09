import { afterEach, describe, expect, it, vi } from "vitest";
import { loadBenchmarks } from "./benchmarks";
import { DEFAULT_BENCHMARKS } from "./benchmarks.default";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadBenchmarks", () => {
  it("merges server empirical data with defaults, filling in label and source", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          generatedAt: "2026-07-08T00:00:00Z",
          table: {
            face_on: {
              top: [{ metric: "shoulderTurn", range: { min: 82, max: 96 }, sampleSize: 5 }],
            },
            down_the_line: {},
          },
        }),
      }),
    );

    const result = await loadBenchmarks();
    const entry = result.face_on.top?.find((e) => e.metric === "shoulderTurn");
    expect(entry).toMatchObject({
      source: "empirical",
      range: { min: 82, max: 96 },
      sampleSize: 5,
    });
    expect(entry?.label).toBe(
      DEFAULT_BENCHMARKS.face_on.top?.find((e) => e.metric === "shoulderTurn")?.label,
    );
    // Untouched phase falls through to the pure default.
    expect(result.face_on.address).toEqual(DEFAULT_BENCHMARKS.face_on.address);
  });

  it("falls back to defaults when the backend is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    expect(await loadBenchmarks()).toEqual(DEFAULT_BENCHMARKS);
  });
});
