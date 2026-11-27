// The adapter of the Anthropic Messages API: it translates the common shape
// of a conversation into a request, and the answer back into the common
// shape. It sends no sampling parameter, so the model's defaults apply.
//
// Checked on 2026-11-14 against the API version `2026-10-21` and these pages:
// - https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls
// - https://platform.claude.com/docs/en/api/errors
// - https://platform.claude.com/docs/en/build-with-claude/extended-thinking
// - https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons
// - https://platform.claude.com/docs/en/build-with-claude/pdf-support
// - https://platform.claude.com/docs/en/api/models/list (checked on 2026-11-16)
// The common shape keeps no thinking blocks. With adaptive thinking, the API
// accepts a history without them; only manual thinking requires them.

import { isPlainObject } from "../../shapes.js";
import { ProviderError } from "./errors.js";
import { dataOf, getJson, LIST_TIMEOUT_MS, postJson } from "./http.js";

/** @typedef {import("./types.js").Answer} Answer */
/** @typedef {import("./types.js").Attachment} Attachment */
/** @typedef {import("./types.js").Message} Message */
/** @typedef {import("./types.js").Model} Model */
/** @typedef {import("./types.js").Provider} Provider */

const API_VERSION = "2026-10-21";

// The API requires a limit on the answer. This one leaves room for the
// model's thinking, which counts toward it.
const MAX_TOKENS = 16000;

/**
 * @param {object} options
 * @param {string} options.apiKey
 * @param {string} options.model
 * @param {string} [options.baseUrl]
 * @param {typeof globalThis.fetch} [options.fetch]
 * @param {number} [options.timeoutMs]
 * @returns {Provider}
 */
export function createAnthropicProvider({
  apiKey,
  model,
  baseUrl = "https://api.anthropic.com",
  fetch = globalThis.fetch,
  timeoutMs = 120000,
}) {
  return {
    name: "anthropic",
    model,
    async complete({ system, messages, tools, signal }) {
      const answer = await postJson({
        fetch,
        url: `${baseUrl}/v1/messages`,
        headers: { "x-api-key": apiKey, "anthropic-version": API_VERSION },
        body: {
          model,
          max_tokens: MAX_TOKENS,
          system,
          tools: tools.map(({ name, description, parameters }) => ({
            name,
            description,
            input_schema: parameters,
          })),
          messages: messages.flatMap(toApiMessages),
        },
        signal,
        timeoutMs,
        apiKey,
        isTooLong,
      });
      return fromApiAnswer(answer);
    },
  };
}

/**
 * Lists the models that `apiKey` can use, newest first, each with its
 * display name. The API lists the active and the deprecated models, in pages
 * of up to 1,000.
 *
 * @param {object} options
 * @param {string} options.apiKey
 * @param {string} [options.baseUrl]
 * @param {typeof globalThis.fetch} [options.fetch]
 * @param {number} [options.timeoutMs] The limit of each page.
 * @returns {Promise<Model[]>}
 */
export async function listAnthropicModels({
  apiKey,
  baseUrl = "https://api.anthropic.com",
  fetch = globalThis.fetch,
  timeoutMs = LIST_TIMEOUT_MS,
}) {
  const items = [];
  /** @type {string | undefined} */
  let afterId;
  do {
    const after = afterId === undefined ? "" : `&after_id=${encodeURIComponent(afterId)}`;
    const answer = await getJson({
      fetch,
      url: `${baseUrl}/v1/models?limit=1000${after}`,
      headers: { "x-api-key": apiKey, "anthropic-version": API_VERSION },
      timeoutMs,
      apiKey,
    });
    const page = dataOf(answer);
    items.push(...page);
    // An empty page ends the list too, so a list that always has more can't
    // loop forever.
    afterId =
      answer.has_more === true && page.length > 0 && typeof answer.last_id === "string"
        ? answer.last_id
        : undefined;
  } while (afterId !== undefined);
  // The API lists the newest first already; the sort makes it certain.
  const releasedAt = (item) => Date.parse(item.created_at) || 0;
  return items
    .sort((a, b) => releasedAt(b) - releasedAt(a))
    .map((item) => ({
      id: item.id,
      name:
        typeof item.display_name === "string" && item.display_name !== ""
          ? item.display_name
          : item.id,
    }));
}

/**
 * The API answers 413 to a request of too many bytes, and 400 with a message
 * such as "prompt is too long: 1000001 tokens > 1000000 maximum" to one of
 * too many tokens. The error type of the 400 is the generic
 * `invalid_request_error`, so only the message tells them apart.
 */
function isTooLong(status, error) {
  if (status === 413) return true;
  return (
    status === 400 &&
    typeof error?.message === "string" &&
    /prompt is too long|context (limit|window)/i.test(error.message)
  );
}

/**
 * A message becomes one message of the API, or none for an assistant message
 * without text or tool calls, whose empty content the API rejects.
 *
 * @param {Message} message
 */
function toApiMessages(message) {
  if (message.role === "user") {
    /** @type {object[]} */
    const content = message.attachments.map(toApiAttachment);
    // The API rejects an empty text block.
    if (message.text !== "") content.push({ type: "text", text: message.text });
    return [{ role: "user", content }];
  }
  if (message.role === "assistant") {
    const content = [];
    if (message.text !== "") content.push({ type: "text", text: message.text });
    for (const call of message.toolCalls) {
      // The API needs an object; a call whose arguments didn't parse sends an
      // empty one, and its result already holds the error.
      content.push({ type: "tool_use", id: call.id, name: call.name, input: call.input ?? {} });
    }
    return content.length === 0 ? [] : [{ role: "assistant", content }];
  }
  return [
    {
      role: "user",
      content: message.results.map((result) => ({
        type: "tool_result",
        tool_use_id: result.id,
        content: result.output,
        is_error: result.isError,
      })),
    },
  ];
}

/**
 * A PDF goes in a document block and an image in an image block, both with
 * the data in base64.
 *
 * @param {Attachment} attachment
 */
function toApiAttachment({ mediaType, data }) {
  const type = mediaType === "application/pdf" ? "document" : "image";
  return { type, source: { type: "base64", media_type: mediaType, data } };
}

/**
 * @param {any} answer
 * @returns {Answer}
 */
function fromApiAnswer(answer) {
  if (answer.stop_reason === "refusal") {
    throw new ProviderError("other", "The model declined to answer.");
  }
  if (answer.stop_reason === "max_tokens") {
    throw new ProviderError("other", "The answer reached the output limit");
  }
  if (answer.stop_reason === "model_context_window_exceeded") {
    throw new ProviderError("too_long", "The answer filled the context window");
  }
  const content = Array.isArray(answer.content) ? answer.content : [];
  const text = content
    .filter((block) => block.type === "text" && block.text !== "")
    .map((block) => block.text)
    .join("\n\n");
  const toolCalls = content
    .filter((block) => block.type === "tool_use")
    .map((block) => ({
      id: block.id,
      name: block.name,
      input: isPlainObject(block.input) ? block.input : null,
    }));
  return {
    text,
    toolCalls,
    usage: {
      inputTokens: answer.usage?.input_tokens ?? 0,
      outputTokens: answer.usage?.output_tokens ?? 0,
    },
  };
}
