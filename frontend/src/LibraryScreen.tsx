import { useEffect, useState } from "react";
import { computeSwingSamples } from "./calibration";
import { FileField } from "./FileField";
import {
  deleteReferenceSwing,
  listReferenceSwings,
  referenceSwingVideoUrl,
  submitSamples,
  uploadReferenceSwing,
} from "./libraryApi";
import type { LibraryEntry } from "./libraryApi";
import type { Handedness, View } from "./types";

interface Props {
  onBenchmarksChanged: () => void | Promise<void>;
}

const VIEW_OPTIONS: { value: View; label: string }[] = [
  { value: "face_on", label: "Face-on" },
  { value: "down_the_line", label: "Down-the-line" },
];

const HANDEDNESS_OPTIONS: { value: Handedness; label: string }[] = [
  { value: "right", label: "Right" },
  { value: "left", label: "Left" },
];

const VIEW_FILTER_OPTIONS: { value: View | "all"; label: string }[] = [
  { value: "all", label: "All views" },
  ...VIEW_OPTIONS,
];

const HANDEDNESS_FILTER_OPTIONS: { value: Handedness | "all"; label: string }[] = [
  { value: "all", label: "Both" },
  ...HANDEDNESS_OPTIONS,
];

type LibraryViewMode = "list" | "grid";

function VideoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

const SKELETON_KEYS = ["a", "b", "c"];

function LibrarySkeleton({ mode }: { mode: LibraryViewMode }) {
  if (mode === "grid") {
    return (
      <div className="library-grid" aria-hidden="true">
        {SKELETON_KEYS.map((key) => (
          <div key={key} className="library-tile skeleton">
            <span className="skeleton-block skeleton-icon" />
            <span className="skeleton-block skeleton-line" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="library-list" aria-hidden="true">
      {SKELETON_KEYS.map((key) => (
        <div key={key} className="library-entry skeleton">
          <span className="skeleton-block skeleton-thumb" />
          <div className="library-entry-meta">
            <span className="skeleton-block skeleton-line skeleton-line-wide" />
            <span className="skeleton-block skeleton-line skeleton-line-narrow" />
            <span className="skeleton-block skeleton-line skeleton-line-narrow" />
          </div>
          <span className="skeleton-block skeleton-button" />
        </div>
      ))}
    </div>
  );
}

export function LibraryScreen({ onBenchmarksChanged }: Props) {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [handedness, setHandedness] = useState<Handedness | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [libraryViewMode, setLibraryViewMode] = useState<LibraryViewMode>("list");
  const [selectedEntry, setSelectedEntry] = useState<LibraryEntry | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterView, setFilterView] = useState<View | "all">("all");
  const [filterHandedness, setFilterHandedness] = useState<Handedness | "all">("all");

  useEffect(() => {
    void refreshEntries();
  }, []);

  async function refreshEntries() {
    setLoadingList(true);
    try {
      setEntries(await listReferenceSwings());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load library");
    } finally {
      setLoadingList(false);
    }
  }

  const ready = file !== null && view !== null && handedness !== null && !uploading;

  async function submit() {
    if (!file || !view || !handedness) return;
    setUploading(true);
    setError(null);
    try {
      const entry = await uploadReferenceSwing(file, view, handedness);
      const samples = computeSwingSamples(entry.analysis);
      await submitSamples(entry.id, samples);
      setFile(null);
      setView(null);
      setHandedness(null);
      await refreshEntries();
      await onBenchmarksChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    setConfirmingId(null);
    setDeletingId(id);
    setError(null);
    try {
      await deleteReferenceSwing(id);
      await refreshEntries();
      await onBenchmarksChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  const filteredEntries = entries.filter((entry) => {
    if (filterView !== "all" && entry.view !== filterView) return false;
    if (filterHandedness !== "all" && entry.handedness !== filterHandedness) return false;
    if (search.trim() && !entry.filename.toLowerCase().includes(search.trim().toLowerCase())) {
      return false;
    }
    return true;
  });
  const hasActiveFilters = search.trim() !== "" || filterView !== "all" || filterHandedness !== "all";

  return (
    <div className="library">
      <h1>Reference swing library</h1>
      <p className="hint">
        Upload swings you consider good technique. Benchmark ranges shown during analysis
        recalculate automatically from every swing in this library.
      </p>

      <div className="library-upload">
        <FileField
          label="Reference swing video (mp4, mov or webm)"
          file={file}
          accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm"
          disabled={uploading}
          onChange={setFile}
        />

        <div className="field">
          <span>Camera view</span>
          <div className="toggle-group" role="radiogroup" aria-label="Camera view">
            {VIEW_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={view === opt.value ? "toggle selected" : "toggle"}
                aria-pressed={view === opt.value}
                disabled={uploading}
                onClick={() => setView(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span>Handedness</span>
          <div className="toggle-group" role="radiogroup" aria-label="Handedness">
            {HANDEDNESS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={handedness === opt.value ? "toggle selected" : "toggle"}
                aria-pressed={handedness === opt.value}
                disabled={uploading}
                onClick={() => setHandedness(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <button type="button" className="submit" disabled={!ready} onClick={submit}>
          {uploading ? "Uploading…" : "Add to library"}
        </button>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="library-toolbar">
        <input
          type="search"
          className="filter-search"
          placeholder="Search filename…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search by filename"
        />

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

        <div className="library-toolbar-divider" aria-hidden="true" />

        <div className="toggle-group" role="radiogroup" aria-label="Library view">
          <button
            type="button"
            className={libraryViewMode === "list" ? "toggle selected" : "toggle"}
            aria-pressed={libraryViewMode === "list"}
            onClick={() => setLibraryViewMode("list")}
          >
            List
          </button>
          <button
            type="button"
            className={libraryViewMode === "grid" ? "toggle selected" : "toggle"}
            aria-pressed={libraryViewMode === "grid"}
            onClick={() => setLibraryViewMode("grid")}
          >
            Grid
          </button>
        </div>
      </div>

      {loadingList ? (
        <LibrarySkeleton mode={libraryViewMode} />
      ) : entries.length === 0 ? (
        <p className="hint">No reference swings yet.</p>
      ) : filteredEntries.length === 0 ? (
        <p className="hint">
          No reference swings match your filters.
          {hasActiveFilters && (
            <>
              {" "}
              <button
                type="button"
                className="reset filter-clear"
                onClick={() => {
                  setSearch("");
                  setFilterView("all");
                  setFilterHandedness("all");
                }}
              >
                Clear filters
              </button>
            </>
          )}
        </p>
      ) : libraryViewMode === "list" ? (
        <div className="library-list">
          {filteredEntries.map((entry) => (
            <div key={entry.id} className="library-entry">
              <video controls src={referenceSwingVideoUrl(entry.id)} />
              <div className="library-entry-meta">
                <span>{entry.filename}</span>
                <span>{entry.view === "face_on" ? "Face-on" : "Down-the-line"}</span>
                <span>{entry.handedness === "right" ? "Right-handed" : "Left-handed"}</span>
                <span>{new Date(entry.createdAt).toLocaleDateString()}</span>
              </div>
              {confirmingId === entry.id ? (
                <div className="confirm-actions">
                  <span className="confirm-label">Remove this swing?</span>
                  <button
                    type="button"
                    className="reset danger"
                    disabled={deletingId === entry.id}
                    onClick={() => handleDelete(entry.id)}
                  >
                    {deletingId === entry.id ? "Removing…" : "Confirm"}
                  </button>
                  <button type="button" onClick={() => setConfirmingId(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button type="button" className="reset" onClick={() => setConfirmingId(entry.id)}>
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="library-grid">
          {filteredEntries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="library-tile"
              onClick={() => setSelectedEntry(entry)}
            >
              <span className="library-tile-icon">
                <VideoIcon />
              </span>
              <span className="library-tile-name">{entry.filename}</span>
            </button>
          ))}
        </div>
      )}

      {selectedEntry && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setSelectedEntry(null);
            setConfirmingId(null);
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <video controls src={referenceSwingVideoUrl(selectedEntry.id)} />
            <div className="library-entry-meta">
              <span>{selectedEntry.filename}</span>
              <span>{selectedEntry.view === "face_on" ? "Face-on" : "Down-the-line"}</span>
              <span>{selectedEntry.handedness === "right" ? "Right-handed" : "Left-handed"}</span>
              <span>{new Date(selectedEntry.createdAt).toLocaleDateString()}</span>
            </div>
            {confirmingId === selectedEntry.id ? (
              <div className="confirm-actions">
                <span className="confirm-label">Remove this swing?</span>
                <button
                  type="button"
                  className="reset danger"
                  disabled={deletingId === selectedEntry.id}
                  onClick={() => {
                    void handleDelete(selectedEntry.id);
                    setSelectedEntry(null);
                  }}
                >
                  {deletingId === selectedEntry.id ? "Removing…" : "Confirm"}
                </button>
                <button type="button" onClick={() => setConfirmingId(null)}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="modal-actions">
                <button type="button" className="reset" onClick={() => setConfirmingId(selectedEntry.id)}>
                  Remove
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedEntry(null);
                    setConfirmingId(null);
                  }}
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
