# Clubhead detector bake-off

Output of `python training/diagnose_detectors.py` against the six reference
swings in the library (real down-the-line tour footage, 1,497 frames total),
run 2026-07-31 with `clubhead.pt` installed and no `ball.pt`.

The question: the app carries two independent clubhead signals — `club_tip`
(classical Canny + Hough line search) and `club_tip_yolo` (YOLOv8n) — and has
never reconciled them. Should they be fused, or should one go?

## Per-clip results

| Clip (fps, size) | Frames | YOLO hit | Hough hit | YOLO conf | Hough conf | Overlap | Radial ratio (MAD/med) | Angular | Residual | Hough-only |
|---|---|---|---|---|---|---|---|---|---|---|
| 20b94136 (21.6, 360×640) | 251 | 98.4% | 92.4% | 0.87 | 0.39 | 232 | 1.016 (28.4%) | 4.2° | 52.5% | +0 |
| 38bd2596 (30, 720×1280) | 359 | 99.2% | 93.3% | 0.90 | 0.64 | 332 | 0.737 (27.2%) | 6.6° | 25.6% | +3 |
| 5f7fdd10 (30, 720×1280) | 248 | 91.1% | 86.7% | 0.87 | 0.72 | 196 | 0.972 (29.4%) | 4.1° | 39.2% | +19 |
| 7a4a70be (30, 720×1280) | 188 | 99.5% | 98.4% | 0.92 | 0.84 | 185 | 0.696 (5.8%) | 5.8° | 13.7% | +0 |
| a5c8f53c (30, 720×1280) | 277 | 99.3% | 92.8% | 0.89 | 0.84 | 257 | 0.625 (31.3%) | 12.5° | 39.5% | +0 |
| ca088659 (30, 720×900) | 174 | 100.0% | 96.6% | 0.92 | 0.52 | 168 | 0.990 (15.8%) | 0.4° | 18.9% | +0 |

"Residual" is the median post-registration distance from Hough to YOLO, as a
percentage of the club's own on-screen reach. "Hough-only" counts frames where
Hough fired and YOLO did not — the coverage Hough actually contributes.

## Impact window

The ±20-frame window around impact is the only stretch `stats.ts` reads for
clubhead speed, so it's the coverage that matters.

| Clip | YOLO | Hough | Union | Gained from Hough |
|---|---|---|---|---|
| 20b94136 | 95.1% | 90.2% | 95.1% | +0 |
| 38bd2596 | 97.6% | 82.9% | 100.0% | +1 |
| 5f7fdd10 | 95.1% | 80.5% | 100.0% | +2 |
| 7a4a70be | 97.6% | 92.7% | 97.6% | +0 |
| a5c8f53c | 100.0% | 65.9% | 100.0% | +0 |
| ca088659 | 100.0% | 85.4% | 100.0% | +0 |

## Verdict: remove the Hough detector

Against the pre-agreed decision criteria:

1. **Coverage contribution is below the delete threshold.** Hough adds 22
   frames YOLO doesn't already have, across 1,497 — **1.5%**, under the ~3%
   bar. In the impact window it adds **3 frames across all six clips**. Four
   of six clips gain nothing at all.

2. **Registration is not stable enough to fuse.** The criterion was a
   radial-ratio spread (MAD/median) ≤ ~15%. Five of six clips fail it, four
   of them at 27–31%. Worse, the ratio's *median* swings from 0.625 to 1.016
   between clips, so there isn't a consistent offset to register even
   per-clip. The post-registration residual confirms it: a median of 25–52%
   of the club's on-screen reach on four clips, meaning that even after
   correction Hough's point lands nowhere near the clubhead. Fusing would
   inject exactly the fake velocity `stats.ts`'s "never mix detectors"
   caveat warns about.

3. **YOLO doesn't need the help.** 91–100% hit rate (97.9% overall) at 0.87–
   0.92 median confidence, and 95–100% inside the impact window. Hough is
   worse everywhere and much worse where it counts — 65.9% in one clip's
   impact window against YOLO's 100%.

The low angular disagreement (0.4–12.5°) confirms both detectors are looking
along the same shaft; they simply disagree, inconsistently, about how far
along it the clubhead is. That is precisely the failure mode a scalar
registration cannot fix.

So the reconciliation is removal, not fusion: delete `_detect_club_tip`, the
`club_tip` field, and the per-frame Canny + Hough pass, leaving YOLO as the
single clubhead signal. This also retires the "two detectors must never be
mixed" constraint threaded through `club.ts` and `stats.ts`.

## Incidental findings

- **`ball_tip` fired on 0 of 1,497 frames**, as expected — `models/ball.pt`
  has never been trained (`train_ball.py` doesn't exist either). Every swing
  therefore falls back to club-length or torso calibration and a fixed smash
  factor. The consuming code in `stats.ts` is written and tested; this is
  waiting only on a training run.
- **Hough's confidence tracks its usefulness**, ranging 0.39–0.84 by clip.
  The clip where it scored lowest (0.39) is also the lowest-resolution one
  (360×640), which fits a technique built on visible edges.
