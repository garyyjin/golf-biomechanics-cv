from unittest.mock import patch

import cv2
import numpy as np
import pytest

from app.pose import _detect_club_tip, _rotation_code, analyze_video


def _landmark(x, y, visibility=1.0):
    return {"x": x, "y": y, "z": 0.0, "visibility": visibility}


def test_rotation_code_maps_known_angles():
    assert _rotation_code(0) is None
    assert _rotation_code(90) == cv2.ROTATE_90_CLOCKWISE
    assert _rotation_code(180) == cv2.ROTATE_180
    assert _rotation_code(270) == cv2.ROTATE_90_COUNTERCLOCKWISE


def test_rotation_code_handles_negative_and_out_of_range_angles():
    assert _rotation_code(-90) == cv2.ROTATE_90_COUNTERCLOCKWISE  # -90 % 360 == 270
    assert _rotation_code(360) is None
    assert _rotation_code(450) == cv2.ROTATE_90_CLOCKWISE  # 450 % 360 == 90


def test_rotation_code_falls_back_to_none_for_unrecognized_angle():
    assert _rotation_code(45) is None


def test_analyze_video_pins_ffmpeg_backend(sample_video):
    with patch("app.pose.cv2.VideoCapture", wraps=cv2.VideoCapture) as spy:
        analyze_video(str(sample_video))
        assert spy.call_args.args[1] == cv2.CAP_FFMPEG


def test_analyze_video_includes_club_tip_key(sample_video):
    result = analyze_video(str(sample_video))
    # sample_video has no person in it, so landmarks (and therefore club_tip,
    # which needs hand landmarks to anchor its search) are None throughout —
    # this just confirms the key always exists in the frame shape.
    assert all("club_tip" in f for f in result["frames"])
    assert all(f["club_tip"] is None for f in result["frames"])


def test_detect_club_tip_finds_a_drawn_line_from_the_hands():
    width = height = 200
    frame = np.full((height, width, 3), 255, dtype=np.uint8)
    cv2.line(frame, (100, 150), (100, 50), (0, 0, 0), 3)

    landmarks = [_landmark(0.0, 0.0)] * 33
    landmarks[11] = _landmark(80 / width, 100 / height)  # left shoulder
    landmarks[12] = _landmark(120 / width, 100 / height)  # right shoulder
    landmarks[15] = _landmark(95 / width, 150 / height)  # left wrist
    landmarks[16] = _landmark(105 / width, 150 / height)  # right wrist
    landmarks[19] = _landmark(95 / width, 140 / height)  # left index knuckle
    landmarks[20] = _landmark(105 / width, 140 / height)  # right index knuckle

    result = _detect_club_tip(frame, landmarks, width, height)
    assert result is not None
    assert result["x"] == pytest.approx(100 / width, abs=0.05)
    assert result["y"] == pytest.approx(50 / height, abs=0.05)


def test_detect_club_tip_ignores_a_line_misaligned_with_hand_orientation():
    width = height = 200
    frame = np.full((height, width, 3), 255, dtype=np.uint8)
    # A horizontal line near the hands, but the hand-orientation prior below
    # points straight up — this line should be rejected as background/noise.
    cv2.line(frame, (100, 150), (10, 150), (0, 0, 0), 3)

    landmarks = [_landmark(0.0, 0.0)] * 33
    landmarks[11] = _landmark(80 / width, 100 / height)
    landmarks[12] = _landmark(120 / width, 100 / height)
    landmarks[15] = _landmark(95 / width, 150 / height)
    landmarks[16] = _landmark(105 / width, 150 / height)
    landmarks[19] = _landmark(95 / width, 140 / height)
    landmarks[20] = _landmark(105 / width, 140 / height)

    assert _detect_club_tip(frame, landmarks, width, height) is None


def test_detect_club_tip_returns_none_when_hands_not_visible():
    width = height = 200
    frame = np.full((height, width, 3), 255, dtype=np.uint8)
    landmarks = [_landmark(0.5, 0.5, visibility=0.1)] * 33
    assert _detect_club_tip(frame, landmarks, width, height) is None
