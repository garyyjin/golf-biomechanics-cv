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


def test_analyze_ok(sample_video):
    response = post_analyze(sample_video)
    assert response.status_code == 200
    body = response.json()

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
        club_tip_yolo = frame["club_tip_yolo"]
        assert club_tip_yolo is None or set(club_tip_yolo) == {"x", "y"}


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
    response = post_analyze(sample_video, quality="accurate")
    assert response.status_code == 200
    body = response.json()

    assert body["quality"] == "accurate"
    assert body["frame_count"] > 0
    assert body["width"] == 64
    assert body["height"] == 64
    assert len(body["frames"]) == body["frame_count"]
    for frame in body["frames"]:
        landmarks = frame["landmarks"]
        assert landmarks is None or len(landmarks) == 33
        club_tip_yolo = frame["club_tip_yolo"]
        assert club_tip_yolo is None or set(club_tip_yolo) == {"x", "y"}


def test_bad_extension_422(tmp_path):
    path = tmp_path / "notes.txt"
    path.write_bytes(b"not a video")
    response = post_analyze(path)
    assert response.status_code == 422


def test_garbage_video_422(tmp_path):
    path = tmp_path / "garbage.mp4"
    path.write_bytes(b"\x00\x01\x02 definitely not an mp4")
    response = post_analyze(path)
    assert response.status_code == 422
