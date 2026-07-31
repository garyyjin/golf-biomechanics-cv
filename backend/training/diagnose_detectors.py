"""One-off diagnostic: how do the two clubhead detectors actually compare on
real footage?

Not called at runtime -- run manually:

    python training/diagnose_detectors.py            # every library swing
    python training/diagnose_detectors.py PATH       # a directory, or one video

Re-runs analyze_video against each video and prints, per clip:

1. **Hit rates and confidence** for each detector (club_tip: classical
   Hough-line, club_tip_yolo: YOLOv8n clubhead, ball_tip: YOLOv8n ball) --
   the fraction of frames where each found something, and how confident it
   was when it did. Note the two clubhead confidences are on different scales
   (YOLO's is a class probability, Hough's a geometric quality score) and are
   never compared against each other; they're reported side by side only to
   show each detector's own spread.

2. **Agreement**, over the frames where both clubhead detectors fired. The two
   report different physical points -- Hough gives a point somewhere along the
   *shaft* (wherever its line segment happened to end), YOLO gives the clubhead
   *toe* -- so before either can be substituted for the other, that offset has
   to be characterized. It's measured here as a *radial ratio* about the grip,
   `|yolo - grip| / |hough - grip|`, rather than as a 2-D translation: the
   offset rotates with the club as it pivots about the hands, so a constant
   image-space translation would be the wrong model, while a scalar length
   along the grip->tip ray is rotation-invariant and should hold across the
   whole swing. A tight spread on that ratio (plus a small angular
   disagreement, confirming both really are on the shaft) is what licenses
   registering Hough onto YOLO's convention and fusing the two tracks.

3. **Coverage**, the actual payoff: how many frames a fused track would cover
   versus YOLO alone, reported both over the whole clip and restricted to the
   window around impact -- the only stretch the speed math in stats.ts reads.
   A detector that adds coverage everywhere except there adds nothing that
   matters.

Use the result to decide where effort is worth spending next: if Hough
contributes almost no frames YOLO doesn't already have, it's dead weight and
should go; if it adds coverage but the radial ratio won't sit still, the two
can't be safely fused and confidence gating is the most that's justified; if
it adds coverage with a stable ratio, register and fuse. If *YOLO's* hit rate
is poor even on this footage, that points at a training-data/camera-angle
mismatch (retrain on more representative footage) rather than anything
fusion can fix.
"""

import math
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.pose import _wrist_point, analyze_video  # noqa: E402

ENTRIES_DIR = Path(__file__).resolve().parent.parent / "data" / "entries"
VIDEO_SUFFIXES = {".mp4", ".mov", ".webm"}

# Mirrors stats.ts's IMPACT_SEARCH_WINDOW_FRAMES -- the span either side of
# impact its clubhead-speed search actually looks at.
IMPACT_WINDOW_FRAMES = 20


def _pixel_point(detection: dict | None, width: int, height: int) -> tuple[float, float] | None:
    """A normalized detection as a pixel-space point. All the geometry below
    works in pixels rather than normalized units: x and y are normalized by
    different divisors on a non-square frame, so normalized "distance" is
    anisotropic and would distort both the radial ratio and the angle."""
    if detection is None:
        return None
    return (detection["x"] * width, detection["y"] * height)


def _grip(frame: dict, width: int, height: int) -> tuple[float, float] | None:
    """Pixel-space grip position, reusing pose.py's own "whichever wrist is
    more visible" policy rather than reimplementing it here -- the fusion this
    informs has to anchor on exactly the same point the detectors did."""
    landmarks = frame["landmarks"]
    if landmarks is None:
        return None
    return _wrist_point(landmarks, width, height)


def _distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _angle_between(v1: tuple[float, float], v2: tuple[float, float]) -> float | None:
    """Angle between two vectors in degrees, or None if either is degenerate."""
    n1, n2 = math.hypot(*v1), math.hypot(*v2)
    if n1 < 1e-9 or n2 < 1e-9:
        return None
    cosine = (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)
    return math.degrees(math.acos(max(-1.0, min(1.0, cosine))))


def _mad(values: list[float], center: float) -> float:
    """Median absolute deviation -- a spread measure that a couple of wild
    frames can't inflate the way a standard deviation can."""
    return statistics.median([abs(v - center) for v in values])


def _impact_index(frames: list[dict], width: int, height: int) -> int | None:
    """Approximate impact as the frame ending the fastest consecutive grip
    movement in the clip.

    This mirrors stats.ts's estimatePhasesFromHandVelocity rather than its
    full detectPhases: real phase detection lives in the frontend (TypeScript)
    and can't be called from here. The downswing is by far the fastest hand
    motion in a swing, so this lands close enough to locate a +/-20 frame
    window -- which is all it's used for. Treat the reported impact frame as
    approximate.
    """
    best_index = None
    best_speed = 0.0
    previous: tuple[int, tuple[float, float]] | None = None
    for i, frame in enumerate(frames):
        grip = _grip(frame, width, height)
        if grip is None:
            continue
        if previous is not None:
            previous_index, previous_grip = previous
            elapsed = frame["t"] - frames[previous_index]["t"]
            if elapsed > 0:
                speed = _distance(grip, previous_grip) / elapsed
                if speed > best_speed:
                    best_speed = speed
                    best_index = i
        previous = (i, grip)
    return best_index


def _coverage_line(label: str, frames: list[dict], lo: int, hi: int) -> str:
    """One "yolo X% / hough Y% / union Z%" line over frames[lo:hi]."""
    window = frames[lo:hi]
    total = len(window)
    if total == 0:
        return f"  {label:<16} (no frames)"
    yolo = sum(1 for f in window if f["club_tip_yolo"] is not None)
    hough = sum(1 for f in window if f["club_tip"] is not None)
    union = sum(1 for f in window if f["club_tip_yolo"] is not None or f["club_tip"] is not None)
    hough_only = union - yolo
    return (
        f"  {label:<16} yolo {100 * yolo / total:5.1f}%   hough {100 * hough / total:5.1f}%   "
        f"union {100 * union / total:5.1f}%   (+{hough_only} frames from hough)"
    )


def _report_hit_rates(frames: list[dict]) -> None:
    total = len(frames)

    def line(label: str, key: str, with_confidence: bool) -> str:
        hits = [f[key] for f in frames if f[key] is not None]
        text = f"  {label:<22} {len(hits):>4}/{total} ({100 * len(hits) / total:5.1f}%)"
        if with_confidence and hits:
            # Older stored analyses predate the confidence field; skip rather
            # than fail on them.
            scores = [h["confidence"] for h in hits if "confidence" in h]
            if scores:
                text += f"   confidence median {statistics.median(scores):.2f}"
        return text

    print("  -- hit rates --")
    print(line("club_tip (hough):", "club_tip", True))
    print(line("club_tip_yolo (YOLO):", "club_tip_yolo", True))
    print(line("ball_tip (YOLO):", "ball_tip", False))


def _report_agreement(frames: list[dict], width: int, height: int) -> None:
    """Radial ratio, angular disagreement, and post-registration residual over
    the frames where both clubhead detectors fired and a grip is available."""
    ratios: list[float] = []
    angles: list[float] = []
    samples: list[tuple[tuple[float, float], tuple[float, float], tuple[float, float]]] = []

    for frame in frames:
        yolo = _pixel_point(frame["club_tip_yolo"], width, height)
        hough = _pixel_point(frame["club_tip"], width, height)
        grip = _grip(frame, width, height)
        if yolo is None or hough is None or grip is None:
            continue
        hough_reach = _distance(hough, grip)
        yolo_reach = _distance(yolo, grip)
        if hough_reach < 1e-6 or yolo_reach < 1e-6:
            continue
        ratios.append(yolo_reach / hough_reach)
        angle = _angle_between(
            (yolo[0] - grip[0], yolo[1] - grip[1]),
            (hough[0] - grip[0], hough[1] - grip[1]),
        )
        if angle is not None:
            angles.append(angle)
        samples.append((grip, hough, yolo))

    print(f"  -- agreement (both detectors fired on {len(ratios)} frames) --")
    if not ratios:
        print("  (never overlapped -- no basis for registering one onto the other)")
        return

    median_ratio = statistics.median(ratios)
    mad_ratio = _mad(ratios, median_ratio)
    spread = mad_ratio / median_ratio if median_ratio > 1e-9 else float("inf")
    print(
        f"  radial ratio |yolo-grip|/|hough-grip|:  median {median_ratio:.3f}   "
        f"MAD {mad_ratio:.3f}   spread {100 * spread:.1f}%"
    )
    if angles:
        print(f"  angular disagreement:                   median {statistics.median(angles):.1f} deg")

    # What's left over after registering Hough onto YOLO's convention with the
    # single median ratio above -- i.e. the error a fused track would inherit.
    # Reported against the club's own on-screen reach as well as in pixels,
    # since a raw pixel count means nothing without the clip's resolution.
    residuals = [
        _distance((grip[0] + median_ratio * (hough[0] - grip[0]),
                   grip[1] + median_ratio * (hough[1] - grip[1])), yolo)
        for grip, hough, yolo in samples
    ]
    reaches = [_distance(yolo, grip) for grip, _, yolo in samples]
    median_residual = statistics.median(residuals)
    median_reach = statistics.median(reaches)
    relative = f"{100 * median_residual / median_reach:.1f}% of club reach" if median_reach > 1e-6 else "n/a"
    print(f"  registered residual:                    median {median_residual:.1f} px   ({relative})")


def diagnose_one(video_path: Path) -> None:
    result = analyze_video(str(video_path))
    frames = result["frames"]
    width, height = result["width"], result["height"]
    total = len(frames)

    print(f"{video_path.parent.name}/{video_path.name}  ({total} frames, {result['fps']:.1f} fps, {width}x{height})")
    _report_hit_rates(frames)
    _report_agreement(frames, width, height)

    print("  -- coverage --")
    print(_coverage_line("whole clip:", frames, 0, total))
    impact = _impact_index(frames, width, height)
    if impact is None:
        print("  impact window:   (no grip motion found -- can't locate impact)")
    else:
        lo = max(0, impact - IMPACT_WINDOW_FRAMES)
        hi = min(total, impact + IMPACT_WINDOW_FRAMES + 1)
        print(_coverage_line("impact window:", frames, lo, hi))
        print(f"  (impact approximated at frame {impact}, window {lo}-{hi - 1})")


def _collect_videos(root: Path | None) -> list[Path]:
    if root is None:
        return sorted(ENTRIES_DIR.glob("*/video.*"))
    if root.is_file():
        return [root]
    return sorted(p for p in root.rglob("*") if p.suffix.lower() in VIDEO_SUFFIXES)


def main() -> None:
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else None
    videos = [p for p in _collect_videos(root) if p.suffix.lower() in VIDEO_SUFFIXES]
    if not videos:
        target = root if root is not None else ENTRIES_DIR
        print(f"No videos found under {target}")
        return
    for video_path in videos:
        try:
            diagnose_one(video_path)
        except ValueError as e:
            print(f"{video_path.name}  -- skipped ({e})")
        print()


if __name__ == "__main__":
    main()
