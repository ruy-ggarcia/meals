// The adapter of the OpenAI Responses API: it translates the common shape of
// a conversation into a request, and the answer back into the common shape.
// It sends `store: false`, so OpenAI keeps no response to read later, and no
// sampling parameter, so the model's defaults apply.
//
// Checked on 2026-11-14 against these pages:
// - https://developers.openai.com/api/docs/guides/function-calling
// - https://developers.openai.com/api/docs/guides/file-inputs
// - https://developers.openai.com/api/reference/resources/responses/methods/create
// - https://developers.openai.com/api/reference/resources/models/methods/list
//   (checked on 2026-11-16)

import { isPlainObject } from "../../shapes.js";
import { ProviderError } from "./errors.js";
import { dataOf, getJson, LIST_TIMEOUT_MS, postJson } from "./http.js";

/** @typedef {import("./types.js").Answer} Answer */
/** @typedef {import("./types.js").Attachment} Attachment */
/** @typedef {import("./types.js").Message} Message */
/** @typedef {import("./types.js").Model} Model */
/** @typedef {import("./types.js").Provider} Provider */

// The API lists every model of the account in one answer, with no display
// names, including models that can't chat. These identifiers are the ones
// that can: the GPT models and the o-series reasoning models.
const CHAT_MODEL = /^(gpt-|o\d)/;
// Models of those families that do something else.
const NOT_CHAT = /audio|realtime|tts|transcribe|image|embedding|search|moderation/;

/**
 * @param {object} options
 * @param {string} options.apiKey
 * @param {string} options.model
 * @param {string} [options.baseUrl]
 * @param {typeof globalThis.fetch} [options.fetch]
 * @param {number} [options.timeoutMs]
 * @returns {Provider}
 */
export function createOpenAIProvider({
  apiKey,
  model,
  baseUrl = "https://api.openai.com",
  fetch = globalThis.fetch,
  timeoutMs = 120000,
}) {
  return {
    name: "openai",
    model,
    async complete({ system, messages, tools, signal }) {
      const answer = await postJson({
        fetch,
        url: `${baseUrl}/v1/responses`,
        headers: { authorization: `Bearer ${apiKey}` },
        body: {
          model,
          instructions: system,
          store: false,
          // Without `strict`, the API validates strictly only the schemas
          // that allow it, and the tools have optional properties.
          tools: tools.map(({ name, description, parameters }) => ({
            type: "function",
            name,
            description,
            parameters,
          })),
          input: messages.flatMap(toApiItems),
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
 * Lists the models that `apiKey` can use to chat, newest first, each named
 * by its identifier.
 *
 * @param {object} options
 * @param {string} options.apiKey
 * @param {string} [options.baseUrl]
 * @param {typeof globalThis.fetch} [options.fetch]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<Model[]>}
 */
export async function listOpenAIModels({
  apiKey,
  baseUrl = "https://api.openai.com",
  fetch = globalThis.fetch,
  timeoutMs = LIST_TIMEOUT_MS,
}) {
  const answer = await getJson({
    fetch,
    url: `${baseUrl}/v1/models`,
    headers: { authorization: `Bearer ${apiKey}` },
    timeoutMs,
    apiKey,
  });
  const createdAt = (item) => (typeof item.created === "number" ? item.created : 0);
  return dataOf(answer)
    .filter((item) => CHAT_MODEL.test(item.id) && !NOT_CHAT.test(item.id))
    .sort((a, b) => createdAt(b) - createdAt(a))
    .map((item) => ({ id: item.id, name: item.id }));
}

/** The API answers 400 with the code `context_length_exceeded`. */
function isTooLong(status, error) {
  return status === 400 && error?.code === "context_length_exceeded";
}

/**
 * A message becomes one or more items of the input, or none for an
 * assistant message without text or tool calls.
 *
 * @param {Message} message
 */
function toApiItems(message) {
  if (message.role === "user") {
    /** @type {object[]} */
    const content = message.attachments.map(toApiAttachment);
    if (message.text !== "") content.push({ type: "input_text", text: message.text });
    return [{ role: "user", content }];
  }
  if (message.role === "assistant") {
    const items = [];
    if (message.text !== "") items.push({ role: "assistant", content: message.text });
    for (const call of message.toolCalls) {
      // The call goes without the item ID of the answer: with `store: false`,
      // an item ID would need the reasoning item that came with it. A call
      // whose arguments didn't parse sends an empty object, and its result
      // already holds the error.
      items.push({
        type: "function_call",
        call_id: call.id,
        name: call.name,
        arguments: JSON.stringify(call.input ?? {}),
      });
    }
    return items;
  }
  // The output holds the error of a failed call, so the API needs no flag.
  return message.results.map((result) => ({
    type: "function_call_output",
    call_id: result.id,
    output: result.output,
  }));
}

/**
 * A PDF goes as a file with its name, and an image at the default detail,
 * both as base64 data URLs.
 *
 * @param {Attachment} attachment
 */
function toApiAttachment({ name, mediaType, data }) {
  const url = `data:${mediaType};base64,${data}`;
  if (mediaType === "application/pdf") {
    return { type: "input_file", filename: name, file_data: url };
  }
  return { type: "input_image", image_url: url, detail: "auto" };
}

/**
 * @param {any} answer
 * @returns {Answer}
 */
function fromApiAnswer(answer) {
  if (answer.status !== "completed") {
    const reason = answer.incomplete_details?.reason ?? answer.error?.code ?? answer.status;
    throw new ProviderError("other", `The answer is ${answer.status}: ${reason}`);
  }
  const output = Array.isArray(answer.output) ? answer.output : [];
  const parts = output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? []);
  if (parts.some((part) => part.type === "refusal")) {
    throw new ProviderError("other", "The model declined to answer.");
  }
  const text = parts
    .filter((part) => part.type === "output_text" && part.text !== "")
    .map((part) => part.text)
    .join("\n\n");
  const toolCalls = output
    .filter((item) => item.type === "function_call")
    .map((item) => ({ id: item.call_id, name: item.name, input: parseArguments(item.arguments) }));
  return {
    text,
    toolCalls,
    usage: {
      inputTokens: answer.usage?.input_tokens ?? 0,
      outputTokens: answer.usage?.output_tokens ?? 0,
    },
  };
}

/**
 * Returns the parsed arguments of a call, or null when they don't parse to a
 * JSON object, as the arguments of every tool are.
 */
function parseArguments(text) {
  try {
    const input = JSON.parse(text);
    return isPlainObject(input) ? input : null;
  } catch {
    return null;
  }
}
