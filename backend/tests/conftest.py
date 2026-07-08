import sys
from pathlib import Path

# Make `app` importable regardless of where pytest is invoked from.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import cv2
import numpy as np
import pytest


@pytest.fixture(scope="module")
def sample_video(tmp_path_factory):
    """A tiny valid mp4 (no person in it — landmarks may be null)."""
    path = tmp_path_factory.mktemp("videos") / "sample.mp4"
    writer = cv2.VideoWriter(
        str(path), cv2.VideoWriter_fourcc(*"mp4v"), 30.0, (64, 64)
    )
    assert writer.isOpened()
    for i in range(10):
        frame = np.full((64, 64, 3), i * 20 % 255, dtype=np.uint8)
        cv2.circle(frame, (32, 32), 10 + i, (0, 255, 0), -1)
        writer.write(frame)
    writer.release()
    return path
