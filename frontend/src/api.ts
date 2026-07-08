import type { AnalysisResponse, Handedness, Quality, View } from "./types";

const API_URL = "http://localhost:8000/analyze";

export async function analyzeVideo(
  file: File,
  view: View,
  handedness: Handedness,
  quality: Quality,
): Promise<AnalysisResponse> {
  const form = new FormData();
  form.append("video", file);
  form.append("view", view);
  form.append("handedness", handedness);
  form.append("quality", quality);

  let response: Response;
  try {
    response = await fetch(API_URL, { method: "POST", body: form });
  } catch {
    throw new Error("Could not reach the analysis server. Is the backend running on port 8000?");
  }

  if (!response.ok) {
    let message = `Analysis failed (${response.status})`;
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
