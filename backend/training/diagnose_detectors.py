"""One-off diagnostic: how often do the clubhead/ball detectors actually fire
on real footage?

Not called at runtime -- run manually:

    python training/diagnose_detectors.py

Re-runs analyze_video against every backend/data/entries/*/video.mp4 (the
library's stored reference swings) and prints, per video, the fraction of
frames where each detector (club_tip: classical Hough-line, club_tip_yolo:
YOLOv8n clubhead, ball_tip: YOLOv8n ball) found something. This is the first
real-world hit-rate evidence for this app: the stored analysis.json fixtures
predate club_tip_yolo/ball_tip entirely, so there's been no other way to know
whether these detectors work on actual user-shaped footage rather than just
the datasets they were trained on.

Use the result to decide where effort is worth spending next: if a detector
almost never fires even on these videos, that points at a training-data/
camera-angle mismatch (retrain on more representative footage) rather than a
confidence-threshold tuning problem; if it's firing reasonably often but just
missing the few frames right around impact, threshold tuning or the
address/impact search-window widening in stats.ts is the more promising
lever. (Per-detection confidence isn't reported here -- that would need
detect_club/detect_ball to expose their score, which no runtime caller
currently needs; hit-rate alone is enough to tell these two cases apart.)
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.pose import analyze_video  # noqa: E402

ENTRIES_DIR = Path(__file__).resolve().parent.parent / "data" / "entries"


def diagnose_one(video_path: Path) -> None:
    result = analyze_video(str(video_path))
    frames = result["frames"]
    total = len(frames)
    hough_hits = sum(1 for f in frames if f["club_tip"] is not None)
    yolo_hits = sum(1 for f in frames if f["club_tip_yolo"] is not None)
    ball_hits = sum(1 for f in frames if f["ball_tip"] is not None)

    print(f"{video_path.parent.name}  ({total} frames, {result['fps']:.1f} fps)")
    print(f"  club_tip (hough):      {hough_hits}/{total} ({100 * hough_hits / total:.0f}%)")
    print(f"  club_tip_yolo (YOLO):  {yolo_hits}/{total} ({100 * yolo_hits / total:.0f}%)")
    print(f"  ball_tip (YOLO):       {ball_hits}/{total} ({100 * ball_hits / total:.0f}%)")


def main() -> None:
    videos = sorted(ENTRIES_DIR.glob("*/video.mp4"))
    if not videos:
        print(f"No videos found under {ENTRIES_DIR}")
        return
    for video_path in videos:
        try:
            diagnose_one(video_path)
        except ValueError as e:
            print(f"{video_path.parent.name}  -- skipped ({e})")
        print()


if __name__ == "__main__":
    main()
