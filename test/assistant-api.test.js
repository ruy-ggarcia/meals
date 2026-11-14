import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import request from "supertest";
import { createApp } from "../server/app.js";
import { createConversations } from "../server/assistant/conversations.js";
import { createStores } from "../server/stores.js";
import { fakeClock, heldStep, scriptedProvider } from "./assistant-helpers.js";
import { collectingLogger, useDataDir, within, writeDataFile } from "./backend-helpers.js";

// Noon of Monday, November 16, 2026, in the local time zone.
const NOON = new Date(2026, 10, 16, 12).getTime();
const MB = 1024 * 1024;
const UNKNOWN = "00000000-0000-4000-8000-000000000000";

const onion = { id: "onion", name: "Onion", unit: "g", measures: [], archived: false };
const soup = {
  id: "soup",
  name: "Soup",
  archived: false,
  ingredients: [{ ingredientId: "onion", quantity: 100 }],
};

/** An attachment named `name` of a PDF file of `size` bytes. */
function pdfFile(name, size = 64) {
  const bytes = Buffer.alloc(size);
  bytes.write("%PDF-1.7");
  return { name, mediaType: "application/pdf", data: bytes.toString("base64") };
}

/** A tool call with `id`, of the tool `name`, with `input`. */
function call(id, name, input) {
  return { id, name, input };
}

/** The steps of a turn that proposes the new ingredient Leek, and then answers. */
const LEEK_STEPS = [
  { toolCalls: [call("c1", "propose_ingredient", { name: "Leek", unit: "g" })] },
  { text: "Proposed." },
];

const dataDir = useDataDir("meals-assistant-api-");

beforeEach(async () => {
  await writeDataFile(dataDir(), "v2/ingredients.json", JSON.stringify({ ingredients: [onion] }));
  await writeDataFile(dataDir(), "v2/recipes.json", JSON.stringify({ recipes: [soup] }));
});

/**
 * An app whose assistant answers from `steps`, on a fake clock at NOON. The
 * conversations stop when the test ends.
 * @param {import("node:test").TestContext} t
 * @param {any[]} steps
 * @param {{ logger?: import("../server/logger.js").Logger }} [options]
 */
function setup(t, steps = [], options = {}) {
  const stores = createStores({ dataDir: dataDir() });
  const provider = scriptedProvider(steps);
  const assistant = createConversations({ provider, stores, clock: fakeClock(NOON) });
  t.after(() => assistant.stop());
  return { app: createApp(stores, { assistant, ...options }), assistant, provider, stores };
}

/** Starts a conversation through the API and returns its ID. */
async function create(app) {
  const res = await request(app).post("/api/assistant/conversations");
  assert.equal(res.status, 201);
  return res.body.id;
}

/**
 * Starts a conversation, sends `message` through the API, and waits for the
 * turn to end. Returns the conversation's ID.
 */
async function converse({ app, assistant }, message) {
  const id = await create(app);
  const res = await request(app).post(`/api/assistant/conversations/${id}/messages`).send(message);
  assert.equal(res.status, 202, JSON.stringify(res.body));
  await within(assistant.settled(id), "the turn didn't end");
  return id;
}

function assertJsonError(res, status, label) {
  assert.equal(res.status, status, label);
  assert.match(res.headers["content-type"], /application\/json/, label);
  assert.equal(typeof res.body.error, "string", label);
}

/**
 * Each route of a conversation, with a body for the ones that need one.
 * @type {["get" | "post" | "delete", string, object?][]}
 */
const CONVERSATION_ROUTES = [
  ["get", ""],
  ["post", "/messages", { text: "Hi." }],
  ["post", "/retry"],
  ["post", "/apply"],
  ["post", "/discard"],
  ["delete", ""],
];

/**
 * Sends the request of `route` for the conversation `id`.
 * @param {any} app
 * @param {(typeof CONVERSATION_ROUTES)[number]} route
 * @param {string} id
 */
function send(app, [method, suffix, body], id) {
  const req = request(app)[method](`/api/assistant/conversations/${id}${suffix}`);
  return body === undefined ? req : req.send(body);
}

describe("GET /api/assistant", () => {
  test("answers enabled true with an assistant", async (t) => {
    const res = await request(setup(t).app).get("/api/assistant");

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { enabled: true });
  });

  test("answers enabled false without an assistant", async () => {
    const res = await request(createApp(createStores({ dataDir: dataDir() }))).get(
      "/api/assistant",
    );

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { enabled: false });
  });
});

describe("/api/assistant/conversations", () => {
  const bare = () => createApp(createStores({ dataDir: dataDir() }));

  test("answers 404 to a new conversation without an assistant", async () => {
    const res = await request(bare()).post("/api/assistant/conversations");

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: "Not found" });
  });

  for (const route of CONVERSATION_ROUTES) {
    const [method, suffix] = route;
    const label = `${method.toUpperCase()} .../:id${suffix}`;

    test(`answers 404 to ${label} without an assistant`, async () => {
      const res = await send(bare(), route, UNKNOWN);

      assert.equal(res.status, 404);
      assert.deepEqual(res.body, { error: "Not found" });
    });

    test(`answers 404 to ${label} when the conversation is unknown`, async (t) => {
      const res = await send(setup(t).app, route, UNKNOWN);

      assertJsonError(res, 404, label);
      assert.deepEqual(res.body, { error: `Unknown conversation: ${UNKNOWN}` });
    });
  }
});

describe("POST /api/assistant/conversations", () => {
  test("answers 201 with the ID of a new conversation", async (t) => {
    const { app, assistant } = setup(t);

    const res = await request(app).post("/api/assistant/conversations");

    assert.equal(res.status, 201);
    assert.deepEqual(Object.keys(res.body), ["id"]);
    assert.equal((await assistant.view(res.body.id)).status, "idle");
  });
});

describe("GET /api/assistant/conversations/:id", () => {
  test("returns the messages, the status, and the pending changes", async (t) => {
    const context = setup(t, [{ text: "Hello." }]);
    const id = await converse(context, { text: "Hi." });

    const res = await request(context.app).get(`/api/assistant/conversations/${id}`);

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      id,
      status: "idle",
      messages: [
        { role: "user", text: "Hi." },
        { role: "assistant", text: "Hello." },
      ],
      pending: [],
    });
  });

  test("logs nothing for a successful read", async (t) => {
    const { entries, logger } = collectingLogger();
    const { app } = setup(t, [], { logger });
    const id = await create(app);

    assert.equal((await request(app).get(`/api/assistant/conversations/${id}`)).status, 200);

    assert.deepEqual(
      entries.filter((entry) => entry.method === "GET"),
      [],
    );
  });

  test("logs a read of an unknown conversation", async (t) => {
    const { entries, logger } = collectingLogger();
    const { app } = setup(t, [], { logger });

    await request(app).get(`/api/assistant/conversations/${UNKNOWN}`);

    assert.deepEqual(
      entries.map(({ level, msg, method, path, status }) => ({ level, msg, method, path, status })),
      [
        {
          level: "info",
          msg: "request",
          method: "GET",
          path: `/api/assistant/conversations/${UNKNOWN}`,
          status: 404,
        },
      ],
    );
  });
});

describe("POST /api/assistant/conversations/:id/messages", () => {
  test("answers 202 while the turn still runs", async (t) => {
    const held = heldStep();
    const { app } = setup(t, [held.step]);
    const id = await create(app);

    const res = await request(app)
      .post(`/api/assistant/conversations/${id}/messages`)
      .send({ text: "Hi." });

    assert.equal(res.status, 202);
    assert.deepEqual(res.body, {});
    await within(held.called, "the turn didn't call the provider");
  });

  test("answers 409 to a message during a turn", async (t) => {
    const held = heldStep();
    const { app } = setup(t, [held.step]);
    const id = await create(app);
    await request(app).post(`/api/assistant/conversations/${id}/messages`).send({ text: "Hi." });

    const res = await request(app)
      .post(`/api/assistant/conversations/${id}/messages`)
      .send({ text: "Again." });

    assertJsonError(res, 409, "message during a turn");
    assert.deepEqual(res.body, { error: "The assistant is still answering." });
  });

  test("accepts a message with 20 MB of attachments", async (t) => {
    const { app } = setup(t, [{ text: "Got them." }]);
    const id = await create(app);

    // As base64 in JSON, the body is about 27 MB.
    const res = await request(app)
      .post(`/api/assistant/conversations/${id}/messages`)
      .send({ attachments: [pdfFile("a.pdf", 10 * MB), pdfFile("b.pdf", 10 * MB)] });

    assert.equal(res.status, 202, JSON.stringify(res.body));
  });

  const BAD_MESSAGES = [
    ["no body", undefined],
    ["no text and no attachment", {}],
    ["a text that isn't a string", { text: 1 }],
    ["attachments that aren't a list", { text: "Hi.", attachments: "a.pdf" }],
    ["6 attachments", { attachments: Array.from({ length: 6 }, (_, i) => pdfFile(`${i}.pdf`)) }],
    ["an attachment without a name", { attachments: [{ ...pdfFile("a.pdf"), name: "" }] }],
    ["data that isn't base64", { attachments: [{ ...pdfFile("a.pdf"), data: "%%%" }] }],
    [
      "a text file",
      { attachments: [{ ...pdfFile("a.pdf"), data: Buffer.from("Hello.").toString("base64") }] },
    ],
    ["a file one byte larger than 10 MB", { attachments: [pdfFile("a.pdf", 10 * MB + 1)] }],
    [
      "attachments beyond 20 MB",
      { attachments: ["a.pdf", "b.pdf", "c.pdf"].map((name) => pdfFile(name, 7 * MB)) },
    ],
    ["a week that isn't a Monday", { text: "Hi.", week: "2026-11-17" }],
    ["a today that isn't a date", { text: "Hi.", today: "11/16/2026" }],
  ];
  for (const [label, body] of BAD_MESSAGES) {
    test(`rejects ${label} with 400`, async (t) => {
      const { app, provider } = setup(t);
      const id = await create(app);
      const req = request(app).post(`/api/assistant/conversations/${id}/messages`);

      const res = await (body === undefined ? req : req.send(body));

      assertJsonError(res, 400, label);
      assert.equal(provider.calls.length, 0, "a turn started");
    });
  }
});

describe("PUT /api/preferences", () => {
  test("rejects a body of 12 MB with 413 while the assistant is on", async (t) => {
    const res = await request(setup(t).app)
      .put("/api/preferences")
      .send({ text: "a".repeat(12 * MB) });

    assertJsonError(res, 413, "12 MB of preferences");
  });
});

describe("POST /api/assistant/conversations/:id/retry", () => {
  test("answers 202 and runs the failed message again", async (t) => {
    const context = setup(t, [new Error("The provider is down."), { text: "Hello." }]);
    const id = await converse(context, { text: "Hi." });

    const res = await request(context.app).post(`/api/assistant/conversations/${id}/retry`);
    await within(context.assistant.settled(id), "the retry didn't end");

    assert.equal(res.status, 202);
    assert.deepEqual(res.body, {});
    assert.deepEqual((await context.assistant.view(id)).messages, [
      { role: "user", text: "Hi." },
      { role: "assistant", text: "Hello." },
    ]);
  });
});

describe("POST /api/assistant/conversations/:id/apply", () => {
  test("answers 200 with applied true and saves the pending changes", async (t) => {
    const context = setup(t, LEEK_STEPS);
    const id = await converse(context, { text: "Add leek." });

    const res = await request(context.app).post(`/api/assistant/conversations/${id}/apply`);

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { applied: true });
    const { ingredients } = await createStores({ dataDir: dataDir() }).read([]);
    assert.deepEqual(
      ingredients.map((entry) => entry.name),
      ["Onion", "Leek"],
    );
  });

  test("answers 409 with the problems when a target changed", async (t) => {
    const context = setup(t, [
      { toolCalls: [call("c1", "propose_recipe", { id: "soup", name: "Pumpkin soup" })] },
      { text: "Proposed." },
    ]);
    const id = await converse(context, { text: "Rename the soup." });
    await context.stores.recipes.update("soup", { name: "Squash soup" });

    const res = await request(context.app).post(`/api/assistant/conversations/${id}/apply`);

    assertJsonError(res, 409, "stale apply");
    assert.deepEqual(res.body.problems, [
      { target: "recipe:soup", message: "Squash soup changed after the assistant proposed this." },
    ]);
  });
});

describe("POST /api/assistant/conversations/:id/discard", () => {
  test("answers 200 and removes the pending changes", async (t) => {
    const context = setup(t, LEEK_STEPS);
    const id = await converse(context, { text: "Add leek." });

    const res = await request(context.app).post(`/api/assistant/conversations/${id}/discard`);

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {});
    assert.deepEqual((await context.assistant.view(id)).pending, []);
  });
});

describe("DELETE /api/assistant/conversations/:id", () => {
  test("answers 204 and ends the conversation", async (t) => {
    const { app } = setup(t);
    const id = await create(app);

    const res = await request(app).delete(`/api/assistant/conversations/${id}`);

    assert.equal(res.status, 204);
    assert.equal((await request(app).get(`/api/assistant/conversations/${id}`)).status, 404);
  });
});
