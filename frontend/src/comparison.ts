import { PHASE_ORDER } from "./feedback.ts";
import { fetchReferenceAnalysis } from "./libraryApi.ts";
import type { LibraryEntry } from "./libraryApi.ts";
import { detectPhases } from "./phases.ts";
import type { SwingPhases } from "./phases.ts";
import type { AnalysisResponse, Handedness, View } from "./types.ts";

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
  const anchors = PHASE_ORDER.map((phase) => ({
    user: userPhases[phase],
    reference: referencePhases[phase],
  })).filter(
    (a): a is { user: number; reference: number } => a.user !== null && a.reference !== null,
  );
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
