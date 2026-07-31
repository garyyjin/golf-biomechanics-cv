import { BASE_URL, request, requestJson } from "./http";
import type { SwingSummary } from "./swingSummary";
import type { AnalysisResponse, Handedness, View } from "./types";

export interface HistoryEntry {
  id: string;
  /** The uploaded file's original name — kept immutable so a renamed swing
   * can still be traced back to its source clip. */
  filename: string;
  /** User-editable display name; defaults to the filename. */
  label: string;
  view: View;
  handedness: Handedness;
  createdAt: string;
  /** Null while analysis is still running, or when the client went away
   * before posting one. The history screen treats that the same as a stale
   * summary and computes it. */
  summary: SwingSummary | null;
}

export interface HistoryResponse {
  swings: HistoryEntry[];
  /** Disk used by all stored swings. Surfaced because swings are kept
   * indefinitely — there's no retention cap by design. */
  totalBytes: number;
}

export function listSwings(): Promise<HistoryResponse> {
  return request("/swings");
}

export function fetchSwingAnalysis(id: string): Promise<AnalysisResponse> {
  return request(`/swings/${id}/analysis`);
}

export function swingVideoUrl(id: string): string {
  return `${BASE_URL}/swings/${id}/video`;
}

export function saveSwingSummary(id: string, summary: SwingSummary): Promise<HistoryEntry> {
  return requestJson(`/swings/${id}/summary`, "POST", summary);
}

export function renameSwing(id: string, label: string): Promise<HistoryEntry> {
  return requestJson(`/swings/${id}`, "PATCH", { label });
}

export function deleteSwing(id: string): Promise<{ totalBytes: number }> {
  return request(`/swings/${id}`, { method: "DELETE" });
}
