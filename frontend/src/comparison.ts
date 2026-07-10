import { PHASE_ORDER } from "./feedback.ts";
import { fetchReferenceAnalysis } from "./libraryApi.ts";
import type { LibraryEntry } from "./libraryApi.ts";
import { detectPhases } from "./phases.ts";
import type { SwingPhases } from "./phases.ts";
import type { AnalysisResponse, Handedness, PoseFrame, View } from "./types.ts";

export interface ReferenceSwing {
  entry: LibraryEntry;
  analysis: AnalysisResponse;
  phases: SwingPhases;
}

/**
 * Library entries comparable with a swing of the given view/handedness,
 * newest first. Cross-view comparison is visually meaningless and mixed
 * handedness would mirror every angle, so both must match. The first entry
 * is the default selection, preserving the old "most recent" auto-pick.
 */
export function matchingReferenceEntries(
  entries: LibraryEntry[],
  view: View,
  handedness: Handedness,
): LibraryEntry[] {
  return entries
    .filter((e) => e.view === view && e.handedness === handedness)
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : 0));
}

/** Fetches a library entry's full analysis and detects its swing phases. */
export async function loadReferenceSwing(entry: LibraryEntry): Promise<ReferenceSwing> {
  const analysis = await fetchReferenceAnalysis(entry.id);
  const phases = detectPhases(analysis.frames, analysis.handedness, analysis.fps);
  return { entry, analysis, phases };
}

/**
 * Time to seek a paused reference video to for a given frame index. Nudged a
 * quarter-frame past the frame boundary so that round(currentTime * fps)
 * lands back on the requested index after the seek — the same trick the
 * player's frame stepper uses to avoid rounding-boundary flips.
 */
export function referenceSeekTime(analysis: AnalysisResponse, refIndex: number): number {
  return analysis.frames[refIndex].t + 0.25 / analysis.fps;
}

/**
 * Maps a frame index in the user's swing to the "same moment" frame index in
 * a reference swing, so the two can be shown side by side like a synced
 * video even though they run at different tempos/lengths. Synced by
 * phase-checkpoint (address/takeaway/top/downswing/impact/followThrough):
 * frames between two phases detected on both sides are linearly interpolated
 * between that phase pair's frame indices; frames outside the first/last
 * shared phase clamp to that phase's reference frame rather than
 * extrapolating blindly. Returns null when no phase is detected on both
 * sides — there's nothing to anchor a mapping to.
 */
export function mapUserFrameToReference(
  userIndex: number,
  userPhases: SwingPhases,
  referencePhases: SwingPhases,
  referenceFrameCount: number,
): number | null {
  const anchors = sharedPhaseAnchors(userPhases, referencePhases);
  if (anchors.length === 0) return null;

  const clamp = (index: number) => Math.min(referenceFrameCount - 1, Math.max(0, Math.round(index)));

  if (userIndex <= anchors[0].user) return clamp(anchors[0].reference);
  if (userIndex >= anchors[anchors.length - 1].user) return clamp(anchors[anchors.length - 1].reference);

  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (userIndex >= a.user && userIndex <= b.user) {
      const t = b.user === a.user ? 0 : (userIndex - a.user) / (b.user - a.user);
      return clamp(a.reference + t * (b.reference - a.reference));
    }
  }
  return null;
}

export interface AnchorPair {
  user: number;
  reference: number;
}

/**
 * Phase checkpoints detected on both swings, in swing order — the anchor
 * points every user↔reference time mapping interpolates between.
 */
export function sharedPhaseAnchors(
  userPhases: SwingPhases,
  referencePhases: SwingPhases,
): AnchorPair[] {
  return PHASE_ORDER.map((phase) => ({
    user: userPhases[phase],
    reference: referencePhases[phase],
  })).filter((a): a is AnchorPair => a.user !== null && a.reference !== null);
}

export interface TimeAnchor {
  userTime: number;
  refTime: number;
}

/**
 * Converts frame-index anchor pairs to media-time pairs via each swing's
 * per-frame timestamps. Pairs whose user time fails to strictly increase are
 * dropped so no downstream segment ever divides by a zero-width interval.
 */
export function anchorTimePairs(
  anchors: AnchorPair[],
  userFrames: PoseFrame[],
  refFrames: PoseFrame[],
): TimeAnchor[] {
  const at = (frames: PoseFrame[], index: number) =>
    frames[Math.min(frames.length - 1, Math.max(0, index))].t;
  const result: TimeAnchor[] = [];
  for (const anchor of anchors) {
    const pair = { userTime: at(userFrames, anchor.user), refTime: at(refFrames, anchor.reference) };
    const prev = result[result.length - 1];
    if (prev && pair.userTime <= prev.userTime) continue;
    result.push(pair);
  }
  return result;
}

/**
 * Maps a user media time to the phase-aligned reference media time —
 * piecewise-linear between anchors, clamped to the first/last anchor's
 * reference time outside the shared range. Continuous (not frame-quantized)
 * so it can drive a playback-rate control loop, not just seeks.
 */
export function idealReferenceTime(userTime: number, anchors: TimeAnchor[]): number {
  if (userTime <= anchors[0].userTime) return anchors[0].refTime;
  const last = anchors[anchors.length - 1];
  if (userTime >= last.userTime) return last.refTime;
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (userTime >= a.userTime && userTime <= b.userTime) {
      const t = (userTime - a.userTime) / (b.userTime - a.userTime);
      return a.refTime + t * (b.refTime - a.refTime);
    }
  }
  return last.refTime;
}

export type SyncTarget =
  | { mode: "hold"; refTime: number }
  | { mode: "play"; refTime: number; baseRate: number };

/**
 * What the reference video should be doing while the master plays at
 * masterRate: frozen on an anchor frame outside the shared phase range (or
 * when there's only one anchor — nothing to interpolate), or playing at the
 * rate that makes the current phase segment span the same wall-clock time as
 * the master's. baseRate is unclamped; correctedPlaybackRate bounds it.
 */
export function referenceSyncTarget(
  userTime: number,
  anchors: TimeAnchor[],
  masterRate: number,
): SyncTarget {
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  if (anchors.length < 2 || userTime <= first.userTime || userTime >= last.userTime) {
    const refTime = userTime <= first.userTime ? first.refTime : last.refTime;
    return { mode: "hold", refTime };
  }
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (userTime >= a.userTime && userTime <= b.userTime) {
      const baseRate = ((b.refTime - a.refTime) / (b.userTime - a.userTime)) * masterRate;
      return { mode: "play", refTime: idealReferenceTime(userTime, anchors), baseRate };
    }
  }
  return { mode: "hold", refTime: last.refTime };
}

// Proportional drift controller for keeping the playing reference video on
// its ideal phase-aligned time without ever seeking (a seek would skip
// frames, which is exactly what rate-matched playback exists to avoid).
const RATE_CORRECTION_GAIN = 2; // rate factor change per second of error
const RATE_CORRECTION_SPAN = 0.15; // nudge capped at ±15% of the base rate
export const MIN_PLAYBACK_RATE = 0.0625; // Chromium-supported bounds
export const MAX_PLAYBACK_RATE = 16;
/** Beyond this the master jumped (scrub) — realign with one seek instead. */
export const CATCHUP_SEEK_THRESHOLD = 0.3;

/**
 * Playback rate that gently steers the reference toward zero alignment
 * error. errorSeconds = ideal reference time − actual reference time
 * (positive means the reference is behind and should speed up). At ±15% cap
 * a ~150 ms error converges in about a second of 1x playback.
 */
export function correctedPlaybackRate(baseRate: number, errorSeconds: number): number {
  const nudge = Math.min(
    1 + RATE_CORRECTION_SPAN,
    Math.max(1 - RATE_CORRECTION_SPAN, 1 + RATE_CORRECTION_GAIN * errorSeconds),
  );
  return Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, baseRate * nudge));
}
