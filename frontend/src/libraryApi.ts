import type { MetricId, MetricRange, Phase } from "./benchmarks";
import type { SwingSample } from "./calibration";
import { BASE_URL, request, requestJson } from "./http";
import type { AnalysisResponse, Handedness, View } from "./types";

export interface LibraryEntry {
  id: string;
  filename: string;
  view: View;
  handedness: Handedness;
  createdAt: string;
}

export interface LibraryEntryWithAnalysis extends LibraryEntry {
  analysis: AnalysisResponse;
}

export interface RawBenchmarkEntry {
  metric: MetricId;
  range: MetricRange;
  sampleSize: number;
}

export interface RawBenchmarkResponse {
  generatedAt: string | null;
  table: Record<View, Partial<Record<Phase, RawBenchmarkEntry[]>>>;
}

export function uploadReferenceSwing(
  file: File,
  view: View,
  handedness: Handedness,
): Promise<LibraryEntryWithAnalysis> {
  const form = new FormData();
  form.append("video", file);
  form.append("view", view);
  form.append("handedness", handedness);
  return request("/reference-swings", { method: "POST", body: form });
}

export function listReferenceSwings(): Promise<LibraryEntry[]> {
  return request("/reference-swings");
}

export function deleteReferenceSwing(id: string): Promise<RawBenchmarkResponse> {
  return request(`/reference-swings/${id}`, { method: "DELETE" });
}

export function fetchReferenceAnalysis(id: string): Promise<AnalysisResponse> {
  return request(`/reference-swings/${id}/analysis`);
}

export function referenceSwingVideoUrl(id: string): string {
  return `${BASE_URL}/reference-swings/${id}/video`;
}

export function submitSamples(id: string, samples: SwingSample[]): Promise<RawBenchmarkResponse> {
  return requestJson(`/reference-swings/${id}/samples`, "POST", { samples });
}

export function fetchBenchmarks(): Promise<RawBenchmarkResponse> {
  return request("/benchmarks");
}
