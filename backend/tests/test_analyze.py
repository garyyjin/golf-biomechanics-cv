import time

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def post_analyze(video_path, **overrides):
    fields = {"view": "face_on", "handedness": "right", "quality": "fast"}
    fields.update({k: v for k, v in overrides.items() if v is not None})
    for k in [k for k, v in overrides.items() if v is None]:
        fields.pop(k, None)
    with open(video_path, "rb") as f:
        return client.post(
            "/analyze",
            files={"video": (video_path.name, f, "video/mp4")},
            data=fields,
        )


def wait_for_job(job_id, timeout=10.0):
    """Polls GET /analyze/{job_id} until it leaves "processing", mirroring
    what a real client does. sample_video is tiny (10 frames, 64x64), so
    this should resolve in well under a second in practice."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        response = client.get(f"/analyze/{job_id}")
        if response.status_code != 200 or response.json()["status"] != "processing":
            return response
        time.sleep(0.02)
    raise AssertionError(f"job {job_id} did not finish within {timeout}s")


def run_analyze(video_path, **overrides):
    """POST /analyze then poll until done; returns the final response."""
    response = post_analyze(video_path, **overrides)
    assert response.status_code == 202, response.text
    job_id = response.json()["job_id"]
    return wait_for_job(job_id)


def test_analyze_ok(sample_video):
    response = run_analyze(sample_video)
    assert response.status_code == 200
    job = response.json()
    assert job["status"] == "done"
    assert job["progress"] == 100.0
    body = job["result"]

    assert body["frame_count"] > 0
    assert body["width"] == 64
    assert body["height"] == 64
    assert body["fps"] > 0
    assert body["view"] == "face_on"
    assert body["handedness"] == "right"
    assert body["quality"] == "fast"
    assert len(body["frames"]) == body["frame_count"]

    for i, frame in enumerate(body["frames"]):
        assert frame["index"] == i
        assert isinstance(frame["t"], (int, float))
        landmarks = frame["landmarks"]
        assert landmarks is None or len(landmarks) == 33
        if landmarks is not None:
            for lm in landmarks:
                assert set(lm) == {"x", "y", "z", "visibility"}


def test_missing_view_422(sample_video):
    response = post_analyze(sample_video, view=None)
    assert response.status_code == 422


def test_missing_handedness_422(sample_video):
    response = post_analyze(sample_video, handedness=None)
    assert response.status_code == 422


def test_invalid_view_422(sample_video):
    response = post_analyze(sample_video, view="side")
    assert response.status_code == 422


def test_invalid_handedness_422(sample_video):
    response = post_analyze(sample_video, handedness="ambidextrous")
    assert response.status_code == 422


def test_missing_quality_422(sample_video):
    response = post_analyze(sample_video, quality=None)
    assert response.status_code == 422


def test_invalid_quality_422(sample_video):
    response = post_analyze(sample_video, quality="ultra")
    assert response.status_code == 422


def test_analyze_accurate_quality_ok(sample_video):
    response = run_analyze(sample_video, quality="accurate")
    assert response.status_code == 200
    body = response.json()["result"]

    assert body["quality"] == "accurate"
    assert body["frame_count"] > 0
    assert body["width"] == 64
    assert body["height"] == 64
    assert len(body["frames"]) == body["frame_count"]
    for frame in body["frames"]:
        landmarks = frame["landmarks"]
        assert landmarks is None or len(landmarks) == 33


def test_bad_extension_422(tmp_path):
    path = tmp_path / "notes.txt"
    path.write_bytes(b"not a video")
    response = post_analyze(path)
    assert response.status_code == 422


def test_garbage_video_422(tmp_path):
    path = tmp_path / "garbage.mp4"
    path.write_bytes(b"\x00\x01\x02 definitely not an mp4")
    response = run_analyze(path)
    assert response.status_code == 422


def test_unknown_job_404():
    response = client.get("/analyze/does-not-exist")
    assert response.status_code == 404
