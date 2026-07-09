import type { MetricId, MetricRange, Phase } from "./benchmarks";
import type { SwingSample } from "./calibration";
import type { AnalysisResponse, Handedness, View } from "./types";

const BASE_URL = "http://localhost:8000";

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, init);
  } catch {
    throw new Error("Could not reach the analysis server. Is the backend running on port 8000?");
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      // keep generic message
    }
    throw new Error(message);
  }

  return response.json();
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
  return request(`/reference-swings/${id}/samples`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ samples }),
  });
}

export function fetchBenchmarks(): Promise<RawBenchmarkResponse> {
  return request("/benchmarks");
}
