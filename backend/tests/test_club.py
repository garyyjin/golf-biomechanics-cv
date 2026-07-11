import numpy as np
import pytest

from app import club
from app.club import MODEL_PATH, detect_club


@pytest.fixture(autouse=True)
def clear_model_cache():
    # _load_model is lru_cached, so a stale None (or a stale model) leaks
    # between tests that point MODEL_PATH at different places.
    club._load_model.cache_clear()
    yield
    club._load_model.cache_clear()


def test_detect_club_returns_none_when_no_model_is_installed(monkeypatch, tmp_path):
    # Pointed at a path that definitely has no weights, rather than asserting
    # the real MODEL_PATH is missing — that assertion would start failing the
    # moment someone trains a model and drops it in place.
    monkeypatch.setattr(club, "MODEL_PATH", tmp_path / "clubhead.pt")
    frame = np.zeros((64, 64, 3), dtype=np.uint8)
    assert detect_club(frame) is None


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
