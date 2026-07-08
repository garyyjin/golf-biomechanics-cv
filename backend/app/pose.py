"""Per-frame pose extraction with MediaPipe Pose (raw landmarks, no smoothing)."""

import logging

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


def _rotation_code(degrees: float) -> int | None:
    """Map a CAP_PROP_ORIENTATION_META angle to a cv2.rotate() code, or None."""
    return _ROTATE_CODES.get(int(round(degrees)) % 360)


def analyze_video(path: str, quality: str = "fast") -> dict:
    """Decode a video frame-by-frame and extract 33 pose landmarks per frame.

    Returns {fps, width, height, frame_count, frames}; frames with no detected
    pose get landmarks=None. Raises ValueError if the file cannot be decoded.
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
            frames.append({"index": index, "t": index / fps, "landmarks": landmarks})
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
