"""Per-frame golf ball detection via a locally-trained YOLOv8n model.

Same detect-per-frame shape as app/club.py, for the same reason: a tracker
carrying state through a fast-moving, motion-blurred ball is fragile, while a
detector just reports "found at (x, y)" or "not found" independently each
frame (gaps get bridged downstream, see stats.ts's fastestAdjacentPair). The
ball is only ever a meaningful target for a short window after impact —
there's no need to track it through the whole swing the way the clubhead is.

Requires backend/app/models/ball.pt (a YOLOv8n model trained offline — see
backend/training/train_ball.py, mirroring train_clubhead.py). If that file
doesn't exist yet, detect_ball always returns None so pose extraction still
works without it.
"""

from functools import lru_cache
from pathlib import Path
from typing import Any

MODEL_PATH = Path(__file__).resolve().parent / "models" / "ball.pt"
CONFIDENCE_THRESHOLD = 0.25


@lru_cache(maxsize=1)
def _load_model() -> Any | None:
    if not MODEL_PATH.exists():
        return None
    from ultralytics import YOLO

    return YOLO(str(MODEL_PATH))


def detect_ball(frame_bgr: Any) -> dict[str, float] | None:
    """Highest-confidence ball detection in this frame as a normalized [0,1]
    {"x", "y"} box center, or None if no model is installed or nothing scored
    above CONFIDENCE_THRESHOLD.

    Unlike detect_club, there's no hand-anchored tip/center distinction here
    — a ball has no orientation, so the box center is the whole answer.
    """
    model = _load_model()
    if model is None:
        return None

    height, width = frame_bgr.shape[:2]
    results = model.predict(frame_bgr, verbose=False)

    best_confidence = CONFIDENCE_THRESHOLD
    best_box: tuple[float, float, float, float] | None = None
    for result in results:
        for box in result.boxes:
            confidence = float(box.conf[0])
            if confidence <= best_confidence:
                continue
            best_confidence = confidence
            best_box = tuple(box.xyxy[0].tolist())

    if best_box is None:
        return None

    x1, y1, x2, y2 = best_box
    return {"x": (x1 + x2) / 2 / width, "y": (y1 + y2) / 2 / height}
