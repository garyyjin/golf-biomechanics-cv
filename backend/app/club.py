"""Per-frame golf clubhead detection via a locally-trained YOLOv8n model.

Deliberately per-frame detection, not frame-to-frame tracking: earlier
classical-CV attempts (Hough-line shaft detection, Lucas-Kanade optical flow,
multi-anchor tracking) all failed because a tracker has to carry state
through motion-blurred downswing frames, and either loses the target or
silently locks onto a static background feature while still reporting
"success". A detector just reports "found at (x, y)" or "not found" for each
frame independently — gaps get bridged by interpolation downstream (see
phases.ts's interpolateGaps for the same pattern applied to phase detection)
rather than by a tracker guessing through the blur.

Requires backend/app/models/clubhead.pt (a YOLOv8n model trained offline —
see backend/training/train_clubhead.py). If that file doesn't exist yet,
detect_club always returns None so pose extraction still works without it.
"""

from functools import lru_cache
from pathlib import Path
from typing import Any

MODEL_PATH = Path(__file__).resolve().parent / "models" / "clubhead.pt"
CONFIDENCE_THRESHOLD = 0.25


@lru_cache(maxsize=1)
def _load_model() -> Any | None:
    if not MODEL_PATH.exists():
        return None
    from ultralytics import YOLO

    return YOLO(str(MODEL_PATH))


def detect_club(frame_bgr: Any) -> dict[str, float] | None:
    """Highest-confidence clubhead detection in this frame as normalized
    [0,1] {"x", "y"} (box center), or None if no model is installed or
    nothing scored above CONFIDENCE_THRESHOLD.
    """
    model = _load_model()
    if model is None:
        return None

    height, width = frame_bgr.shape[:2]
    results = model.predict(frame_bgr, verbose=False)

    best_confidence = CONFIDENCE_THRESHOLD
    best: dict[str, float] | None = None
    for result in results:
        for box in result.boxes:
            confidence = float(box.conf[0])
            if confidence <= best_confidence:
                continue
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            best_confidence = confidence
            best = {"x": (x1 + x2) / 2 / width, "y": (y1 + y2) / 2 / height}
    return best
