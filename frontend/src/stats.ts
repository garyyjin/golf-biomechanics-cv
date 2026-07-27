import { rejectOutliers } from "./club";
import type { ClubPoint } from "./club";
import { midpoint, sideIndices, visiblePoint } from "./geometry";
import type { Point } from "./geometry";
import { interpolateGaps } from "./phases";
import type { SwingPhases } from "./phases";
import type { Handedness, PoseFrame } from "./types";

// There's no way to know which club was actually used from video alone --
// no depth/calibration reference exists in a single 2D camera. This is the
// one assumption every number below inherits: a different real club length
// shifts clubhead speed (and everything derived from it) by that same
// ratio. Driver length is the most common "how far did I hit it" context.
export const ASSUMED_CLUB_LENGTH_INCHES = 45;

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

// Sanity bound: a clubhead-speed estimate outside this range means the
// tracking (or the address-frame calibration it depends on) was almost
// certainly bad for this swing, not that the golfer is superhuman.
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
}

const NULL_STATS: Omit<SwingStats, "diagnostic"> = {
  clubheadSpeedMph: null,
  ballSpeedMph: null,
  ballSpeedSource: null,
  estCarryYards: null,
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
  if (impact <= 0 || impact >= frames.length - 1) {
    return { stats: NULL_STATS, diagnostic: { gate: "impact-at-clip-edge", impact, frameCount: frames.length } };
  }

  const real = rejectOutliers(frames.map(tip));
  const filled = gapFilledTrack(real);

  const scale = inchesPerNormalizedUnit(frames, address, filled, handedness);
  if (scale === null) {
    return { stats: NULL_STATS, diagnostic: { gate: "scale-calibration" } };
  }

  // Search the real (pre-interpolation) detections, not the gap-filled
  // track -- an interpolated point there is a straight-line average over
  // however wide the surrounding miss is, which would silently understate
  // impact speed rather than reporting it honestly as unavailable. Never
  // searches at or before address: the club is stationary there by
  // definition, so it's never a legitimate impact-speed candidate.
  const segment = fastestAdjacentPair(
    frames,
    real,
    Math.max(address + 1, impact - IMPACT_SEARCH_WINDOW_FRAMES),
    impact + IMPACT_SEARCH_WINDOW_FRAMES,
  );
  if (!segment) {
    return { stats: NULL_STATS, diagnostic: { gate: "no-detection-near-impact", impact } };
  }
  const before = real[segment.beforeIndex]!;
  const after = real[segment.afterIndex]!;
  // fastestAdjacentPair only ever selects pairs with a positive time delta.
  const seconds = frames[segment.afterIndex].t - frames[segment.beforeIndex].t;

  const inches = distance(before, after) * scale;
  const clubheadSpeedMph = (inches / seconds) * (SECONDS_PER_HOUR / INCHES_PER_MILE);
  if (clubheadSpeedMph <= 0 || clubheadSpeedMph > MAX_PLAUSIBLE_CLUBHEAD_MPH) {
    return { stats: NULL_STATS, diagnostic: { gate: "implausible-speed", clubheadSpeedMph } };
  }

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
    stats: { clubheadSpeedMph, ballSpeedMph, ballSpeedSource, estCarryYards },
    diagnostic: { gate: "ok" },
  };
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
 */
export function computeSwingStats(
  frames: PoseFrame[],
  phases: SwingPhases,
  handedness: Handedness,
): SwingStats {
  const fromYolo = computeFromSource(frames, phases, handedness, (f) => f.club_tip_yolo ?? null);
  if (fromYolo.stats.clubheadSpeedMph !== null) {
    return { ...fromYolo.stats, diagnostic: fromYolo.diagnostic };
  }

  const fromClassical = computeFromSource(frames, phases, handedness, (f) => f.club_tip ?? null);
  if (fromClassical.stats.clubheadSpeedMph !== null) {
    return { ...fromClassical.stats, diagnostic: fromClassical.diagnostic };
  }

  return { ...NULL_STATS, diagnostic: fromYolo.diagnostic };
}
