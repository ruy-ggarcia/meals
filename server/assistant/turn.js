// A turn: everything the server does to answer one message. It calls the
// model, runs the tools that the model asks for, sends the results back, and
// repeats until the model answers with text only. A turn works on copies: it
// returns the new messages and pending changes, and a turn that fails or is
// canceled changes nothing that the caller holds.

import { silentLogger } from "../logger.js";
import { runTool, TOOLS } from "./tools.js";

/** @typedef {import("../logger.js").Logger} Logger */
/** @typedef {import("./pending.js").PendingChange} PendingChange */
/** @typedef {import("./providers/errors.js").Message} Message */
/** @typedef {import("./providers/errors.js").Provider} Provider */
/** @typedef {import("./providers/errors.js").ToolCall} ToolCall */

// The output of a call whose arguments the adapter couldn't parse. The model
// gets it as any other tool error, so it can send the call again.
const NOT_JSON = { error: "The arguments of this tool call aren't valid JSON." };

/** The model kept calling tools for the whole limit of rounds. */
export class TurnLimitError extends Error {
  name = "TurnLimitError";
}

/**
 * Runs the tool calls of one answer in order, each on the pending changes
 * that the call before it left. Rejects with the reason of `signal` when it
 * aborts before a call.
 * @param {ToolCall[]} toolCalls
 * @param {{ stores: any, pending: PendingChange[], logger: Logger, signal?: AbortSignal }} context
 */
async function runToolCalls(toolCalls, { stores, pending, logger, signal }) {
  let current = pending;
  const results = [];
  for (const { id, name, input } of toolCalls) {
    signal?.throwIfAborted();
    let output = NOT_JSON;
    let isError = true;
    if (input !== null) {
      const result = await runTool(name, input, { stores, pending: current, logger });
      ({ output, isError } = result);
      current = result.pending;
    }
    results.push({ id, name, output: JSON.stringify(output), isError });
  }
  return { results, pending: current };
}

/**
 * Answers the last message of `messages`. It never changes its `messages` or
 * `pending` arguments.
 *
 * Rejects with the provider's error when a call to the model fails, with
 * `TurnLimitError` when `maxRounds` answers in a row call tools, and with the
 * reason of `signal` when it aborts, checked before each call to the model
 * and before each tool call.
 *
 * @param {object} options
 * @param {Provider} options.provider
 * @param {string} options.system The instructions.
 * @param {Message[]} options.messages The conversation so far.
 * @param {PendingChange[]} options.pending The pending changes before the turn.
 * @param {any} options.stores
 * @param {AbortSignal} [options.signal]
 * @param {Logger} [options.logger] Gets the failures of the tools.
 * @param {number} [options.maxRounds]
 * @returns {Promise<{ messages: Message[], pending: PendingChange[], usage: { inputTokens: number, outputTokens: number }, rounds: number }>}
 *   `messages` holds only the new ones: each answer of the model, each
 *   followed by the results of its tool calls. `rounds` counts the calls to
 *   the model, and `usage` sums their tokens.
 */
export async function runTurn({
  provider,
  system,
  messages,
  pending,
  stores,
  signal,
  logger = silentLogger,
  maxRounds = 30,
}) {
  /** @type {Message[]} */
  const added = [];
  let current = pending;
  const usage = { inputTokens: 0, outputTokens: 0 };
  for (let rounds = 1; ; rounds += 1) {
    signal?.throwIfAborted();
    const answer = await provider.complete({
      system,
      messages: [...messages, ...added],
      tools: TOOLS,
      signal,
    });
    usage.inputTokens += answer.usage.inputTokens;
    usage.outputTokens += answer.usage.outputTokens;
    if (answer.toolCalls.length === 0) {
      added.push({ role: "assistant", text: answer.text, toolCalls: [] });
      return { messages: added, pending: current, usage, rounds };
    }
    const ran = await runToolCalls(answer.toolCalls, { stores, pending: current, logger, signal });
    added.push(
      { role: "assistant", text: answer.text, toolCalls: answer.toolCalls },
      { role: "tool", results: ran.results },
    );
    current = ran.pending;
    if (rounds >= maxRounds) {
      throw new TurnLimitError(`The model called tools in ${maxRounds} rounds in a row.`);
    }
  }
}
