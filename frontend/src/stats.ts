import { rejectOutliers } from "./club";
import type { ClubPoint } from "./club";
import { LEFT_HIP, LEFT_SHOULDER, RIGHT_HIP, RIGHT_SHOULDER, findAddressFrame, midpoint, sideIndices, visiblePoint } from "./geometry";
import type { Point } from "./geometry";
import { interpolateGaps } from "./phases";
import type { SwingPhases } from "./phases";
import type { Handedness, PoseFrame } from "./types";

// There's no way to know which club was actually used from video alone --
// no depth/calibration reference exists in a single 2D camera. This is the
// one assumption every number below inherits when calibration falls all the
// way back to it (see CalibrationSource): a different real club length
// shifts clubhead speed (and everything derived from it) by that same
// ratio. Driver length is the most common "how far did I hit it" context.
export const ASSUMED_CLUB_LENGTH_INCHES = 45;

// Regulation golf ball diameter (USGA/R&A minimum, effectively the
// standard size in play) -- unlike club length, this is a genuine physical
// constant rather than an assumption about which club the golfer swung, so
// it's tried first as the distance-calibration reference whenever the
// ball's detected box size gives a usable reading (see
// inchesPerNormalizedUnitFromBall).
export const GOLF_BALL_DIAMETER_INCHES = 1.68;

// A detected ball's box aspect ratio (long side / short side) shouldn't
// stray far from 1 -- a ball is round. A box significantly off square
// usually means motion blur smeared the box along the direction of travel
// (common just after impact), which would read as a bigger or smaller
// "diameter" than the ball's true size depending on which axis it smeared
// along. Rejecting those keeps the calibration reading anchored to clean,
// blur-free detections -- typically found before the ball starts moving,
// i.e. at address.
const BALL_BOX_MAX_ASPECT_RATIO = 1.3;

// Rough average adult torso length (mid-hip to mid-shoulder, inches), used
// only as the last-resort calibration reference when neither the ball's box
// size nor the grip-to-clubhead-at-address distance could be read from this
// clip (see CalibrationSource). Real torso length varies by golfer -- this
// is a population average, not a measurement -- but shoulder/hip landmarks
// are already required for phase detection to have found address/impact at
// all, so this keeps calibration (and therefore every number below) from
// failing outright just because neither detector caught the ball or club.
const ASSUMED_TORSO_LENGTH_INCHES = 20;

// Typical smash factor (ball speed / clubhead speed) for a solid,
// center-face driver strike. Real smash factor varies with strike quality
// and club -- used only as a fallback when the ball itself isn't detected
// (see ballSpeedSource on SwingStats); this can't detect a mishit, so it
// always assumes a good one.
const ASSUMED_SMASH_FACTOR = 1.48;

const INCHES_PER_MILE = 63360;
const SECONDS_PER_HOUR = 3600;

// Carry (yards) as a linear function of ball speed (mph), fit on the 1,137
// driver ("W1") shots in CaddieSet (https://github.com/damilab/CaddieSet,
// MIT licensed) -- a public dataset of 1,757 real shots from 8 golfers
// captured with a camera-based launch monitor. r^2 = 0.84. Regenerate with
// `backend/training/calibrate_carry.py`. This replaces a no-spin/no-drag
// projectile-motion formula with a driver-shaped real-world relationship;
// it still assumes a driver strike, matching ASSUMED_CLUB_LENGTH_INCHES.
// CaddieSet has no clubhead-speed column, so it can't calibrate
// ASSUMED_SMASH_FACTOR above -- only this carry step, and it's equally
// valid whether the ball speed fed into it was measured or estimated.
export const DRIVER_CARRY_REGRESSION = {
  slopeYardsPerMph: 2.2232,
  interceptYards: -92.888,
  minBallSpeedMph: 89.3,
  maxBallSpeedMph: 155.2,
};

/**
 * Empirical carry estimate from ball speed alone, clamping the input to the
 * regression's training range to avoid extrapolating a linear fit past data
 * it was never shown (e.g. the tiny synthetic speeds a mishit or a bad
 * tracking read can produce). Still gated on a positive launch-angle proxy
 * by the caller -- this only replaces the *magnitude* formula, not the
 * "was this even a real strike" check.
 */
export function estimateCarryYards(ballSpeedMph: number): number {
  const { slopeYardsPerMph, interceptYards, minBallSpeedMph, maxBallSpeedMph } = DRIVER_CARRY_REGRESSION;
  const clamped = Math.min(Math.max(ballSpeedMph, minBallSpeedMph), maxBallSpeedMph);
  return Math.max(0, slopeYardsPerMph * clamped + interceptYards);
}

// Sanity ceiling: a clubhead-speed estimate above this means the tracking
// (or the calibration it depends on) was almost certainly bad for this
// swing, not that the golfer is superhuman. Used as a clamp rather than a
// null-out (see computeFromSource) -- a bounded, directionally-reasonable
// number still beats leaving the whole panel blank over one bad detection.
const MAX_PLAUSIBLE_CLUBHEAD_MPH = 160;

// How many frames on either side of impact to look for real (non-
// interpolated) detections when picking the pair used to measure clubhead
// speed. Deliberately generous (roughly a full downswing plus follow-through
// at typical frame rates) -- unlike a "nearest real detection on each side"
// search, widening this window doesn't risk diluting the reading, because
// fastestAdjacentPair (below) doesn't take whichever pair is nearest
// impact's frame index, it takes whichever *adjacent* pair implies the
// highest speed. A widely spaced pair can only read slower than the true
// peak (it's averaging across more of the swing, including the slower
// parts), so it can never beat a tighter, faster pair that exists closer to
// the real impact instant -- widening the window just gives it a better
// chance of finding that tighter pair somewhere in a wide detector miss,
// instead of forcing a choice between "nothing" and "whatever's nearest,
// however diluted".
const IMPACT_SEARCH_WINDOW_FRAMES = 20;

// How many frames after impact to look for the ball's own real detections.
// Shorter than the clubhead's window on purpose: the ball only exists as a
// tracked target once it's airborne, and by ~half a second after impact
// (this window at typical frame rates) it's usually left the frame entirely
// -- searching further out would just find nothing or, worse, a false
// detection unrelated to this shot.
const BALL_SEARCH_WINDOW_FRAMES = 15;

// How many frames on either side of address to accept a calibration point
// from. Address is the middle of a settled, near-stationary stretch (see
// phases.ts's ADDRESS_MIN_HOLD_SECONDS) -- the clubhead barely moves across
// this whole window, so any real or gap-filled detection inside it is
// essentially the same reference length as one at the exact address frame,
// without requiring a detection on the single hardest (smallest,
// low-contrast, stationary) frame in the swing to get a calibration at all.
const ADDRESS_CALIBRATION_WINDOW_FRAMES = 5;

export type SwingStatsDiagnostic =
  | { gate: "phase-detection"; address: number | null; impact: number | null }
  | { gate: "impact-at-clip-edge"; impact: number; frameCount: number }
  | { gate: "scale-calibration" }
  | { gate: "no-detection-near-impact"; impact: number }
  | { gate: "implausible-speed"; clubheadSpeedMph: number }
  | { gate: "ok" };

/** Which real-world reference calibrated the pixel-to-inch scale a swing's
 * numbers are built on -- tried in this order (see computeFromSource):
 * "ball" (the detected ball's own box size against its known fixed
 * diameter), "club-length" (grip-to-clubhead-at-address against
 * ASSUMED_CLUB_LENGTH_INCHES), "body-proportion" (torso length against
 * ASSUMED_TORSO_LENGTH_INCHES, the last resort). Null alongside all-null
 * stats, when none of the three produced a scale. */
export type CalibrationSource = "ball" | "club-length" | "body-proportion";

export interface SwingStats {
  /** The fastest segment between two real (non-interpolated) detections
   * found near impact (see fastestAdjacentPair) -- deliberately not a
   * gap-filled track, whose interpolated points are a straight-line average
   * over however wide the surrounding miss is, which reads as a plausible
   * number but is actually just the *average* speed across that whole span
   * (much lower than the true peak at impact). Tried against the YOLO
   * detector first, falling back to the classical detector if YOLO alone
   * couldn't produce a result (see computeFromSource) -- a miss from one
   * detector no longer nulls the whole panel. Accuracy still depends
   * entirely on detector quality and the assumed club length, but it's not
   * a further-derived guess like the two below. */
  clubheadSpeedMph: number | null;
  /** Measured directly from the ball's own tracked displacement just after
   * impact when a ball detection exists (see ballSpeedSource); otherwise
   * clubheadSpeedMph * an assumed smash factor, since a normal video
   * framerate can't always resolve the ball's actual flight. */
  ballSpeedMph: number | null;
  /** Whether ballSpeedMph came from an actual tracked ball ("measured") or
   * the smash-factor fallback ("estimated"). Null alongside a null
   * ballSpeedMph. */
  ballSpeedSource: "measured" | "estimated" | null;
  /** ballSpeedMph run through DRIVER_CARRY_REGRESSION (an empirical
   * driver-carry curve fit on real shots), gated on a positive launch-angle
   * proxy -- a level or downward impact direction is treated as a mishit
   * and yields null rather than a fabricated number. Still an estimate:
   * real carry also depends on strike quality and spin axis, neither
   * observable here. */
  estCarryYards: number | null;
  /** See CalibrationSource's doc comment. Null alongside a null
   * clubheadSpeedMph. */
  calibrationSource: CalibrationSource | null;
}

const NULL_STATS: Omit<SwingStats, "diagnostic"> = {
  clubheadSpeedMph: null,
  ballSpeedMph: null,
  ballSpeedSource: null,
  estCarryYards: null,
  calibrationSource: null,
};

function gripPosition(landmarks: PoseFrame["landmarks"], handedness: Handedness): Point | null {
  if (!landmarks) return null;
  const side = sideIndices(handedness);
  const lead = visiblePoint(landmarks, side.leadWrist);
  const trail = visiblePoint(landmarks, side.trailWrist);
  return lead && trail ? midpoint(lead, trail) : null;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Same gap-bridging shape as club.ts's fillClubGaps, but over a single
 * already-outlier-rejected track instead of the two-detector fused one --
 * kept local to stats.ts since speed math needs each detector's gaps filled
 * independently, never mixed (see computeFromSource). */
function gapFilledTrack(real: (ClubPoint | null)[]): (ClubPoint | null)[] {
  const xs = interpolateGaps(real.map((p) => p?.x ?? null));
  const ys = interpolateGaps(real.map((p) => p?.y ?? null));
  return xs.map((x, i) => {
    const y = ys[i];
    return x !== null && y !== null ? { x, y } : null;
  });
}

/**
 * Real-world scale (inches per normalized-distance unit), anchored on a
 * grip-to-clubhead distance near the address frame standing in for
 * ASSUMED_CLUB_LENGTH_INCHES -- the only real-world reference available
 * without a depth camera or a calibration object in frame. Searches
 * ADDRESS_CALIBRATION_WINDOW_FRAMES on either side of address (see its doc
 * comment) rather than requiring a detection on that exact frame.
 */
function inchesPerNormalizedUnit(
  frames: PoseFrame[],
  addressIndex: number,
  filledTrack: (ClubPoint | null)[],
  handedness: Handedness,
): number | null {
  const grip = gripPosition(frames[addressIndex].landmarks, handedness);
  if (!grip) return null;
  const lo = Math.max(0, addressIndex - ADDRESS_CALIBRATION_WINDOW_FRAMES);
  const hi = Math.min(filledTrack.length - 1, addressIndex + ADDRESS_CALIBRATION_WINDOW_FRAMES);
  for (let i = lo; i <= hi; i++) {
    const point = filledTrack[i];
    if (!point) continue;
    const normalizedLength = distance(grip, point);
    if (normalizedLength < 1e-4) continue;
    return ASSUMED_CLUB_LENGTH_INCHES / normalizedLength;
  }
  return null;
}

/**
 * Real-world scale from the ball's own detected box size -- a golf ball's
 * diameter is a fixed real-world constant (GOLF_BALL_DIAMETER_INCHES), so
 * unlike inchesPerNormalizedUnit above, this doesn't depend on which club
 * was swung or on the clubhead being visible at address. Scans every frame
 * in the clip (not just near address, since the ball's size reads the same
 * whether it's sitting still or airborne) for a detection with a usable box
 * size, discards ones whose box isn't roughly square (see
 * BALL_BOX_MAX_ASPECT_RATIO -- motion blur elongates the box once the ball
 * is moving), and takes the median normalized diameter across the rest --
 * median rather than mean or first-hit so one unusually large/small stray
 * reading can't skew the result.
 */
function inchesPerNormalizedUnitFromBall(frames: PoseFrame[]): number | null {
  const diameters: number[] = [];
  for (const f of frames) {
    const box = f.ball_tip;
    if (!box || box.width === undefined || box.height === undefined) continue;
    const { width, height } = box;
    if (width <= 0 || height <= 0) continue;
    const aspect = width > height ? width / height : height / width;
    if (aspect > BALL_BOX_MAX_ASPECT_RATIO) continue;
    diameters.push((width + height) / 2);
  }
  if (diameters.length === 0) return null;
  diameters.sort((a, b) => a - b);
  const mid = Math.floor(diameters.length / 2);
  const median = diameters.length % 2 === 0 ? (diameters[mid - 1] + diameters[mid]) / 2 : diameters[mid];
  return GOLF_BALL_DIAMETER_INCHES / median;
}

/** Mid-shoulder-to-mid-hip distance for one frame's landmarks, or null if
 * any of the four aren't visible -- the same torso-length idea geometry.ts's
 * computeComparisonTransform and clubTipEstimate use, applied here as a
 * real-world scale reference instead of a unitless normalization. */
function torsoLength(landmarks: PoseFrame["landmarks"]): number | null {
  if (!landmarks) return null;
  const ls = visiblePoint(landmarks, LEFT_SHOULDER);
  const rs = visiblePoint(landmarks, RIGHT_SHOULDER);
  const lh = visiblePoint(landmarks, LEFT_HIP);
  const rh = visiblePoint(landmarks, RIGHT_HIP);
  if (!ls || !rs || !lh || !rh) return null;
  return distance(midpoint(ls, rs), midpoint(lh, rh));
}

/**
 * Real-world scale from an assumed average torso length
 * (ASSUMED_TORSO_LENGTH_INCHES) -- the last-resort calibration reference
 * when neither the ball's box size nor the grip-to-clubhead-at-address
 * distance produced a scale. Searches the same address-centered window as
 * inchesPerNormalizedUnit (shoulders/hips barely move there either) rather
 * than requiring the exact address frame.
 */
function inchesPerNormalizedUnitFromTorso(frames: PoseFrame[], addressIndex: number): number | null {
  const lo = Math.max(0, addressIndex - ADDRESS_CALIBRATION_WINDOW_FRAMES);
  const hi = Math.min(frames.length - 1, addressIndex + ADDRESS_CALIBRATION_WINDOW_FRAMES);
  for (let i = lo; i <= hi; i++) {
    const length = torsoLength(frames[i].landmarks);
    if (length !== null && length > 1e-4) return ASSUMED_TORSO_LENGTH_INCHES / length;
  }
  return null;
}

/**
 * Among the real (non-interpolated) detections within [searchFrom,
 * searchTo], the adjacent pair implying the *highest* speed -- not
 * necessarily the pair nearest either end of the range. A well-struck
 * downswing accelerates continuously up to impact then decelerates, so the
 * fastest observed segment anywhere in the window is the best available
 * proxy for the true peak speed, and a slower, more-widely-spaced pair (the
 * kind a detector miss right at the moment that matters would otherwise
 * force a "nearest neighbor" search to fall back on) simply can't win the
 * comparison. Ranks by raw normalized-distance-per-second, not real-world
 * mph -- the scale factor is constant across all candidate pairs, so it
 * doesn't affect which one ranks highest.
 *
 * Shared by both the clubhead-speed search (around impact) and the
 * ball-speed search (just after impact) -- same "fastest adjacent real
 * pair in a window" logic, different window and track.
 */
function fastestAdjacentPair(
  frames: PoseFrame[],
  real: (ClubPoint | null)[],
  searchFrom: number,
  searchTo: number,
): { beforeIndex: number; afterIndex: number } | null {
  const lo = Math.max(0, searchFrom);
  const hi = Math.min(real.length - 1, searchTo);
  const hitIndices: number[] = [];
  for (let i = lo; i <= hi; i++) {
    if (real[i]) hitIndices.push(i);
  }

  let best: { beforeIndex: number; afterIndex: number; speed: number } | null = null;
  for (let k = 0; k + 1 < hitIndices.length; k++) {
    const i = hitIndices[k];
    const j = hitIndices[k + 1];
    const seconds = frames[j].t - frames[i].t;
    if (seconds <= 0) continue;
    const speed = distance(real[i]!, real[j]!) / seconds;
    if (!best || speed > best.speed) best = { beforeIndex: i, afterIndex: j, speed };
  }
  return best;
}

interface SourceResult {
  stats: Omit<SwingStats, "diagnostic">;
  diagnostic: SwingStatsDiagnostic;
}

/**
 * Runs the full clubhead-speed/ball-speed/carry computation against one
 * clubhead-tip signal (`tip`) -- either the YOLO detector or the classical
 * one (see computeSwingStats). Deliberately does not mix the two detectors
 * within a single computed number: a calibration point from one paired with
 * a speed segment from the other risks a fixed systematic offset between
 * where each detector thinks the "tip" is, which would read as fake
 * velocity on a short, high-speed segment. Each attempt is entirely
 * self-contained; computeSwingStats picks whichever attempt succeeds.
 */
function computeFromSource(
  frames: PoseFrame[],
  phases: SwingPhases,
  handedness: Handedness,
  tip: (f: PoseFrame) => ClubPoint | null,
): SourceResult {
  const { address, impact } = phases;
  if (address === null || impact === null) {
    return { stats: NULL_STATS, diagnostic: { gate: "phase-detection", address, impact } };
  }
  // Only bails when there's genuinely no frame data to compute anything
  // from (a 0- or 1-frame clip) -- impact sitting right at the clip's edge
  // no longer blocks on its own, since the search windows below already
  // clamp to the frames that actually exist, and no-detection-near-impact
  // (also below) is what fires if that leaves nothing to measure.
  if (frames.length < 2) {
    return { stats: NULL_STATS, diagnostic: { gate: "impact-at-clip-edge", impact, frameCount: frames.length } };
  }

  const real = rejectOutliers(frames.map(tip));
  const filled = gapFilledTrack(real);

  // Tries three real-world scale references in order, each only attempted
  // once the one before it fails: the ball's own detected size (a fixed
  // physical constant, independent of club/camera framing), then the
  // existing grip-to-clubhead-at-address distance, then an assumed average
  // torso length as a last resort -- see each function's doc comment.
  // Stacking all three like this is what makes the scale-calibration gate
  // below effectively unreachable except when pose landmarks themselves are
  // missing near address.
  const ballScale = inchesPerNormalizedUnitFromBall(frames);
  const clubScale = ballScale === null ? inchesPerNormalizedUnit(frames, address, filled, handedness) : null;
  const torsoScale =
    ballScale === null && clubScale === null ? inchesPerNormalizedUnitFromTorso(frames, address) : null;
  const scale = ballScale ?? clubScale ?? torsoScale;
  const calibrationSource: CalibrationSource | null =
    ballScale !== null ? "ball" : clubScale !== null ? "club-length" : torsoScale !== null ? "body-proportion" : null;
  if (scale === null || calibrationSource === null) {
    return { stats: NULL_STATS, diagnostic: { gate: "scale-calibration" } };
  }

  // Search the real (pre-interpolation) detections, not the gap-filled
  // track -- an interpolated point there is a straight-line average over
  // however wide the surrounding miss is, which would silently understate
  // impact speed rather than reporting it honestly as unavailable. Never
  // searches at or before address: the club is stationary there by
  // definition, so it's never a legitimate impact-speed candidate. Tries a
  // tight window around impact first (the fastest real segment there is the
  // best available proxy for true peak speed -- see fastestAdjacentPair's
  // doc comment), then falls back to searching the entire rest of the clip
  // for any real adjacent pair at all, so a detector miss right around
  // impact doesn't null the whole panel when a usable pair exists somewhere
  // else in the swing.
  const segment =
    fastestAdjacentPair(
      frames,
      real,
      Math.max(address + 1, impact - IMPACT_SEARCH_WINDOW_FRAMES),
      impact + IMPACT_SEARCH_WINDOW_FRAMES,
    ) ?? fastestAdjacentPair(frames, real, address + 1, frames.length - 1);
  if (!segment) {
    return { stats: NULL_STATS, diagnostic: { gate: "no-detection-near-impact", impact } };
  }
  const before = real[segment.beforeIndex]!;
  const after = real[segment.afterIndex]!;
  // fastestAdjacentPair only ever selects pairs with a positive time delta.
  const seconds = frames[segment.afterIndex].t - frames[segment.beforeIndex].t;

  const inches = distance(before, after) * scale;
  const rawClubheadSpeedMph = (inches / seconds) * (SECONDS_PER_HOUR / INCHES_PER_MILE);
  if (rawClubheadSpeedMph <= 0) {
    return { stats: NULL_STATS, diagnostic: { gate: "implausible-speed", clubheadSpeedMph: rawClubheadSpeedMph } };
  }
  // A reading above the plausible ceiling is almost always a bad detection
  // somewhere in the swing rather than a real one, but clamping it to the
  // ceiling still gives a bounded, directionally-reasonable number instead
  // of leaving the whole panel blank (see MAX_PLAUSIBLE_CLUBHEAD_MPH).
  const clubheadSpeedMph = Math.min(rawClubheadSpeedMph, MAX_PLAUSIBLE_CLUBHEAD_MPH);

  // Direction of clubhead travel around impact, as a fallback launch-angle
  // proxy -- not the ball's real launch angle, which also depends on
  // dynamic loft and spin (neither observable here). y grows downward in
  // image space. Overridden below by the ball's own direction whenever a
  // real ball measurement exists.
  let launchAngleRad = Math.atan2(-(after.y - before.y), Math.abs(after.x - before.x));

  const realBall = rejectOutliers(frames.map((f) => f.ball_tip ?? null));
  const ballSegment = fastestAdjacentPair(frames, realBall, impact, impact + BALL_SEARCH_WINDOW_FRAMES);

  let ballSpeedMph: number;
  let ballSpeedSource: "measured" | "estimated";
  if (ballSegment) {
    const ballBefore = realBall[ballSegment.beforeIndex]!;
    const ballAfter = realBall[ballSegment.afterIndex]!;
    const ballSeconds = frames[ballSegment.afterIndex].t - frames[ballSegment.beforeIndex].t;
    const ballInches = distance(ballBefore, ballAfter) * scale;
    ballSpeedMph = (ballInches / ballSeconds) * (SECONDS_PER_HOUR / INCHES_PER_MILE);
    ballSpeedSource = "measured";
    launchAngleRad = Math.atan2(-(ballAfter.y - ballBefore.y), Math.abs(ballAfter.x - ballBefore.x));
  } else {
    ballSpeedMph = clubheadSpeedMph * ASSUMED_SMASH_FACTOR;
    ballSpeedSource = "estimated";
  }

  const estCarryYards = launchAngleRad > 0 ? estimateCarryYards(ballSpeedMph) : null;

  return {
    stats: { clubheadSpeedMph, ballSpeedMph, ballSpeedSource, estCarryYards, calibrationSource },
    diagnostic: { gate: "ok" },
  };
}

/**
 * Ultimate fallback address/impact indices from raw wrist-position speed,
 * used only when detectPhases (phases.ts) couldn't find a full swing shape
 * at all -- too little visible motion, too few valid frames, or a noisy
 * tail for its heuristics to trust. Address is just the first frame with any
 * visible pose (same as geometry.ts's findAddressFrame); impact is
 * approximated as the second frame of whichever consecutive pair of valid
 * grip positions moved fastest anywhere in the clip -- a golf downswing is
 * by far the fastest hand motion in a swing, so the single fastest
 * frame-to-frame jump is still a reasonable proxy for "around impact" even
 * without the full phase heuristic. Returns null if there's no visible pose
 * anywhere, or fewer than two valid grip positions to compare.
 */
function estimatePhasesFromHandVelocity(
  frames: PoseFrame[],
  handedness: Handedness,
): { address: number; impact: number } | null {
  const addressFrame = findAddressFrame(frames);
  if (!addressFrame) return null;
  const addressIndex = frames.indexOf(addressFrame);

  let best: { index: number; speed: number } | null = null;
  let prevIndex: number | null = null;
  let prevPoint: Point | null = null;
  for (let i = 0; i < frames.length; i++) {
    const point = gripPosition(frames[i].landmarks, handedness);
    if (point && prevPoint !== null && prevIndex !== null) {
      const seconds = frames[i].t - frames[prevIndex].t;
      if (seconds > 0) {
        const speed = distance(point, prevPoint) / seconds;
        if (!best || speed > best.speed) best = { index: i, speed };
      }
    }
    if (point) {
      prevPoint = point;
      prevIndex = i;
    }
  }
  if (!best || best.index <= addressIndex) return null;
  return { address: addressIndex, impact: best.index };
}

/** phases as-is when detectPhases found both address and impact; otherwise
 * estimatePhasesFromHandVelocity's proxy substituted in for just those two
 * fields, or phases unchanged if even that proxy found nothing. */
function withPhaseFallback(frames: PoseFrame[], phases: SwingPhases, handedness: Handedness): SwingPhases {
  if (phases.address !== null && phases.impact !== null) return phases;
  const estimate = estimatePhasesFromHandVelocity(frames, handedness);
  return estimate ? { ...phases, address: estimate.address, impact: estimate.impact } : phases;
}

/**
 * Rough swing-stat estimates derived entirely from per-frame clubhead (and,
 * where available, ball) tracking plus the detected address/impact phases --
 * no new tracking, just arithmetic over data the app already collects. See
 * each SwingStats field's doc comment for how far its number is from an
 * actual measurement.
 *
 * Tries the YOLO clubhead detector first, then the classical one, so a miss
 * from either alone doesn't null the whole panel (see computeFromSource);
 * the returned diagnostic reflects whichever attempt's failure is more
 * informative (YOLO's, since it's tried first and is the primary detector).
 *
 * When detectPhases itself couldn't find address/impact, falls back to
 * estimatePhasesFromHandVelocity's raw-motion proxy rather than giving up
 * immediately -- still best-effort arithmetic over existing data, just with
 * a cruder notion of "when did the swing happen."
 */
export function computeSwingStats(
  frames: PoseFrame[],
  phases: SwingPhases,
  handedness: Handedness,
): SwingStats {
  const usablePhases = withPhaseFallback(frames, phases, handedness);

  const fromYolo = computeFromSource(frames, usablePhases, handedness, (f) => f.club_tip_yolo ?? null);
  if (fromYolo.stats.clubheadSpeedMph !== null) {
    return { ...fromYolo.stats, diagnostic: fromYolo.diagnostic };
  }

  const fromClassical = computeFromSource(frames, usablePhases, handedness, (f) => f.club_tip ?? null);
  if (fromClassical.stats.clubheadSpeedMph !== null) {
    return { ...fromClassical.stats, diagnostic: fromClassical.diagnostic };
  }

  return { ...NULL_STATS, diagnostic: fromYolo.diagnostic };
}
