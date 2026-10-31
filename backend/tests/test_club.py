import numpy as np
import pytest

from app import club
from app.club import MODEL_PATH, _tip_from_box, detect_club


@pytest.fixture(autouse=True)
def clear_model_cache():
    # _load_model is lru_cached, so a stale None (or a stale model) leaks
    # between tests that point MODEL_PATH at different places.
    club._load_model.cache_clear()
    yield
    club._load_model.cache_clear()


class _FakeBox:
    def __init__(self, xyxy: tuple[float, float, float, float], confidence: float):
        self.xyxy = [np.array(xyxy, dtype=float)]
        self.conf = [confidence]


class _FakeResult:
    def __init__(self, boxes: list[_FakeBox]):
        self.boxes = boxes


class _FakeModel:
    def __init__(self, boxes: list[_FakeBox]):
        self._boxes = boxes

    def predict(self, frame_bgr, verbose=False):
        return [_FakeResult(self._boxes)]


def test_detect_club_returns_none_when_no_model_is_installed(monkeypatch, tmp_path):
    # Pointed at a path that definitely has no weights, rather than asserting
    # the real MODEL_PATH is missing — that assertion would start failing the
    # moment someone trains a model and drops it in place.
    monkeypatch.setattr(club, "MODEL_PATH", tmp_path / "clubhead.pt")
    frame = np.zeros((64, 64, 3), dtype=np.uint8)
    assert detect_club(frame) is None


def test_detect_club_defaults_to_box_center_with_no_hand_point(monkeypatch):
    monkeypatch.setattr(club, "_load_model", lambda: _FakeModel([_FakeBox((10, 10, 30, 30), 0.9)]))
    frame = np.zeros((100, 100, 3), dtype=np.uint8)
    assert detect_club(frame) == {"x": 0.2, "y": 0.2}


def test_detect_club_returns_the_far_box_edge_along_the_hand_direction(monkeypatch):
    monkeypatch.setattr(club, "_load_model", lambda: _FakeModel([_FakeBox((10, 10, 30, 30), 0.9)]))
    frame = np.zeros((100, 100, 3), dtype=np.uint8)
    # Hand at the box's bottom-right corner -- the tip is the far edge along
    # that direction, which is the opposite corner.
    result = detect_club(frame, hand_point=(30, 30))
    assert result["x"] == pytest.approx(0.1)
    assert result["y"] == pytest.approx(0.1)


@pytest.mark.skipif(
    not MODEL_PATH.exists(),
    reason="no trained clubhead.pt (see training/train_clubhead.py)",
)
def test_detect_club_with_a_trained_model_returns_a_normalized_point_or_none():
    # A blank frame has no clubhead in it, so None is the expected answer —
    # but a detection is not a failure either. What's being pinned here is the
    # contract detect_club's callers rely on: a normalized {"x", "y"} or None,
    # never a raw pixel box.
    frame = np.zeros((64, 64, 3), dtype=np.uint8)
    result = detect_club(frame)
    if result is None:
        return
    assert set(result) == {"x", "y"}
    assert 0.0 <= result["x"] <= 1.0
    assert 0.0 <= result["y"] <= 1.0


def test_tip_from_box_extends_to_the_far_edge_along_the_hand_direction():
    # 20x20 box centered at (110, 110), hand straight below it: the tip is the
    # top edge's midpoint, half the box's extent away from the center.
    x, y = _tip_from_box((100.0, 100.0, 120.0, 120.0), (110.0, 200.0))
    assert x == 110.0
    assert y == 100.0


def test_tip_from_box_moves_continuously_as_the_hand_direction_rotates():
    box = (100.0, 100.0, 120.0, 120.0)
    # A corner-max rule jumps a whole diagonal between neighboring frames as
    # the shaft swings; this point should move by a small, bounded step.
    first = _tip_from_box(box, (100.0, 200.0))
    second = _tip_from_box(box, (95.0, 200.0))
    assert abs(second[0] - first[0]) < 10.0
    assert abs(second[1] - first[1]) < 10.0


def test_tip_from_box_uses_the_center_without_a_hand():
    assert _tip_from_box((100.0, 100.0, 120.0, 120.0), None) == (110.0, 110.0)


def test_tip_from_box_falls_back_to_the_center_when_the_hand_sits_on_it():
    assert _tip_from_box((100.0, 100.0, 120.0, 120.0), (110.0, 110.0)) == (110.0, 110.0)
