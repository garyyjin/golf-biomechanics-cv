import logging
import os
import threading
from typing import Literal

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.history import (
    create_swing,
    delete_swing,
    discard_swing,
    get_swing_analysis,
    get_swing_video_path,
    list_swings,
    save_summary,
    set_label,
    store_analysis,
    total_bytes,
)
from app.jobs import create_job, get_job, set_done, set_error, set_progress
from app.library import (
    create_entry,
    delete_entry,
    get_benchmarks,
    get_entry_analysis,
    get_entry_video_path,
    list_entries,
    save_samples,
)
from app.pose import analyze_video

ALLOWED_EXTENSIONS = {".mp4", ".mov", ".webm"}
EXT_MEDIA_TYPES = {".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm"}

logger = logging.getLogger(__name__)


class SampleIn(BaseModel):
    phase: Literal["address", "takeaway", "top", "downswing", "impact", "followThrough"]
    metric: Literal["spineTilt", "shoulderTurn", "hipTurn", "xFactor", "planeAngle", "spineRetention"]
    value: float


class SamplesRequest(BaseModel):
    samples: list[SampleIn]


class SummaryIn(BaseModel):
    """A swing's scores as computed by the frontend.

    Every field is optional-by-nullability because each one has its own way of
    being unavailable on a given clip (phases undetected, clubhead never
    tracked, ball never seen). benchmarksAt records which benchmark generation
    produced this score, so the frontend can spot a stale summary and redo it;
    it's a string rather than a datetime because it also carries the literal
    "defaults" when the backend's benchmarks weren't reachable.
    """

    score: float | None = None
    band: Literal["good", "fair", "poor"] | None = None
    clubheadSpeedMph: float | None = None
    ballSpeedMph: float | None = None
    estCarryYards: float | None = None
    tempoRatio: float | None = None
    tempoScore: float | None = None
    benchmarksAt: str


class LabelRequest(BaseModel):
    label: str


app = FastAPI(title="Golf Swing Pose Extraction")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _run_analyze_job(
    job_id: str,
    swing_id: str,
    video_path: str,
    view: str,
    handedness: str,
    quality: str,
) -> None:
    """Runs pose extraction and, on success, persists the result to the
    swing's history entry.

    The video already lives in that entry's directory (see analyze below), so
    a failure here has to take the whole entry with it — otherwise history
    accumulates rows whose swing can never be reviewed.
    """
    try:
        result = analyze_video(
            video_path,
            quality=quality,
            on_progress=lambda index, total: set_progress(
                job_id, min(99.0, index / total * 100) if total > 0 else 0.0
            ),
        )
        analysis = {
            "fps": result["fps"],
            "width": result["width"],
            "height": result["height"],
            "frame_count": result["frame_count"],
            "view": view,
            "handedness": handedness,
            "quality": quality,
            "frames": result["frames"],
        }
        store_analysis(swing_id, analysis)
        set_done(job_id, analysis)
    except ValueError as exc:
        discard_swing(swing_id)
        set_error(job_id, str(exc))
    except Exception:
        # A background thread's exceptions never reach the client — without
        # this, anything analyze_video's callees can raise beyond ValueError
        # (mediapipe/cv2/YOLO errors) would leave the job stuck in
        # "processing" forever, and the frontend's poll loop has no timeout.
        logger.exception("analyze job %s failed", job_id)
        discard_swing(swing_id)
        set_error(job_id, "Analysis failed unexpectedly")


@app.post("/analyze", status_code=202)
def analyze(
    video: UploadFile = File(...),
    view: Literal["face_on", "down_the_line"] = Form(...),
    handedness: Literal["right", "left"] = Form(...),
    quality: Literal["fast", "accurate"] = Form(...),
):
    """Kicks off pose extraction in a background thread and returns
    immediately with a job id — extraction can take tens of seconds, and a
    single request holding the connection open the whole time gives the
    client nothing to show progress with. Poll GET /analyze/{job_id} for
    status/progress and the final result.

    The upload is written straight into a swing-history entry rather than a
    temp file, and the returned swing_id is that entry. Every analyzed swing
    is kept so the history screen can chart progress over time; persisting
    here means the client's single upload serves both analysis and storage
    instead of having to send the same 5-50MB again afterwards. A failed
    analysis removes the entry (see _run_analyze_job).
    """
    ext = os.path.splitext(video.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=422,
            detail="video must be one of: mp4, mov, webm",
        )

    swing_id = create_swing(video.file, video.filename or f"upload{ext}", view, handedness)
    video_path = get_swing_video_path(swing_id)
    if video_path is None:  # pragma: no cover - create_swing just wrote it
        raise HTTPException(status_code=500, detail="could not store the uploaded video")

    job_id = create_job()
    threading.Thread(
        target=_run_analyze_job,
        args=(job_id, swing_id, str(video_path), view, handedness, quality),
        daemon=True,
    ).start()
    return {"job_id": job_id, "swing_id": swing_id}


@app.get("/analyze/{job_id}")
def get_analyze_job(job_id: str):
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    if job["status"] == "error":
        raise HTTPException(status_code=422, detail=job["error"])
    return job


@app.post("/reference-swings", status_code=201)
def upload_reference_swing(
    video: UploadFile = File(...),
    view: Literal["face_on", "down_the_line"] = Form(...),
    handedness: Literal["right", "left"] = Form(...),
):
    ext = os.path.splitext(video.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=422,
            detail="video must be one of: mp4, mov, webm",
        )
    try:
        return create_entry(video.file, video.filename or f"upload{ext}", view, handedness)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/reference-swings")
def get_reference_swings():
    return list_entries()


@app.delete("/reference-swings/{entry_id}")
def remove_reference_swing(entry_id: str):
    result = delete_entry(entry_id)
    if result is None:
        raise HTTPException(status_code=404, detail="reference swing not found")
    return result


@app.get("/reference-swings/{entry_id}/video")
def get_reference_swing_video(entry_id: str):
    path = get_entry_video_path(entry_id)
    if path is None:
        raise HTTPException(status_code=404, detail="reference swing not found")
    media_type = EXT_MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream")
    return FileResponse(path, media_type=media_type)


@app.get("/reference-swings/{entry_id}/analysis")
def get_reference_swing_analysis(entry_id: str):
    analysis = get_entry_analysis(entry_id)
    if analysis is None:
        raise HTTPException(status_code=404, detail="reference swing not found")
    return analysis


@app.post("/reference-swings/{entry_id}/samples")
def post_reference_swing_samples(entry_id: str, body: SamplesRequest):
    result = save_samples(entry_id, [s.model_dump() for s in body.samples])
    if result is None:
        raise HTTPException(status_code=404, detail="reference swing not found")
    return result


@app.get("/benchmarks")
def get_benchmarks_table():
    return get_benchmarks()


@app.get("/swings")
def get_swings():
    """Every analyzed swing, newest first, with the total disk they occupy —
    swings are kept indefinitely by design, so the UI shows the growth."""
    return {"swings": list_swings(), "totalBytes": total_bytes()}


@app.get("/swings/{swing_id}/analysis")
def get_swing_analysis_route(swing_id: str):
    analysis = get_swing_analysis(swing_id)
    if analysis is None:
        raise HTTPException(status_code=404, detail="swing not found")
    return analysis


@app.get("/swings/{swing_id}/video")
def get_swing_video(swing_id: str):
    path = get_swing_video_path(swing_id)
    if path is None:
        raise HTTPException(status_code=404, detail="swing not found")
    media_type = EXT_MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream")
    return FileResponse(path, media_type=media_type)


@app.post("/swings/{swing_id}/summary")
def post_swing_summary(swing_id: str, body: SummaryIn):
    """Stores the frontend's computed scores for a swing. Scoring lives in the
    frontend, so this endpoint only persists what it's given."""
    result = save_summary(swing_id, body.model_dump())
    if result is None:
        raise HTTPException(status_code=404, detail="swing not found")
    return result


@app.patch("/swings/{swing_id}")
def patch_swing(swing_id: str, body: LabelRequest):
    result = set_label(swing_id, body.label)
    if result is None:
        raise HTTPException(status_code=404, detail="swing not found")
    return result


@app.delete("/swings/{swing_id}")
def remove_swing(swing_id: str):
    if not delete_swing(swing_id):
        raise HTTPException(status_code=404, detail="swing not found")
    return {"totalBytes": total_bytes()}
