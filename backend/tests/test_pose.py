from unittest.mock import patch

import cv2
import numpy as np
import pytest

from app.pose import _detect_club_tip, _rotation_code, analyze_video


def _landmark(x, y, visibility=1.0):
    return {"x": x, "y": y, "z": 0.0, "visibility": visibility}


def _base_landmarks(width, height):
    """Shoulders/hips/hands/knuckles positioned so the hand-orientation
    prior points straight up from (100, 150) — matches the line drawn by
    the tests below. Torso length (hip-to-shoulder) is 70px here, which
    sets the search radius (see _detect_club_tip).
    """
    landmarks = [_landmark(0.0, 0.0)] * 33
    landmarks[11] = _landmark(80 / width, 100 / height)  # left shoulder
    landmarks[12] = _landmark(120 / width, 100 / height)  # right shoulder
    landmarks[23] = _landmark(85 / width, 170 / height)  # left hip
    landmarks[24] = _landmark(115 / width, 170 / height)  # right hip
    landmarks[15] = _landmark(95 / width, 150 / height)  # left wrist
    landmarks[16] = _landmark(105 / width, 150 / height)  # right wrist
    landmarks[19] = _landmark(95 / width, 140 / height)  # left index knuckle
    landmarks[20] = _landmark(105 / width, 140 / height)  # right index knuckle
    return landmarks


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


def test_analyze_video_reports_progress(sample_video):
    calls = []
    analyze_video(str(sample_video), on_progress=lambda index, total: calls.append((index, total)))
    # sample_video has 10 frames; on_progress should fire once per frame,
    # with a strictly increasing index and a consistent total.
    assert len(calls) == 10
    assert [c[0] for c in calls] == list(range(1, 11))
    assert all(c[1] == calls[0][1] for c in calls)


def test_analyze_video_includes_club_tip_yolo_key(sample_video):
    result = analyze_video(str(sample_video))
    # Shape-only: club_tip_yolo is None with no clubhead.pt installed, but a
    # trained model may legitimately fire on some frames, so don't pin None.
    assert all("club_tip_yolo" in f for f in result["frames"])
    assert all(
        f["club_tip_yolo"] is None or set(f["club_tip_yolo"]) == {"x", "y"}
        for f in result["frames"]
    )


def test_detect_club_tip_finds_a_drawn_line_from_the_hands():
    width = height = 200
    frame = np.full((height, width, 3), 255, dtype=np.uint8)
    cv2.line(frame, (100, 150), (100, 50), (0, 0, 0), 3)

    result = _detect_club_tip(frame, _base_landmarks(width, height), width, height)
    assert result is not None
    assert result["x"] == pytest.approx(100 / width, abs=0.05)
    assert result["y"] == pytest.approx(50 / height, abs=0.05)


def test_detect_club_tip_ignores_a_line_misaligned_with_hand_orientation():
    width = height = 200
    frame = np.full((height, width, 3), 255, dtype=np.uint8)
    # A horizontal line near the hands, but the hand-orientation prior below
    # points straight up — this line should be rejected as background/noise.
    cv2.line(frame, (100, 150), (10, 150), (0, 0, 0), 3)

    assert _detect_club_tip(frame, _base_landmarks(width, height), width, height) is None


def test_detect_club_tip_falls_back_to_a_single_visible_hand():
    """Reproduces a real failure mode found against actual down-the-line
    footage: one hand is very often occluded by the other or by the body in
    anything close to a profile view, so requiring both hands to be visible
    made detection fail on the large majority of frames. The lead hand here
    is marked invisible (as MediaPipe reports it on real occluded frames);
    detection should still succeed off the trail hand alone."""
    width = height = 200
    frame = np.full((height, width, 3), 255, dtype=np.uint8)
    cv2.line(frame, (105, 150), (105, 50), (0, 0, 0), 3)

    landmarks = _base_landmarks(width, height)
    landmarks[15] = _landmark(95 / width, 150 / height, visibility=0.1)  # left wrist occluded
    landmarks[19] = _landmark(95 / width, 140 / height, visibility=0.1)  # left knuckle occluded

    result = _detect_club_tip(frame, landmarks, width, height)
    assert result is not None
    assert result["x"] == pytest.approx(105 / width, abs=0.05)
    assert result["y"] == pytest.approx(50 / height, abs=0.05)


def test_detect_club_tip_returns_none_when_both_hands_occluded():
    width = height = 200
    frame = np.full((height, width, 3), 255, dtype=np.uint8)
    cv2.line(frame, (100, 150), (100, 50), (0, 0, 0), 3)

    landmarks = _base_landmarks(width, height)
    landmarks[15] = _landmark(95 / width, 150 / height, visibility=0.1)
    landmarks[19] = _landmark(95 / width, 140 / height, visibility=0.1)
    landmarks[16] = _landmark(105 / width, 150 / height, visibility=0.1)
    landmarks[20] = _landmark(105 / width, 140 / height, visibility=0.1)

    assert _detect_club_tip(frame, landmarks, width, height) is None


def test_detect_club_tip_returns_none_when_shoulders_not_visible():
    width = height = 200
    frame = np.full((height, width, 3), 255, dtype=np.uint8)
    landmarks = [_landmark(0.5, 0.5, visibility=0.1)] * 33
    assert _detect_club_tip(frame, landmarks, width, height) is None


def test_detect_club_tip_search_radius_scales_with_torso_not_shoulder_width():
    """A foreshortened (profile-like) stance has shoulders nearly stacked in
    x but a normal torso length — this is what a down-the-line view looks
    like. The club-tip line here sits well beyond a shoulder-width-based
    radius but within a torso-length-based one; detecting it confirms the
    radius is keyed off the more stable reference."""
    width = height = 300
    frame = np.full((height, width, 3), 255, dtype=np.uint8)
    cv2.line(frame, (150, 200), (150, 40), (0, 0, 0), 3)  # 160px, hands to tip

    landmarks = [_landmark(0.0, 0.0)] * 33
    landmarks[11] = _landmark(148 / width, 100 / height)  # shoulders nearly stacked
    landmarks[12] = _landmark(152 / width, 100 / height)  # (shoulder width ~4px)
    landmarks[23] = _landmark(147 / width, 200 / height)  # normal torso length (~100px)
    landmarks[24] = _landmark(153 / width, 200 / height)
    landmarks[15] = _landmark(145 / width, 200 / height)
    landmarks[16] = _landmark(155 / width, 200 / height)
    landmarks[19] = _landmark(145 / width, 190 / height)
    landmarks[20] = _landmark(155 / width, 190 / height)

    result = _detect_club_tip(frame, landmarks, width, height)
    assert result is not None
    assert result["y"] == pytest.approx(40 / height, abs=0.05)
