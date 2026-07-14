import type { ScoreBand, SwingScore } from "./swingScore";

interface Props {
  score: SwingScore;
}

const BAND_LABEL: Record<ScoreBand, string> = {
  good: "Solid swing",
  fair: "Getting there",
  poor: "Needs work",
};

const BAND_CAPTION: Record<ScoreBand, string> = {
  good: "Most of your key positions are inside the target ranges.",
  fair: "A few key positions are drifting outside the target ranges.",
  poor: "Several key positions are well outside the target ranges.",
};

// Ring geometry: stroke-dasharray progress trick around an SVG circle.
const SIZE = 96;
const STROKE = 8;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function SwingScoreBadge({ score }: Props) {
  const { overall, band } = score;
  const progress = overall !== null ? Math.max(0, Math.min(100, overall)) / 100 : 0;
  const dashOffset = CIRCUMFERENCE * (1 - progress);

  return (
    <div className={band ? `swing-score-card swing-score-${band}` : "swing-score-card swing-score-unscored"}>
      <div className="swing-score-ring" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <circle
            className="swing-score-track"
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            strokeWidth={STROKE}
            fill="none"
          />
          {overall !== null && (
            <circle
              className="swing-score-progress"
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              strokeWidth={STROKE}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            />
          )}
        </svg>
        <span className="swing-score-number">{overall !== null ? Math.round(overall) : "—"}</span>
      </div>
      <div className="swing-score-copy">
        <span className="swing-score-title">Swing score</span>
        <span className="swing-score-band">
          {band ? BAND_LABEL[band] : "Not enough detected"}
        </span>
        <p className="swing-score-caption">
          {band
            ? BAND_CAPTION[band]
            : "We couldn't find enough of your address, top, or impact positions to score this swing."}
        </p>
      </div>
    </div>
  );
}
