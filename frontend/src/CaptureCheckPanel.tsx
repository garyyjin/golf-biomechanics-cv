import type { CaptureCheck, CaptureGrade, CaptureReport } from "./captureCheck";

const LEVEL_LABEL: Record<CaptureCheck["level"], string> = {
  pass: "Good",
  warn: "Check",
  fail: "Fix",
};

const GRADE_LABEL: Record<CaptureGrade, string> = {
  good: "Ready",
  usable: "Usable",
  poor: "Poor setup",
};

/**
 * Setup quality for the clip being reviewed. Collapsed when everything
 * passes — a clean capture shouldn't cost vertical space — and opened
 * automatically when something needs attention, because every number in the
 * panels below inherits that problem.
 */
export function CaptureCheckPanel({ report }: { report: CaptureReport }) {
  return (
    <details className="capture-panel" open={report.grade !== "good"}>
      <summary>
        Capture check
        <span className={`capture-grade capture-grade-${report.grade}`}>
          {GRADE_LABEL[report.grade]}
        </span>
      </summary>
      <ul className="capture-list">
        {report.checks.map((check) => (
          <li key={check.id} className="capture-item">
            <div className="capture-row">
              <span className={`capture-dot capture-dot-${check.level}`} aria-hidden="true" />
              <span className="capture-label">{check.label}</span>
              <span className={`capture-level capture-level-${check.level}`}>
                {LEVEL_LABEL[check.level]}
              </span>
            </div>
            <p className="capture-detail">{check.detail}</p>
            {check.advice && <p className="capture-advice">{check.advice}</p>}
          </li>
        ))}
      </ul>
    </details>
  );
}
