"""Swing history: local-disk storage for every swing the user analyzes.

Deliberately a separate tree from library.py's reference swings. The two look
similar on disk but mean opposite things: the reference library is a curated
set of good technique to *measure against* (and often isn't the user's own
swing at all), while this is the user's personal log of what they actually
hit. Mixing them would put a pro's swing into the user's progress chart.

Same storage approach and same caveat as library.py: plain synchronous
json.load/json.dump with no file-locking library, a deliberate scoping call
for a local single-user tool rather than an oversight.

Scoring lives entirely in the frontend (see frontend/src/swingSummary.ts), so
this module never computes a summary — it only persists the one the frontend
sends, alongside the benchmark version that summary was computed against. The
frontend uses that stamp to notice when a stored score has gone stale and
needs recomputing (empirical benchmarks shift as the reference library grows).
"""

import json
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def _swings_dir() -> Path:
    return DATA_DIR / "swings"


def _swing_dir(swing_id: str) -> Path:
    return _swings_dir() / swing_id


def _index_path() -> Path:
    return _swings_dir() / "index.json"


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


def _find_entry(swing_id: str) -> dict | None:
    for entry in _read_index():
        if entry["id"] == swing_id:
            return entry
    return None


def _read_summary(swing_id: str) -> dict | None:
    path = _swing_dir(swing_id) / "summary.json"
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def create_swing(video_stream, filename: str, view: str, handedness: str) -> str:
    """Persists an uploaded swing video and registers it in the index,
    returning the new swing's id.

    Called before analysis rather than after, so the single upload the client
    already made serves both purposes — re-uploading afterwards would move the
    same 5-50MB twice. The entry therefore exists before there's any analysis
    to go with it; store_analysis fills that in, and discard_swing removes the
    whole thing if analysis fails.

    label defaults to the filename and is user-editable afterwards (see
    set_label) — phone filenames like IMG_1234.mov repeat and say nothing.
    """
    swing_id = str(uuid.uuid4())
    ext = os.path.splitext(filename)[1].lower()
    swing_dir = _swing_dir(swing_id)
    swing_dir.mkdir(parents=True, exist_ok=True)

    with open(swing_dir / f"video{ext}", "wb") as f:
        shutil.copyfileobj(video_stream, f)

    entries = _read_index()
    entries.append(
        {
            "id": swing_id,
            "filename": filename,
            "label": filename,
            "view": view,
            "handedness": handedness,
            "createdAt": _now(),
        }
    )
    _write_index(entries)
    return swing_id


def store_analysis(swing_id: str, analysis: dict) -> None:
    """Writes the completed per-frame analysis for a swing. No-ops if the
    swing directory is gone — a delete racing a still-running analysis job
    shouldn't resurrect the directory as a stray analysis.json."""
    swing_dir = _swing_dir(swing_id)
    if not swing_dir.exists():
        return
    with open(swing_dir / "analysis.json", "w", encoding="utf-8") as f:
        json.dump(analysis, f)


def discard_swing(swing_id: str) -> None:
    """Removes a swing whose analysis failed, so a video that could never be
    reviewed doesn't sit in the history list forever. Mirrors create_entry's
    rmtree-on-error cleanup in library.py."""
    shutil.rmtree(_swing_dir(swing_id), ignore_errors=True)
    _write_index([e for e in _read_index() if e["id"] != swing_id])


def save_summary(swing_id: str, summary: dict) -> dict | None:
    """Persists the frontend-computed score/stats summary for a swing."""
    entry = _find_entry(swing_id)
    if entry is None:
        return None
    with open(_swing_dir(swing_id) / "summary.json", "w", encoding="utf-8") as f:
        json.dump(summary, f)
    return {**entry, "summary": summary}


def set_label(swing_id: str, label: str) -> dict | None:
    entries = _read_index()
    updated = None
    for entry in entries:
        if entry["id"] == swing_id:
            entry["label"] = label
            updated = entry
    if updated is None:
        return None
    _write_index(entries)
    return {**updated, "summary": _read_summary(swing_id)}


def list_swings() -> list[dict]:
    """Index entries with their summaries attached, newest first.

    summary is None for a swing whose analysis is still running, or whose
    client went away before posting one — the frontend treats that the same as
    a stale summary and recomputes it.
    """
    entries = [{**e, "summary": _read_summary(e["id"])} for e in _read_index()]
    entries.sort(key=lambda e: e["createdAt"], reverse=True)
    return entries


def get_swing_analysis(swing_id: str) -> dict | None:
    if _find_entry(swing_id) is None:
        return None
    path = _swing_dir(swing_id) / "analysis.json"
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def get_swing_video_path(swing_id: str) -> Path | None:
    entry = _find_entry(swing_id)
    if entry is None:
        return None
    ext = os.path.splitext(entry["filename"])[1].lower()
    path = _swing_dir(swing_id) / f"video{ext}"
    return path if path.exists() else None


def delete_swing(swing_id: str) -> bool:
    if _find_entry(swing_id) is None:
        return False
    shutil.rmtree(_swing_dir(swing_id), ignore_errors=True)
    _write_index([e for e in _read_index() if e["id"] != swing_id])
    return True


def total_bytes() -> int:
    """Bytes used by all stored swings. Surfaced in the history UI because
    videos are kept indefinitely by design (no retention cap), so the growth
    should at least be visible before it becomes a problem.

    Excludes index.json, which is bookkeeping rather than swing data — it
    never empties (an empty history still leaves a 2-byte "[]"), and a disk
    readout that can't reach zero when there's nothing stored reads as a bug.
    """
    root = _swings_dir()
    if not root.exists():
        return 0
    index = _index_path()
    return sum(p.stat().st_size for p in root.rglob("*") if p.is_file() and p != index)
