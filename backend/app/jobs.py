"""In-memory job tracking for long-running analysis requests.

Pose extraction can take several seconds to tens of seconds for a full
swing video; without this, a client has to hold one request open the whole
time with no way to show progress. Jobs are tracked in a plain dict behind
a lock — scoped deliberately for this project's local, single/two-person
use (no persistence, no cleanup of old jobs, no external queue), matching
the same low-ceremony storage choices made elsewhere in this backend.
"""

import threading
import uuid
from typing import Literal

Status = Literal["processing", "done", "error"]

_jobs: dict[str, dict] = {}
_lock = threading.Lock()


def create_job() -> str:
    job_id = str(uuid.uuid4())
    with _lock:
        _jobs[job_id] = {"status": "processing", "progress": 0.0, "result": None, "error": None}
    return job_id


def set_progress(job_id: str, progress: float) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if job is not None and job["status"] == "processing":
            job["progress"] = progress


def set_done(job_id: str, result: dict) -> None:
    with _lock:
        _jobs[job_id] = {"status": "done", "progress": 100.0, "result": result, "error": None}


def set_error(job_id: str, error: str) -> None:
    with _lock:
        _jobs[job_id] = {"status": "error", "progress": 0.0, "result": None, "error": error}


def get_job(job_id: str) -> dict | None:
    with _lock:
        job = _jobs.get(job_id)
        return dict(job) if job is not None else None
