"""Per-frame pose extraction with MediaPipe Pose (raw landmarks, no smoothing)."""

import cv2
import mediapipe as mp


def analyze_video(path: str) -> dict:
    """Decode a video frame-by-frame and extract 33 pose landmarks per frame.

    Returns {fps, width, height, frame_count, frames}; frames with no detected
    pose get landmarks=None. Raises ValueError if the file cannot be decoded.
    """
    capture = cv2.VideoCapture(path)
    if not capture.isOpened():
        raise ValueError("could not decode video")

    # Honor rotation metadata (phone-recorded portrait video is typically
    # stored landscape + a rotation tag). Browsers always render the rotated
    # orientation, so landmarks must be computed in that same orientation.
    capture.set(cv2.CAP_PROP_ORIENTATION_AUTO, 1)

    fps = capture.get(cv2.CAP_PROP_FPS)
    if not fps or fps <= 0:
        fps = 30.0
    width = 0
    height = 0

    frames = []
    # smooth_landmarks=False: the API smooths by default, but downstream
    # consumers need raw per-frame values.
    with mp.solutions.pose.Pose(
        static_image_mode=False,
        model_complexity=1,
        smooth_landmarks=False,
    ) as pose:
        index = 0
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            if index == 0:
                # Dimensions from the decoded frame, not container props —
                # props can disagree with the delivered orientation.
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
