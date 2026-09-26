// HTTP helpers for the pages. Every request gives up after REQUEST_TIMEOUT_MS,
// so the pages show an error instead of waiting forever.

export const REQUEST_TIMEOUT_MS = 5000;

/** The parsed body of GET `url`. Rejects on a network error, a timeout, or a status other than 2xx. */
export async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/**
 * Sends `body` as JSON. Resolves with the status and the parsed body, whatever
 * the status, so callers can read a 409's body. Rejects on a network error or
 * a timeout.
 */
export async function sendJson(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}
