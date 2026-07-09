import pytest
from fastapi.testclient import TestClient

from app import library
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def isolated_data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(library, "DATA_DIR", tmp_path)


def upload(sample_video, view="face_on", handedness="right"):
    with open(sample_video, "rb") as f:
        return client.post(
            "/reference-swings",
            files={"video": (sample_video.name, f, "video/mp4")},
            data={"view": view, "handedness": handedness},
        )


def test_upload_creates_entry_and_list(sample_video):
    response = upload(sample_video)
    assert response.status_code == 201
    body = response.json()
    assert body["view"] == "face_on"
    assert body["handedness"] == "right"
    assert "analysis" in body
    assert body["analysis"]["quality"] == "accurate"

    listed = client.get("/reference-swings")
    assert listed.status_code == 200
    entries = listed.json()
    assert len(entries) == 1
    assert entries[0]["id"] == body["id"]
    assert "analysis" not in entries[0]


def test_upload_bad_extension_422(tmp_path):
    path = tmp_path / "notes.txt"
    path.write_bytes(b"not a video")
    response = upload(path)
    assert response.status_code == 422


def test_video_endpoint_serves_file(sample_video):
    entry = upload(sample_video).json()
    response = client.get(f"/reference-swings/{entry['id']}/video")
    assert response.status_code == 200
    assert response.headers["content-type"] == "video/mp4"


def test_video_endpoint_unknown_404():
    response = client.get("/reference-swings/does-not-exist/video")
    assert response.status_code == 404


def test_analysis_endpoint_returns_full_analysis(sample_video):
    entry = upload(sample_video).json()
    response = client.get(f"/reference-swings/{entry['id']}/analysis")
    assert response.status_code == 200
    body = response.json()
    assert body["view"] == "face_on"
    assert body["handedness"] == "right"
    assert body["quality"] == "accurate"
    assert "frames" in body


def test_analysis_endpoint_unknown_404():
    response = client.get("/reference-swings/does-not-exist/analysis")
    assert response.status_code == 404


def test_delete_removes_entry(sample_video):
    entry = upload(sample_video).json()
    response = client.delete(f"/reference-swings/{entry['id']}")
    assert response.status_code == 200
    assert client.get("/reference-swings").json() == []


def test_delete_unknown_404():
    response = client.delete("/reference-swings/does-not-exist")
    assert response.status_code == 404


def test_benchmarks_empty_when_no_samples():
    response = client.get("/benchmarks")
    assert response.status_code == 200
    body = response.json()
    assert body["generatedAt"] is None
    assert body["table"] == {"face_on": {}, "down_the_line": {}}


def test_samples_below_threshold_not_included(sample_video):
    ids = [upload(sample_video).json()["id"] for _ in range(2)]
    for entry_id in ids:
        response = client.post(
            f"/reference-swings/{entry_id}/samples",
            json={"samples": [{"phase": "top", "metric": "shoulderTurn", "value": 85.0}]},
        )
    assert response.status_code == 200
    assert response.json()["table"]["face_on"].get("top") is None


def test_samples_mean_std_math_and_threshold(sample_video):
    ids = [upload(sample_video).json()["id"] for _ in range(3)]
    values = [80.0, 85.0, 90.0]
    for entry_id, value in zip(ids, values):
        response = client.post(
            f"/reference-swings/{entry_id}/samples",
            json={"samples": [{"phase": "top", "metric": "shoulderTurn", "value": value}]},
        )
    assert response.status_code == 200
    entries = response.json()["table"]["face_on"]["top"]
    assert len(entries) == 1
    assert entries[0]["metric"] == "shoulderTurn"
    assert entries[0]["sampleSize"] == 3
    assert entries[0]["range"]["min"] == pytest.approx(80.0)
    assert entries[0]["range"]["max"] == pytest.approx(90.0)


def test_delete_drops_group_below_threshold(sample_video):
    ids = [upload(sample_video).json()["id"] for _ in range(3)]
    values = [80.0, 85.0, 90.0]
    for entry_id, value in zip(ids, values):
        client.post(
            f"/reference-swings/{entry_id}/samples",
            json={"samples": [{"phase": "top", "metric": "shoulderTurn", "value": value}]},
        )

    response = client.delete(f"/reference-swings/{ids[0]}")
    assert response.status_code == 200
    assert response.json()["table"]["face_on"].get("top") is None
