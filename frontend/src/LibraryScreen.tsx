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

type LibraryViewMode = "list" | "grid";

function VideoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
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

      {loadingList ? (
        <p>Loading…</p>
      ) : entries.length === 0 ? (
        <p className="hint">No reference swings yet.</p>
      ) : libraryViewMode === "list" ? (
        <div className="library-list">
          {entries.map((entry) => (
            <div key={entry.id} className="library-entry">
              <video controls src={referenceSwingVideoUrl(entry.id)} />
              <div className="library-entry-meta">
                <span>{entry.filename}</span>
                <span>{entry.view === "face_on" ? "Face-on" : "Down-the-line"}</span>
                <span>{entry.handedness === "right" ? "Right-handed" : "Left-handed"}</span>
                <span>{new Date(entry.createdAt).toLocaleDateString()}</span>
              </div>
              <button
                type="button"
                className="reset"
                disabled={deletingId === entry.id}
                onClick={() => handleDelete(entry.id)}
              >
                {deletingId === entry.id ? "Removing…" : "Remove"}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="library-grid">
          {entries.map((entry) => (
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
        <div className="modal-backdrop" onClick={() => setSelectedEntry(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <video controls src={referenceSwingVideoUrl(selectedEntry.id)} />
            <div className="library-entry-meta">
              <span>{selectedEntry.filename}</span>
              <span>{selectedEntry.view === "face_on" ? "Face-on" : "Down-the-line"}</span>
              <span>{selectedEntry.handedness === "right" ? "Right-handed" : "Left-handed"}</span>
              <span>{new Date(selectedEntry.createdAt).toLocaleDateString()}</span>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="reset"
                disabled={deletingId === selectedEntry.id}
                onClick={() => {
                  void handleDelete(selectedEntry.id);
                  setSelectedEntry(null);
                }}
              >
                {deletingId === selectedEntry.id ? "Removing…" : "Remove"}
              </button>
              <button type="button" onClick={() => setSelectedEntry(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
