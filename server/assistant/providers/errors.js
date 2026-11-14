// What the provider adapters share: the common shape of a provider and of a
// conversation, the failure of a call in one shape for every provider, and
// the HTTP request that turns every failure of the call into one. The
// message of a `ProviderError` is safe to log: it never holds the API key or
// the content of the conversation.

/**
 * A file of a user message, with `data` in base64.
 * @typedef {{ name: string, mediaType: string, data: string }} Attachment
 */

/**
 * A call of a tool. `input` holds the parsed arguments, or null when they
 * don't parse.
 * @typedef {{ id: string, name: string, input: any }} ToolCall
 */

/**
 * A message of a conversation, in the shape that every adapter translates.
 * `output` of a tool result is a JSON string.
 * @typedef {{ role: "user", text: string, attachments: Attachment[] }
 *   | { role: "assistant", text: string, toolCalls: ToolCall[] }
 *   | { role: "tool", results: { id: string, name: string, output: string, isError: boolean }[] }} Message
 */

/**
 * A tool that the model can call, with `parameters` a JSON Schema object.
 * @typedef {{ name: string, description: string, parameters: any }} Tool
 */

/**
 * One answer of the model.
 * @typedef {{ text: string, toolCalls: ToolCall[], usage: { inputTokens: number, outputTokens: number } }} Answer
 */

/**
 * A language model behind a provider's API.
 * @typedef {object} Provider
 * @property {"anthropic" | "openai"} name
 * @property {string} model
 * @property {(request: { system: string, messages: Message[], tools: Tool[], signal?: AbortSignal }) => Promise<Answer>} complete
 */

/**
 * @typedef {"auth" | "network" | "overloaded" | "rate_limit" | "timeout" | "too_long" | "other"} ProviderErrorKind
 */

/** A call to a provider failed. `kind` tells the caller what to do about it. */
export class ProviderError extends Error {
  name = "ProviderError";

  /**
   * @param {ProviderErrorKind} kind
   * @param {string} message
   */
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
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
export async function postJson({
  fetch,
  url,
  headers,
  body,
  signal,
  timeoutMs,
  apiKey,
  isTooLong,
}) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signals = signal ? [signal, timeout] : [timeout];
  let status;
  let text;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.any(signals),
    });
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
