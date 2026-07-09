# Golf Biomechanics CV

A web app that analyzes a golfer's swing from video: upload a clip, get
per-frame pose landmarks via computer vision, and see biomechanics metrics
(spine tilt, shoulder/hip turn, X-factor, swing plane angle, spine
retention) overlaid on the video at each swing phase (address, takeaway,
top, downswing, impact, follow-through). Metrics can be compared against a
library of reference swings to see whether they fall inside a normal range.

## Architecture

- **`backend/`** — FastAPI service. Decodes uploaded video with OpenCV and
  runs [MediaPipe Pose](https://ai.google.dev/edge/mediapipe) frame-by-frame
  to extract 33 raw pose landmarks per frame (`app/pose.py`). Also persists
  a library of reference swings and their per-phase metric samples to local
  disk, and aggregates them into benchmark ranges (`app/library.py`).
  Biomechanics logic itself (phase detection, angle computation) lives
  entirely in the frontend — the backend only computes/persists raw
  landmarks and samples.
- **`frontend/`** — React + TypeScript app (Vite). Uploads video to the
  backend, then renders it with a pose overlay, computes swing phases and
  biomechanics angles from the landmarks, and shows feedback against
  benchmark ranges. Also has a library UI for managing reference swings.

## Prerequisites

- Python 3.12+
- Node.js 18+

## Setup

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate      # Windows
# source .venv/bin/activate  # macOS/Linux
pip install -r requirements.txt
```

### Frontend

```bash
cd frontend
npm install
```

## Running

Start both servers (in separate terminals):

```bash
# backend — http://127.0.0.1:8000
cd backend
.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000

# frontend — http://localhost:5173
cd frontend
npm run dev
```

Open http://localhost:5173. The dev backend's CORS is configured to allow
the default Vite dev origin (`http://localhost:5173`).

## Testing

```bash
# backend
cd backend
.venv\Scripts\python.exe -m pytest

# frontend
cd frontend
npm test
```

## API

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/analyze` | Upload a video (`mp4`/`mov`/`webm`) with `view`, `handedness`, `quality` ("fast" or "accurate") form fields; returns per-frame pose landmarks. |
| `POST` | `/reference-swings` | Upload a reference swing video; analyzed at max accuracy and added to the library. |
| `GET` | `/reference-swings` | List reference swing library entries. |
| `DELETE` | `/reference-swings/{id}` | Remove a reference swing and recompute benchmarks. |
| `GET` | `/reference-swings/{id}/video` | Fetch a reference swing's video file. |
| `POST` | `/reference-swings/{id}/samples` | Save per-phase metric samples for a reference swing and recompute benchmarks. |
| `GET` | `/benchmarks` | Get the current benchmark ranges (mean ± 1 std per view/phase/metric). |
