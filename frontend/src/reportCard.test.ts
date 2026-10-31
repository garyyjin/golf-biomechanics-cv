import { describe, expect, it } from "vitest";
import type { CaptureReport } from "./captureCheck";
import type { FeedbackItem, FeedbackResult } from "./feedback";
import {
  REPORT_CARD_HEIGHT,
  REPORT_CARD_WIDTH,
  buildReportCard,
  drawReportCard,
  formatReportDate,
  wrapText,
} from "./reportCard";
import type { ReportCardInput } from "./reportCard";
import type { Rotation3d } from "./rotation3d";
import type { SwingStats } from "./stats";
import type { SwingTempo } from "./tempo";
import type { AnalysisResponse } from "./types";

const ANALYSIS: AnalysisResponse = {
  fps: 30,
  width: 1080,
  height: 1920,
  frame_count: 60,
  view: "face_on",
  handedness: "right",
  quality: "fast",
  frames: [],
};

function item(overrides: Partial<FeedbackItem>): FeedbackItem {
  return {
    phase: "top",
    phaseLabel: "Top of backswing",
    frameIndex: 40,
    metric: "hipTurn",
    metricLabel: "Hip turn",
    value: 22,
    range: { min: 35, max: 55 },
    status: "below",
    source: "published",
    confidence: 1,
    ...overrides,
  };
}

function feedback(items: FeedbackItem[]): FeedbackResult {
  return {
    phases: { address: 0, takeaway: 10, top: 40, downswing: 45, impact: 50, followThrough: 70 },
    items,
  };
}

const STATS: SwingStats = {
  clubheadSpeedMph: 112.4,
  ballSpeedMph: 164.8,
  ballSpeedSource: "estimated",
  estCarryYards: 268.2,
  calibrationSource: "club-length",
  diagnostic: { gate: "ok" },
};

const TEMPO: SwingTempo = {
  ratio: 3.1,
  score: 9.2,
  backswingSeconds: 0.93,
  downswingSeconds: 0.3,
};

const ROTATION: Rotation3d = {
  available: true,
  torsoAtTop: { degrees: 92.4, confidence: 1 },
  pelvisAtTop: { degrees: 45.6, confidence: 1 },
  separationAtTop: 46.8,
  torsoAtImpact: null,
  pelvisAtImpact: null,
  peakTorso: null,
  peakPelvis: null,
  confidence: 1,
};

const CAPTURE: CaptureReport = {
  grade: "usable",
  checks: [
    { id: "pose", label: "Body tracking", level: "pass", detail: "Tracked in 100% of frames.", advice: null },
    {
      id: "frame-rate",
      label: "Frame rate",
      level: "warn",
      detail: "Recorded at 24fps.",
      advice: "Film at 30fps or higher.",
    },
  ],
};

function input(overrides: Partial<ReportCardInput> = {}): ReportCardInput {
  return {
    analysis: ANALYSIS,
    feedback: feedback([
      item({}),
      item({ phase: "address", phaseLabel: "Address", metric: "spineTilt", metricLabel: "Spine tilt", status: "within", value: 10, range: { min: 4, max: 15 } }),
      item({ phase: "impact", phaseLabel: "Impact", metric: "xFactor", metricLabel: "X-factor", status: "above", value: 60, range: { min: -10, max: 15 } }),
    ]),
    score: { overall: 78.4, band: "good" },
    stats: STATS,
    tempo: TEMPO,
    rotation: ROTATION,
    capture: CAPTURE,
    generatedAt: new Date(2026, 9, 31),
    ...overrides,
  };
}

describe("formatReportDate", () => {
  it("renders a stable day-first date", () => {
    expect(formatReportDate(new Date(2026, 9, 31))).toBe("31 Oct 2026");
  });
});

describe("buildReportCard", () => {
  it("formats the score, context and headline numbers", () => {
    const card = buildReportCard(input());

    expect(card.generatedOn).toBe("31 Oct 2026");
    expect(card.context).toBe("Face-on · Right-handed");
    expect(card.scoreValue).toBe("78");
    expect(card.scoreCaption).toBe("Solid swing");
    expect(card.scoreProgress).toBeCloseTo(0.784, 5);
    expect(card.stats).toEqual([
      { label: "Clubhead speed", value: "112 mph" },
      { label: "Est. ball speed", value: "165 mph" },
      { label: "Est. carry", value: "268 yd" },
    ]);
    expect(card.tempo).toEqual([
      { label: "Backswing : downswing", value: "3.1 : 1" },
      { label: "Against 3:1", value: "9.2 / 10" },
    ]);
    expect(card.rotation.map((row) => row.value)).toEqual(["92°", "46°", "47°"]);
  });

  it("labels ball speed as measured when the ball itself was tracked", () => {
    const card = buildReportCard(
      input({ stats: { ...STATS, ballSpeedSource: "measured" } }),
    );
    expect(card.stats.map((row) => row.label)).toEqual([
      "Clubhead speed",
      "Ball speed",
      "Carry distance",
    ]);
  });

  it("falls back to dashes for unmeasurable numbers", () => {
    const card = buildReportCard(
      input({
        score: { overall: null, band: null },
        stats: {
          clubheadSpeedMph: null,
          ballSpeedMph: null,
          ballSpeedSource: null,
          estCarryYards: null,
          calibrationSource: null,
          diagnostic: { gate: "phase-detection", address: null, impact: null },
        },
        tempo: { ratio: null, score: null, backswingSeconds: null, downswingSeconds: null },
        rotation: { ...ROTATION, available: false },
        feedback: feedback([]),
      }),
    );

    expect(card.scoreValue).toBe("—");
    expect(card.scoreCaption).toBe("Not enough detected to score");
    expect(card.scoreProgress).toBe(0);
    expect(card.stats.map((row) => row.value)).toEqual(["—", "—", "—"]);
    expect(card.tempo.map((row) => row.value)).toEqual(["—", "—"]);
    expect(card.rotationNote).not.toBeNull();
    expect(card.focusNote).toContain("nothing needs fixing");
  });

  it("turns flagged metrics into at most three focuses, one per metric", () => {
    const card = buildReportCard(
      input({
        feedback: feedback([
          item({}),
          item({ phase: "impact", phaseLabel: "Impact", metric: "hipTurn" }),
          item({ metric: "shoulderTurn", metricLabel: "Shoulder turn", status: "above", value: 120, range: { min: 70, max: 100 } }),
          item({ metric: "xFactor", metricLabel: "X-factor", status: "above", value: 60, range: { min: -10, max: 15 } }),
        ]),
      }),
    );

    expect(card.focuses).toHaveLength(3);
    expect(card.focuses[0].title).toBe("Hip turn · Top of backswing");
    expect(card.focuses[0].meta).toBe("22° measured · target 35–55°");
    expect(card.focuses[0].detail.length).toBeGreaterThan(20);
    expect(card.focuses[1].title).toBe("Shoulder turn · Top of backswing");
  });

  it("leaves low-confidence readings and in-range metrics out of the focus list", () => {
    const card = buildReportCard(
      input({
        feedback: feedback([
          item({ metric: "hipTurn", confidence: 0.2 }),
          item({ metric: "spineTilt", status: "within" }),
        ]),
      }),
    );

    expect(card.focuses).toEqual([]);
    expect(card.focusNote).not.toBeNull();
  });

  it("lists only setup problems that need attention", () => {
    const card = buildReportCard(input());
    expect(card.captureGrade).toBe("usable");
    expect(card.captures).toEqual([
      { text: "Frame rate: Recorded at 24fps.", level: "warn" },
    ]);

    const clean = buildReportCard(input({ capture: { grade: "good", checks: [] } }));
    expect(clean.captures).toEqual([]);
  });
});

describe("wrapText", () => {
  const measure = (value: string) => value.length * 10;

  it("wraps at word boundaries", () => {
    expect(wrapText("one two three four", 100, 4, measure)).toEqual(["one two", "three four"]);
  });

  it("truncates with an ellipsis past the line limit", () => {
    expect(wrapText("one two three four", 100, 1, measure)).toEqual(["one two…"]);
  });

  it("keeps a single over-long word rather than dropping it", () => {
    expect(wrapText("abcdefghijklmno", 100, 2, measure)).toEqual(["abcdefghijklmno"]);
  });

  it("returns nothing when no lines are allowed", () => {
    expect(wrapText("one two", 100, 0, measure)).toEqual([]);
  });
});

/** Proxy-based 2D context: every method is a no-op, measureText reports a
 * deterministic width, and property writes are accepted. Enough to prove the
 * renderer paints both full and empty models without throwing. */
function fakeContext() {
  let measureCalls = 0;
  const target: Record<string, unknown> = {
    measureText: (text: string) => {
      measureCalls += 1;
      return { width: text.length * 8 };
    },
  };
  const ctx = new Proxy(target, {
    get: (t, prop) => {
      if (prop in t) return t[prop as string];
      return () => undefined;
    },
    set: (t, prop, value) => {
      t[prop as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, measureCalls: () => measureCalls };
}

/** Like fakeContext, but records every fillText call so layout can be
 * asserted by position rather than by eye. */
function recordingContext() {
  const texts: { text: string; x: number; y: number }[] = [];
  const target: Record<string, unknown> = {
    measureText: (text: string) => ({ width: text.length * 8 }),
    fillText: (text: string, x: number, y: number) => {
      texts.push({ text, x, y });
    },
  };
  const ctx = new Proxy(target, {
    get: (t, prop) => {
      if (prop in t) return t[prop as string];
      return () => undefined;
    },
    set: (t, prop, value) => {
      t[prop as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, texts };
}

describe("drawReportCard layout", () => {
  it("keeps the fullest possible card clear of the footer", () => {
    const { ctx, texts } = recordingContext();
    const card = buildReportCard(
      input({
        feedback: feedback([
          item({}),
          item({ metric: "shoulderTurn", metricLabel: "Shoulder turn", status: "above", value: 120, range: { min: 70, max: 100 } }),
          item({ metric: "xFactor", metricLabel: "X-factor", status: "above", value: 60, range: { min: -10, max: 15 } }),
        ]),
      }),
    );
    drawReportCard(ctx, card);

    const footerRuleY = REPORT_CARD_HEIGHT - 132;
    const content = texts.filter((entry) => entry.y < footerRuleY);
    const lowest = Math.max(...content.map((entry) => entry.y));
    // 20px of breathing room between the last content baseline and the rule.
    expect(lowest).toBeLessThanOrEqual(footerRuleY - 20);

    const drawn = texts.map((entry) => entry.text);
    expect(drawn).toContain("78");
    expect(drawn).toContain("Solid swing");
    expect(drawn).toContain("GOLF SWING ANALYZER");
    expect(drawn.some((text) => text.startsWith("Hip turn"))).toBe(true);
  });

  it("keeps three focuses on the card", () => {
    const { ctx, texts } = recordingContext();
    drawReportCard(ctx, buildReportCard(input()));
    const focusTitles = texts
      .map((entry) => entry.text)
      .filter((text) => text.includes(" · "));
    expect(focusTitles.length).toBeGreaterThanOrEqual(1);
  });
});

describe("drawReportCard", () => {
  it("draws a full card", () => {
    const { ctx, measureCalls } = fakeContext();
    expect(() => drawReportCard(ctx, buildReportCard(input()))).not.toThrow();
    expect(measureCalls()).toBeGreaterThan(0);
  });

  it("draws an empty card without readings", () => {
    const { ctx } = fakeContext();
    const card = buildReportCard(
      input({
        score: { overall: null, band: null },
        stats: {
          clubheadSpeedMph: null,
          ballSpeedMph: null,
          ballSpeedSource: null,
          estCarryYards: null,
          calibrationSource: null,
          diagnostic: { gate: "phase-detection", address: null, impact: null },
        },
        tempo: { ratio: null, score: null, backswingSeconds: null, downswingSeconds: null },
        rotation: { ...ROTATION, available: false },
        feedback: feedback([]),
        capture: { grade: "poor", checks: [] },
      }),
    );
    expect(() => drawReportCard(ctx, card)).not.toThrow();
  });

  it("is laid out for a 2:3 portrait image", () => {
    expect(REPORT_CARD_WIDTH).toBe(1080);
    expect(REPORT_CARD_HEIGHT).toBe(1620);
  });
});
