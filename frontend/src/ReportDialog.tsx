import { useEffect, useRef, useState } from "react";
import type { ReportCardModel } from "./reportCard";
import {
  copyCanvasPng,
  downloadCanvasPng,
  prepareReportCanvas,
  reportFilename,
  waitForReportFonts,
} from "./reportExport";

interface ReportDialogProps {
  report: ReportCardModel;
  onClose: () => void;
}

type CopyState = "idle" | "copied" | "failed";

/**
 * Preview-and-export overlay for the shareable card.
 *
 * The canvas is painted once when the dialog opens (after webfonts settle) and
 * then reused for both the download and the clipboard, so the image the user
 * previews is byte-for-byte the one they share.
 */
export function ReportDialog({ report, onClose }: ReportDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(true);
  const [renderFailed, setRenderFailed] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [downloading, setDownloading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await waitForReportFonts();
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      if (!prepareReportCanvas(canvas, report)) {
        setRenderFailed(true);
      }
      setDrawing(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [report]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleDownload() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setDownloading(true);
    setSaveError(null);
    try {
      await downloadCanvasPng(canvas, reportFilename());
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save the report image.");
    } finally {
      setDownloading(false);
    }
  }

  async function handleCopy() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const copied = await copyCanvasPng(canvas);
    setCopyState(copied ? "copied" : "failed");
  }

  const ready = !drawing && !renderFailed;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="modal report-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Shareable swing report"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="report-modal-head">
          <div>
            <h2>Shareable report</h2>
            <p className="report-modal-caption">
              One image with your score, key numbers and what to work on. Rendered on your
              device — nothing is uploaded.
            </p>
          </div>
          <button type="button" className="icon-button" aria-label="Close report" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="report-preview">
          <canvas ref={canvasRef} role="img" aria-label="Swing report preview" />
          {drawing && <span className="report-drawing">Rendering report…</span>}
          {renderFailed && (
            <span className="report-drawing">This browser couldn&apos;t render the report image.</span>
          )}
        </div>

        {saveError && <p className="error">{saveError}</p>}

        <div className="modal-actions">
          <button type="button" className="reset" onClick={onClose}>
            Close
          </button>
          <button type="button" className="reset" disabled={!ready} onClick={handleCopy}>
            {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy unsupported" : "Copy image"}
          </button>
          <button type="button" className="submit" disabled={!ready || downloading} onClick={handleDownload}>
            {downloading ? "Preparing…" : "Download PNG"}
          </button>
        </div>
      </div>
    </div>
  );
}
