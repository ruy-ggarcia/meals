// The HTTP requests of the provider adapters, which turn every failure of a
// call into a ProviderError.

import { ProviderError } from "./errors.js";

/** @typedef {import("./errors.js").ProviderErrorKind} ProviderErrorKind */

/**
 * The time limit of a model list. A provider answers one in well under a
 * second, and the pages give up on a request after 5 seconds, so the server
 * answers before the page gives up on it.
 */
export const LIST_TIMEOUT_MS = 4000;

/**
 * Returns the `data` array of the answer of a models API, or rejects with a
 * `ProviderError` when the answer has none.
 * @param {any} answer
 * @returns {any[]}
 */
export function dataOf(answer) {
  if (!Array.isArray(answer?.data)) {
    throw new ProviderError("other", "The answer has no list of models");
  }
  return answer.data.filter((item) => typeof item?.id === "string");
}

/**
 * Posts `body` as JSON to `url` and returns the parsed JSON answer. Rejects
 * with the reason of `signal` when it aborts, and with a `ProviderError`
 * for every other failure: no answer within `timeoutMs`, no connection, an
 * error status, or an answer that isn't JSON.
 *
 * The message of an error status is the provider's `error.message`, with
 * any copy of `apiKey` removed, or `HTTP <status>` when there's none. An
 * auth error says only its status, because a provider can echo a masked key
 * in it. The message never holds the body itself, which could echo the
 * request.
 *
 * @param {object} options
 * @param {typeof globalThis.fetch} options.fetch
 * @param {string} options.url
 * @param {Record<string, string>} options.headers Without the content type.
 * @param {unknown} options.body
 * @param {AbortSignal} [options.signal]
 * @param {number} options.timeoutMs
 * @param {string} options.apiKey
 * @param {(status: number, error: any) => boolean} options.isTooLong Whether
 *   an error status with the provider's `error` object means the
 *   conversation is too long for the model.
 * @returns {Promise<any>}
 */
export function postJson({ fetch, url, headers, body, signal, timeoutMs, apiKey, isTooLong }) {
  return requestJson({
    fetch,
    url,
    init: {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    signal,
    timeoutMs,
    apiKey,
    isTooLong,
  });
}

/**
 * Gets `url` and returns the parsed JSON answer. Rejects with a
 * `ProviderError` as `postJson` does, and never with the kind `too_long`.
 *
 * @param {object} options
 * @param {typeof globalThis.fetch} options.fetch
 * @param {string} options.url
 * @param {Record<string, string>} options.headers
 * @param {number} options.timeoutMs
 * @param {string} options.apiKey
 * @returns {Promise<any>}
 */
export function getJson({ fetch, url, headers, timeoutMs, apiKey }) {
  return requestJson({
    fetch,
    url,
    init: { method: "GET", headers },
    timeoutMs,
    apiKey,
    isTooLong: () => false,
  });
}

/**
 * Sends the request of `init` to `url`, with the error handling that
 * `postJson` describes.
 *
 * @param {object} options
 * @param {typeof globalThis.fetch} options.fetch
 * @param {string} options.url
 * @param {RequestInit} options.init Without a signal.
 * @param {AbortSignal} [options.signal]
 * @param {number} options.timeoutMs
 * @param {string} options.apiKey
 * @param {(status: number, error: any) => boolean} options.isTooLong
 * @returns {Promise<any>}
 */
async function requestJson({ fetch, url, init, signal, timeoutMs, apiKey, isTooLong }) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signals = signal ? [signal, timeout] : [timeout];
  let status;
  let text;
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.any(signals) });
    status = response.status;
    text = await response.text();
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (timeout.aborted) {
      throw new ProviderError("timeout", `No answer within ${timeoutMs} ms`);
    }
    // Only the code of the system error, such as ECONNREFUSED: the message of
    // an error of fetch can quote a header, and so the key.
    const code = errorCode(error);
    throw new ProviderError("network", code ? `Network error: ${code}` : "Network error");
  }
  const answer = parseJson(text);
  if (status < 200 || status > 299) {
    const kind = kindOfStatus(status, answer?.error, isTooLong);
    const providerMessage = answer?.error?.message;
    const message =
      kind !== "auth" && typeof providerMessage === "string" && providerMessage !== ""
        ? withoutKey(providerMessage, apiKey)
        : `HTTP ${status}`;
    throw new ProviderError(kind, message);
  }
  if (answer === undefined) {
    throw new ProviderError("other", `HTTP ${status} with an answer that isn't JSON`);
  }
  return answer;
}

/**
 * @param {number} status
 * @param {any} error
 * @param {(status: number, error: any) => boolean} isTooLong
 * @returns {ProviderErrorKind}
 */
function kindOfStatus(status, error, isTooLong) {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "overloaded";
  if (isTooLong(status, error)) return "too_long";
  return "other";
}

/**
 * Returns `message` with every copy of `apiKey` replaced. An empty key
 * leaves it as it is, since it would match between every two characters.
 */
function withoutKey(message, apiKey) {
  return apiKey ? message.replaceAll(apiKey, "[key]") : message;
}

/**
 * Returns the code of the system error behind a failure of fetch, such as
 * ECONNREFUSED, or undefined when it has none. fetch wraps the system error
 * in its cause, and a connection that tried several addresses wraps one per
 * address in an AggregateError.
 */
function errorCode(error) {
  const cause = error?.cause ?? error;
  if (typeof cause?.code === "string") return cause.code;
  const first = cause instanceof AggregateError ? cause.errors[0] : undefined;
  return typeof first?.code === "string" ? first.code : undefined;
}

/** Returns the value of the JSON `text`, or undefined if it isn't JSON. */
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
