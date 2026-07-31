import { useCallback, useEffect, useMemo, useState } from "react";
import type { LoadedBenchmarks } from "./benchmarks";
import {
  deleteSwing,
  fetchSwingAnalysis,
  listSwings,
  renameSwing,
  saveSwingSummary,
} from "./historyApi";
import type { HistoryEntry } from "./historyApi";
import { ProgressChart } from "./ProgressChart";
import { SERIES_OPTIONS } from "./chartSeries";
import type { SeriesKey } from "./chartSeries";
import type { SeriesPoint } from "./chartGeometry";
import { computeSwingSummary } from "./swingSummary";
import { formatTempoRatio } from "./tempo";
import type { Handedness, View } from "./types";

interface Props {
  benchmarks: LoadedBenchmarks;
  onOpenSwing: (entry: HistoryEntry) => void | Promise<void>;
}

const VIEW_FILTER_OPTIONS: { value: View | "all"; label: string }[] = [
  { value: "all", label: "All views" },
  { value: "face_on", label: "Face-on" },
  { value: "down_the_line", label: "Down-the-line" },
];

const HANDEDNESS_FILTER_OPTIONS: { value: Handedness | "all"; label: string }[] = [
  { value: "all", label: "Both" },
  { value: "right", label: "Right" },
  { value: "left", label: "Left" },
];

const SKELETON_KEYS = ["a", "b", "c"];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

function HistorySkeleton() {
  return (
    <div className="library-list" aria-hidden="true">
      {SKELETON_KEYS.map((key) => (
        <div key={key} className="library-entry skeleton">
          <span className="skeleton-block skeleton-thumb" />
          <div className="library-entry-meta">
            <span className="skeleton-block skeleton-line skeleton-line-wide" />
            <span className="skeleton-block skeleton-line skeleton-line-narrow" />
          </div>
          <span className="skeleton-block skeleton-button" />
        </div>
      ))}
    </div>
  );
}

export function HistoryScreen({ benchmarks, onOpenSwing }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [totalBytes, setTotalBytes] = useState(0);
  const [loading, setLoading] = useState(true);
  const [rescoring, setRescoring] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [seriesKey, setSeriesKey] = useState<SeriesKey>("score");
  const [filterView, setFilterView] = useState<View | "all">("all");
  const [filterHandedness, setFilterHandedness] = useState<Handedness | "all">("all");

  /**
   * Recomputes any summary that wasn't scored against the current benchmarks.
   *
   * Empirical benchmarks shift every time the reference library changes, so a
   * score saved before that shift was graded on a different yardstick — left
   * alone, the progress chart would mix generations and an apparent
   * improvement could just be the yardstick moving. A missing summary (the
   * tab closed before the post landed, or analysis is still running) has no
   * stamp at all and so falls out of the same check.
   *
   * Scoring lives in the frontend, so the backend can't do this itself. Each
   * stale entry costs a full analysis fetch, so only stale ones are touched.
   */
  const rescoreStale = useCallback(
    async (current: HistoryEntry[]) => {
      const stale = current.filter((e) => e.summary?.benchmarksAt !== benchmarks.version);
      if (stale.length === 0) return;

      setRescoring(stale.length);
      const updated = new Map<string, HistoryEntry>();
      try {
        for (const entry of stale) {
          try {
            const analysis = await fetchSwingAnalysis(entry.id);
            const summary = computeSwingSummary(analysis, benchmarks.table, benchmarks.version);
            updated.set(entry.id, await saveSwingSummary(entry.id, summary));
          } catch {
            // A swing still being analyzed has no analysis.json yet. Skip it —
            // the next visit picks it up rather than failing the whole page.
          }
          setRescoring((n) => n - 1);
        }
      } finally {
        setRescoring(0);
      }
      if (updated.size > 0) {
        setEntries((previous) => previous.map((e) => updated.get(e.id) ?? e));
      }
    },
    [benchmarks.table, benchmarks.version],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const body = await listSwings();
      setEntries(body.swings);
      setTotalBytes(body.totalBytes);
      await rescoreStale(body.swings);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load history");
    } finally {
      setLoading(false);
    }
  }, [rescoreStale]);

  // Reruns when the benchmark version changes (via load -> rescoreStale's
  // deps), which is exactly when every stored score has gone stale.
  useEffect(() => {
    void load();
  }, [load]);

  async function handleDelete(id: string) {
    setConfirmingId(null);
    setDeletingId(id);
    setError(null);
    try {
      const { totalBytes: remaining } = await deleteSwing(id);
      setEntries((previous) => previous.filter((e) => e.id !== id));
      setTotalBytes(remaining);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  async function commitLabel(entry: HistoryEntry) {
    const label = draftLabel.trim();
    setEditingId(null);
    if (!label || label === entry.label) return;
    try {
      const updated = await renameSwing(entry.id, label);
      setEntries((previous) => previous.map((e) => (e.id === entry.id ? updated : e)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rename failed");
    }
  }

  const filtered = entries.filter((entry) => {
    if (filterView !== "all" && entry.view !== filterView) return false;
    if (filterHandedness !== "all" && entry.handedness !== filterHandedness) return false;
    return true;
  });

  // The chart follows the filters, so narrowing to face-on charts only
  // face-on swings — comparing across camera views would be meaningless.
  const chartSeries = useMemo<SeriesPoint[]>(
    () =>
      filtered
        .map((entry) => {
          const value = entry.summary?.[seriesKey];
          if (value === null || value === undefined) return null;
          return { t: new Date(entry.createdAt).getTime(), value, id: entry.id };
        })
        .filter((p): p is SeriesPoint => p !== null),
    [filtered, seriesKey],
  );

  return (
    <div className="library">
      <h1>Swing history</h1>
      <p className="hint">
        Every swing you've analyzed, scored and charted over time. Swings are kept until you
        remove them — currently using <span className="stats-value">{formatBytes(totalBytes)}</span>.
      </p>

      {rescoring > 0 && (
        <p className="hint">Updating {rescoring} score{rescoring === 1 ? "" : "s"} against the latest benchmarks…</p>
      )}
      {error && <p className="error">{error}</p>}

      <div className="library-toolbar">
        <div className="toggle-group" role="radiogroup" aria-label="Chart series">
          {SERIES_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={seriesKey === opt.value ? "toggle selected" : "toggle"}
              aria-pressed={seriesKey === opt.value}
              onClick={() => setSeriesKey(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="library-toolbar-divider" aria-hidden="true" />

        <div className="toggle-group" role="radiogroup" aria-label="Filter by camera view">
          {VIEW_FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={filterView === opt.value ? "toggle selected" : "toggle"}
              aria-pressed={filterView === opt.value}
              onClick={() => setFilterView(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="toggle-group" role="radiogroup" aria-label="Filter by handedness">
          {HANDEDNESS_FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={filterHandedness === opt.value ? "toggle selected" : "toggle"}
              aria-pressed={filterHandedness === opt.value}
              onClick={() => setFilterHandedness(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {!loading && (
        <ProgressChart
          series={chartSeries}
          seriesKey={seriesKey}
          onSelect={(id) => {
            const entry = entries.find((e) => e.id === id);
            if (entry) void onOpenSwing(entry);
          }}
        />
      )}

      {loading ? (
        <HistorySkeleton />
      ) : entries.length === 0 ? (
        <p className="hint">
          No swings yet. Analyze one from the Analyze tab and it'll be saved here automatically.
        </p>
      ) : filtered.length === 0 ? (
        <p className="hint">No swings match your filters.</p>
      ) : (
        <div className="library-list">
          {filtered.map((entry) => (
            <div key={entry.id} className="library-entry history-entry">
              <div className="history-score">
                {entry.summary?.score != null ? (
                  <>
                    {/* swing-score-{band} sets `color`, which the number picks
                        up — same red/amber/green mapping as the player's
                        badge, defined once. */}
                    <span
                      className={`history-score-value swing-score-${entry.summary.band ?? "unscored"}`}
                    >
                      {Math.round(entry.summary.score)}
                    </span>
                    <span className="history-score-caption">score</span>
                  </>
                ) : (
                  <span className="history-score-caption">not scored</span>
                )}
              </div>

              <div className="library-entry-meta history-meta">
                {editingId === entry.id ? (
                  <input
                    className="history-label-input"
                    value={draftLabel}
                    autoFocus
                    aria-label="Swing label"
                    onChange={(e) => setDraftLabel(e.target.value)}
                    onBlur={() => void commitLabel(entry)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void commitLabel(entry);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="reset history-label"
                    title="Rename this swing"
                    onClick={() => {
                      setEditingId(entry.id);
                      setDraftLabel(entry.label);
                    }}
                  >
                    {entry.label}
                  </button>
                )}
                <span>{new Date(entry.createdAt).toLocaleString()}</span>
                <span>
                  {entry.view === "face_on" ? "Face-on" : "Down-the-line"} ·{" "}
                  {entry.handedness === "right" ? "Right-handed" : "Left-handed"}
                </span>
                <span className="history-stats">
                  {entry.summary?.clubheadSpeedMph != null && (
                    <span className="stats-value">{entry.summary.clubheadSpeedMph.toFixed(0)} mph</span>
                  )}
                  {entry.summary?.tempoRatio != null && (
                    <span className="stats-value">{formatTempoRatio(entry.summary.tempoRatio)}</span>
                  )}
                </span>
              </div>

              {confirmingId === entry.id ? (
                <div className="confirm-actions">
                  <span className="confirm-label">Remove this swing?</span>
                  <button
                    type="button"
                    className="reset danger"
                    disabled={deletingId === entry.id}
                    onClick={() => void handleDelete(entry.id)}
                  >
                    {deletingId === entry.id ? "Removing…" : "Confirm"}
                  </button>
                  <button type="button" onClick={() => setConfirmingId(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="history-actions">
                  <button type="button" onClick={() => void onOpenSwing(entry)}>
                    Open
                  </button>
                  <button type="button" className="reset" onClick={() => setConfirmingId(entry.id)}>
                    Remove
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
