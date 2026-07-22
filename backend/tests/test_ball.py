import numpy as np
import pytest

from app import ball
from app.ball import MODEL_PATH, detect_ball


@pytest.fixture(autouse=True)
def clear_model_cache():
    # _load_model is lru_cached, so a stale None (or a stale model) leaks
    # between tests that point MODEL_PATH at different places.
    ball._load_model.cache_clear()
    yield
    ball._load_model.cache_clear()


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


def test_detect_ball_returns_none_when_no_model_is_installed(monkeypatch, tmp_path):
    # Pointed at a path that definitely has no weights, rather than asserting
    # the real MODEL_PATH is missing — that assertion would start failing the
    # moment someone trains a model and drops it in place.
    monkeypatch.setattr(ball, "MODEL_PATH", tmp_path / "ball.pt")
    frame = np.zeros((64, 64, 3), dtype=np.uint8)
    assert detect_ball(frame) is None


def test_detect_ball_returns_the_box_center_and_size(monkeypatch):
    monkeypatch.setattr(ball, "_load_model", lambda: _FakeModel([_FakeBox((10, 10, 30, 30), 0.9)]))
    frame = np.zeros((100, 100, 3), dtype=np.uint8)
    assert detect_ball(frame) == {"x": 0.2, "y": 0.2, "width": 0.2, "height": 0.2}


def test_detect_ball_picks_the_highest_confidence_box(monkeypatch):
    monkeypatch.setattr(
        ball,
        "_load_model",
        lambda: _FakeModel([_FakeBox((0, 0, 10, 10), 0.3), _FakeBox((80, 80, 100, 100), 0.9)]),
    )
    frame = np.zeros((100, 100, 3), dtype=np.uint8)
    assert detect_ball(frame) == {"x": 0.9, "y": 0.9, "width": 0.2, "height": 0.2}


def test_detect_ball_ignores_boxes_below_the_confidence_threshold(monkeypatch):
    monkeypatch.setattr(ball, "_load_model", lambda: _FakeModel([_FakeBox((10, 10, 30, 30), 0.1)]))
    frame = np.zeros((100, 100, 3), dtype=np.uint8)
    assert detect_ball(frame) is None


@pytest.mark.skipif(
    not MODEL_PATH.exists(),
    reason="no trained ball.pt (see training/train_ball.py)",
)
def test_detect_ball_with_a_trained_model_returns_a_normalized_point_or_none():
    # A blank frame has no ball in it, so None is the expected answer -- but
    # a detection is not a failure either. What's being pinned here is the
    # contract detect_ball's callers rely on: a normalized {"x", "y"} or
    # None, never a raw pixel box.
    frame = np.zeros((64, 64, 3), dtype=np.uint8)
    result = detect_ball(frame)
    if result is None:
        return
    assert set(result) == {"x", "y", "width", "height"}
    assert 0.0 <= result["x"] <= 1.0
    assert 0.0 <= result["y"] <= 1.0
    assert 0.0 <= result["width"] <= 1.0
    assert 0.0 <= result["height"] <= 1.0
