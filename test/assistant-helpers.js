// Helpers of the backend tests of the assistant, the ones that run
// `server/assistant/`. They don't serve any other layer.

import assert from "node:assert/strict";
import http from "node:http";
import { ProviderError } from "../server/assistant/providers/errors.js";

/**
 * Asserts that `promise` rejects with a `ProviderError` of `kind`, and
 * returns the error.
 *
 * @param {Promise<unknown>} promise
 * @param {string} kind
 * @returns {Promise<ProviderError>}
 */
export async function rejectsWithKind(promise, kind) {
  const error = await promise.then(
    () => assert.fail(`expected a ProviderError of kind ${kind}, but it resolved`),
    (reason) => reason,
  );
  assert.ok(error instanceof ProviderError, `expected a ProviderError, got ${error}`);
  assert.equal(error.kind, kind, `wrong kind for: ${error.message}`);
  return error;
}

/**
 * @typedef {object} StubRequest
 * @property {string} method
 * @property {string} url The path and query of the request.
 * @property {http.IncomingHttpHeaders} headers With lowercase names.
 * @property {any} body The body parsed as JSON, or the raw text if it isn't JSON.
 */

/**
 * @typedef {object} StubAnswer
 * @property {number} [status] 200 when left out.
 * @property {any} body An object to send as JSON, or a string to send as is.
 */

/**
 * Starts an HTTP server on a free port of `127.0.0.1` that stands in for a
 * provider's API. It records each request in `requests` and answers with
 * what `handler` returns for it. A handler that returns a promise that never
 * settles holds the answer. The server closes when the test `t` ends, and
 * drops any answer that it still holds.
 *
 * @param {import("node:test").TestContext} t
 * @param {(request: StubRequest) => StubAnswer | Promise<StubAnswer>} handler
 * @returns {Promise<{ baseUrl: string, requests: StubRequest[] }>}
 */
export async function stubProviderServer(t, handler) {
  /** @type {StubRequest[]} */
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString("utf8");
    let body = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Keep the raw text, so a test can see what isn't JSON.
    }
    const request = { method: req.method, url: req.url, headers: req.headers, body };
    requests.push(request);
    const answer = await handler(request);
    const payload = typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body);
    res.writeHead(answer.status ?? 200, { "content-type": "application/json" });
    res.end(payload);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(undefined)));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  });
  const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
  return { baseUrl: `http://127.0.0.1:${port}`, requests };
}

/**
 * Returns the base URL of a port of `127.0.0.1` that refuses connections: a
 * server listened on it and closed before this returns.
 *
 * @returns {Promise<string>}
 */
export async function refusingBaseUrl() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(undefined)));
  const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
  await new Promise((resolve) => server.close(() => resolve(undefined)));
  return `http://127.0.0.1:${port}`;
}

/** A promise that never settles, for a handler that holds its answer. */
export function never() {
  return new Promise(() => {});
}

/** @typedef {import("../server/assistant/providers/errors.js").Provider} Provider */
/** @typedef {import("../server/assistant/providers/errors.js").Message} Message */
/** @typedef {import("../server/assistant/providers/errors.js").Tool} Tool */
/** @typedef {import("../server/assistant/providers/errors.js").ToolCall} ToolCall */

/**
 * What a step of a script answers. The text defaults to "", the tool calls
 * to none, and the usage to zero tokens.
 * @typedef {{ text?: string, toolCalls?: ToolCall[], usage?: { inputTokens: number, outputTokens: number } }} ScriptedAnswer
 */

/**
 * @typedef {{ system: string, messages: Message[], tools: Tool[], signal?: AbortSignal }} ProviderRequest
 */

/**
 * A provider that answers from a script instead of a model. Each call takes
 * the next step, in order: an answer, an `Error` to reject with, or a
 * function that gets the request, signal included, and returns an answer. A
 * call beyond the script rejects with an error that says so.
 *
 * `calls` records a deep copy of each request without its signal, so a later
 * change to the conversation can't change what a call sent.
 *
 * @param {(ScriptedAnswer | Error | ((request: ProviderRequest) => ScriptedAnswer | Promise<ScriptedAnswer>))[]} steps
 * @returns {Provider & { calls: { system: string, messages: Message[], tools: Tool[] }[] }}
 */
export function scriptedProvider(steps) {
  /** @type {{ system: string, messages: Message[], tools: Tool[] }[]} */
  const calls = [];
  return {
    name: "anthropic",
    model: "scripted",
    calls,
    async complete(request) {
      const { system, messages, tools } = request;
      calls.push(structuredClone({ system, messages, tools }));
      const step = steps[calls.length - 1];
      if (step === undefined) {
        throw new Error(
          `The script has ${steps.length} steps, but the provider got call ${calls.length}.`,
        );
      }
      if (step instanceof Error) throw step;
      const answer = typeof step === "function" ? await step(request) : step;
      return {
        text: answer.text ?? "",
        toolCalls: answer.toolCalls ?? [],
        usage: answer.usage ?? { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
}
