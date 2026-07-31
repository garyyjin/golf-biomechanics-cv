import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BENCHMARKS_VERSION, loadBenchmarks } from "./benchmarks";
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

    const result = (await loadBenchmarks()).table;
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
    const result = await loadBenchmarks();
    expect(result.table).toEqual(DEFAULT_BENCHMARKS);
    expect(result.version).toBe(DEFAULT_BENCHMARKS_VERSION);
  });

  it("carries the server's generatedAt as the version stamp", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          generatedAt: "2026-07-31T12:00:00+00:00",
          table: { face_on: {}, down_the_line: {} },
        }),
      }),
    );
    expect((await loadBenchmarks()).version).toBe("2026-07-31T12:00:00+00:00");
  });

  it("uses the defaults stamp when the server has no empirical benchmarks yet", async () => {
    // generatedAt is null until the library has enough samples for any range,
    // and the merge yields the published defaults — so that's the honest stamp.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ generatedAt: null, table: { face_on: {}, down_the_line: {} } }),
      }),
    );
    expect((await loadBenchmarks()).version).toBe(DEFAULT_BENCHMARKS_VERSION);
  });
});
