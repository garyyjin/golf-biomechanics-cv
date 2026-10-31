import type { CaptureCheck, CaptureGrade, CaptureReport } from "./captureCheck.ts";
import { getCoachingTip } from "./coachingTips.ts";
import type { FeedbackResult } from "./feedback.ts";
import { MIN_SCORE_CONFIDENCE } from "./measurement.ts";
import type { Rotation3d } from "./rotation3d.ts";
import type { SwingStats } from "./stats.ts";
import { SCORE_BAND_LABEL } from "./swingScore.ts";
import type { ScoreBand, SwingScore } from "./swingScore.ts";
import { TOUR_TEMPO_RATIO, formatTempoRatio } from "./tempo.ts";
import type { SwingTempo } from "./tempo.ts";
import type { AnalysisResponse } from "./types.ts";

/**
 * The shareable summary of one swing.
 *
 * The player is built for study — panels to open, a video to scrub. A report
 * has to survive being looked at once, out of context, on a phone: score,
 * the numbers that matter, and the couple of things to work on. Everything is
 * derived from the same functions the player uses, so a card can never
 * disagree with the screen it was exported from.
 */

export interface ReportCardRow {
  label: string;
  value: string;
}

export interface ReportCardFocus {
  title: string;
  meta: string;
  detail: string;
}

export interface ReportCardIssue {
  text: string;
  level: CaptureCheck["level"];
}

export interface ReportCardModel {
  /** e.g. "31 Oct 2026" */
  generatedOn: string;
  /** e.g. "Face-on · Right-handed" */
  context: string;
  scoreValue: string;
  scoreCaption: string;
  scoreBand: ScoreBand | null;
  /** 0–1 fill for the score gauge. */
  scoreProgress: number;
  stats: ReportCardRow[];
  tempo: ReportCardRow[];
  rotation: ReportCardRow[];
  rotationNote: string | null;
  focuses: ReportCardFocus[];
  focusNote: string | null;
  captures: ReportCardIssue[];
  captureGrade: CaptureGrade;
}

export interface ReportCardInput {
  analysis: AnalysisResponse;
  feedback: FeedbackResult;
  score: SwingScore;
  stats: SwingStats;
  tempo: SwingTempo;
  rotation: Rotation3d;
  capture: CaptureReport;
  generatedAt: Date;
}

const VIEW_LABEL: Record<AnalysisResponse["view"], string> = {
  face_on: "Face-on",
  down_the_line: "Down-the-line",
};

const HANDEDNESS_LABEL: Record<AnalysisResponse["handedness"], string> = {
  right: "Right-handed",
  left: "Left-handed",
};

const DASH = "—";

/** en-GB gives the day-first form golfers read ("31 Oct 2026"), and pinning
 * it keeps the exported card identical regardless of the viewer's locale. */
export function formatReportDate(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function mph(value: number | null): string {
  return value === null ? DASH : `${Math.round(value)} mph`;
}

function yards(value: number | null): string {
  return value === null ? DASH : `${Math.round(value)} yd`;
}

function degrees(value: number | null): string {
  return value === null ? DASH : `${Math.round(value)}°`;
}

function scoreCaption(score: SwingScore): string {
  if (score.band === null) return "Not enough detected to score";
  return SCORE_BAND_LABEL[score.band];
}

/**
 * At most three faults, in the swing's own order and one per metric — the
 * same selection rule the player's practice plan uses. Low-confidence
 * readings are excluded for the same reason: a share card shouldn't assert
 * something the footage barely supports.
 */
function buildFocuses(result: FeedbackResult, view: AnalysisResponse["view"]): ReportCardFocus[] {
  const focuses: ReportCardFocus[] = [];
  const seen = new Set<string>();

  for (const item of result.items) {
    if (item.status !== "below" && item.status !== "above") continue;
    if (item.confidence < MIN_SCORE_CONFIDENCE) continue;
    if (item.range === null || item.value === null) continue;
    if (seen.has(item.metric)) continue;
    seen.add(item.metric);

    const tip =
      getCoachingTip(view, item.phase, item.metric, item.status) ??
      `${item.metricLabel} is ${item.status} its target range here.`;

    focuses.push({
      title: `${item.metricLabel} · ${item.phaseLabel}`,
      meta: `${degrees(item.value)} measured · target ${Math.round(item.range.min)}–${Math.round(item.range.max)}°`,
      detail: tip,
    });
    if (focuses.length === 3) break;
  }

  return focuses;
}

export function buildReportCard(input: ReportCardInput): ReportCardModel {
  const { analysis, feedback, score, stats, tempo, rotation, capture } = input;

  const measuredBallSpeed = stats.ballSpeedSource === "measured";
  const rotationRows: ReportCardRow[] = [
    { label: "Chest at the top", value: degrees(rotation.torsoAtTop?.degrees ?? null) },
    { label: "Pelvis at the top", value: degrees(rotation.pelvisAtTop?.degrees ?? null) },
    { label: "Chest − pelvis", value: degrees(rotation.separationAtTop) },
  ];

  const focuses = buildFocuses(feedback, analysis.view);
  const issues: ReportCardIssue[] = capture.checks
    .filter((check) => check.level !== "pass")
    .map((check) => ({ text: `${check.label}: ${check.detail}`, level: check.level }));

  return {
    generatedOn: formatReportDate(input.generatedAt),
    context: `${VIEW_LABEL[analysis.view]} · ${HANDEDNESS_LABEL[analysis.handedness]}`,
    scoreValue: score.overall === null ? DASH : `${Math.round(score.overall)}`,
    scoreCaption: scoreCaption(score),
    scoreBand: score.band,
    scoreProgress: score.overall === null ? 0 : Math.max(0, Math.min(100, score.overall)) / 100,
    stats: [
      { label: "Clubhead speed", value: mph(stats.clubheadSpeedMph) },
      {
        label: measuredBallSpeed ? "Ball speed" : "Est. ball speed",
        value: mph(stats.ballSpeedMph),
      },
      {
        label: measuredBallSpeed ? "Carry distance" : "Est. carry",
        value: yards(stats.estCarryYards),
      },
    ],
    tempo: [
      {
        label: "Backswing : downswing",
        value: tempo.ratio === null ? DASH : formatTempoRatio(tempo.ratio),
      },
      {
        label: `Against ${TOUR_TEMPO_RATIO}:1`,
        value: tempo.score === null ? DASH : `${tempo.score.toFixed(1)} / 10`,
      },
    ],
    rotation: rotationRows,
    rotationNote: rotation.available ? null : "No 3D pose data for this clip.",
    focuses,
    focusNote:
      focuses.length === 0
        ? "Every measured position landed inside its target range — nothing needs fixing right now."
        : null,
    captures: issues,
    captureGrade: capture.grade,
  };
}

// --- Canvas rendering -------------------------------------------------------

const SANS = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

const COLORS = {
  canvas: "#0a0d0a",
  surface: "#12160f",
  surfaceAlt: "#171c15",
  hairline: "#262d22",
  ink: "#f3f6f0",
  inkMuted: "#c3cabd",
  inkSubtle: "#8b9484",
  inkTertiary: "#5b6355",
  primary: "#59e37c",
  warning: "#f5a623",
  error: "#ff6b57",
};

/** Logical card size. Rendered at 2x by reportExport.ts, which is why every
 * coordinate below is a plain CSS pixel, not a device pixel. */
export const REPORT_CARD_WIDTH = 1080;
export const REPORT_CARD_HEIGHT = 1620;

const PAD = 64;
const INNER = REPORT_CARD_WIDTH - PAD * 2;
const CARD_RADIUS = 18;

function sansFont(weight: number, size: number): string {
  return `${weight} ${size}px ${SANS}`;
}

function monoFont(weight: number, size: number): string {
  return `${weight} ${size}px ${MONO}`;
}

function bandColor(band: ScoreBand | null): string {
  if (band === "good") return COLORS.primary;
  if (band === "fair") return COLORS.warning;
  if (band === "poor") return COLORS.error;
  return COLORS.inkSubtle;
}

function issueColor(level: CaptureCheck["level"]): string {
  if (level === "fail") return COLORS.error;
  if (level === "warn") return COLORS.warning;
  return COLORS.primary;
}

/**
 * Greedy word wrap against a caller-supplied measure function (in practice
 * ctx.measureText) so the layout math can be tested without a canvas.
 * Truncates with an ellipsis once maxLines is reached.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  maxLines: number,
  measure: (value: string) => number,
): string[] {
  if (maxLines <= 0) return [];
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (measure(candidate) <= maxWidth) {
      current = candidate;
    } else {
      if (current !== "") lines.push(current);
      current = word;
    }
  }
  if (current !== "") lines.push(current);

  if (lines.length <= maxLines) return lines;

  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last.length > 1 && measure(`${last}…`) > maxWidth) {
    last = last.slice(0, -1);
  }
  kept[maxLines - 1] = `${last}…`;
  return kept;
}

function fillSurface(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, CARD_RADIUS);
  ctx.fill();
  ctx.strokeStyle = COLORS.hairline;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawEyebrow(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  align: CanvasTextAlign = "left",
): void {
  ctx.font = sansFont(600, 16);
  ctx.fillStyle = COLORS.inkSubtle;
  ctx.textAlign = align;
  ctx.fillText(text.toUpperCase(), x, y);
}

/** Section heading: a short rule plus a label, which reads as a divider on a
 * dense card without adding another filled block. */
function drawSectionHeading(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
): void {
  drawEyebrow(ctx, text, x, y);
  ctx.strokeStyle = COLORS.hairline;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 190, y - 5);
  ctx.lineTo(x + width, y - 5);
  ctx.stroke();
}

function drawRow(
  ctx: CanvasRenderingContext2D,
  row: ReportCardRow,
  x: number,
  y: number,
  width: number,
): void {
  ctx.font = sansFont(400, 17);
  ctx.fillStyle = COLORS.inkSubtle;
  ctx.textAlign = "left";
  ctx.fillText(row.label, x, y);

  ctx.font = monoFont(500, 22);
  ctx.fillStyle = COLORS.ink;
  ctx.textAlign = "right";
  ctx.fillText(row.value, x + width, y);
}

/**
 * Paints the whole card. Pure drawing: no DOM, no image loading, no state —
 * reportExport.ts owns the canvas and the file. Layout is fixed-height with
 * the footer pinned, so a swing with fewer flagged faults leaves breathing
 * room rather than stretching.
 */
export function drawReportCard(
  ctx: CanvasRenderingContext2D,
  model: ReportCardModel,
): void {
  const W = REPORT_CARD_WIDTH;
  const H = REPORT_CARD_HEIGHT;

  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = COLORS.canvas;
  ctx.fillRect(0, 0, W, H);

  let y = PAD;

  // Header: brand, then the report date.
  ctx.fillStyle = COLORS.primary;
  ctx.beginPath();
  ctx.roundRect(PAD, y, 40, 40, 10);
  ctx.fill();

  ctx.font = sansFont(700, 26);
  ctx.fillStyle = COLORS.ink;
  ctx.textAlign = "left";
  ctx.fillText("Golf Swing Analyzer", PAD + 56, y + 29);

  ctx.font = monoFont(400, 17);
  ctx.fillStyle = COLORS.inkSubtle;
  ctx.textAlign = "right";
  ctx.fillText(model.generatedOn, W - PAD, y + 27);

  y += 40 + 44;

  // Hero: the score, its reading, and a gauge.
  drawEyebrow(ctx, "Swing score", PAD, y + 16);

  ctx.font = sansFont(700, 168);
  ctx.fillStyle = bandColor(model.scoreBand);
  ctx.textAlign = "left";
  ctx.fillText(model.scoreValue, PAD, y + 188);

  ctx.font = sansFont(500, 26);
  ctx.fillStyle = COLORS.inkMuted;
  ctx.fillText(model.scoreCaption, PAD, y + 230);

  ctx.font = monoFont(400, 18);
  ctx.fillStyle = COLORS.inkSubtle;
  ctx.textAlign = "right";
  ctx.fillText(model.context, W - PAD, y + 230);

  const gaugeY = y + 258;
  ctx.fillStyle = COLORS.hairline;
  ctx.beginPath();
  ctx.roundRect(PAD, gaugeY, INNER, 8, 4);
  ctx.fill();
  if (model.scoreProgress > 0) {
    ctx.fillStyle = bandColor(model.scoreBand);
    ctx.beginPath();
    ctx.roundRect(PAD, gaugeY, Math.max(8, INNER * model.scoreProgress), 8, 4);
    ctx.fill();
  }

  y += 300;

  // Stat tiles.
  const tileGap = 20;
  const tileWidth = (INNER - tileGap * 2) / 3;
  const tileHeight = 132;
  model.stats.forEach((row, index) => {
    const x = PAD + index * (tileWidth + tileGap);
    fillSurface(ctx, x, y, tileWidth, tileHeight, COLORS.surface);
    ctx.font = sansFont(500, 16);
    ctx.fillStyle = COLORS.inkSubtle;
    ctx.textAlign = "left";
    ctx.fillText(row.label, x + 24, y + 38);
    ctx.font = monoFont(600, 40);
    ctx.fillStyle = COLORS.ink;
    ctx.fillText(row.value, x + 24, y + 98);
  });

  y += tileHeight + 28;

  // Tempo and 3D rotation, side by side.
  const halfGap = 20;
  const halfWidth = (INNER - halfGap) / 2;
  const toneHeight = 196;

  fillSurface(ctx, PAD, y, halfWidth, toneHeight, COLORS.surface);
  drawEyebrow(ctx, "Tempo", PAD + 24, y + 38);
  model.tempo.forEach((row, index) => {
    drawRow(ctx, row, PAD + 24, y + 82 + index * 38, halfWidth - 48);
  });

  const rightX = PAD + halfWidth + halfGap;
  fillSurface(ctx, rightX, y, halfWidth, toneHeight, COLORS.surface);
  drawEyebrow(ctx, "3D rotation", rightX + 24, y + 38);
  if (model.rotationNote) {
    ctx.font = sansFont(400, 17);
    ctx.fillStyle = COLORS.inkSubtle;
    ctx.textAlign = "left";
    const lines = wrapText(
      model.rotationNote,
      halfWidth - 48,
      3,
      (value) => ctx.measureText(value).width,
    );
    lines.forEach((line, index) => {
      ctx.fillText(line, rightX + 24, y + 78 + index * 26);
    });
  } else {
    model.rotation.forEach((row, index) => {
      drawRow(ctx, row, rightX + 24, y + 82 + index * 36, halfWidth - 48);
    });
  }

  y += toneHeight + 40;

  drawSectionHeading(ctx, "What to work on", PAD, y + 16, INNER);
  y += 44;

  const focusGap = 14;
  if (model.focusNote) {
    ctx.font = sansFont(400, 22);
    ctx.fillStyle = COLORS.inkMuted;
    ctx.textAlign = "left";
    const lines = wrapText(model.focusNote, INNER - 48, 2, (value) => ctx.measureText(value).width);
    lines.forEach((line, index) => {
      ctx.fillText(line, PAD, y + 34 + index * 30);
    });
    y += 34 + lines.length * 30 + 10;
  }

  for (const focus of model.focuses) {
    ctx.font = sansFont(400, 23);
    const tipLines = wrapText(focus.detail, INNER - 48, 2, (value) => ctx.measureText(value).width);
    const cardHeight = 72 + tipLines.length * 30;
    fillSurface(ctx, PAD, y, INNER, cardHeight, COLORS.surface);

    ctx.font = sansFont(600, 23);
    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = "left";
    ctx.fillText(focus.title, PAD + 24, y + 36);

    ctx.font = monoFont(400, 16);
    ctx.fillStyle = COLORS.inkTertiary;
    ctx.textAlign = "right";
    ctx.fillText(focus.meta, PAD + INNER - 24, y + 36);

    ctx.font = sansFont(400, 23);
    ctx.fillStyle = COLORS.inkMuted;
    ctx.textAlign = "left";
    tipLines.forEach((line, index) => {
      ctx.fillText(line, PAD + 24, y + 70 + index * 30);
    });

    y += cardHeight + focusGap;
  }

  y += 14;

  // Capture strip.
  const captureHeight = 112;
  fillSurface(ctx, PAD, y, INNER, captureHeight, COLORS.surfaceAlt);
  const gradeLevel: CaptureCheck["level"] =
    model.captureGrade === "good" ? "pass" : model.captureGrade === "usable" ? "warn" : "fail";
  const gradeText = `Setup · ${model.captureGrade}`;
  ctx.font = monoFont(600, 15);
  ctx.fillStyle = issueColor(gradeLevel);
  ctx.textAlign = "left";
  ctx.fillText(gradeText.toUpperCase(), PAD + 24, y + 40);

  const captureText =
    model.captures.length === 0
      ? "Framing, tracking and frame rate all checked out."
      : model.captures.map((issue) => issue.text).join(" · ");

  ctx.font = sansFont(400, 20);
  ctx.fillStyle = COLORS.inkMuted;
  const captureLines = wrapText(
    captureText,
    INNER - 48,
    2,
    (value) => ctx.measureText(value).width,
  );
  captureLines.forEach((line, index) => {
    ctx.fillText(line, PAD + 24, y + 70 + index * 28);
  });

  // Footer, pinned so short reports don't drift.
  const footerLineY = H - 132;
  ctx.strokeStyle = COLORS.hairline;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, footerLineY);
  ctx.lineTo(W - PAD, footerLineY);
  ctx.stroke();

  ctx.font = sansFont(400, 17);
  ctx.fillStyle = COLORS.inkSubtle;
  ctx.textAlign = "left";
  ctx.fillText("Measured from video — not launch-monitor data.", PAD, footerLineY + 34);

  ctx.font = monoFont(400, 15);
  ctx.fillStyle = COLORS.inkTertiary;
  ctx.textAlign = "right";
  ctx.fillText("GOLF SWING ANALYZER", W - PAD, footerLineY + 34);

  ctx.font = sansFont(400, 16);
  ctx.fillStyle = COLORS.inkTertiary;
  ctx.textAlign = "left";
  ctx.fillText(
    "Speed, distance and 3D rotation are estimates from a single camera.",
    PAD,
    footerLineY + 60,
  );

  ctx.restore();
}
