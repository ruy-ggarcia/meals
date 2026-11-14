import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createAnthropicProvider } from "../server/assistant/providers/anthropic.js";
import { ProviderError } from "../server/assistant/providers/errors.js";
import {
  never,
  refusingBaseUrl,
  rejectsWithKind,
  stubProviderServer,
} from "./assistant-helpers.js";

const KEY = "sk-test-secret";
const MODEL = "claude-test";
const SYSTEM = "You plan the meals of a family.";
const TOOLS = [
  {
    name: "list_recipes",
    description: "Lists the recipe book.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
];
/** @type {import("../server/assistant/providers/errors.js").Message[]} */
const HELLO = [{ role: "user", text: "Plan Monday.", attachments: [] }];

/** An answer of the Messages API with text and a tool call. */
const ANSWER = {
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: MODEL,
  content: [
    { type: "text", text: "Let me read the recipes." },
    { type: "tool_use", id: "toolu_1", name: "list_recipes", input: {} },
  ],
  stop_reason: "tool_use",
  stop_sequence: null,
  usage: { input_tokens: 120, output_tokens: 30 },
};

/** An error answer of the Messages API. */
function apiError(type, message) {
  return { type: "error", error: { type, message }, request_id: "req_1" };
}

/**
 * Starts a stub of the Messages API that answers every request with
 * `answer`, and returns a provider that calls it, with the stub's requests.
 *
 * @param {import("node:test").TestContext} t
 * @param {import("./assistant-helpers.js").StubAnswer} [answer]
 */
async function useStub(t, answer = { body: ANSWER }) {
  const { baseUrl, requests } = await stubProviderServer(t, () => answer);
  const provider = createAnthropicProvider({ apiKey: KEY, model: MODEL, baseUrl });
  return { provider, requests };
}

describe("server/assistant/providers/anthropic.js", () => {
  test("names the provider and the model", () => {
    const provider = createAnthropicProvider({ apiKey: KEY, model: MODEL });
    assert.equal(provider.name, "anthropic");
    assert.equal(provider.model, MODEL);
  });

  test("posts to the Messages API with the key and the API version", async (t) => {
    const { provider, requests } = await useStub(t);
    await provider.complete({ system: SYSTEM, messages: HELLO, tools: TOOLS });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "POST");
    assert.equal(requests[0].url, "/v1/messages");
    assert.equal(requests[0].headers["x-api-key"], KEY);
    assert.equal(requests[0].headers["anthropic-version"], "2026-10-21");
    assert.equal(requests[0].headers["content-type"], "application/json");
  });

  test("sends the model, the instructions, and the tools and no sampling", async (t) => {
    const { provider, requests } = await useStub(t);
    await provider.complete({ system: SYSTEM, messages: HELLO, tools: TOOLS });
    const { messages, ...settings } = requests[0].body;
    assert.deepEqual(settings, {
      model: MODEL,
      max_tokens: 8192,
      system: SYSTEM,
      tools: [
        {
          name: "list_recipes",
          description: "Lists the recipe book.",
          input_schema: { type: "object", properties: {}, additionalProperties: false },
        },
      ],
    });
  });

  test("sends a PDF and a PNG as base64 blocks before the text", async (t) => {
    const { provider, requests } = await useStub(t);
    const attachments = [
      { name: "menu.pdf", mediaType: "application/pdf", data: "JVBERi0xLjQ=" },
      { name: "fridge.png", mediaType: "image/png", data: "iVBORw0KGgo=" },
    ];
    await provider.complete({
      system: SYSTEM,
      messages: [{ role: "user", text: "Use these.", attachments }],
      tools: TOOLS,
    });
    assert.deepEqual(requests[0].body.messages, [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: "JVBERi0xLjQ=" },
          },
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" },
          },
          { type: "text", text: "Use these." },
        ],
      },
    ]);
  });

  test("sends earlier tool calls and their results as blocks", async (t) => {
    const { provider, requests } = await useStub(t);
    await provider.complete({
      system: SYSTEM,
      tools: TOOLS,
      messages: [
        ...HELLO,
        {
          role: "assistant",
          text: "Let me look.",
          toolCalls: [
            { id: "toolu_1", name: "list_recipes", input: {} },
            { id: "toolu_2", name: "propose_menus", input: null },
          ],
        },
        {
          role: "tool",
          results: [
            { id: "toolu_1", name: "list_recipes", output: '{"recipes":[]}', isError: false },
            { id: "toolu_2", name: "propose_menus", output: '{"error":"Bad"}', isError: true },
          ],
        },
        { role: "assistant", text: "There are no recipes yet.", toolCalls: [] },
      ],
    });
    assert.deepEqual(requests[0].body.messages.slice(1), [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me look." },
          { type: "tool_use", id: "toolu_1", name: "list_recipes", input: {} },
          { type: "tool_use", id: "toolu_2", name: "propose_menus", input: {} },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_1",
            content: '{"recipes":[]}',
            is_error: false,
          },
          {
            type: "tool_result",
            tool_use_id: "toolu_2",
            content: '{"error":"Bad"}',
            is_error: true,
          },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "There are no recipes yet." }] },
    ]);
  });

  test("leaves out an assistant message without text or tool calls", async (t) => {
    const { provider, requests } = await useStub(t);
    await provider.complete({
      system: SYSTEM,
      tools: TOOLS,
      messages: [...HELLO, { role: "assistant", text: "", toolCalls: [] }, ...HELLO],
    });
    assert.deepEqual(
      requests[0].body.messages.map((message) => message.role),
      ["user", "user"],
    );
  });

  test("leaves out the text block of a message without text", async (t) => {
    const { provider, requests } = await useStub(t);
    const pdf = { name: "menu.pdf", mediaType: "application/pdf", data: "JVBERi0xLjQ=" };
    await provider.complete({
      system: SYSTEM,
      tools: TOOLS,
      messages: [
        { role: "user", text: "", attachments: [pdf] },
        {
          role: "assistant",
          text: "",
          toolCalls: [{ id: "toolu_1", name: "list_recipes", input: {} }],
        },
      ],
    });
    const [user, assistant] = requests[0].body.messages;
    assert.deepEqual(
      user.content.map((block) => block.type),
      ["document"],
    );
    assert.deepEqual(
      assistant.content.map((block) => block.type),
      ["tool_use"],
    );
  });

  test("returns the text, the tool calls, and the usage of an answer", async (t) => {
    const { provider } = await useStub(t);
    const answer = await provider.complete({ system: SYSTEM, messages: HELLO, tools: TOOLS });
    assert.deepEqual(answer, {
      text: "Let me read the recipes.",
      toolCalls: [{ id: "toolu_1", name: "list_recipes", input: {} }],
      usage: { inputTokens: 120, outputTokens: 30 },
    });
  });

  test("returns null input for tool arguments that aren't a JSON object", async (t) => {
    const content = [{ type: "tool_use", id: "toolu_1", name: "list_recipes", input: "{oops" }];
    const { provider } = await useStub(t, { body: { ...ANSWER, content } });
    const answer = await provider.complete({ system: SYSTEM, messages: HELLO, tools: TOOLS });
    assert.deepEqual(answer.toolCalls, [{ id: "toolu_1", name: "list_recipes", input: null }]);
  });

  test("rejects with auth for 401 and 403", async (t) => {
    for (const status of [401, 403]) {
      const { provider } = await useStub(t, {
        status,
        body: apiError("authentication_error", "invalid x-api-key"),
      });
      await rejectsWithKind(
        provider.complete({ system: SYSTEM, messages: HELLO, tools: TOOLS }),
        "auth",
      );
    }
  });

  test("rejects with rate_limit for 429", async (t) => {
    const { provider } = await useStub(t, {
      status: 429,
      body: apiError("rate_limit_error", "Number of requests has exceeded your rate limit."),
    });
    await rejectsWithKind(
      provider.complete({ system: SYSTEM, messages: HELLO, tools: TOOLS }),
      "rate_limit",
    );
  });

  test("rejects with overloaded for 500 and 529", async (t) => {
    for (const status of [500, 529]) {
      const { provider } = await useStub(t, {
        status,
        body: apiError("overloaded_error", "Overloaded"),
      });
      await rejectsWithKind(
        provider.complete({ system: SYSTEM, messages: HELLO, tools: TOOLS }),
        "overloaded",
      );
    }
  });

  test("rejects with too_long when the prompt is too long", async (t) => {
    const { provider } = await useStub(t, {
      status: 400,
      body: apiError(
        "invalid_request_error",
        "prompt is too long: 1000001 tokens > 1000000 maximum",
      ),
    });
    await rejectsWithKind(
      provider.complete({ system: SYSTEM, messages: HELLO, tools: TOOLS }),
      "too_long",
    );
  });

  test("rejects with too_long for 413", async (t) => {
    const { provider } = await useStub(t, {
      status: 413,
      body: apiError("request_too_large", "Request exceeds the maximum allowed number of bytes."),
    });
    await rejectsWithKind(
      provider.complete({ system: SYSTEM, messages: HELLO, tools: TOOLS }),
      "too_long",
    );
  });

  test("rejects with too_long when the answer fills the context window", async (t) => {
    const { provider } = await useStub(t, {
      body: { ...ANSWER, stop_reason: "model_context_window_exceeded" },
    });
    await rejectsWithKind(
      provider.complete({ system: SYSTEM, messages: HELLO, tools: TOOLS }),
      "too_long",
    );
  });

  test("rejects with other when the model declines to answer", async (t) => {
    const { provider } = await useStub(t, { body: { ...ANSWER, stop_reason: "refusal" } });
    const error = await rejectsWithKind(
      provider.complete({ system: SYSTEM, messages: HELLO, tools: TOOLS }),
      "other",
    );
    assert.equal(error.message, "The model declined to answer.");
  });

  test("rejects with other when the output limit cuts the answer", async (t) => {
    const { provider } = await useStub(t, { body: { ...ANSWER, stop_reason: "max_tokens" } });
    await rejectsWithKind(
      provider.complete({ system: SYSTEM, messages: HELLO, tools: TOOLS }),
      "other",
    );
  });

  test("rejects with the provider's message for another error", async (t) => {
    const { provider } = await useStub(t, {
      status: 400,
      body: apiError("invalid_request_error", "messages: text content blocks must be non-empty"),
    });
    const error = await rejectsWithKind(
      provider.complete({ system: SYSTEM, messages: HELLO, tools: TOOLS }),
      "other",
    );
    assert.match(error.message, /text content blocks must be non-empty/);
  });

  test("rejects with the status when the error answer isn't JSON", async (t) => {
    const { provider } = await useStub(t, { status: 502, body: "<html>Bad gateway</html>" });
    const error = await rejectsWithKind(
      provider.complete({ system: SYSTEM, messages: HELLO, tools: TOOLS }),
      "overloaded",
    );
    assert.match(error.message, /HTTP 502/);
  });

  test("rejects with network when the connection is refused", async () => {
    const provider = createAnthropicProvider({
      apiKey: KEY,
      model: MODEL,
      baseUrl: await refusingBaseUrl(),
    });
    await rejectsWithKind(
      provider.complete({ system: SYSTEM, messages: HELLO, tools: TOOLS }),
      "network",
    );
  });

  test("rejects with timeout when the answer takes longer than the limit", async (t) => {
    const { baseUrl } = await stubProviderServer(t, never);
    const provider = createAnthropicProvider({ apiKey: KEY, model: MODEL, baseUrl, timeoutMs: 1 });
    await rejectsWithKind(
      provider.complete({ system: SYSTEM, messages: HELLO, tools: TOOLS }),
      "timeout",
    );
  });

  test("rejects with the abort reason when the signal aborts", async (t) => {
    const controller = new AbortController();
    const reason = new Error("The turn was canceled.");
    const { baseUrl } = await stubProviderServer(t, () => {
      controller.abort(reason);
      return never();
    });
    const provider = createAnthropicProvider({ apiKey: KEY, model: MODEL, baseUrl });
    const completion = provider.complete({
      system: SYSTEM,
      messages: HELLO,
      tools: TOOLS,
      signal: controller.signal,
    });
    await assert.rejects(completion, (error) => error === reason);
  });

  test("never puts the key in an error message", async (t) => {
    const echo = apiError("invalid_request_error", `Bad key: ${KEY}`);
    const failures = [
      useStub(t, { status: 401, body: echo }),
      useStub(t, { status: 400, body: echo }),
      useStub(t, { status: 500, body: echo }),
      useStub(t, { body: { ...ANSWER, stop_reason: "max_tokens" } }),
    ];
    const providers = (await Promise.all(failures)).map(({ provider }) => provider);
    providers.push(
      createAnthropicProvider({ apiKey: KEY, model: MODEL, baseUrl: await refusingBaseUrl() }),
    );
    for (const provider of providers) {
      const error = await provider.complete({ system: SYSTEM, messages: HELLO, tools: TOOLS }).then(
        () => assert.fail("expected a rejection"),
        (reason) => reason,
      );
      assert.ok(error instanceof ProviderError, String(error));
      assert.ok(!error.message.includes(KEY), error.message);
      assert.ok(!error.stack.includes(KEY), error.stack);
    }
  });

  test("never puts a key with a control character in an error message", async (t) => {
    // fetch rejects such a header value with an error that quotes it.
    for (const apiKey of ["sk-test\nsecret", "sk-test\u0000secret"]) {
      const { baseUrl } = await stubProviderServer(t, () => ({ body: ANSWER }));
      const provider = createAnthropicProvider({ apiKey, model: MODEL, baseUrl });
      const error = await rejectsWithKind(
        provider.complete({ system: SYSTEM, messages: HELLO, tools: TOOLS }),
        "network",
      );
      assert.ok(!error.message.includes(apiKey), error.message);
      assert.ok(!error.stack.includes(apiKey), error.stack);
    }
  });

  test("names only the error code in a network error", async () => {
    const provider = createAnthropicProvider({
      apiKey: KEY,
      model: MODEL,
      baseUrl: await refusingBaseUrl(),
    });
    const error = await rejectsWithKind(
      provider.complete({ system: SYSTEM, messages: HELLO, tools: TOOLS }),
      "network",
    );
    assert.equal(error.message, "Network error: ECONNREFUSED");
  });

  test("keeps the provider's message whole when the key is empty", async (t) => {
    const message = "messages: text content blocks must be non-empty";
    const { baseUrl } = await stubProviderServer(t, () => ({
      status: 400,
      body: apiError("invalid_request_error", message),
    }));
    const provider = createAnthropicProvider({ apiKey: "", model: MODEL, baseUrl });
    const error = await rejectsWithKind(
      provider.complete({ system: SYSTEM, messages: HELLO, tools: TOOLS }),
      "other",
    );
    assert.equal(error.message, message);
  });
});
