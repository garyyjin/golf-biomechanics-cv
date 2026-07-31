import type { AnalysisResponse, Handedness, Quality, View } from "./types";

const API_URL = "http://localhost:8000/analyze";
const POLL_INTERVAL_MS = 300;
const MAX_CONSECUTIVE_POLL_FAILURES = 5;

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

export interface AnalysisJobHandle {
  jobId: string;
  /** The history entry the backend created for this upload. The video is
   * stored there rather than in a temp file, so every analyzed swing is
   * recorded — the frontend posts the computed scores back against this id
   * once analysis finishes. */
  swingId: string;
}

/** POSTs the video and returns the job handle — extraction happens
 * server-side in the background from this point on, so the ids are enough to
 * resume tracking the same job later without re-uploading. */
export async function submitAnalysisJob(
  file: File,
  view: View,
  handedness: Handedness,
  quality: Quality,
): Promise<AnalysisJobHandle> {
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

  const { job_id: jobId, swing_id: swingId } = await response.json();
  return { jobId, swingId };
}

/**
 * Polls GET /analyze/{job_id} until it leaves "processing" — extraction can
 * take tens of seconds, so a single request held open the whole time gives
 * the caller nothing to show progress with. onProgress(percent), if given,
 * fires on every poll tick.
 */
export async function pollAnalysisJob(
  jobId: string,
  onProgress?: (percent: number) => void,
): Promise<AnalysisResponse> {
  let consecutiveFailures = 0;
  for (;;) {
    let poll: Response;
    try {
      poll = await fetch(`${API_URL}/${jobId}`);
    } catch {
      // A single dropped poll over a request that can run for tens of
      // seconds shouldn't fail the whole analysis — only give up after a
      // run of failures that suggests the server is actually unreachable.
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        throw new Error("Could not reach the analysis server. Is the backend running on port 8000?");
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      continue;
    }
    consecutiveFailures = 0;

    if (!poll.ok) {
      throw new Error(await parseErrorMessage(poll));
    }

    const job: AnalyzeJob = await poll.json();
    onProgress?.(job.progress);

    if (job.status === "done") {
      if (!job.result) throw new Error("Analysis finished with no result");
      return job.result;
    }
    if (job.status === "error") throw new Error(job.error ?? "Analysis failed");

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/**
 * Submits the video and polls it through to completion, resolving with the
 * analysis and the id of the history entry it was stored as. onJobStarted, if
 * given, fires as soon as the job is known — callers can hang onto the handle
 * to retry via pollAnalysisJob directly if a later poll fails, without
 * re-uploading the file.
 */
export async function analyzeVideo(
  file: File,
  view: View,
  handedness: Handedness,
  quality: Quality,
  onProgress?: (percent: number) => void,
  onJobStarted?: (handle: AnalysisJobHandle) => void,
): Promise<{ analysis: AnalysisResponse; swingId: string }> {
  const handle = await submitAnalysisJob(file, view, handedness, quality);
  onJobStarted?.(handle);
  const analysis = await pollAnalysisJob(handle.jobId, onProgress);
  return { analysis, swingId: handle.swingId };
}
