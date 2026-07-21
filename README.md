# Golf Biomechanics CV

A web app that analyzes a golfer's swing from video: upload a clip, get
per-frame pose landmarks via computer vision, and see biomechanics metrics
(spine tilt, shoulder/hip turn, X-factor, swing plane angle, spine
retention) overlaid on the video at each swing phase (address, takeaway,
top, downswing, impact, follow-through). Metrics can be compared against a
library of reference swings to see whether they fall inside a normal range.

## Features

### Video analysis

- Upload an `mp4`, `mov`, or `webm` swing clip, tagged with camera view
  (face-on or down-the-line) and handedness (right/left).
- Two analysis quality levels: **Fast** (MediaPipe model complexity 1) or
  **Accurate** (complexity 2, MediaPipe's heaviest model).
- The backend decodes the video with OpenCV (honoring rotation metadata
  from phone recordings) and runs MediaPipe Pose frame-by-frame, returning
  33 raw pose landmarks per frame with timestamps.

### Player with live pose overlay

- Skeleton and angle lines (spine, shoulder, hip, swing plane) drawn over
  the video on a canvas, with a live readout panel of each angle in
  degrees.
- Frame-accurate scrubbing and single-frame stepping (`Space` to
  play/pause, `←`/`→` to step), playback speeds of 0.25x/0.5x/1x, and a
  "Skeleton only" mode that hides the video and shows just the overlay.
- Drawing-only exponential landmark smoothing weighted by MediaPipe's
  per-landmark visibility, so occluded/low-confidence joints don't jitter —
  the raw analysis data is never mutated.
- A down-the-line alignment warning when the camera doesn't look lined up
  with the target line (detected from foot spread), since misalignment
  skews the angle readings.

### Swing phase detection

- Six phases — address, takeaway, top of backswing, downswing, impact,
  follow-through — detected heuristically from smoothed lead/trail wrist
  height and velocity over time (no ML), with gap interpolation across
  frames where landmarks were missed.
- Phase chips in the player jump the video straight to each detected
  phase's frame.

### Biomechanics feedback

- Six metrics computed from the landmarks: spine tilt, shoulder turn, hip
  turn, X-factor (shoulder−hip separation), swing plane angle, and spine
  retention (change in spine tilt vs address).
- Metrics are scored at address, top, and impact against per-view
  benchmark ranges, each shown as within/below/above with the measured
  value, the target range, and a plain-English coaching tip. Clicking a
  feedback row seeks the video to that phase.
- Benchmark ranges come from published defaults out of the box, and are
  replaced by **empirical benchmarks** (mean ± 1 std per view/phase/metric)
  aggregated from your own reference swing library as you add swings —
  each row labels which source it used.
- A normalized skeleton comparison diagram overlays your pose on the
  reference swing's pose at the same swing moment.

### Reference swing library

- Upload reference swings (analyzed at maximum accuracy), browse them in a
  list or thumbnail grid, play them back, and delete them.
- Each uploaded reference is automatically calibrated: per-phase metric
  samples are computed with the exact same phase-detection and
  angle-measurement code used to score user swings, then persisted and
  aggregated into the benchmark ranges.

### Side-by-side swing comparison

- Compare mode plays a reference swing next to yours, phase-aligned: the
  reference's playback rate is stretched per phase segment so its address,
  takeaway, top, downswing, impact, and follow-through land at the same
  moments as yours. A proportional drift controller keeps the two in sync
  by nudging playback rate rather than seeking, so the reference never
  skips frames.
- A reference picker lists library swings matching your clip's view and
  handedness (newest first).
- **Regular speed** mode instead plays both swings at their natural tempo,
  time-shifted so the takeaways coincide and windowed to the swing itself.
- **Tempo score** rates how closely your tempo matches the reference out
  of 10 — derived from the speed factor the sync applies to the reference
  (1.0x = untouched = 10/10, 2x or half speed = 0) — with a
  backswing (takeaway→top) and downswing (top→impact) breakdown.

### Club tracking

- A per-frame YOLOv8n clubhead detector (trained offline on the public
  Roboflow "golf-club-tracking" dataset of ~11.5k labeled images via
  `backend/training/train_clubhead.py`) reports a clubhead position each
  frame independently, with short detection gaps bridged by interpolation
  — falling back to a body-pose-based estimate when no confident detection
  exists.
- A toggleable swing-path tracer draws the tracked clubhead's path over
  the video (red on the takeback, green on the downswing), frozen at
  impact rather than continuing through follow-through.

### Swing stats

- Clubhead speed, estimated ball speed, and estimated carry distance,
  derived from the club tracer's positions around address and impact.
  These are rough estimates, not launch-monitor-grade measurements — they
  assume a fixed club length (driver) and a typical smash factor, and
  ignore spin and drag entirely. The panel is explicit about this rather
  than presenting the numbers as precise.

## Architecture

- **`backend/`** — FastAPI service. Decodes uploaded video with OpenCV and
  runs [MediaPipe Pose](https://ai.google.dev/edge/mediapipe) frame-by-frame
  to extract 33 raw pose landmarks per frame (`app/pose.py`), plus the
  club-tip/clubhead detections (`app/pose.py`, `app/club.py`). Also
  persists a library of reference swings and their per-phase metric
  samples to local disk, and aggregates them into benchmark ranges
  (`app/library.py`). Biomechanics logic itself (phase detection, angle
  computation) lives entirely in the frontend — the backend only
  computes/persists raw landmarks and samples.
- **`frontend/`** — React + TypeScript app (Vite). Uploads video to the
  backend, then renders it with a pose overlay, computes swing phases and
  biomechanics angles from the landmarks, and shows feedback against
  benchmark ranges. Also has the library UI and the side-by-side
  comparison player.

## Tech stack

### Backend (Python 3.12+)

| Library | Use |
| --- | --- |
| [FastAPI](https://fastapi.tiangolo.com/) + [Uvicorn](https://www.uvicorn.org/) | HTTP API server |
| [MediaPipe](https://ai.google.dev/edge/mediapipe) | Pose landmark extraction (33 landmarks/frame) |
| [OpenCV](https://opencv.org/) (`opencv-python`) | Video decoding, rotation handling, Canny + Hough club-shaft detection |
| [NumPy](https://numpy.org/) | Frame/array math |
| [Ultralytics](https://docs.ultralytics.com/) (YOLOv8) | Clubhead detector (training + inference) |
| pytest + httpx | Backend tests |

### Frontend (TypeScript)

| Library | Use |
| --- | --- |
| [React 19](https://react.dev/) | UI |
| [Vite](https://vite.dev/) | Dev server and build |
| [Vitest](https://vitest.dev/) | Unit tests |
| [oxlint](https://oxc.rs/docs/guide/usage/linter) | Linting |

No runtime dependencies beyond React: the overlay is hand-rolled Canvas 2D
rendering driven by `requestVideoFrameCallback`, and all biomechanics math
(geometry, phase detection, smoothing, comparison sync, tempo scoring) is
plain TypeScript with unit tests alongside each module.

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
| `GET` | `/reference-swings/{id}/analysis` | Fetch a reference swing's stored per-frame analysis. |
| `POST` | `/reference-swings/{id}/samples` | Save per-phase metric samples for a reference swing and recompute benchmarks. |
| `GET` | `/benchmarks` | Get the current benchmark ranges (mean ± 1 std per view/phase/metric). |
