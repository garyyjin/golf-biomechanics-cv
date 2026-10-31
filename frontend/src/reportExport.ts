import { REPORT_CARD_HEIGHT, REPORT_CARD_WIDTH, drawReportCard } from "./reportCard.ts";
import type { ReportCardModel } from "./reportCard.ts";

/**
 * Turns a report model into a PNG.
 *
 * Kept apart from reportCard.ts so the drawing stays free of DOM APIs: the
 * card can be rendered anywhere (tests, a server-side canvas, a future
 * batch export), while sizing the backing store, waiting on fonts and
 * handing the file to the browser only happen here.
 */

/** Backing-store multiplier. The card is laid out in 1080×1620 CSS pixels,
 * so 2x yields a 2160×3240 PNG that stays crisp on a phone screen. */
export const REPORT_EXPORT_SCALE = 2;

export async function waitForReportFonts(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    // Canvas draws synchronously with whatever faces are loaded; without this
    // the first render can use fallback metrics and mis-measure every wrap.
    await document.fonts.ready;
  } catch {
    // Font loading is best-effort; the card's own fallback stack still draws.
  }
}

/** Sizes and paints an existing canvas. Returns false if the browser gave no
 * 2D context (rare, but the dialog should say so rather than show a blank
 * box). */
export function prepareReportCanvas(
  canvas: HTMLCanvasElement,
  model: ReportCardModel,
): boolean {
  canvas.width = REPORT_CARD_WIDTH * REPORT_EXPORT_SCALE;
  canvas.height = REPORT_CARD_HEIGHT * REPORT_EXPORT_SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  ctx.setTransform(REPORT_EXPORT_SCALE, 0, 0, REPORT_EXPORT_SCALE, 0, 0);
  drawReportCard(ctx, model);
  return true;
}

export function createReportCanvas(model: ReportCardModel): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  prepareReportCanvas(canvas, model);
  return canvas;
}

/** Local date, zero-padded, so a folder of exports sorts chronologically. */
export function reportFilename(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `swing-report-${year}-${month}-${day}.png`;
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not render the report image."));
    }, "image/png");
  });
}

export async function downloadCanvasPng(
  canvas: HTMLCanvasElement,
  filename: string,
): Promise<void> {
  const blob = await canvasToPngBlob(canvas);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Clipboard image support is browser-dependent, so a false return is a
 * normal outcome the dialog turns into a hint, not an error. */
export async function copyCanvasPng(canvas: HTMLCanvasElement): Promise<boolean> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return false;
  try {
    const blob = await canvasToPngBlob(canvas);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
}
