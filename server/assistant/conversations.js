// Conversations with the assistant. They live in the server's memory only, so
// a restart ends them and backups never hold them. Each one keeps its
// messages, their attachments, and its pending changes. A message starts a
// turn that runs in the background, one at a time, and the page reads the
// conversation until the turn ends. Apply saves every pending change or none.

import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { ConflictError, NotFoundError, ValidationError } from "../errors.js";
import { silentLogger } from "../logger.js";
import { isPlainObject } from "../shapes.js";
import { isWeekId } from "../weeks.js";
import { instructions } from "./instructions.js";
import { describe as describePending, nextState, weeksOf } from "./pending.js";
import { ProviderError } from "./providers/errors.js";
import { runTurn, TurnLimitError } from "./turn.js";

/** @typedef {import("../logger.js").Logger} Logger */
/** @typedef {import("./pending.js").PendingChange} PendingChange */
/** @typedef {import("./pending.js").Problem} Problem */
/** @typedef {import("./providers/errors.js").Message} Message */
/** @typedef {import("./providers/errors.js").Provider} Provider */

/**
 * @typedef {object} Clock
 * @property {() => number} now The time in milliseconds since the epoch.
 * @property {(fn: () => void, ms: number) => any} setTimeout
 * @property {(handle: any) => void} clearTimeout
 */

/**
 * A file of a user message: `data` in base64, `mediaType` from its first
 * bytes, and `size` in decoded bytes.
 * @typedef {{ name: string, mediaType: string, data: string, size: number }} StoredAttachment
 */

/**
 * A message as the conversation keeps it. A user message keeps the week that
 * the page showed, the browser's date, and whether its turn failed. A note
 * records what the user did outside the chat, for the model only. Assistant
 * and tool messages are the ones that a turn returns.
 * @typedef {{ role: "user", text: string, attachments: StoredAttachment[], week?: string, today?: string, failed?: boolean }} UserEntry
 * @typedef {{ role: "note", text: string }} NoteEntry
 * @typedef {UserEntry | NoteEntry | Exclude<Message, { role: "user" }>} Entry
 */

/**
 * @typedef {object} Conversation
 * @property {string} id
 * @property {Entry[]} entries
 * @property {PendingChange[]} pending
 * @property {Problem[]} problems The problems of the last rejected apply,
 *   until the pending changes change.
 * @property {"limit" | "provider" | "too_long" | undefined} error Why the
 *   last turn failed.
 * @property {number} activity When the last message, apply, or discard came.
 * @property {any} idleTimer
 * @property {AbortController | undefined} turn The running turn's controller.
 * @property {boolean} applying
 */

/**
 * What a page shows of a conversation.
 * @typedef {object} ConversationView
 * @property {string} id
 * @property {"idle" | "working" | "failed"} status
 * @property {"limit" | "provider" | "too_long"} [error]
 * @property {{ role: "user" | "assistant", text: string, attachments?: string[], failed?: true }[]} messages
 * @property {any[]} pending What `describe` gives.
 */

const MB = 1024 * 1024;
const MAX_ATTACHMENTS = 5;
const MAX_FILE_BYTES = 10 * MB;
const MAX_CONVERSATION_BYTES = 20 * MB;
const MAX_TEXT = 20000;
const MAX_NAME = 255;
const DAY_MS = 86_400_000;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// The first bytes of each type of file that the providers read.
const SIGNATURES = [
  { mediaType: "application/pdf", bytes: Buffer.from("%PDF-", "latin1") },
  { mediaType: "image/png", bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { mediaType: "image/jpeg", bytes: Buffer.from([0xff, 0xd8, 0xff]) },
];

const APPLIED = "(Meals: the user applied the pending changes.)";
const DISCARDED = "(Meals: the user discarded the pending changes.)";

/** The reason of the abort of a turn whose conversation ended. */
class TurnCanceled extends Error {
  name = "TurnCanceled";
}

/** The reason of the abort of a turn that ran for the whole time limit. */
class TurnTimedOut extends Error {
  name = "TurnTimedOut";
}

/**
 * The real clock. Its timers don't keep the process alive: a conversation
 * that waits to expire never holds up a stop.
 * @type {Clock}
 */
const realClock = {
  now: () => Date.now(),
  setTimeout(fn, ms) {
    const timer = setTimeout(fn, ms);
    timer.unref();
    return timer;
  },
  clearTimeout: (handle) => clearTimeout(handle),
};

/** The local date of `time` as `YYYY-MM-DD`. */
function localDate(time) {
  const date = new Date(time);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Whether `value` is a real calendar date as `YYYY-MM-DD`. An impossible date
 * such as 2026-02-30 rolls over to another day, so it fails the round trip.
 */
function isDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/**
 * The date that the model reads as today: the browser's, which knows the
 * family's time zone, when it's at most one day from `serverToday`, the
 * server's own. A browser with a wrong clock gets the server's.
 * @param {string | undefined} browserToday
 * @param {string} serverToday
 */
function todayOf(browserToday, serverToday) {
  if (browserToday === undefined) return serverToday;
  const days = (Date.parse(browserToday) - Date.parse(serverToday)) / DAY_MS;
  return Math.abs(days) <= 1 ? browserToday : serverToday;
}

/** The media type that the first bytes of `bytes` show, or undefined. */
function mediaTypeOf(bytes) {
  return SIGNATURES.find((signature) =>
    bytes.subarray(0, signature.bytes.length).equals(signature.bytes),
  )?.mediaType;
}

/**
 * The attachment at `index` of a message, checked. Only the part of the name
 * after the last `/` or `\` stays, so a path never reaches the model.
 * @param {any} attachment
 * @param {number} index
 * @returns {StoredAttachment}
 */
function attachmentOf(attachment, index) {
  const name =
    isPlainObject(attachment) && typeof attachment.name === "string"
      ? attachment.name.split(/[/\\]/).at(-1)
      : "";
  if (name === "") throw new ValidationError(`attachments[${index}] needs a name.`);
  if (name.length > MAX_NAME) {
    throw new ValidationError(
      `"${name.slice(0, 40)}…" has a name longer than ${MAX_NAME} characters.`,
    );
  }
  const { data } = attachment;
  // Decoding is lenient, so data that doesn't encode back the same isn't
  // base64, and its size would be wrong.
  const bytes = Buffer.from(typeof data === "string" ? data : "", "base64");
  if (typeof data !== "string" || bytes.toString("base64") !== data) {
    throw new ValidationError(`"${name}" isn't valid base64.`);
  }
  const mediaType = mediaTypeOf(bytes);
  if (mediaType === undefined) {
    throw new ValidationError(`"${name}" isn't a PDF, a JPEG, or a PNG.`);
  }
  if (bytes.length > MAX_FILE_BYTES) throw new ValidationError(`"${name}" is larger than 10 MB.`);
  return { name, mediaType, data, size: bytes.length };
}

/**
 * The user message of `message`, checked. `usedBytes` counts the attachments
 * that the conversation already holds.
 * @param {any} message
 * @param {number} usedBytes
 * @returns {UserEntry}
 */
function userEntryOf(message, usedBytes) {
  const { text = "", attachments = [], week, today } = isPlainObject(message) ? message : {};
  if (typeof text !== "string") throw new ValidationError('"text" must be a string.');
  if (!Array.isArray(attachments)) throw new ValidationError('"attachments" must be a list.');
  if (week !== undefined && !isWeekId(week)) {
    throw new ValidationError('"week" must be a Monday as YYYY-MM-DD.');
  }
  if (today !== undefined && !isDate(today)) {
    throw new ValidationError('"today" must be a date as YYYY-MM-DD.');
  }
  const trimmed = text.trim();
  if (trimmed === "" && attachments.length === 0) {
    throw new ValidationError("A message needs text or an attachment.");
  }
  if (trimmed.length > MAX_TEXT) {
    throw new ValidationError(`A message holds at most ${MAX_TEXT} characters.`);
  }
  if (attachments.length > MAX_ATTACHMENTS) {
    throw new ValidationError(`A message holds at most ${MAX_ATTACHMENTS} attachments.`);
  }
  const files = attachments.map(attachmentOf);
  const total = files.reduce((sum, file) => sum + file.size, usedBytes);
  if (total > MAX_CONVERSATION_BYTES) {
    throw new ValidationError(
      "The attachments of a conversation total at most 20 MB. Start a new conversation to attach more.",
    );
  }
  return {
    role: "user",
    text: trimmed,
    attachments: files,
    ...(week !== undefined && { week }),
    ...(today !== undefined && { today }),
  };
}

/**
 * The messages that the model reads. Each run of user messages and notes
 * without an answer between them becomes one user message: the notes, one
 * per line, and then the texts, joined by a blank line, with every
 * attachment in order. A message without an answer is one whose turn failed.
 * @param {Entry[]} entries
 * @returns {Message[]}
 */
function messagesForModel(entries) {
  /** @type {Message[]} */
  const messages = [];
  /** @type {{ notes: string[], texts: string[], attachments: any[] } | undefined} */
  let run;
  const flush = () => {
    if (run === undefined) return;
    const text = [run.notes.join("\n"), run.texts.join("\n\n")].filter(Boolean).join("\n");
    messages.push({ role: "user", text, attachments: run.attachments });
    run = undefined;
  };
  for (const entry of entries) {
    if (entry.role !== "user" && entry.role !== "note") {
      flush();
      messages.push(entry);
      continue;
    }
    run ??= { notes: [], texts: [], attachments: [] };
    if (entry.role === "note") {
      run.notes.push(entry.text);
      continue;
    }
    if (entry.text !== "") run.texts.push(entry.text);
    for (const { name, mediaType, data } of entry.attachments) {
      run.attachments.push({ name, mediaType, data });
    }
  }
  flush();
  return messages;
}

/** The last user message of `conversation`, or undefined. */
function lastUserEntry(conversation) {
  return /** @type {UserEntry | undefined} */ (
    conversation.entries.findLast((entry) => entry.role === "user")
  );
}

/** What a page shows of the messages: never a note, a tool call, or a file. */
function messagesForView(entries) {
  return entries.flatMap((entry) => {
    if (entry.role === "user") {
      const names = entry.attachments.map((attachment) => attachment.name);
      return [
        {
          role: "user",
          text: entry.text,
          ...(names.length > 0 && { attachments: names }),
          ...(entry.failed && { failed: true }),
        },
      ];
    }
    if (entry.role === "assistant" && entry.text !== "") {
      return [{ role: "assistant", text: entry.text }];
    }
    return [];
  });
}

/**
 * Keeps the conversations of the server. A message starts a turn on
 * `provider` that runs until it ends, fails, or is canceled; `settled` and
 * `stop` wait for it.
 *
 * @param {object} options
 * @param {Provider} options.provider
 * @param {any} options.stores
 * @param {Logger} [options.logger]
 * @param {Clock} [options.clock]
 * @param {number} [options.maxConversations] Creating one more ends the one
 *   with the oldest activity.
 * @param {number} [options.idleMs] How long a conversation lasts after its
 *   last activity.
 * @param {number} [options.turnMs] How long a turn may run.
 */
export function createConversations({
  provider,
  stores,
  logger = silentLogger,
  clock = realClock,
  maxConversations = 20,
  idleMs = 86_400_000,
  turnMs = 180_000,
}) {
  /** @type {Map<string, Conversation>} */
  const conversations = new Map();
  /** The running turns by conversation, ended conversations included. */
  const turns = new Map();

  /** @returns {Conversation} */
  function get(id) {
    const conversation = conversations.get(id);
    if (!conversation) throw new NotFoundError(`Unknown conversation: ${id}`);
    return conversation;
  }

  /** Throws when a turn or an apply runs, which would race with a change. */
  function checkFree(conversation) {
    if (conversation.turn) throw new ConflictError("The assistant is still answering.");
    if (conversation.applying) throw new ConflictError("The pending changes are being applied.");
  }

  /** Records activity now, so the conversation lasts `idleMs` from now. */
  function touch(conversation) {
    conversation.activity = clock.now();
    clock.clearTimeout(conversation.idleTimer);
    conversation.idleTimer = clock.setTimeout(() => remove(conversation), idleMs);
  }

  /** Ends `conversation`: drops it, clears its timer, and cancels its turn. */
  function remove(conversation) {
    conversations.delete(conversation.id);
    clock.clearTimeout(conversation.idleTimer);
    conversation.turn?.abort(new TurnCanceled("The conversation ended."));
  }

  /** @param {Conversation} conversation */
  function setPending(conversation, pending) {
    if (!isDeepStrictEqual(pending, conversation.pending)) conversation.problems = [];
    conversation.pending = pending;
  }

  /**
   * Answers the conversation's last message. Works on a copy of the pending
   * changes and adds the turn's messages only when it succeeds, so a turn
   * that fails or is canceled leaves both as they were. Never rejects.
   * @param {Conversation} conversation
   * @param {AbortController} controller
   */
  async function answer(conversation, controller) {
    const { signal } = controller;
    const started = clock.now();
    let rounds = 0;
    const usage = { inputTokens: 0, outputTokens: 0 };
    // Counts every call, so a turn that fails logs what it cost too.
    /** @type {Provider} */
    const counting = {
      ...provider,
      async complete(request) {
        rounds += 1;
        const result = await provider.complete(request);
        usage.inputTokens += result.usage.inputTokens;
        usage.outputTokens += result.usage.outputTokens;
        return result;
      },
    };
    /** @type {"ok" | "canceled" | "limit" | "provider" | "too_long"} */
    let outcome = "ok";
    try {
      const week = conversation.entries.findLast(
        (entry) => entry.role === "user" && entry.week !== undefined,
      );
      const system = instructions({
        preferences: await stores.preferences.read(),
        today: todayOf(lastUserEntry(conversation)?.today, localDate(clock.now())),
        week: /** @type {UserEntry | undefined} */ (week)?.week,
      });
      const result = await runTurn({
        provider: counting,
        system,
        messages: messagesForModel(conversation.entries),
        pending: conversation.pending,
        stores,
        signal,
        logger,
      });
      // The limit or an end can come after the last call, before this runs.
      signal.throwIfAborted();
      conversation.entries.push(.../** @type {Entry[]} */ (result.messages));
      setPending(conversation, result.pending);
    } catch (caught) {
      const error = signal.aborted ? signal.reason : caught;
      outcome = outcomeOf(error);
      if (outcome === "provider") {
        logger.error(
          "assistant turn failed",
          error instanceof ProviderError
            ? { kind: error.kind, error: error.message }
            : { error: error?.stack ?? String(error) },
        );
      }
      const entry = lastUserEntry(conversation);
      if (entry) entry.failed = true;
      conversation.error = outcome === "canceled" ? undefined : outcome;
    }
    logger.info("assistant turn", {
      provider: provider.name,
      model: provider.model,
      rounds,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      ms: clock.now() - started,
      outcome,
    });
  }

  /** @returns {"canceled" | "limit" | "provider" | "too_long"} */
  function outcomeOf(error) {
    if (error instanceof TurnCanceled) return "canceled";
    if (error instanceof TurnTimedOut || error instanceof TurnLimitError) return "limit";
    if (error instanceof ProviderError && error.kind === "too_long") return "too_long";
    return "provider";
  }

  /** Starts a turn on the conversation's last message. */
  function startTurn(conversation) {
    const controller = new AbortController();
    conversation.turn = controller;
    conversation.error = undefined;
    const limit = clock.setTimeout(
      () => controller.abort(new TurnTimedOut(`The turn ran for ${turnMs} ms.`)),
      turnMs,
    );
    const turn = answer(conversation, controller).finally(() => {
      clock.clearTimeout(limit);
      conversation.turn = undefined;
      turns.delete(conversation.id);
    });
    turns.set(conversation.id, turn);
  }

  /** Records a note for the model, which reads it with the next message. */
  function note(conversation, text) {
    conversation.entries.push({ role: "note", text });
  }

  return {
    /** Starts an empty conversation. */
    create() {
      if (conversations.size >= maxConversations) {
        let oldest;
        for (const conversation of conversations.values()) {
          if (oldest === undefined || conversation.activity < oldest.activity) {
            oldest = conversation;
          }
        }
        if (oldest) remove(oldest);
      }
      /** @type {Conversation} */
      const conversation = {
        id: randomUUID(),
        entries: [],
        pending: [],
        problems: [],
        error: undefined,
        activity: 0,
        idleTimer: undefined,
        turn: undefined,
        applying: false,
      };
      conversations.set(conversation.id, conversation);
      touch(conversation);
      return { id: conversation.id };
    },

    /**
     * What a page shows of the conversation. Every object that it returns is
     * new, so a caller can't change the conversation through it.
     * @param {string} id
     * @returns {Promise<ConversationView>}
     */
    async view(id) {
      const conversation = get(id);
      const { pending, problems } = conversation;
      /** @type {ConversationView["status"]} */
      const status = conversation.turn
        ? "working"
        : lastUserEntry(conversation)?.failed
          ? "failed"
          : "idle";
      const view = {
        id,
        status,
        ...(status === "failed" && conversation.error && { error: conversation.error }),
        messages: messagesForView(conversation.entries),
      };
      // The window reads the conversation every second during a turn, and
      // most turns stage nothing.
      if (pending.length === 0) return structuredClone({ ...view, pending: [] });
      const state = await stores.read(weeksOf(pending));
      return structuredClone({ ...view, pending: describePending(state, pending, problems) });
    },

    /**
     * Adds a user message and starts a turn that answers it, and returns
     * without waiting for the turn. A message after a failed one clears its
     * failed mark: the model reads both as one.
     * @param {string} id
     * @param {{ text?: string, attachments?: { name: string, data: string }[], week?: string, today?: string }} message
     */
    send(id, message) {
      const conversation = get(id);
      checkFree(conversation);
      const used = conversation.entries.reduce(
        (sum, entry) =>
          entry.role === "user"
            ? entry.attachments.reduce((total, file) => total + file.size, sum)
            : sum,
        0,
      );
      const entry = userEntryOf(message, used);
      const last = lastUserEntry(conversation);
      if (last) delete last.failed;
      conversation.entries.push(entry);
      touch(conversation);
      startTurn(conversation);
    },

    /** Runs the turn of the failed last message again. */
    retry(id) {
      const conversation = get(id);
      checkFree(conversation);
      const last = lastUserEntry(conversation);
      if (!last?.failed) throw new ConflictError("There's nothing to retry.");
      delete last.failed;
      touch(conversation);
      startTurn(conversation);
    },

    /**
     * Saves every pending change, or none when any has a problem against the
     * data as it is now. A failure of the disk rejects and keeps them.
     * @param {string} id
     * @returns {Promise<{ applied: true } | { applied: false, problems: Problem[] }>}
     */
    async apply(id) {
      const conversation = get(id);
      checkFree(conversation);
      touch(conversation);
      const { pending } = conversation;
      conversation.applying = true;
      try {
        const result = await stores.transaction(weeksOf(pending), (state) => {
          const next = nextState(state, pending);
          if (next.problems.length > 0) {
            return { state, result: { applied: false, problems: next.problems } };
          }
          return { state: next.state, result: { applied: true } };
        });
        if (result.applied) {
          setPending(conversation, []);
          note(conversation, APPLIED);
        } else {
          conversation.problems = result.problems;
          // Each message ends with a period, and the note ends with its own.
          const messages = result.problems
            .map((problem) => problem.message.replace(/\.$/, ""))
            .join("; ");
          note(conversation, `(Meals: the pending changes couldn't be applied: ${messages}.)`);
        }
        return structuredClone(result);
      } finally {
        conversation.applying = false;
      }
    },

    /** Removes every pending change. */
    discard(id) {
      const conversation = get(id);
      checkFree(conversation);
      touch(conversation);
      setPending(conversation, []);
      note(conversation, DISCARDED);
    },

    /** Ends the conversation and cancels its turn. */
    end(id) {
      remove(get(id));
    },

    /**
     * Resolves when no turn of the conversation runs, even after it ended.
     * @param {string} id
     * @returns {Promise<void>}
     */
    async settled(id) {
      await turns.get(id);
    },

    /**
     * Ends every conversation, which cancels every turn and clears every
     * timer, and resolves when every turn has settled.
     * @returns {Promise<void>}
     */
    async stop() {
      for (const conversation of [...conversations.values()]) remove(conversation);
      await Promise.all(turns.values());
    },
  };
}
