import numpy as np

from app.club import MODEL_PATH, detect_club


def test_detect_club_returns_none_without_a_trained_model():
    # clubhead.pt is trained offline (training/train_clubhead.py) and isn't
    # committed to the repo, so this is the real state until someone trains
    # and drops weights in place.
    assert not MODEL_PATH.exists()
    frame = np.zeros((64, 64, 3), dtype=np.uint8)
    assert detect_club(frame) is None
