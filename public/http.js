// HTTP helpers for the pages. Every request gives up after REQUEST_TIMEOUT_MS,
// so the pages show an error instead of waiting forever. A message to the
// assistant carries its attachments, which take longer to upload: it gives
// up after UPLOAD_TIMEOUT_MS.

export const REQUEST_TIMEOUT_MS = 5000;
export const UPLOAD_TIMEOUT_MS = 120000;

/**
 * The parsed body of GET `url`. Rejects on a network error, a timeout, or a
 * status other than 2xx, with an error whose `status` is the response's.
 */
export async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) {
    throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
  }
  return response.json();
}

/**
 * Sends `body` as JSON. Resolves with the status and the parsed body, whatever
 * the status, so callers can read a 409's body. Rejects on a network error or
 * after `timeoutMs`.
 * @param {string} method
 * @param {string} url
 * @param {unknown} body
 * @param {{ timeoutMs?: number }} [options]
 */
export async function sendJson(method, url, body, { timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}
