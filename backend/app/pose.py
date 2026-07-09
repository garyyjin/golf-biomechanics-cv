"""Per-frame pose extraction with MediaPipe Pose (raw landmarks, no smoothing)."""

import logging
import math

import cv2
import mediapipe as mp

logger = logging.getLogger(__name__)

# model_complexity: 1 ("fast") vs 2 ("accurate", MediaPipe's heaviest model).
_MODEL_COMPLEXITY = {"fast": 1, "accurate": 2}

_ROTATE_CODES = {
    90: cv2.ROTATE_90_CLOCKWISE,
    180: cv2.ROTATE_180,
    270: cv2.ROTATE_90_COUNTERCLOCKWISE,
}

# MediaPipe Pose landmark indices (mirrors geometry.ts's constants).
_LEFT_SHOULDER, _RIGHT_SHOULDER = 11, 12
_LEFT_WRIST, _RIGHT_WRIST = 15, 16
_LEFT_INDEX, _RIGHT_INDEX = 19, 20
_VISIBILITY_THRESHOLD = 0.5


def _rotation_code(degrees: float) -> int | None:
    """Map a CAP_PROP_ORIENTATION_META angle to a cv2.rotate() code, or None."""
    return _ROTATE_CODES.get(int(round(degrees)) % 360)


def _detect_club_tip(frame, landmarks: list[dict], width: int, height: int) -> dict | None:
    """Approximates the club-head pixel position with a Hough line detection
    anchored near the hands, rather than inferring it purely from body pose.

    MediaPipe has no club/shaft detection, so this looks for a real straight
    edge in the pixels: golf shafts are thin, high-contrast lines originating
    at the hands. A generous ROI around the hands (sized off shoulder width,
    a stable scale reference) is searched with Canny + probabilistic Hough
    transform; candidate segments are required to have one endpoint near the
    hands and to be reasonably aligned with the wrist-to-knuckle direction
    (the same hand-orientation prior geometry.ts's clubTipEstimate uses) —
    that alignment check is what rejects sleeve/arm/background edges instead
    of picking whatever line happens to be nearby.

    Returns None (the frontend then falls back to the body-pose estimate)
    when hands aren't visible or no confident line is found — motion blur,
    low contrast, and an occluded club are all realistic failure modes for a
    technique built on visible edges rather than a trained detector.
    """
    lw, rw = landmarks[_LEFT_WRIST], landmarks[_RIGHT_WRIST]
    li, ri = landmarks[_LEFT_INDEX], landmarks[_RIGHT_INDEX]
    ls, rs = landmarks[_LEFT_SHOULDER], landmarks[_RIGHT_SHOULDER]
    if min(
        lw["visibility"], rw["visibility"], li["visibility"], ri["visibility"],
        ls["visibility"], rs["visibility"],
    ) < _VISIBILITY_THRESHOLD:
        return None

    hands_x = (lw["x"] + rw["x"]) / 2 * width
    hands_y = (lw["y"] + rw["y"]) / 2 * height
    knuckle_x = (li["x"] + ri["x"]) / 2 * width
    knuckle_y = (li["y"] + ri["y"]) / 2 * height
    prior_len = math.hypot(knuckle_x - hands_x, knuckle_y - hands_y)
    if prior_len < 1e-6:
        return None
    prior_dx, prior_dy = (knuckle_x - hands_x) / prior_len, (knuckle_y - hands_y) / prior_len

    shoulder_width = math.hypot((ls["x"] - rs["x"]) * width, (ls["y"] - rs["y"]) * height)
    if shoulder_width < 1:
        return None
    radius = shoulder_width * 3.2

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


def analyze_video(path: str, quality: str = "fast") -> dict:
    """Decode a video frame-by-frame and extract 33 pose landmarks per frame.

    Returns {fps, width, height, frame_count, frames}; frames with no detected
    pose get landmarks=None. Each frame also carries club_tip — a
    {x, y} normalized point from Hough-line detection anchored on the hands
    (see _detect_club_tip), or None when no confident line was found (a
    frame with no landmarks always has club_tip=None too, since detection
    needs the hand landmarks to anchor its search). Raises ValueError if the
    file cannot be decoded.
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

    frames = []
    # smooth_landmarks=False: the API smooths by default, but downstream
    # consumers need raw per-frame values.
    # min_detection_confidence left at the MediaPipe default (0.5): raising it
    # would drop more landmarks on fast, motion-blurred downswing/impact
    # frames, which is exactly where accuracy matters most. min_tracking_confidence
    # is raised so the tracker falls back to full re-detection instead of
    # extrapolating from a degrading track — the usual failure mode on fast
    # sports motion.
    with mp.solutions.pose.Pose(
        static_image_mode=False,
        model_complexity=_MODEL_COMPLEXITY.get(quality, 1),
        smooth_landmarks=False,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.7,
    ) as pose:
        index = 0
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            if rotate_code is not None:
                frame = cv2.rotate(frame, rotate_code)
            if index == 0:
                # Dimensions from the decoded (and now rotated) frame, not
                # container props — props can disagree with the delivered
                # orientation.
                height, width = frame.shape[:2]
            result = pose.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            landmarks = None
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
            frames.append({"index": index, "t": index / fps, "landmarks": landmarks, "club_tip": club_tip})
            index += 1

    capture.release()

    if not frames:
        raise ValueError("could not decode video")

    return {
        "fps": fps,
        "width": width,
        "height": height,
        "frame_count": len(frames),
        "frames": frames,
    }
