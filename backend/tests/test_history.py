import time
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app import history
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def isolated_data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(history, "DATA_DIR", tmp_path)


def analyze(sample_video, view="face_on", handedness="right"):
    """POST /analyze and poll to completion; returns the swing id."""
    with open(sample_video, "rb") as f:
        response = client.post(
            "/analyze",
            files={"video": (sample_video.name, f, "video/mp4")},
            data={"view": view, "handedness": handedness, "quality": "fast"},
        )
    assert response.status_code == 202, response.text
    body = response.json()
    deadline = time.monotonic() + 10.0
    while time.monotonic() < deadline:
        poll = client.get(f"/analyze/{body['job_id']}")
        if poll.status_code != 200 or poll.json()["status"] != "processing":
            return body["swing_id"]
        time.sleep(0.02)
    raise AssertionError("analysis did not finish in time")


SUMMARY = {
    "score": 72.5,
    "band": "fair",
    "clubheadSpeedMph": 95.0,
    "ballSpeedMph": 140.0,
    "estCarryYards": 220.0,
    "tempoRatio": 2.8,
    "tempoScore": 8.9,
    "benchmarksAt": "2026-07-31T00:00:00+00:00",
}


def test_analyze_returns_a_swing_id_and_records_the_swing(sample_video):
    swing_id = analyze(sample_video)

    listed = client.get("/swings")
    assert listed.status_code == 200
    body = listed.json()
    assert [s["id"] for s in body["swings"]] == [swing_id]
    entry = body["swings"][0]
    assert entry["view"] == "face_on"
    assert entry["handedness"] == "right"
    # Label defaults to the filename until the user renames it.
    assert entry["label"] == entry["filename"]
    # No summary yet -- the frontend computes and posts it after analysis.
    assert entry["summary"] is None
    assert body["totalBytes"] > 0


def test_failed_analysis_leaves_no_swing_behind(sample_video):
    # A swing whose video can't be decoded could never be reviewed, so the
    # entry (and its stored video) must not linger in the history list.
    with patch("app.main.analyze_video", side_effect=ValueError("could not decode video")):
        analyze(sample_video)

    body = client.get("/swings").json()
    assert body["swings"] == []
    assert body["totalBytes"] == 0


def test_unexpected_analysis_error_also_cleans_up(sample_video):
    with patch("app.main.analyze_video", side_effect=RuntimeError("yolo exploded")):
        analyze(sample_video)

    assert client.get("/swings").json()["swings"] == []


def test_summary_round_trips(sample_video):
    swing_id = analyze(sample_video)
    response = client.post(f"/swings/{swing_id}/summary", json=SUMMARY)
    assert response.status_code == 200
    assert response.json()["summary"] == SUMMARY

    entry = client.get("/swings").json()["swings"][0]
    assert entry["summary"]["score"] == pytest.approx(72.5)
    assert entry["summary"]["benchmarksAt"] == SUMMARY["benchmarksAt"]


def test_summary_accepts_all_null_scores(sample_video):
    """Every score has its own way of being unavailable (phases undetected,
    clubhead never tracked). An all-null summary is still worth storing --
    it records that this swing was scored against these benchmarks and
    nothing could be measured, so it isn't retried as stale forever."""
    swing_id = analyze(sample_video)
    response = client.post(f"/swings/{swing_id}/summary", json={"benchmarksAt": "defaults"})
    assert response.status_code == 200
    summary = response.json()["summary"]
    assert summary["score"] is None
    assert summary["band"] is None
    assert summary["benchmarksAt"] == "defaults"


def test_summary_rejects_an_unknown_band(sample_video):
    swing_id = analyze(sample_video)
    response = client.post(
        f"/swings/{swing_id}/summary",
        json={**SUMMARY, "band": "excellent"},
    )
    assert response.status_code == 422


def test_summary_unknown_swing_404():
    response = client.post("/swings/does-not-exist/summary", json=SUMMARY)
    assert response.status_code == 404


def test_label_can_be_edited(sample_video):
    swing_id = analyze(sample_video)
    response = client.patch(f"/swings/{swing_id}", json={"label": "driver — range session"})
    assert response.status_code == 200
    assert response.json()["label"] == "driver — range session"

    entry = client.get("/swings").json()["swings"][0]
    assert entry["label"] == "driver — range session"
    # Renaming must not disturb the original filename.
    assert entry["filename"] == "sample.mp4"


def test_label_edit_preserves_an_existing_summary(sample_video):
    swing_id = analyze(sample_video)
    client.post(f"/swings/{swing_id}/summary", json=SUMMARY)
    response = client.patch(f"/swings/{swing_id}", json={"label": "renamed"})
    assert response.json()["summary"]["score"] == pytest.approx(72.5)


def test_label_unknown_swing_404():
    response = client.patch("/swings/does-not-exist", json={"label": "x"})
    assert response.status_code == 404


def test_analysis_endpoint_returns_the_stored_analysis(sample_video):
    swing_id = analyze(sample_video)
    response = client.get(f"/swings/{swing_id}/analysis")
    assert response.status_code == 200
    body = response.json()
    assert body["view"] == "face_on"
    assert body["quality"] == "fast"
    assert len(body["frames"]) == body["frame_count"]


def test_analysis_endpoint_unknown_404():
    assert client.get("/swings/does-not-exist/analysis").status_code == 404


def test_video_endpoint_serves_the_stored_video(sample_video):
    swing_id = analyze(sample_video)
    response = client.get(f"/swings/{swing_id}/video")
    assert response.status_code == 200
    assert response.headers["content-type"] == "video/mp4"


def test_video_endpoint_unknown_404():
    assert client.get("/swings/does-not-exist/video").status_code == 404


def test_delete_removes_the_swing_and_reclaims_disk(sample_video):
    swing_id = analyze(sample_video)
    before = client.get("/swings").json()["totalBytes"]
    assert before > 0

    response = client.delete(f"/swings/{swing_id}")
    assert response.status_code == 200
    assert response.json()["totalBytes"] == 0
    assert client.get("/swings").json()["swings"] == []


def test_delete_unknown_404():
    assert client.delete("/swings/does-not-exist").status_code == 404


def test_swings_are_listed_newest_first(sample_video):
    first = analyze(sample_video)
    second = analyze(sample_video)
    ids = [s["id"] for s in client.get("/swings").json()["swings"]]
    assert ids == [second, first]


def test_reference_uploads_do_not_appear_in_history(sample_video, monkeypatch):
    """The reference library is a curated set to measure against, often not
    even the user's own swing -- letting it into the personal progress log
    would pollute the trend."""
    from app import library

    monkeypatch.setattr(library, "DATA_DIR", history.DATA_DIR)
    with open(sample_video, "rb") as f:
        response = client.post(
            "/reference-swings",
            files={"video": (sample_video.name, f, "video/mp4")},
            data={"view": "face_on", "handedness": "right"},
        )
    assert response.status_code == 201
    assert client.get("/swings").json()["swings"] == []
