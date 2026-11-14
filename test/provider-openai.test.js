import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ProviderError } from "../server/assistant/providers/errors.js";
import { createOpenAIProvider } from "../server/assistant/providers/openai.js";
import {
  never,
  refusingBaseUrl,
  rejectsWithKind,
  stubProviderServer,
} from "./assistant-helpers.js";

const KEY = "sk-test-secret";
const MODEL = "gpt-test";
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

/** An answer of the Responses API with reasoning, text, and a tool call. */
const ANSWER = {
  id: "resp_1",
  object: "response",
  status: "completed",
  model: MODEL,
  output: [
    { type: "reasoning", id: "rs_1", summary: [] },
    {
      type: "message",
      id: "msg_1",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "Let me read the recipes.", annotations: [] }],
    },
    {
      type: "function_call",
      id: "fc_1",
      call_id: "call_1",
      name: "list_recipes",
      arguments: "{}",
      status: "completed",
    },
  ],
  usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150 },
};

/** An error answer of the Responses API. */
function apiError(type, message, code = null) {
  return { error: { message, type, param: null, code } };
}

/**
 * Starts a stub of the Responses API that answers every request with
 * `answer`, and returns a provider that calls it, with the stub's requests.
 *
 * @param {import("node:test").TestContext} t
 * @param {import("./assistant-helpers.js").StubAnswer} [answer]
 */
async function useStub(t, answer = { body: ANSWER }) {
  const { baseUrl, requests } = await stubProviderServer(t, () => answer);
  const provider = createOpenAIProvider({ apiKey: KEY, model: MODEL, baseUrl });
  return { provider, requests };
}

describe("server/assistant/providers/openai.js", () => {
  test("names the provider and the model", () => {
    const provider = createOpenAIProvider({ apiKey: KEY, model: MODEL });
    assert.equal(provider.name, "openai");
    assert.equal(provider.model, MODEL);
  });

  test("posts to the Responses API with the key as a bearer token", async (t) => {
    const { provider, requests } = await useStub(t);
    await provider.complete({ system: SYSTEM, messages: HELLO, tools: TOOLS });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "POST");
    assert.equal(requests[0].url, "/v1/responses");
    assert.equal(requests[0].headers.authorization, `Bearer ${KEY}`);
    assert.equal(requests[0].headers["content-type"], "application/json");
  });

  test("sends the model, the instructions, and the tools and no sampling", async (t) => {
    const { provider, requests } = await useStub(t);
    await provider.complete({ system: SYSTEM, messages: HELLO, tools: TOOLS });
    const { input, ...settings } = requests[0].body;
    assert.deepEqual(settings, {
      model: MODEL,
      instructions: SYSTEM,
      store: false,
      tools: [
        {
          type: "function",
          name: "list_recipes",
          description: "Lists the recipe book.",
          parameters: { type: "object", properties: {}, additionalProperties: false },
        },
      ],
    });
  });

  test("sends a PDF and a PNG as data URLs before the text", async (t) => {
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
    assert.deepEqual(requests[0].body.input, [
      {
        role: "user",
        content: [
          {
            type: "input_file",
            filename: "menu.pdf",
            file_data: "data:application/pdf;base64,JVBERi0xLjQ=",
          },
          {
            type: "input_image",
            image_url: "data:image/png;base64,iVBORw0KGgo=",
            detail: "auto",
          },
          { type: "input_text", text: "Use these." },
        ],
      },
    ]);
  });

  test("sends earlier tool calls and their results as items", async (t) => {
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
            { id: "call_1", name: "list_recipes", input: {} },
            { id: "call_2", name: "propose_menus", input: null },
          ],
        },
        {
          role: "tool",
          results: [
            { id: "call_1", name: "list_recipes", output: '{"recipes":[]}', isError: false },
            { id: "call_2", name: "propose_menus", output: '{"error":"Bad"}', isError: true },
          ],
        },
        { role: "assistant", text: "There are no recipes yet.", toolCalls: [] },
      ],
    });
    assert.deepEqual(requests[0].body.input.slice(1), [
      { role: "assistant", content: "Let me look." },
      { type: "function_call", call_id: "call_1", name: "list_recipes", arguments: "{}" },
      { type: "function_call", call_id: "call_2", name: "propose_menus", arguments: "{}" },
      { type: "function_call_output", call_id: "call_1", output: '{"recipes":[]}' },
      { type: "function_call_output", call_id: "call_2", output: '{"error":"Bad"}' },
      { role: "assistant", content: "There are no recipes yet." },
    ]);
  });

  test("leaves out the text of a message without text", async (t) => {
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
          toolCalls: [{ id: "call_1", name: "list_recipes", input: {} }],
        },
      ],
    });
    const [user, ...rest] = requests[0].body.input;
    assert.deepEqual(
      user.content.map((part) => part.type),
      ["input_file"],
    );
    assert.deepEqual(
      rest.map((item) => item.type),
      ["function_call"],
    );
  });

  test("returns the text, the tool calls, and the usage of an answer", async (t) => {
    const { provider } = await useStub(t);
    const answer = await provider.complete({ system: SYSTEM, messages: HELLO, tools: TOOLS });
    assert.deepEqual(answer, {
      text: "Let me read the recipes.",
      toolCalls: [{ id: "call_1", name: "list_recipes", input: {} }],
      usage: { inputTokens: 120, outputTokens: 30 },
    });
  });

  test("returns null input for tool arguments that aren't valid JSON", async (t) => {
    const call = { ...ANSWER.output[2], arguments: '{"menus": [' };
    const { provider } = await useStub(t, { body: { ...ANSWER, output: [call] } });
    const answer = await provider.complete({ system: SYSTEM, messages: HELLO, tools: TOOLS });
    assert.deepEqual(answer.toolCalls, [{ id: "call_1", name: "list_recipes", input: null }]);
  });

  test("rejects with auth for 401 and 403", async (t) => {
    for (const status of [401, 403]) {
      const { provider } = await useStub(t, {
        status,
        body: apiError("invalid_request_error", "Incorrect API key provided."),
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
      body: apiError("requests", "Rate limit reached.", "rate_limit_exceeded"),
    });
    await rejectsWithKind(
      provider.complete({ system: SYSTEM, messages: HELLO, tools: TOOLS }),
      "rate_limit",
    );
  });

  test("rejects with overloaded for 500 and 503", async (t) => {
    for (const status of [500, 503]) {
      const { provider } = await useStub(t, {
        status,
        body: apiError("server_error", "The server had an error.", "server_error"),
      });
      await rejectsWithKind(
        provider.complete({ system: SYSTEM, messages: HELLO, tools: TOOLS }),
        "overloaded",
      );
    }
  });

  test("rejects with too_long when the input exceeds the context window", async (t) => {
    const { provider } = await useStub(t, {
      status: 400,
      body: apiError(
        "invalid_request_error",
        "Your input exceeds the context window of this model. Please adjust your input and try again.",
        "context_length_exceeded",
      ),
    });
    await rejectsWithKind(
      provider.complete({ system: SYSTEM, messages: HELLO, tools: TOOLS }),
      "too_long",
    );
  });

  test("rejects with other when the output limit cuts the answer", async (t) => {
    const { provider } = await useStub(t, {
      body: {
        ...ANSWER,
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
      },
    });
    await rejectsWithKind(
      provider.complete({ system: SYSTEM, messages: HELLO, tools: TOOLS }),
      "other",
    );
  });

  test("rejects with the provider's message for another error", async (t) => {
    const { provider } = await useStub(t, {
      status: 400,
      body: apiError("invalid_request_error", "Invalid value for 'input'.", "invalid_value"),
    });
    const error = await rejectsWithKind(
      provider.complete({ system: SYSTEM, messages: HELLO, tools: TOOLS }),
      "other",
    );
    assert.match(error.message, /Invalid value for 'input'/);
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
    const provider = createOpenAIProvider({
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
    const provider = createOpenAIProvider({ apiKey: KEY, model: MODEL, baseUrl, timeoutMs: 1 });
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
    const provider = createOpenAIProvider({ apiKey: KEY, model: MODEL, baseUrl });
    const completion = provider.complete({
      system: SYSTEM,
      messages: HELLO,
      tools: TOOLS,
      signal: controller.signal,
    });
    await assert.rejects(completion, (error) => error === reason);
  });

  test("never puts the key in an error message", async (t) => {
    // The Responses API echoes a masked key in a 401, such as sk-test-****cret.
    const masked = apiError(
      "invalid_request_error",
      "Incorrect API key provided: sk-test-****cret.",
    );
    const echo = apiError("invalid_request_error", `Bad key: ${KEY}`);
    const failures = [
      useStub(t, { status: 401, body: masked }),
      useStub(t, { status: 401, body: echo }),
      useStub(t, { status: 400, body: echo }),
      useStub(t, { status: 500, body: echo }),
      useStub(t, {
        body: {
          ...ANSWER,
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
        },
      }),
    ];
    const providers = (await Promise.all(failures)).map(({ provider }) => provider);
    providers.push(
      createOpenAIProvider({ apiKey: KEY, model: MODEL, baseUrl: await refusingBaseUrl() }),
    );
    for (const provider of providers) {
      const error = await provider.complete({ system: SYSTEM, messages: HELLO, tools: TOOLS }).then(
        () => assert.fail("expected a rejection"),
        (reason) => reason,
      );
      assert.ok(error instanceof ProviderError, String(error));
      for (const text of [error.message, error.stack]) {
        assert.ok(!text.includes(KEY), text);
        assert.ok(!text.includes("sk-test-****cret"), text);
      }
    }
  });
});
