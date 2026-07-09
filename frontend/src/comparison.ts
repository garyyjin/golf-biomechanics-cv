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
