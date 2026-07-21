import type { ClubPoint } from "./club";
import { midpoint, sideIndices, visiblePoint } from "./geometry";
import type { Point } from "./geometry";
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
// and club -- this can't detect a mishit, so it always assumes a good one.
const ASSUMED_SMASH_FACTOR = 1.48;

const INCHES_PER_MILE = 63360;
const FEET_PER_MILE = 5280;
const SECONDS_PER_HOUR = 3600;
const GRAVITY_FT_PER_S2 = 32.174;

// Sanity bound: a clubhead-speed estimate outside this range means the
// tracking (or the address-frame calibration it depends on) was almost
// certainly bad for this swing, not that the golfer is superhuman.
const MAX_PLAUSIBLE_CLUBHEAD_MPH = 160;

export interface SwingStats {
  /** Directly measured from tracked clubhead positions -- accuracy depends
   * entirely on tracking quality and the assumed club length, but it's not
   * a further-derived guess like the two below. */
  clubheadSpeedMph: number | null;
  /** clubheadSpeedMph * an assumed smash factor -- not a ball measurement,
   * since a normal video framerate can't resolve the ball's actual flight
   * (see stats.ts's module doc). */
  ballSpeedMph: number | null;
  /** Basic no-spin, no-drag projectile-motion estimate from ballSpeedMph and
   * the clubhead's direction of travel at impact as a launch-angle proxy.
   * Real carry depends heavily on backspin, which this can't measure at
   * all, so treat this as a rough directional number, not a real distance. */
  estCarryYards: number | null;
}

const NULL_STATS: SwingStats = { clubheadSpeedMph: null, ballSpeedMph: null, estCarryYards: null };

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

/**
 * Real-world scale (inches per normalized-distance unit), anchored on the
 * address frame's grip-to-clubhead distance standing in for
 * ASSUMED_CLUB_LENGTH_INCHES -- the only real-world reference available
 * without a depth camera or a calibration object in frame.
 */
function inchesPerNormalizedUnit(
  addressFrame: PoseFrame | undefined,
  addressClubPoint: ClubPoint | null,
  handedness: Handedness,
): number | null {
  if (!addressFrame) return null;
  const grip = gripPosition(addressFrame.landmarks, handedness);
  if (!grip || !addressClubPoint) return null;
  const normalizedLength = distance(grip, addressClubPoint);
  if (normalizedLength < 1e-4) return null;
  return ASSUMED_CLUB_LENGTH_INCHES / normalizedLength;
}

/**
 * Rough swing-stat estimates derived entirely from the club tracer's
 * gap-filled per-frame positions (see club.ts's fillClubGaps) plus the
 * detected address/impact phases -- no new tracking, just arithmetic over
 * data the app already collects. See each SwingStats field's doc comment
 * for how far its number is from an actual measurement.
 *
 * Returns all-null when there isn't enough to work with: address or impact
 * wasn't detected, the clubhead wasn't tracked at address (for
 * calibration) or in the frames immediately around impact (for speed), or
 * the resulting clubhead speed is outside MAX_PLAUSIBLE_CLUBHEAD_MPH (a
 * sign the tracking was bad for this swing, not that it's real).
 */
export function computeSwingStats(
  frames: PoseFrame[],
  clubTrack: (ClubPoint | null)[],
  phases: SwingPhases,
  handedness: Handedness,
): SwingStats {
  const { address, impact } = phases;
  if (address === null || impact === null) return NULL_STATS;
  if (impact <= 0 || impact >= frames.length - 1) return NULL_STATS;

  const scale = inchesPerNormalizedUnit(frames[address], clubTrack[address] ?? null, handedness);
  if (scale === null) return NULL_STATS;

  const before = clubTrack[impact - 1];
  const after = clubTrack[impact + 1];
  if (!before || !after) return NULL_STATS;

  const seconds = frames[impact + 1].t - frames[impact - 1].t;
  if (seconds <= 0) return NULL_STATS;

  const inches = distance(before, after) * scale;
  const clubheadSpeedMph = (inches / seconds) * (SECONDS_PER_HOUR / INCHES_PER_MILE);
  if (clubheadSpeedMph <= 0 || clubheadSpeedMph > MAX_PLAUSIBLE_CLUBHEAD_MPH) return NULL_STATS;

  const ballSpeedMph = clubheadSpeedMph * ASSUMED_SMASH_FACTOR;

  // Direction of clubhead travel around impact, as a launch-angle proxy --
  // not the ball's real launch angle, which also depends on dynamic loft
  // and spin (neither observable here). y grows downward in image space.
  const dx = after.x - before.x;
  const dy = after.y - before.y;
  const launchAngleRad = Math.atan2(-dy, Math.abs(dx));

  const ballSpeedFtPerSec = (ballSpeedMph * FEET_PER_MILE) / SECONDS_PER_HOUR;
  const rangeFeet = (ballSpeedFtPerSec ** 2 * Math.sin(2 * launchAngleRad)) / GRAVITY_FT_PER_S2;
  const estCarryYards = rangeFeet > 0 ? rangeFeet / 3 : null;

  return { clubheadSpeedMph, ballSpeedMph, estCarryYards };
}
