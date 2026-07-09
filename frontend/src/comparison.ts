import { PHASE_ORDER } from "./feedback.ts";
import { fetchReferenceAnalysis, listReferenceSwings } from "./libraryApi.ts";
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
 * Picks the most recently uploaded reference-library swing matching the
 * given view/handedness and returns its full analysis plus detected phases,
 * or null if the library has no matching entry. There's no manual picker —
 * "most recent" is the whole selection policy, matching the rest of this
 * app's automatic (no-button) library behavior.
 */
export async function findLatestReferenceSwing(
  view: View,
  handedness: Handedness,
): Promise<ReferenceSwing | null> {
  const entries = await listReferenceSwings();
  const matches = entries.filter((e) => e.view === view && e.handedness === handedness);
  if (matches.length === 0) return null;

  const latest = matches.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
  const analysis = await fetchReferenceAnalysis(latest.id);
  const phases = detectPhases(analysis.frames, analysis.handedness, analysis.fps);
  return { entry: latest, analysis, phases };
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
