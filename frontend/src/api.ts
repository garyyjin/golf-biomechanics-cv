import type { AnalysisResponse, Handedness, Quality, View } from "./types";

const API_URL = "http://localhost:8000/analyze";
const POLL_INTERVAL_MS = 300;

interface AnalyzeJob {
  status: "processing" | "done" | "error";
  progress: number;
  result: AnalysisResponse | null;
  error: string | null;
}

async function parseErrorMessage(response: Response): Promise<string> {
  let message = `Analysis failed (${response.status})`;
  try {
    const body = await response.json();
    if (typeof body.detail === "string") message = body.detail;
  } catch {
    // keep generic message
  }
  return message;
}

/**
 * POSTs the video, then polls GET /analyze/{job_id} until it leaves
 * "processing" — extraction can take tens of seconds, so a single request
 * held open the whole time gives the caller nothing to show progress with.
 * onProgress(percent), if given, fires on every poll tick.
 */
export async function analyzeVideo(
  file: File,
  view: View,
  handedness: Handedness,
  quality: Quality,
  onProgress?: (percent: number) => void,
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
    throw new Error(await parseErrorMessage(response));
  }

  const { job_id: jobId } = await response.json();

  for (;;) {
    let poll: Response;
    try {
      poll = await fetch(`${API_URL}/${jobId}`);
    } catch {
      throw new Error("Could not reach the analysis server. Is the backend running on port 8000?");
    }

    if (!poll.ok) {
      throw new Error(await parseErrorMessage(poll));
    }

    const job: AnalyzeJob = await poll.json();
    onProgress?.(job.progress);

    if (job.status === "done" && job.result) return job.result;
    if (job.status === "error") throw new Error(job.error ?? "Analysis failed");

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
