from unittest.mock import patch

import cv2

from app.pose import _rotation_code, analyze_video


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
