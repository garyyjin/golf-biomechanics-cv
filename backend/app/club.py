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
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

MODEL_PATH = Path(__file__).resolve().parent / "models" / "clubhead.pt"
CONFIDENCE_THRESHOLD = 0.25

# Torch defaults to one thread per core, which badly oversubscribes a single
# 640px input: measured on a 16-thread machine, one detection takes ~36 ms with
# four threads but ~75-88 ms with sixteen. Four is also what leaves the rest of
# the cores to the pose workers in app/pose.py.
_TORCH_THREADS = 4


@lru_cache(maxsize=1)
def _load_model() -> Any | None:
    if not MODEL_PATH.exists():
        return None
    import torch
    from ultralytics import YOLO

    torch.set_num_threads(max(1, min(_TORCH_THREADS, os.cpu_count() or 1)))
    return YOLO(str(MODEL_PATH))


def _tip_from_box(
    box: tuple[float, float, float, float],
    hand_point: tuple[float, float] | None,
) -> tuple[float, float]:
    """Pixel-space clubhead tip: the far edge of the box along the direction
    it sits from the grip.

    Taking the box *corner* farthest from the hand looks equivalent but is
    not: as the shaft swings, the farthest corner flips between the box's
    corners, so consecutive frames can report points a whole box diagonal
    apart even when the head barely moved -- visible as jitter in the tracer.
    The box's support point along the (continuous) hand-to-box direction
    moves smoothly with the swing instead, while still landing on the toe
    side of the head rather than its center. Falls back to the center when
    no hand position is available or the hand sits exactly on the center.
    """
    x1, y1, x2, y2 = box
    center_x, center_y = (x1 + x2) / 2, (y1 + y2) / 2
    if hand_point is None:
        return center_x, center_y
    hx, hy = hand_point
    dx, dy = center_x - hx, center_y - hy
    length = math.hypot(dx, dy)
    if length < 1e-6:
        return center_x, center_y
    ux, uy = dx / length, dy / length
    # Half the box's own extent along that direction (its support function).
    half_extent = 0.5 * (abs(ux) * (x2 - x1) + abs(uy) * (y2 - y1))
    return center_x + ux * half_extent, center_y + uy * half_extent


def detect_club(
    frame_bgr: Any, hand_point: tuple[float, float] | None = None
) -> dict[str, float] | None:
    """Highest-confidence clubhead detection in this frame as a normalized
    [0,1] {"x", "y"}, or None if no model is installed or nothing scored
    above CONFIDENCE_THRESHOLD.

    hand_point, if given, is the pixel-space (x, y) of the golfer's grip
    (see pose.py's wrist selection) — the detection is projected onto the far
    edge of its box (see _tip_from_box) so the returned point sits on the end
    of the clubhead that actually strikes the ball, not its center. Falls back
    to the box center when no hand position is available (e.g. no pose
    landmarks this frame).
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

    point_x, point_y = _tip_from_box(best_box, hand_point)
    return {"x": point_x / width, "y": point_y / height}
