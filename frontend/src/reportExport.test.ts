import { describe, expect, it } from "vitest";
import { REPORT_EXPORT_SCALE, reportFilename } from "./reportExport";

describe("reportFilename", () => {
  it("uses a sortable, zero-padded local date", () => {
    expect(reportFilename(new Date(2026, 9, 31))).toBe("swing-report-2026-10-31.png");
    expect(reportFilename(new Date(2026, 0, 5))).toBe("swing-report-2026-01-05.png");
  });
});

describe("REPORT_EXPORT_SCALE", () => {
  it("renders at 2x for crisp text on phones", () => {
    expect(REPORT_EXPORT_SCALE).toBe(2);
  });
});
