import os
import shutil
import tempfile
import threading
from typing import Literal

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

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


class SampleIn(BaseModel):
    phase: Literal["address", "takeaway", "top", "downswing", "impact", "followThrough"]
    metric: Literal["spineTilt", "shoulderTurn", "hipTurn", "xFactor", "planeAngle", "spineRetention"]
    value: float


class SamplesRequest(BaseModel):
    samples: list[SampleIn]

app = FastAPI(title="Golf Swing Pose Extraction")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _run_analyze_job(
    job_id: str,
    tmp_path: str,
    view: str,
    handedness: str,
    quality: str,
) -> None:
    try:
        result = analyze_video(
            tmp_path,
            quality=quality,
            on_progress=lambda index, total: set_progress(
                job_id, min(99.0, index / total * 100) if total > 0 else 0.0
            ),
        )
        set_done(
            job_id,
            {
                "fps": result["fps"],
                "width": result["width"],
                "height": result["height"],
                "frame_count": result["frame_count"],
                "view": view,
                "handedness": handedness,
                "quality": quality,
                "frames": result["frames"],
            },
        )
    except ValueError as exc:
        set_error(job_id, str(exc))
    finally:
        os.unlink(tmp_path)


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
    """
    ext = os.path.splitext(video.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=422,
            detail="video must be one of: mp4, mov, webm",
        )

    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        shutil.copyfileobj(video.file, tmp)
        tmp_path = tmp.name

    job_id = create_job()
    threading.Thread(
        target=_run_analyze_job,
        args=(job_id, tmp_path, view, handedness, quality),
        daemon=True,
    ).start()
    return {"job_id": job_id}


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
