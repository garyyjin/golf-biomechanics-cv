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

export function LibraryScreen({ onBenchmarksChanged }: Props) {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [handedness, setHandedness] = useState<Handedness | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

      <div className="library-list">
        {loadingList ? (
          <p>Loading…</p>
        ) : entries.length === 0 ? (
          <p className="hint">No reference swings yet.</p>
        ) : (
          entries.map((entry) => (
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
          ))
        )}
      </div>
    </div>
  );
}
