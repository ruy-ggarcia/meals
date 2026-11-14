import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { createConversations } from "../server/assistant/conversations.js";
import { instructions } from "../server/assistant/instructions.js";
import { ProviderError } from "../server/assistant/providers/errors.js";
import { createStores } from "../server/stores.js";
import { fakeClock, scriptedProvider } from "./assistant-helpers.js";
import {
  blankWeek,
  collectingLogger,
  useDataDir,
  within,
  writeDataFile,
} from "./backend-helpers.js";

const WEEK = "2026-11-16";
const NEXT_WEEK = "2026-11-23";

// Noon of Monday, November 16, 2026, in the local time zone, so the local
// date is the same in every time zone.
const NOON = new Date(2026, 10, 16, 12).getTime();

const TURN_MS = 180_000;
const IDLE_MS = 86_400_000;
const MB = 1024 * 1024;

const BUSY = { name: "ConflictError", message: "The assistant is still answering." };

const onion = { id: "onion", name: "Onion", unit: "g", measures: [], archived: false };
const soup = {
  id: "soup",
  name: "Soup",
  archived: false,
  ingredients: [{ ingredientId: "onion", quantity: 100 }],
};

/** The base64 of a PDF file of `size` bytes: its signature and then zeros. */
function pdf(size = 64) {
  const bytes = Buffer.alloc(size);
  bytes.write("%PDF-1.7");
  return bytes.toString("base64");
}

/** The base64 of the first bytes of a PNG file. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).toString(
  "base64",
);

/** An attachment named `name` of a PDF file of `size` bytes. */
function pdfFile(name, size) {
  return { name, mediaType: "application/pdf", data: pdf(size) };
}

/** A tool call with `id`, of the tool `name`, with `input`. */
function call(id, name, input = {}) {
  return { id, name, input };
}

/** The parsed output of the tool call `callId` in the messages of `request`. */
function outputOf(request, callId) {
  for (const message of request.messages) {
    if (message.role !== "tool") continue;
    const result = message.results.find((candidate) => candidate.id === callId);
    if (result) return JSON.parse(result.output);
  }
  throw new Error(`No result of tool call ${callId}`);
}

/**
 * A step of a script that holds the provider call until the test releases
 * it, and rejects with the reason of the call's signal when it aborts.
 * `called` resolves when the call starts.
 */
function held() {
  /** @type {(answer: any) => void} */
  let release = () => {
    throw new Error("The held call hasn't started.");
  };
  /** @type {() => void} */
  let started = () => {};
  const called = new Promise((resolve) => {
    started = () => resolve(undefined);
  });
  /** @param {{ signal?: AbortSignal }} request */
  const step = ({ signal }) =>
    new Promise((resolve, reject) => {
      release = resolve;
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      started();
    });
  return {
    step,
    called: () => within(called, "the provider call didn't start"),
    release: (answer) => release(answer),
  };
}

/**
 * Writes a catalog, a recipe book, and a week to a new data directory before
 * each test. Returns the data directory and the stores on it of the test
 * that runs.
 */
function useStores() {
  const dataDir = useDataDir("meals-conversations-");
  let stores;
  beforeEach(async () => {
    await writeDataFile(dataDir(), "v2/ingredients.json", JSON.stringify({ ingredients: [onion] }));
    await writeDataFile(dataDir(), "v2/recipes.json", JSON.stringify({ recipes: [soup] }));
    await writeDataFile(dataDir(), `v2/weeks/${WEEK}.json`, JSON.stringify(blankWeek()));
    stores = createStores({ dataDir: dataDir() });
  });
  return { dataDir, stores: () => stores };
}

describe("server/assistant/conversations.js", () => {
  const { dataDir, stores } = useStores();

  /**
   * Creates the conversations of a test, on a provider that answers from
   * `steps`, a fake clock at NOON, and a collecting logger. Stops them when
   * the test ends.
   * @param {import("node:test").TestContext} t
   * @param {any[]} steps
   * @param {object} [options] Replace the defaults of createConversations.
   */
  function setup(t, steps, options = {}) {
    const provider = scriptedProvider(steps);
    const clock = fakeClock(NOON);
    const { entries, logger } = collectingLogger();
    const conversations = createConversations({
      provider,
      stores: stores(),
      logger,
      clock,
      ...options,
    });
    t.after(() => conversations.stop());
    return { conversations, provider, clock, entries };
  }

  /** Waits until no turn of the conversation `id` runs. */
  function settle(conversations, id) {
    return within(conversations.settled(id), "the turn didn't end");
  }

  /** Sends `message` to a new conversation and waits for the turn to end. */
  async function converse(conversations, message) {
    const { id } = conversations.create();
    conversations.send(id, message);
    await settle(conversations, id);
    return id;
  }

  /** The text of the last message of the last provider call. */
  function lastSent(provider) {
    const message = provider.calls.at(-1)?.messages.at(-1);
    return message?.role === "user" ? message.text : undefined;
  }

  /**
   * The steps of a turn that proposes to rename the stored recipe Soup and
   * to create the ingredient Leek, and then answers.
   */
  const STALE_STEPS = [
    {
      toolCalls: [
        call("c1", "propose_recipe", { id: "soup", name: "Pumpkin soup" }),
        call("c2", "propose_ingredient", { name: "Leek", unit: "g" }),
      ],
    },
    { text: "Proposed." },
  ];

  /**
   * Starts a conversation whose turn proposes STALE_STEPS, renames Soup by
   * hand to Squash soup, and applies. Returns the conversation and the
   * result of the apply. `after` holds the steps of later turns.
   */
  async function rejectedApply(t, after = []) {
    const context = setup(t, [...STALE_STEPS, ...after]);
    const id = await converse(context.conversations, { text: "Rename the soup." });
    await stores().recipes.update("soup", { name: "Squash soup" });
    const result = await context.conversations.apply(id);
    return { ...context, id, result };
  }

  const SQUASH_PROBLEM = {
    target: "recipe:soup",
    message: "Squash soup changed after the assistant proposed this.",
  };

  test("shows the user's message and the assistant's answer after a turn", async (t) => {
    const { conversations } = setup(t, [{ text: "Hello." }]);

    const id = await converse(conversations, { text: "Hi." });

    assert.deepEqual(await conversations.view(id), {
      id,
      status: "idle",
      messages: [
        { role: "user", text: "Hi." },
        { role: "assistant", text: "Hello." },
      ],
      pending: [],
    });
  });

  test("trims the text of a message", async (t) => {
    const { conversations, provider } = setup(t, [{ text: "Hello." }]);

    const id = await converse(conversations, { text: "  Hi.\n" });

    assert.equal(lastSent(provider), "Hi.");
    assert.equal((await conversations.view(id)).messages[0].text, "Hi.");
  });

  test("shows the names of the attachments and never their content", async (t) => {
    const { conversations } = setup(t, [{ text: "Got it." }]);
    const file = pdfFile("menu.pdf", 64);

    const id = await converse(conversations, { text: "Plan from this.", attachments: [file] });

    const view = await conversations.view(id);
    assert.deepEqual(view.messages[0], {
      role: "user",
      text: "Plan from this.",
      attachments: ["menu.pdf"],
    });
    assert.ok(!JSON.stringify(view).includes(file.data), "the view holds the file's content");
  });

  test("keeps only the file name of an attachment's path", async (t) => {
    const { conversations } = setup(t, [{ text: "Got it." }]);

    const id = await converse(conversations, {
      text: "",
      attachments: [pdfFile("C:\\Users\\me/school\\menu.pdf", 64)],
    });

    assert.deepEqual((await conversations.view(id)).messages[0].attachments, ["menu.pdf"]);
  });

  test("sends the type of an attachment that its first bytes show", async (t) => {
    const { conversations, provider } = setup(t, [{ text: "Got it." }]);
    const file = { name: "photo", mediaType: "application/octet-stream", data: PNG };

    await converse(conversations, { text: "What is this?", attachments: [file] });

    assert.deepEqual(provider.calls[0].messages, [
      {
        role: "user",
        text: "What is this?",
        attachments: [{ name: "photo", mediaType: "image/png", data: PNG }],
      },
    ]);
  });

  test("shows no tool calls", async (t) => {
    const { conversations } = setup(t, [
      { toolCalls: [call("c1", "list_recipes")] },
      { text: "Let me look at the week.", toolCalls: [call("c2", "read_week", { week: WEEK })] },
      { text: "The week is empty." },
    ]);

    const id = await converse(conversations, { text: "What's planned?" });

    assert.deepEqual((await conversations.view(id)).messages, [
      { role: "user", text: "What's planned?" },
      { role: "assistant", text: "Let me look at the week." },
      { role: "assistant", text: "The week is empty." },
    ]);
  });

  test("shows the turn as working until it ends", async (t) => {
    const hold = held();
    const { conversations } = setup(t, [hold.step]);
    const { id } = conversations.create();

    conversations.send(id, { text: "Hi." });
    await hold.called();

    assert.equal((await conversations.view(id)).status, "working");
    hold.release({ text: "Hello." });
    await settle(conversations, id);
    assert.equal((await conversations.view(id)).status, "idle");
  });

  test("rejects a message during a turn and keeps the conversation as it was", async (t) => {
    const hold = held();
    const { conversations, provider } = setup(t, [hold.step]);
    const { id } = conversations.create();
    conversations.send(id, { text: "Plan next week." });
    await hold.called();
    const before = await conversations.view(id);

    assert.throws(() => conversations.send(id, { text: "Also lunch." }), BUSY);

    assert.deepEqual(await conversations.view(id), before);
    assert.equal(provider.calls.length, 1);
  });

  test("rejects apply and discard during a turn", async (t) => {
    const hold = held();
    const { conversations } = setup(t, [hold.step]);
    const { id } = conversations.create();
    conversations.send(id, { text: "Plan next week." });
    await hold.called();

    await assert.rejects(conversations.apply(id), BUSY);
    assert.throws(() => conversations.discard(id), BUSY);
  });

  test("rejects a message while the pending changes are being applied", async (t) => {
    /** @type {() => void} */
    let open = () => {};
    const gate = new Promise((resolve) => {
      open = () => resolve(undefined);
    });
    const real = stores();
    const gated = {
      ...real,
      async transaction(weekIds, compute) {
        await gate;
        return real.transaction(weekIds, compute);
      },
    };
    const { conversations } = setup(
      t,
      [
        { toolCalls: [call("c1", "propose_ingredient", { name: "Leek", unit: "g" })] },
        { text: "Leek is pending." },
      ],
      { stores: gated },
    );
    const id = await converse(conversations, { text: "Add leeks." });
    const applying = conversations.apply(id);

    assert.throws(() => conversations.send(id, { text: "And garlic." }), {
      name: "ConflictError",
      message: "The pending changes are being applied.",
    });
    open();
    await applying;
  });

  test("restores the pending changes when a turn fails after staging some", async (t) => {
    const { conversations } = setup(t, [
      { toolCalls: [call("c1", "propose_ingredient", { name: "Leek", unit: "g" })] },
      { text: "Leek is pending." },
      { toolCalls: [call("c2", "propose_ingredient", { name: "Garlic", unit: "g" })] },
      new ProviderError("overloaded", "Overloaded"),
    ]);
    const id = await converse(conversations, { text: "Add leeks." });

    conversations.send(id, { text: "Add garlic." });
    await settle(conversations, id);

    const view = await conversations.view(id);
    assert.deepEqual(
      view.pending.map((change) => change.name),
      ["Leek"],
    );
  });

  test("marks a message as failed, and retry runs it with its attachments", async (t) => {
    const { conversations, provider } = setup(t, [
      new ProviderError("overloaded", "Overloaded"),
      { text: "Here's a plan." },
    ]);
    const file = pdfFile("menu.pdf", 64);
    const id = await converse(conversations, { text: "Plan from this.", attachments: [file] });
    assert.deepEqual(await conversations.view(id), {
      id,
      status: "failed",
      error: "provider",
      messages: [
        { role: "user", text: "Plan from this.", attachments: ["menu.pdf"], failed: true },
      ],
      pending: [],
    });

    conversations.retry(id);
    await settle(conversations, id);

    assert.deepEqual(provider.calls[1].messages, [
      { role: "user", text: "Plan from this.", attachments: [file] },
    ]);
    assert.deepEqual((await conversations.view(id)).messages, [
      { role: "user", text: "Plan from this.", attachments: ["menu.pdf"] },
      { role: "assistant", text: "Here's a plan." },
    ]);
  });

  test("rejects retry without a failed message", async (t) => {
    const { conversations } = setup(t, [{ text: "Hello." }]);
    const id = await converse(conversations, { text: "Hi." });

    assert.throws(() => conversations.retry(id), {
      name: "ConflictError",
      message: "There's nothing to retry.",
    });
  });

  test("merges a failed message into the next one for the model", async (t) => {
    const { conversations, provider } = setup(t, [
      new ProviderError("overloaded", "Overloaded"),
      { text: "Here's a plan." },
    ]);
    const first = pdfFile("menu.pdf", 64);
    const second = { name: "photo.png", mediaType: "image/png", data: PNG };
    const id = await converse(conversations, { text: "Plan next week.", attachments: [first] });

    conversations.send(id, { text: "Use the school menu.", attachments: [second] });
    await settle(conversations, id);

    assert.deepEqual(provider.calls[1].messages, [
      {
        role: "user",
        text: "Plan next week.\n\nUse the school menu.",
        attachments: [first, second],
      },
    ]);
    assert.deepEqual((await conversations.view(id)).messages.slice(0, 2), [
      { role: "user", text: "Plan next week.", attachments: ["menu.pdf"] },
      { role: "user", text: "Use the school menu.", attachments: ["photo.png"] },
    ]);
  });

  test("fails the turn with limit when the clock passes 3 minutes", async (t) => {
    const hold = held();
    const { conversations, clock } = setup(t, [hold.step]);
    const { id } = conversations.create();
    conversations.send(id, { text: "Plan next week." });
    await hold.called();

    clock.advance(TURN_MS - 1);
    assert.equal((await conversations.view(id)).status, "working");
    clock.advance(1);
    await settle(conversations, id);

    const view = await conversations.view(id);
    assert.deepEqual([view.status, view.error], ["failed", "limit"]);
  });

  test("fails the turn with limit when the model calls tools for 30 rounds", async (t) => {
    const rounds = Array.from({ length: 30 }, (_, index) => ({
      toolCalls: [call(`c${index}`, "list_recipes")],
    }));
    const { conversations } = setup(t, rounds);

    const id = await converse(conversations, { text: "Plan next week." });

    const view = await conversations.view(id);
    assert.deepEqual([view.status, view.error], ["failed", "limit"]);
  });

  test("fails the turn with provider when the model gives an empty answer", async (t) => {
    const { conversations } = setup(t, [{ text: "" }]);

    const id = await converse(conversations, { text: "Plan next week." });

    const view = await conversations.view(id);
    assert.deepEqual([view.status, view.error], ["failed", "provider"]);
  });

  test("fails the turn with too_long when the conversation is too long", async (t) => {
    const { conversations } = setup(t, [new ProviderError("too_long", "Prompt is too long")]);

    const id = await converse(conversations, { text: "Plan next week." });

    const view = await conversations.view(id);
    assert.deepEqual([view.status, view.error], ["failed", "too_long"]);
  });

  test("sends the preferences, today, and the displayed week to the model", async (t) => {
    await stores().preferences.save("No fish on Fridays.");
    const { conversations, provider } = setup(t, [{ text: "Sure." }]);

    await converse(conversations, { text: "Plan next week.", week: NEXT_WEEK });

    assert.equal(
      provider.calls[0].system,
      instructions({ preferences: "No fish on Fridays.", today: WEEK, week: NEXT_WEEK }),
    );
  });

  test("keeps the displayed week of an earlier message for one without it", async (t) => {
    const { conversations, provider } = setup(t, [{ text: "Sure." }, { text: "Done." }]);
    const id = await converse(conversations, { text: "Plan next week.", week: NEXT_WEEK });

    conversations.send(id, { text: "Add soup on Monday." });
    await settle(conversations, id);

    assert.equal(
      provider.calls[1].system,
      instructions({ preferences: "", today: WEEK, week: NEXT_WEEK }),
    );
  });

  /** Asserts that sending `message` to a new conversation throws `expected`. */
  function rejectsMessage(t, message, expected) {
    const { conversations, provider } = setup(t, []);
    const { id } = conversations.create();

    assert.throws(() => conversations.send(id, message), {
      name: "ValidationError",
      message: expected,
    });
    assert.equal(provider.calls.length, 0);
  }

  test("rejects a message without text or an attachment", (t) => {
    rejectsMessage(t, { text: "  \n" }, "A message needs text or an attachment.");
  });

  test("rejects a message with 6 attachments", (t) => {
    const attachments = Array.from({ length: 6 }, (_, index) => pdfFile(`${index}.pdf`, 64));
    rejectsMessage(t, { text: "", attachments }, "A message holds at most 5 attachments.");
  });

  test("rejects a text file declared as a PDF", (t) => {
    const file = {
      name: "notes.pdf",
      mediaType: "application/pdf",
      data: Buffer.from("Buy leeks.").toString("base64"),
    };
    rejectsMessage(
      t,
      { text: "", attachments: [file] },
      `"notes.pdf" isn't a PDF, a JPEG, or a PNG.`,
    );
  });

  test("rejects a file one byte larger than 10 MB", (t) => {
    const file = pdfFile("big.pdf", 10 * MB + 1);
    rejectsMessage(t, { text: "", attachments: [file] }, `"big.pdf" is larger than 10 MB.`);
  });

  test("rejects attachments beyond 20 MB in one conversation", async (t) => {
    const { conversations } = setup(t, [{ text: "Got them." }]);
    const files = [pdfFile("a.pdf", 10 * MB), pdfFile("b.pdf", 10 * MB)];
    const id = await converse(conversations, { text: "", attachments: files });
    const photo = { name: "photo.png", mediaType: "image/png", data: PNG };

    assert.throws(() => conversations.send(id, { text: "", attachments: [photo] }), {
      name: "ValidationError",
      message:
        "The attachments of a conversation total at most 20 MB. Start a new conversation to attach more.",
    });
  });

  test("rejects a week that isn't a Monday", (t) => {
    rejectsMessage(
      t,
      { text: "Plan.", week: "2026-11-17" },
      '"week" must be a Monday as YYYY-MM-DD.',
    );
  });

  test("rejects an attachment whose data isn't base64", (t) => {
    const file = { name: "menu.pdf", mediaType: "application/pdf", data: "%PDF-1.7" };
    rejectsMessage(t, { text: "", attachments: [file] }, '"menu.pdf" isn\'t valid base64.');
  });

  test("rejects an attachment without a name", (t) => {
    const file = { name: "folder/", mediaType: "application/pdf", data: pdf() };
    rejectsMessage(t, { text: "", attachments: [file] }, "attachments[0] needs a name.");
  });
  test("accepts a file of exactly 10 MB", async (t) => {
    const { conversations } = setup(t, [{ text: "Got it." }]);

    const id = await converse(conversations, {
      text: "",
      attachments: [pdfFile("big.pdf", 10 * MB)],
    });

    assert.deepEqual((await conversations.view(id)).messages[0].attachments, ["big.pdf"]);
  });

  test("applies a week, a new recipe, and a new ingredient to disk", async (t) => {
    const { conversations } = setup(t, [
      { toolCalls: [call("c1", "propose_ingredient", { name: "Leek", unit: "g" })] },
      (request) => ({
        toolCalls: [
          call("c2", "propose_recipe", {
            name: "Leek soup",
            ingredients: [{ ingredientId: outputOf(request, "c1").id, quantity: 50 }],
          }),
        ],
      }),
      (request) => ({
        toolCalls: [
          call("c3", "propose_menus", {
            menus: [
              {
                week: WEEK,
                day: "tue",
                meal: "dinner",
                items: [{ recipeId: outputOf(request, "c2").id, servings: 2 }],
              },
            ],
          }),
        ],
      }),
      { text: "Leek soup on Tuesday." },
    ]);
    const id = await converse(conversations, { text: "Leek soup on Tuesday." });

    const result = await conversations.apply(id);

    assert.deepEqual(result, { applied: true });
    const saved = await createStores({ dataDir: dataDir() }).read([WEEK]);
    const leek = saved.ingredients.find((entry) => entry.name === "Leek");
    const leekSoup = saved.recipes.find((entry) => entry.name === "Leek soup");
    assert.deepEqual(leekSoup?.ingredients, [{ ingredientId: leek?.id, quantity: 50 }]);
    assert.deepEqual(saved.weeks[WEEK].tue.dinner, {
      items: [{ recipeId: leekSoup?.id, servings: 2 }],
    });
    assert.deepEqual((await conversations.view(id)).pending, []);
  });

  test("saves nothing and reports the problem when a recipe changed by hand", async (t) => {
    const { result } = await rejectedApply(t);

    assert.deepEqual(result, { applied: false, problems: [SQUASH_PROBLEM] });
    const saved = await createStores({ dataDir: dataDir() }).read([]);
    assert.deepEqual(
      saved.ingredients.map((entry) => entry.name),
      ["Onion"],
    );
    assert.deepEqual(
      saved.recipes.map((entry) => entry.name),
      ["Squash soup"],
    );
  });

  test("shows the problem of a rejected apply on its pending change", async (t) => {
    const { conversations, id } = await rejectedApply(t);

    const view = await conversations.view(id);

    assert.deepEqual(
      view.pending.map((change) => [change.target, change.problem]),
      [
        ["recipe:soup", SQUASH_PROBLEM.message],
        [view.pending[1].target, undefined],
      ],
    );
  });

  test("drops the problems of a rejected apply when pending changes change", async (t) => {
    const { conversations, id } = await rejectedApply(t, [
      { toolCalls: [call("c3", "propose_ingredient", { name: "Garlic", unit: "g" })] },
      { text: "Garlic is pending." },
    ]);

    conversations.send(id, { text: "Add garlic." });
    await settle(conversations, id);

    const view = await conversations.view(id);
    assert.deepEqual(
      view.pending.map((change) => change.problem),
      [undefined, undefined, undefined],
    );
  });

  test("tells the model about the rejected apply in the next message", async (t) => {
    const { conversations, provider, id } = await rejectedApply(t, [{ text: "Sorry." }]);

    conversations.send(id, { text: "Fix it." });
    await settle(conversations, id);

    assert.equal(
      lastSent(provider),
      `(Meals: the pending changes couldn't be applied: ${SQUASH_PROBLEM.message}.)\nFix it.`,
    );
  });

  test("tells the model about an apply in the next message", async (t) => {
    const { conversations, provider } = setup(t, [
      { toolCalls: [call("c1", "propose_ingredient", { name: "Leek", unit: "g" })] },
      { text: "Leek is pending." },
      { text: "Great." },
    ]);
    const id = await converse(conversations, { text: "Add leeks." });
    await conversations.apply(id);

    conversations.send(id, { text: "Thanks." });
    await settle(conversations, id);

    assert.equal(lastSent(provider), "(Meals: the user applied the pending changes.)\nThanks.");
  });

  test("removes every pending change on discard", async (t) => {
    const { conversations } = setup(t, STALE_STEPS);
    const id = await converse(conversations, { text: "Rename the soup." });

    conversations.discard(id);

    assert.deepEqual((await conversations.view(id)).pending, []);
  });

  test("tells the model about a discard in the next message", async (t) => {
    const { conversations, provider } = setup(t, [...STALE_STEPS, { text: "OK." }]);
    const id = await converse(conversations, { text: "Rename the soup." });
    conversations.discard(id);

    conversations.send(id, { text: "Start over." });
    await settle(conversations, id);

    assert.equal(
      lastSent(provider),
      "(Meals: the user discarded the pending changes.)\nStart over.",
    );
  });

  test("ends a conversation 24 hours after its last message, not its last view", async (t) => {
    const { conversations, clock } = setup(t, [{ text: "Hello." }]);
    const { id } = conversations.create();
    clock.advance(1000);
    conversations.send(id, { text: "Hi." });
    await settle(conversations, id);

    clock.advance(IDLE_MS - 1);
    await conversations.view(id);
    clock.advance(1);

    await assert.rejects(conversations.view(id), { name: "NotFoundError" });
  });

  test("ends the conversation with the oldest activity when a 21st starts", async (t) => {
    const { conversations, clock } = setup(t, []);
    const ids = [];
    for (let index = 0; index < 20; index += 1) {
      ids.push(conversations.create().id);
      clock.advance(1);
    }
    conversations.discard(ids[0]);

    conversations.create();

    await conversations.view(ids[0]);
    await assert.rejects(conversations.view(ids[1]), { name: "NotFoundError" });
  });

  test("cancels the turn of a conversation that a new one ends", async (t) => {
    const hold = held();
    const { conversations, entries } = setup(t, [hold.step], { maxConversations: 1 });
    const { id } = conversations.create();
    conversations.send(id, { text: "Plan next week." });
    await hold.called();

    conversations.create();
    await settle(conversations, id);

    assert.deepEqual(
      entries.map((entry) => entry.outcome),
      ["canceled"],
    );
  });

  test("cancels the turn when the conversation ends, and logs canceled", async (t) => {
    const hold = held();
    const { conversations, entries } = setup(t, [hold.step]);
    const { id } = conversations.create();
    conversations.send(id, { text: "Plan next week." });
    await hold.called();

    conversations.end(id);
    await settle(conversations, id);

    assert.deepEqual(
      entries.map((entry) => [entry.msg, entry.outcome]),
      [["assistant turn", "canceled"]],
    );
  });

  test("cancels every turn on stop, and leaves no timer", async (t) => {
    const first = held();
    const second = held();
    const { conversations, clock, entries } = setup(t, [first.step, second.step]);
    for (const hold of [first, second]) {
      const { id } = conversations.create();
      conversations.send(id, { text: "Plan next week." });
      await hold.called();
    }

    await within(conversations.stop(), "stop didn't resolve");

    assert.deepEqual(
      entries.map((entry) => entry.outcome),
      ["canceled", "canceled"],
    );
    assert.equal(clock.pendingTimers(), 0);
  });

  test("logs one line per turn with its token counts and nothing else", async (t) => {
    const hold = held();
    const { conversations, clock, entries } = setup(t, [
      {
        toolCalls: [call("c1", "list_recipes")],
        usage: { inputTokens: 100, outputTokens: 10 },
      },
      hold.step,
    ]);
    const { id } = conversations.create();
    conversations.send(id, {
      text: "Plan a secret party.",
      attachments: [pdfFile("private.pdf", 64)],
    });
    await hold.called();

    clock.advance(1500);
    hold.release({ text: "Done.", usage: { inputTokens: 120, outputTokens: 20 } });
    await settle(conversations, id);

    assert.deepEqual(entries, [
      {
        level: "info",
        msg: "assistant turn",
        provider: "anthropic",
        model: "scripted",
        rounds: 2,
        inputTokens: 220,
        outputTokens: 30,
        ms: 1500,
        outcome: "ok",
      },
    ]);
  });

  test("logs the kind and the message of a provider failure", async (t) => {
    const { conversations, entries } = setup(t, [new ProviderError("rate_limit", "Rate limited")]);

    await converse(conversations, { text: "Plan a secret party." });

    assert.deepEqual(
      entries.map(({ level, msg, kind, error, outcome }) => ({ level, msg, kind, error, outcome })),
      [
        {
          level: "error",
          msg: "assistant turn failed",
          kind: "rate_limit",
          error: "Rate limited",
          outcome: undefined,
        },
        {
          level: "info",
          msg: "assistant turn",
          kind: undefined,
          error: undefined,
          outcome: "provider",
        },
      ],
    );
  });

  test("rejects every call on an unknown conversation with NotFoundError", async (t) => {
    const { conversations } = setup(t, []);
    const notFound = { name: "NotFoundError" };

    await assert.rejects(conversations.view("missing"), notFound);
    await assert.rejects(conversations.apply("missing"), notFound);
    assert.throws(() => conversations.send("missing", { text: "Hi." }), notFound);
    assert.throws(() => conversations.retry("missing"), notFound);
    assert.throws(() => conversations.discard("missing"), notFound);
    assert.throws(() => conversations.end("missing"), notFound);
  });

  test("returns a view that shares nothing with the conversation", async (t) => {
    const { conversations } = setup(t, [
      { toolCalls: [call("c1", "propose_ingredient", { name: "Leek", unit: "g" })] },
      { text: "Leek is pending." },
    ]);
    const id = await converse(conversations, {
      text: "Add leeks.",
      attachments: [pdfFile("menu.pdf", 64)],
    });
    const before = await conversations.view(id);

    const changed = await conversations.view(id);
    changed.messages[0].attachments?.push("other.pdf");
    changed.messages.push({ role: "user", text: "Extra." });
    changed.pending[0].name = "Garlic";

    assert.deepEqual(await conversations.view(id), before);
  });
});
