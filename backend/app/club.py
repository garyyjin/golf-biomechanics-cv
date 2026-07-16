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

import math
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


def detect_club(
    frame_bgr: Any, hand_point: tuple[float, float] | None = None
) -> dict[str, float] | None:
    """Highest-confidence clubhead detection in this frame as a normalized
    [0,1] {"x", "y"}, or None if no model is installed or nothing scored
    above CONFIDENCE_THRESHOLD.

    hand_point, if given, is the pixel-space (x, y) of the golfer's grip
    (see pose.py's wrist selection) — the box corner farthest from it is
    returned as the clubhead tip (the toe, the end that actually strikes the
    ball) rather than the box center, which sits nearer the hosel/shaft side
    of a box that spans the whole clubhead. Falls back to the box center
    when no hand position is available (e.g. no pose landmarks this frame).
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
    if hand_point is None:
        point_x, point_y = (x1 + x2) / 2, (y1 + y2) / 2
    else:
        hx, hy = hand_point
        corners = [(x1, y1), (x2, y1), (x1, y2), (x2, y2)]
        point_x, point_y = max(corners, key=lambda c: math.hypot(c[0] - hx, c[1] - hy))
    return {"x": point_x / width, "y": point_y / height}
