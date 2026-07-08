import os
import shutil
import tempfile
from typing import Literal

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app.pose import analyze_video

ALLOWED_EXTENSIONS = {".mp4", ".mov", ".webm"}

app = FastAPI(title="Golf Swing Pose Extraction")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/analyze")
def analyze(
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

    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        shutil.copyfileobj(video.file, tmp)
        tmp_path = tmp.name
    try:
        result = analyze_video(tmp_path)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        os.unlink(tmp_path)

    return {
        "fps": result["fps"],
        "width": result["width"],
        "height": result["height"],
        "frame_count": result["frame_count"],
        "view": view,
        "handedness": handedness,
        "frames": result["frames"],
    }
