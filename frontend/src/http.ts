/** Shared JSON fetch helper and backend base URL.
 *
 * Extracted from libraryApi.ts so historyApi.ts doesn't have to restate the
 * same error handling — both talk to the same backend, and a divergence in
 * how they report "the server isn't running" would show up as two different
 * error messages for one cause.
 */

export const BASE_URL = "http://localhost:8000";

export const UNREACHABLE_MESSAGE =
  "Could not reach the analysis server. Is the backend running on port 8000?";

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, init);
  } catch {
    throw new Error(UNREACHABLE_MESSAGE);
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

/** POSTs/PATCHes a JSON body — the header and stringify are the same three
 * lines at every call site otherwise. */
export function requestJson<T>(path: string, method: "POST" | "PATCH", body: unknown): Promise<T> {
  return request<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
