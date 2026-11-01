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

# Inference size passed to ultralytics (which letterboxes to a square).
# Deliberately the model's trained 640: dropping it makes each pass cheaper
# but starts costing small/distant clubhead detections, and the clubhead is
# the one thing this model exists to find.
IMG_SIZE = 640

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


def _best_box(result: Any) -> tuple[float, float, float, float] | None:
    """Highest-confidence xyxy box in one frame's result, or None."""
    best_confidence = CONFIDENCE_THRESHOLD
    best_box: tuple[float, float, float, float] | None = None
    for box in result.boxes:
        confidence = float(box.conf[0])
        if confidence <= best_confidence:
            continue
        best_confidence = confidence
        best_box = tuple(box.xyxy[0].tolist())
    return best_box


def detect_club_batch(
    frames_bgr: list[Any], hand_points: list[tuple[float, float] | None] | None = None
) -> list[dict[str, float] | None]:
    """Clubhead detection for a batch of frames, one result per frame.

    Batched rather than one frame per call because a YOLOv8n forward pass at
    640px is dominated by per-call overhead, not by the image: on real footage
    one frame per call measures ~64 ms, while a batch of eight measures ~24 ms
    per frame — and the detections agree exactly with the single-frame path
    (verified across 24 frames), so this is free speed rather than a tradeoff
    against accuracy. Extra torch threads, or several model instances aimed at
    the same frames, buy nothing: the pass is CPU-bound and saturates at that
    ~24 ms figure.

    hand_points, if given, is one pixel-space grip position per frame (see
    pose.py's wrist selection), used to project each box onto the far edge
    of the clubhead (see _tip_from_box). Entries may be None for frames with
    no pose, which falls back to the box center.
    """
    model = _load_model()
    if model is None or not frames_bgr:
        return [None] * len(frames_bgr)

    if hand_points is None:
        hand_points = [None] * len(frames_bgr)

    height, width = frames_bgr[0].shape[:2]
    results = model.predict(list(frames_bgr), imgsz=IMG_SIZE, verbose=False)

    detections: list[dict[str, float] | None] = []
    for result, hand_point in zip(results, hand_points):
        best_box = _best_box(result)
        if best_box is None:
            detections.append(None)
            continue
        point_x, point_y = _tip_from_box(best_box, hand_point)
        detections.append({"x": point_x / width, "y": point_y / height})
    return detections


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

    Single-frame convenience wrapper over detect_club_batch; callers working
    through a clip should use the batch form, which is far cheaper per frame.
    """
    return detect_club_batch([frame_bgr], [hand_point])[0]
