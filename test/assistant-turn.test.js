import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { ProviderError } from "../server/assistant/providers/errors.js";
import { runTool, TOOLS } from "../server/assistant/tools.js";
import { runTurn, TurnLimitError } from "../server/assistant/turn.js";
import { createStores } from "../server/stores.js";
import { scriptedProvider } from "./assistant-helpers.js";
import { collectingLogger, useDataDir, writeDataFile } from "./backend-helpers.js";

const SYSTEM = "You are a test assistant.";

const onion = { id: "onion", name: "Onion", unit: "g", measures: [], archived: false };

/** @type {import("../server/assistant/providers/errors.js").Message[]} */
const MESSAGES = [{ role: "user", text: "Add leeks to the catalog.", attachments: [] }];

const NOT_JSON = { error: "The arguments of this tool call aren't valid JSON." };

/**
 * Creates a data directory with a catalog of one ingredient before each test.
 * Returns the data directory and the stores on it of the test that runs.
 */
function useStores() {
  const dataDir = useDataDir("meals-assistant-turn-");
  let stores;
  beforeEach(async () => {
    await writeDataFile(dataDir(), "v2/ingredients.json", JSON.stringify({ ingredients: [onion] }));
    stores = createStores({ dataDir: dataDir() });
  });
  return { dataDir, stores: () => stores };
}

/** A tool call with `id`, of the tool `name`, with `input`. */
function call(id, name, input = {}) {
  return { id, name, input };
}

describe("runTurn", () => {
  const { dataDir, stores } = useStores();

  /** Runs a turn on the stores of the test, with the system, messages, and no pending changes. */
  function turn(provider, options = {}) {
    return runTurn({
      provider,
      system: SYSTEM,
      messages: MESSAGES,
      pending: [],
      stores: stores(),
      ...options,
    });
  }

  test("returns the answer when the model calls no tool", async () => {
    const provider = scriptedProvider([{ text: "Hello." }]);

    const result = await turn(provider);

    assert.deepEqual(result.messages, [{ role: "assistant", text: "Hello.", toolCalls: [] }]);
  });

  test("sends the instructions, the conversation, and the tools", async () => {
    const provider = scriptedProvider([{ text: "Hello." }]);

    await turn(provider);

    assert.deepEqual(provider.calls, [{ system: SYSTEM, messages: MESSAGES, tools: TOOLS }]);
  });

  test("runs two tool calls of one answer in order and sends both results back", async () => {
    const calls = [
      call("c1", "propose_ingredient", { name: "Leek", unit: "g" }),
      call("c2", "list_ingredients"),
    ];
    const provider = scriptedProvider([
      { text: "Let me add it.", toolCalls: calls },
      { text: "Done." },
    ]);

    await turn(provider);

    const [assistant, tool] = provider.calls[1].messages.slice(1);
    assert.deepEqual(assistant, { role: "assistant", text: "Let me add it.", toolCalls: calls });
    assert.deepEqual(
      tool.role === "tool" &&
        tool.results.map((result) => [result.id, result.name, result.isError]),
      [
        ["c1", "propose_ingredient", false],
        ["c2", "list_ingredients", false],
      ],
    );
    const listed = JSON.parse(tool.role === "tool" ? tool.results[1].output : "{}");
    assert.deepEqual(
      listed.ingredients.map((entry) => entry.name),
      ["Leek", "Onion"],
    );
  });

  test("returns the tool calls and their results before the answer", async () => {
    const provider = scriptedProvider([
      { toolCalls: [call("c1", "propose_ingredient", { name: "Leek", unit: "g" })] },
      { text: "Done." },
    ]);

    const result = await turn(provider);

    assert.deepEqual(result.messages.slice(0, 2), provider.calls[1].messages.slice(1));
    assert.deepEqual(result.messages[2], { role: "assistant", text: "Done.", toolCalls: [] });
  });

  test("returns the pending changes that the tools staged", async () => {
    const provider = scriptedProvider([
      { toolCalls: [call("c1", "propose_ingredient", { name: "Leek", unit: "g" })] },
      { text: "Done." },
    ]);

    const result = await turn(provider);

    assert.deepEqual(
      result.pending.map((change) => [change.kind, change.action, change.fields?.name]),
      [["ingredient", "create", "Leek"]],
    );
  });

  test("continues with a tool error when the model calls an unknown tool", async () => {
    const provider = scriptedProvider([
      { toolCalls: [call("c1", "delete_everything")] },
      { text: "Sorry." },
    ]);

    const result = await turn(provider);

    const [tool] = provider.calls[1].messages.slice(2);
    assert.deepEqual(tool, {
      role: "tool",
      results: [
        {
          id: "c1",
          name: "delete_everything",
          output: JSON.stringify({ error: "Unknown tool: delete_everything" }),
          isError: true,
        },
      ],
    });
    assert.deepEqual(result.messages.at(-1), { role: "assistant", text: "Sorry.", toolCalls: [] });
  });

  test("continues with a tool error when a tool call has null input", async () => {
    const provider = scriptedProvider([
      { toolCalls: [call("c1", "propose_ingredient", null)] },
      { text: "Sorry." },
    ]);

    const result = await turn(provider);

    const [tool] = provider.calls[1].messages.slice(2);
    assert.deepEqual(tool, {
      role: "tool",
      results: [
        { id: "c1", name: "propose_ingredient", output: JSON.stringify(NOT_JSON), isError: true },
      ],
    });
    assert.deepEqual(result.messages.at(-1), { role: "assistant", text: "Sorry.", toolCalls: [] });
  });

  test("rejects with TurnLimitError after 30 rounds of tool calls", async () => {
    const rounds = Array.from({ length: 30 }, (_, index) => ({
      toolCalls: [call(`c${index}`, "list_recipes")],
    }));
    const provider = scriptedProvider([...rounds, { text: "Never sent." }]);

    await assert.rejects(turn(provider), TurnLimitError);
    assert.equal(provider.calls.length, 30);
  });

  test("rejects with ProviderError when the final answer is blank", async () => {
    const provider = scriptedProvider([
      { toolCalls: [call("c1", "list_recipes")] },
      { text: " \n" },
    ]);

    await assert.rejects(turn(provider), {
      name: "ProviderError",
      kind: "other",
      message: "The model gave an empty answer.",
    });
  });

  test("rejects with the provider's error and leaves its arguments unchanged", async () => {
    const staged = await runTool(
      "propose_ingredient",
      { name: "Garlic", unit: "g" },
      { stores: stores(), pending: [] },
    );
    const pending = staged.pending;
    const before = structuredClone({ messages: MESSAGES, pending });
    const failure = new ProviderError("overloaded", "Overloaded");
    const provider = scriptedProvider([
      { toolCalls: [call("c1", "propose_ingredient", { name: "Leek", unit: "g" })] },
      failure,
    ]);

    await assert.rejects(turn(provider, { pending }), (error) => error === failure);
    assert.deepEqual({ messages: MESSAGES, pending }, before);
  });

  test("stops before the next provider call when the signal aborts", async () => {
    const controller = new AbortController();
    const reason = new Error("Canceled");
    const real = stores();
    // Aborts while the tool reads, after the provider answered.
    const aborting = {
      ...real,
      async read(weeks) {
        controller.abort(reason);
        return real.read(weeks);
      },
    };
    const provider = scriptedProvider([
      { toolCalls: [call("c1", "list_recipes")] },
      { text: "Never sent." },
    ]);

    await assert.rejects(
      turn(provider, { stores: aborting, signal: controller.signal }),
      (error) => error === reason,
    );
    assert.equal(provider.calls.length, 1);
  });

  test("runs no tool call after the signal aborts", async () => {
    const controller = new AbortController();
    const reason = new Error("Canceled");
    const real = stores();
    let reads = 0;
    const counting = {
      ...real,
      async read(weeks) {
        reads += 1;
        return real.read(weeks);
      },
    };
    const provider = scriptedProvider([
      () => {
        controller.abort(reason);
        return { toolCalls: [call("c1", "list_recipes")] };
      },
    ]);

    await assert.rejects(
      turn(provider, { stores: counting, signal: controller.signal }),
      (error) => error === reason,
    );
    assert.equal(reads, 0);
  });

  test("passes the signal to the provider", async () => {
    const controller = new AbortController();
    let received;
    const provider = scriptedProvider([
      (request) => {
        received = request.signal;
        return { text: "Hello." };
      },
    ]);

    await turn(provider, { signal: controller.signal });

    assert.equal(received, controller.signal);
  });

  test("sums the token usage over the provider calls of the turn", async () => {
    const provider = scriptedProvider([
      { toolCalls: [call("c1", "list_recipes")], usage: { inputTokens: 100, outputTokens: 20 } },
      { text: "Done.", usage: { inputTokens: 150, outputTokens: 5 } },
    ]);

    const result = await turn(provider);

    assert.deepEqual(result.usage, { inputTokens: 250, outputTokens: 25 });
  });

  test("counts the provider calls of the turn as rounds", async () => {
    const provider = scriptedProvider([
      { toolCalls: [call("c1", "list_recipes")] },
      { toolCalls: [call("c2", "list_ingredients")] },
      { text: "Done." },
    ]);

    const result = await turn(provider);

    assert.equal(result.rounds, 3);
  });

  test("logs a tool failure through the logger", async () => {
    await writeDataFile(dataDir(), "v2/ingredients.json", "not JSON");
    const { entries, logger } = collectingLogger();
    const provider = scriptedProvider([
      { toolCalls: [call("c1", "list_ingredients")] },
      { text: "Sorry." },
    ]);

    await turn(provider, { logger });

    assert.deepEqual(
      entries.map((entry) => [entry.level, entry.msg, entry.tool]),
      [["error", "assistant tool failed", "list_ingredients"]],
    );
  });
});
