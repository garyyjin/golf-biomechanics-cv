"""Per-frame pose extraction with MediaPipe Pose (raw landmarks, no smoothing)."""

import logging
import math
import os
import queue
import threading
from collections.abc import Callable

import cv2
import mediapipe as mp

from app.ball import detect_ball
from app.club import detect_club

logger = logging.getLogger(__name__)

# model_complexity: 1 ("fast") vs 2 ("accurate", MediaPipe's heaviest model).
_MODEL_COMPLEXITY = {"fast": 1, "accurate": 2}

# Parallel pose extraction: one MediaPipe graph per worker, each fed its own
# frame. Four is deliberate — per-frame inference measures ~205 ms on one
# thread and ~74 ms with four, but gets *slower* past that (six: ~89 ms,
# eight: ~171 ms) because MediaPipe already runs its own internal pool and
# the extra threads just contend for the same cores.
_MAX_WORKERS = 4

# Sentinels passed through the worker queues: one marks a worker/decoder exit,
# the other carries an exception back to the collector thread.
_WORKER_DONE = object()
_ERROR = object()

_ROTATE_CODES = {
    90: cv2.ROTATE_90_CLOCKWISE,
    180: cv2.ROTATE_180,
    270: cv2.ROTATE_90_COUNTERCLOCKWISE,
}

# MediaPipe Pose landmark indices (mirrors geometry.ts's constants).
_LEFT_SHOULDER, _RIGHT_SHOULDER = 11, 12
_LEFT_HIP, _RIGHT_HIP = 23, 24
_LEFT_WRIST, _RIGHT_WRIST = 15, 16
_LEFT_INDEX, _RIGHT_INDEX = 19, 20
_VISIBILITY_THRESHOLD = 0.5


def _rotation_code(degrees: float) -> int | None:
    """Map a CAP_PROP_ORIENTATION_META angle to a cv2.rotate() code, or None."""
    return _ROTATE_CODES.get(int(round(degrees)) % 360)


def _hand_candidate(landmarks: list[dict], wrist_idx: int, index_idx: int) -> tuple[dict, dict, float] | None:
    """(wrist, index-knuckle, min-visibility) for one hand, or None if either
    landmark is below the visibility threshold."""
    wrist = landmarks[wrist_idx]
    index_lm = landmarks[index_idx]
    visibility = min(wrist["visibility"], index_lm["visibility"])
    if visibility < _VISIBILITY_THRESHOLD:
        return None
    return (wrist, index_lm, visibility)


def _wrist_point(landmarks: list[dict], width: int, height: int) -> tuple[float, float] | None:
    """Pixel-space position of whichever wrist is more visible, for anchoring
    the YOLO clubhead detection's tip-vs-center choice (see app/club.py) —
    same "pick the more visible hand" policy as _detect_club_tip below."""
    candidates = [
        c
        for c in (
            _hand_candidate(landmarks, _LEFT_WRIST, _LEFT_INDEX),
            _hand_candidate(landmarks, _RIGHT_WRIST, _RIGHT_INDEX),
        )
        if c is not None
    ]
    if not candidates:
        return None
    wrist, _, _ = max(candidates, key=lambda c: c[2])
    return (wrist["x"] * width, wrist["y"] * height)


def _detect_club_tip(frame, landmarks: list[dict], width: int, height: int) -> dict | None:
    """Approximates the club-head pixel position with a Hough line detection
    anchored near the hands, rather than inferring it purely from body pose.

    MediaPipe has no club/shaft detection, so this looks for a real straight
    edge in the pixels: golf shafts are thin, high-contrast lines originating
    at the hands. A generous ROI around the hands (sized off torso length, a
    scale reference that stays roughly stable regardless of camera angle —
    shoulder *width* was tried first but collapses badly in a down-the-line
    view, where the shoulders are seen almost edge-on) is searched with
    Canny + probabilistic Hough transform; candidate segments are required
    to have one endpoint near the hands and to be reasonably aligned with
    the wrist-to-knuckle direction (the same hand-orientation prior
    geometry.ts's clubTipEstimate uses) — that alignment check is what
    rejects sleeve/arm/background edges instead of picking whatever line
    happens to be nearby.

    Anchors on whichever hand is actually visible rather than requiring
    both: in anything close to a profile view (down-the-line especially),
    one hand is very often occluded by the other or by the body, and
    requiring both left this detecting almost nothing on real down-the-line
    footage even though the visible hand alone is enough to anchor a search.

    Returns None (the frontend then falls back to the body-pose estimate)
    when neither hand is visible or no confident line is found — motion
    blur, low contrast, and an occluded club are all realistic failure modes
    for a technique built on visible edges rather than a trained detector.
    """
    ls, rs = landmarks[_LEFT_SHOULDER], landmarks[_RIGHT_SHOULDER]
    if min(ls["visibility"], rs["visibility"]) < _VISIBILITY_THRESHOLD:
        return None

    candidates = [
        c
        for c in (
            _hand_candidate(landmarks, _LEFT_WRIST, _LEFT_INDEX),
            _hand_candidate(landmarks, _RIGHT_WRIST, _RIGHT_INDEX),
        )
        if c is not None
    ]
    if not candidates:
        return None
    wrist, index_lm, _ = max(candidates, key=lambda c: c[2])

    hands_x, hands_y = wrist["x"] * width, wrist["y"] * height
    knuckle_x, knuckle_y = index_lm["x"] * width, index_lm["y"] * height
    prior_len = math.hypot(knuckle_x - hands_x, knuckle_y - hands_y)
    if prior_len < 1e-6:
        return None
    prior_dx, prior_dy = (knuckle_x - hands_x) / prior_len, (knuckle_y - hands_y) / prior_len

    lh, rh = landmarks[_LEFT_HIP], landmarks[_RIGHT_HIP]
    shoulder_mid = ((ls["x"] + rs["x"]) / 2 * width, (ls["y"] + rs["y"]) / 2 * height)
    hip_mid = ((lh["x"] + rh["x"]) / 2 * width, (lh["y"] + rh["y"]) / 2 * height)
    torso_length = math.hypot(shoulder_mid[0] - hip_mid[0], shoulder_mid[1] - hip_mid[1])
    if torso_length < 1:
        return None
    radius = torso_length * 2.0

    x0, y0 = max(0, int(hands_x - radius)), max(0, int(hands_y - radius))
    x1, y1 = min(width, int(hands_x + radius)), min(height, int(hands_y + radius))
    if x1 - x0 < 10 or y1 - y0 < 10:
        return None

    roi = frame[y0:y1, x0:x1]
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 50, 150)
    lines = cv2.HoughLinesP(
        edges,
        rho=1,
        theta=math.pi / 180,
        threshold=25,
        minLineLength=max(10, int(radius * 0.18)),
        maxLineGap=max(4, int(radius * 0.04)),
    )
    if lines is None:
        return None

    near_radius = radius * 0.4
    best_point = None
    best_score = -math.inf
    for line in lines:
        lx1, ly1, lx2, ly2 = line[0]
        p1 = (lx1 + x0, ly1 + y0)
        p2 = (lx2 + x0, ly2 + y0)
        d1 = math.hypot(p1[0] - hands_x, p1[1] - hands_y)
        d2 = math.hypot(p2[0] - hands_x, p2[1] - hands_y)
        near, far = (p1, p2) if d1 <= d2 else (p2, p1)
        if min(d1, d2) > near_radius:
            continue

        seg_len = math.hypot(far[0] - near[0], far[1] - near[1])
        if seg_len < 1e-6:
            continue
        seg_dx, seg_dy = (far[0] - near[0]) / seg_len, (far[1] - near[1]) / seg_len
        alignment = seg_dx * prior_dx + seg_dy * prior_dy
        if alignment < 0.3:  # reject lines pointing away from the hand-orientation prior
            continue

        score = seg_len * alignment
        if score > best_score:
            best_score = score
            best_point = far

    if best_point is None:
        return None
    return {"x": best_point[0] / width, "y": best_point[1] / height}


def _make_pose(quality: str):
    # smooth_landmarks=False: the API smooths by default, but downstream
    # consumers need raw per-frame values.
    # min_detection_confidence left at the MediaPipe default (0.5): raising it
    # would drop more landmarks on fast, motion-blurred downswing/impact
    # frames, which is exactly where accuracy matters most. min_tracking_confidence
    # is raised so the tracker falls back to full re-detection instead of
    # extrapolating from a degrading track — the usual failure mode on fast
    # sports motion.
    return mp.solutions.pose.Pose(
        static_image_mode=False,
        model_complexity=_MODEL_COMPLEXITY.get(quality, 1),
        smooth_landmarks=False,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.7,
    )


def _extract_pose(pose, frame, index: int, fps: float, width: int, height: int) -> dict:
    """Pose landmarks (+ world landmarks) and the Hough club tip for one
    frame. Everything here depends only on this frame, so it is safe to run
    on a worker thread with its own MediaPipe graph."""
    result = pose.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    landmarks = None
    world_landmarks = None
    club_tip = None
    if result.pose_landmarks is not None:
        landmarks = [
            {
                "x": lm.x,
                "y": lm.y,
                "z": lm.z,
                "visibility": lm.visibility,
            }
            for lm in result.pose_landmarks.landmark
        ]
        club_tip = _detect_club_tip(frame, landmarks, width, height)
        if result.pose_world_landmarks is not None:
            world_landmarks = [
                {"x": lm.x, "y": lm.y, "z": lm.z}
                for lm in result.pose_world_landmarks.landmark
            ]
    return {
        "index": index,
        "t": index / fps,
        "landmarks": landmarks,
        "world_landmarks": world_landmarks,
        "club_tip": club_tip,
        "club_tip_yolo": None,
        "ball_tip": None,
    }


def _attach_detectors(record: dict, frame, width: int, height: int) -> dict:
    """Add the two YOLO readings to a finished pose record.

    Kept off the pose workers on purpose: the club anchor needs the wrist
    from this frame's landmarks, and the YOLO models are a single shared
    Torch graph that isn't safe to call from several threads at once. One
    collector thread therefore runs both detectors in index order.
    """
    landmarks = record["landmarks"]
    hand_point = _wrist_point(landmarks, width, height) if landmarks is not None else None
    record["club_tip_yolo"] = detect_club(frame, hand_point)
    record["ball_tip"] = detect_ball(frame)
    return record


def _worker_count() -> int:
    return max(1, min(_MAX_WORKERS, os.cpu_count() or 1))


def _read_rotated(capture, rotate_code):
    """Next frame, already in the orientation a browser would render, or
    None at end of stream."""
    ok, frame = capture.read()
    if not ok:
        return None
    if rotate_code is not None:
        frame = cv2.rotate(frame, rotate_code)
    return frame


def _analyze_sequential(
    capture, first_frame, rotate_code, quality, fps, width, height, total_frames, on_progress
) -> list[dict]:
    """Single-threaded fallback for machines with one usable core."""
    frames = []
    index = 0
    with _make_pose(quality) as pose:
        frame = first_frame
        while frame is not None:
            record = _extract_pose(pose, frame, index, fps, width, height)
            frames.append(_attach_detectors(record, frame, width, height))
            index += 1
            if on_progress is not None:
                on_progress(index, total_frames)
            frame = _read_rotated(capture, rotate_code)
    return frames


def _analyze_parallel(
    path, quality, fps, width, height, total_frames, on_progress, workers, rotate_code
) -> list[dict]:
    """Run pose on a small pool of frames, with the detectors on this thread.

    Each worker takes a *contiguous* slice of the clip and decodes it with its
    own capture, rather than being handed every Nth frame: MediaPipe's video
    mode carries a tracker between calls, and feeding one tracker frames four
    apart measurably corrupts it — on a test clip it produced a landmark jump
    of 60% of the frame width mid-swing, which would wreck impact detection.
    Consecutive frames per worker keep each tracker's history intact.

    The split follows what each stage costs on a 1080x1920 clip: pose is
    ~205 ms/frame and parallelises well, while the YOLO detections are ~36 ms
    and must stay on one thread anyway (a single shared Torch graph, plus they
    need this frame's wrist landmarks as an anchor). They run here as records
    come back. A bounded results queue keeps only a handful of decoded frames
    alive at once, and records are re-ordered here so `frames` and on_progress
    stay strictly in index order regardless of which worker finished first.
    """
    chunk = max(1, math.ceil(total_frames / workers))
    results: queue.Queue = queue.Queue(maxsize=workers * 2)
    aborted = threading.Event()

    def work(worker_index: int) -> None:
        pose = None
        capture = None
        start = worker_index * chunk
        # The last worker reads to end-of-stream rather than to the reported
        # frame count: containers that under-report it would otherwise leave
        # the tail of the clip unanalysed.
        end = None if worker_index == workers - 1 else (worker_index + 1) * chunk
        try:
            # Inside the try: a graph or decoder that fails must still report
            # back, or the collector would wait on this worker forever.
            pose = _make_pose(quality)
            capture = cv2.VideoCapture(path, cv2.CAP_FFMPEG)
            if not capture.isOpened():
                raise ValueError("could not decode video")
            # Every worker decodes from the start and skips to its slice.
            # Seeking would be faster but CAP_PROP_POS_FRAMES is unreliable
            # across codecs, and a few frames of drift would mislabel every
            # timestamp in the slice.
            index = 0
            while index < start and not aborted.is_set():
                if not capture.grab():
                    break
                index += 1
            while (end is None or index < end) and not aborted.is_set():
                ok, frame = capture.read()
                if not ok:
                    break
                if rotate_code is not None:
                    frame = cv2.rotate(frame, rotate_code)
                record = _extract_pose(pose, frame, index, fps, width, height)
                # Bounded put, so a worker that runs ahead of the collector
                # can't pile decoded frames up in memory.
                while not aborted.is_set():
                    try:
                        results.put((index, record, frame), timeout=0.1)
                        break
                    except queue.Full:
                        continue
                index += 1
        except BaseException as exc:
            aborted.set()
            results.put((_ERROR, exc, None))
        finally:
            if capture is not None:
                capture.release()
            if pose is not None:
                pose.close()
            results.put(_WORKER_DONE)

    pool = [
        threading.Thread(target=work, args=(i,), name=f"pose-worker-{i}", daemon=True)
        for i in range(workers)
    ]
    for thread in pool:
        thread.start()

    frames: list[dict] = []
    order: dict[int, dict] = {}
    next_index = 0
    finished_workers = 0
    error: BaseException | None = None
    while finished_workers < workers:
        item = results.get()
        if item is _WORKER_DONE:
            finished_workers += 1
            continue
        key, payload, frame = item
        if key is _ERROR:
            error = error or payload
            continue
        index = key
        _attach_detectors(payload, frame, width, height)
        order[index] = payload
        while next_index in order:
            frames.append(order.pop(next_index))
            next_index += 1
            if on_progress is not None:
                on_progress(next_index, total_frames)

    for thread in pool:
        thread.join()

    if error is not None:
        raise error
    return frames


def analyze_video(
    path: str,
    quality: str = "fast",
    on_progress: Callable[[int, int], None] | None = None,
) -> dict:
    """Decode a video frame-by-frame and extract 33 pose landmarks per frame.

    Returns {fps, width, height, frame_count, frames}; frames with no detected
    pose get landmarks=None. Each frame also carries club_tip — a
    {x, y} normalized point from Hough-line detection anchored on the hands
    (see _detect_club_tip), or None when no confident line was found (a
    frame with no landmarks always has club_tip=None too, since detection
    needs the hand landmarks to anchor its search).

    Also carries club_tip_yolo — a {x, y} normalized point from a separate,
    still-experimental per-frame YOLOv8n clubhead detector (see app/club.py),
    trained (once weights exist) independently of the Hough-line approach
    above. Deliberately not reconciled with club_tip yet: this is additive
    data for evaluating the two approaches side by side, not a replacement.
    Always None until backend/app/models/clubhead.pt exists. When landmarks
    are available, the more-visible wrist is passed in as an anchor so
    detect_club can return the clubhead's tip (farthest box corner) rather
    than its center; with no landmarks this frame, it falls back to center.

    Also carries ball_tip — a {x, y, width, height} normalized ball box from
    a separate per-frame YOLOv8n ball detector (see app/ball.py), where
    width/height are the box's normalized size (the frontend uses these for
    distance calibration off the ball's known real diameter — see stats.ts's
    inchesPerNormalizedUnitFromBall). Always None until
    backend/app/models/ball.pt exists. Position is only meaningful around and
    after impact; the frontend (stats.ts) only ever searches for the ball's
    *position* there, though its *size* is scanned across the whole clip for
    calibration.

    Also carries world_landmarks — MediaPipe's metric 3D pose (33 points, in
    meters, origin at the mid-hip), or None when no pose was detected or the
    model didn't report one. Distinct from `landmarks`, which is 2D image
    normalized to [0,1]: world_landmarks is what lets the frontend measure
    rotation about the body's vertical axis without the foreshortening error
    a screen-space angle picks up whenever a turn points partly toward the
    camera.

    on_progress(current_index, total_frames), if given, is called after each
    frame is processed — total_frames comes from CAP_PROP_FRAME_COUNT, which
    OpenCV can misreport for some containers/codecs, so callers should treat
    it as a best-effort estimate (e.g. clamp progress below 100% until this
    function actually returns) rather than an exact count.

    Raises ValueError if the file cannot be decoded.
    """
    # Backend pinned explicitly: auto-selection (FFmpeg vs Media Foundation vs
    # DirectShow on Windows) is inconsistent about honoring rotation metadata,
    # which previously made rotation handling silently machine-dependent.
    capture = cv2.VideoCapture(path, cv2.CAP_FFMPEG)
    if not capture.isOpened():
        raise ValueError("could not decode video")

    # Rotation is applied manually per frame below rather than relying on
    # CAP_PROP_ORIENTATION_AUTO, whose backend support is inconsistent and
    # whose .set() return value can't be trusted. Browsers always render the
    # rotated orientation, so landmarks must be computed in that same
    # orientation.
    rotation_degrees = capture.get(cv2.CAP_PROP_ORIENTATION_META)
    rotate_code = _rotation_code(rotation_degrees)
    logger.info("rotation metadata: %s deg, rotate_code=%s", rotation_degrees, rotate_code)

    fps = capture.get(cv2.CAP_PROP_FPS)
    if not fps or fps <= 0:
        fps = 30.0
    width = 0
    height = 0
    total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)

    # Dimensions from the first decoded (and now rotated) frame, not container
    # props — props can disagree with the delivered orientation.
    first_frame = _read_rotated(capture, rotate_code)
    if first_frame is None:
        capture.release()
        raise ValueError("could not decode video")
    height, width = first_frame.shape[:2]

    workers = _worker_count()
    try:
        # A missing/zero frame count can't be sliced across workers, and one
        # core can't run them anyway.
        if workers == 1 or total_frames <= 0:
            frames = _analyze_sequential(
                capture, first_frame, rotate_code, quality, fps, width, height, total_frames, on_progress
            )
        else:
            frames = _analyze_parallel(
                path, quality, fps, width, height, total_frames, on_progress, workers, rotate_code
            )
    finally:
        capture.release()

    if not frames:
        raise ValueError("could not decode video")

    # Real-world detector hit-rate evidence, gathered on every analysis run
    # rather than only from the handful of fixtures under backend/data/ or
    # synthetic test videos -- see backend/training/diagnose_detectors.py for
    # a one-off tool that re-runs this against stored footage on demand.
    logger.info(
        "club/ball detection hit rates over %d frames: hough=%d yolo=%d ball=%d",
        len(frames),
        sum(1 for f in frames if f["club_tip"] is not None),
        sum(1 for f in frames if f["club_tip_yolo"] is not None),
        sum(1 for f in frames if f["ball_tip"] is not None),
    )

    return {
        "fps": fps,
        "width": width,
        "height": height,
        "frame_count": len(frames),
        "frames": frames,
    }
