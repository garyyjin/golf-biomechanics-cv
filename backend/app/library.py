"""Reference-swing library: local-disk storage + benchmark aggregation.

This is a local, single/two-person dev tool with no concurrent-writer
scenario in practice, so storage uses plain synchronous file I/O (json.load/
json.dump) with no file-locking library — a deliberate scoping call, not an
oversight.

Biomechanics logic (phase detection, angle computation) lives entirely in the
frontend (TypeScript) and never runs here — this module only persists
per-swing samples the frontend already computed, and aggregates them with
plain arithmetic (mean/stdev). Metric labels are frontend-only knowledge too;
this module's output carries bare metric ids, not human-readable labels.
"""

import json
import os
import shutil
import statistics
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.pose import analyze_video

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

MIN_SAMPLES_FOR_RANGE = 3
RANGE_WIDTH_STD = 1


def _entries_dir() -> Path:
    return DATA_DIR / "entries"


def _entry_dir(entry_id: str) -> Path:
    return _entries_dir() / entry_id


def _index_path() -> Path:
    return DATA_DIR / "index.json"


def _benchmarks_path() -> Path:
    return DATA_DIR / "benchmarks.json"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_index() -> list[dict]:
    path = _index_path()
    if not path.exists():
        return []
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _write_index(entries: list[dict]) -> None:
    _index_path().parent.mkdir(parents=True, exist_ok=True)
    with open(_index_path(), "w", encoding="utf-8") as f:
        json.dump(entries, f, indent=2)


def _find_entry(entry_id: str) -> dict | None:
    for entry in _read_index():
        if entry["id"] == entry_id:
            return entry
    return None


def create_entry(video_stream, filename: str, view: str, handedness: str) -> dict:
    """Persists an uploaded reference video, runs pose extraction on it at
    max accuracy, and appends it to the library index.

    Raises ValueError (propagated from analyze_video) if the video can't be
    decoded; the partially-written entry directory is removed before
    re-raising so a failed upload never leaves an orphaned entry.
    """
    entry_id = str(uuid.uuid4())
    ext = os.path.splitext(filename)[1].lower()
    entry_dir = _entry_dir(entry_id)
    entry_dir.mkdir(parents=True, exist_ok=True)

    video_path = entry_dir / f"video{ext}"
    try:
        with open(video_path, "wb") as f:
            shutil.copyfileobj(video_stream, f)

        result = analyze_video(str(video_path), quality="accurate")
    except ValueError:
        shutil.rmtree(entry_dir, ignore_errors=True)
        raise

    analysis = {
        "fps": result["fps"],
        "width": result["width"],
        "height": result["height"],
        "frame_count": result["frame_count"],
        "view": view,
        "handedness": handedness,
        "quality": "accurate",
        "frames": result["frames"],
    }
    with open(entry_dir / "analysis.json", "w", encoding="utf-8") as f:
        json.dump(analysis, f)

    created_at = _now()
    index_entry = {
        "id": entry_id,
        "filename": filename,
        "view": view,
        "handedness": handedness,
        "createdAt": created_at,
    }
    entries = _read_index()
    entries.append(index_entry)
    _write_index(entries)

    return {**index_entry, "analysis": analysis}


def list_entries() -> list[dict]:
    return _read_index()


def get_entry_video_path(entry_id: str) -> Path | None:
    entry = _find_entry(entry_id)
    if entry is None:
        return None
    ext = os.path.splitext(entry["filename"])[1].lower()
    return _entry_dir(entry_id) / f"video{ext}"


def get_entry_analysis(entry_id: str) -> dict | None:
    entry = _find_entry(entry_id)
    if entry is None:
        return None
    analysis_path = _entry_dir(entry_id) / "analysis.json"
    if not analysis_path.exists():
        return None
    with open(analysis_path, encoding="utf-8") as f:
        return json.load(f)


def delete_entry(entry_id: str) -> dict | None:
    entry = _find_entry(entry_id)
    if entry is None:
        return None

    shutil.rmtree(_entry_dir(entry_id), ignore_errors=True)
    entries = [e for e in _read_index() if e["id"] != entry_id]
    _write_index(entries)

    return recompute_benchmarks()


def save_samples(entry_id: str, samples: list[dict]) -> dict | None:
    entry = _find_entry(entry_id)
    if entry is None:
        return None

    samples_path = _entry_dir(entry_id) / "samples.json"
    with open(samples_path, "w", encoding="utf-8") as f:
        json.dump(samples, f)

    return recompute_benchmarks()


def recompute_benchmarks() -> dict:
    entries = _read_index()

    # group[(view, phase, metric)] -> list of values
    groups: dict[tuple[str, str, str], list[float]] = {}
    for entry in entries:
        samples_path = _entry_dir(entry["id"]) / "samples.json"
        if not samples_path.exists():
            continue
        with open(samples_path, encoding="utf-8") as f:
            samples = json.load(f)
        for sample in samples:
            key = (entry["view"], sample["phase"], sample["metric"])
            groups.setdefault(key, []).append(sample["value"])

    table: dict[str, dict[str, list[dict]]] = {"face_on": {}, "down_the_line": {}}
    for (view, phase, metric), values in groups.items():
        if len(values) < MIN_SAMPLES_FOR_RANGE:
            continue
        avg = statistics.mean(values)
        std = statistics.stdev(values)
        phase_entries = table[view].setdefault(phase, [])
        phase_entries.append(
            {
                "metric": metric,
                "range": {"min": avg - RANGE_WIDTH_STD * std, "max": avg + RANGE_WIDTH_STD * std},
                "sampleSize": len(values),
            }
        )

    result = {"generatedAt": _now(), "table": table}
    _benchmarks_path().parent.mkdir(parents=True, exist_ok=True)
    with open(_benchmarks_path(), "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    return result


def get_benchmarks() -> dict:
    path = _benchmarks_path()
    if not path.exists():
        return {"generatedAt": None, "table": {"face_on": {}, "down_the_line": {}}}
    with open(path, encoding="utf-8") as f:
        return json.load(f)
