import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { createApp, markAssistantEnabled } from "../server/app.js";
import { createConversations } from "../server/assistant/conversations.js";
import { ProviderError } from "../server/assistant/providers/errors.js";
import { createAssistantSetup } from "../server/assistant/setup.js";
import { createStores } from "../server/stores.js";
import {
  fakeClock,
  fakeModelLists,
  heldStep,
  LISTED_MODEL,
  scriptedProvider,
} from "./assistant-helpers.js";
import { collectingLogger, useDataDir, writeDataFile } from "./backend-helpers.js";

// Noon of Monday, November 16, 2026, in the local time zone.
const NOON = new Date(2026, 10, 16, 12).getTime();
const MB = 1024 * 1024;
const UNKNOWN = "00000000-0000-4000-8000-000000000000";
const KEY = "sk-test-0123456789";
const PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));

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
  const assistant = createConversations({
    getProvider: () => provider,
    stores,
    clock: fakeClock(NOON),
  });
  t.after(() => assistant.stop());
  return { app: createApp(stores, { assistant, ...options }), assistant, provider, stores };
}

/**
 * An app as the server starts it: its assistant takes the provider from a
 * setup on the data directory of the test, whose factories build a provider
 * that answers from `steps`, each under its own name, so the name tells which
 * factory ran. `environment` sets the assistant up as the environment
 * variables do. Fake model lists answer with `lists`. The conversations stop
 * when the test ends.
 * @param {import("node:test").TestContext} t
 * @param {{
 *   environment?: any,
 *   lists?: Parameters<typeof fakeModelLists>[0],
 *   steps?: any[],
 * }} [options]
 */
async function setupWithSettings(t, { environment, lists, steps = [] } = {}) {
  const stores = createStores({ dataDir: dataDir() });
  const provider = scriptedProvider(steps);
  // The copies share the provider's calls.
  /** @param {"anthropic" | "openai"} name */
  const named = (name) => () => ({ ...provider, name });
  const { entries, logger } = collectingLogger();
  const setup = createAssistantSetup({
    environment,
    settings: stores.assistantSettings,
    providerFactories: { anthropic: named("anthropic"), openai: named("openai") },
    modelLists: fakeModelLists(lists).modelLists,
    logger,
  });
  await setup.load();
  const assistant = createConversations({ getProvider: setup.provider, stores });
  t.after(() => assistant.stop());
  return { app: createApp(stores, { assistant, logger, setup }), assistant, entries, provider };
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
  await assistant.settled(id);
  return id;
}

/**
 * Applies the pending changes of the conversation `id` through the API, with
 * the revision that a read of it answers now.
 */
async function applyShown(app, id) {
  const { body } = await request(app).get(`/api/assistant/conversations/${id}`);
  return request(app)
    .post(`/api/assistant/conversations/${id}/apply`)
    .send({ revision: body.revision });
}

function assertJsonError(res, status, label) {
  assert.equal(res.status, status, label);
  assert.match(res.headers["content-type"], /application\/json/, label);
  assert.equal(typeof res.body.error, "string", label);
}

/**
 * Adds to the describe block that calls it the tests that a route of a
 * conversation answers 404 without an assistant and for an unknown
 * conversation. `suffix` follows the conversation's ID in the path, and
 * `body` is sent when the route needs one.
 * @param {"get" | "post" | "delete"} method
 * @param {string} suffix
 * @param {object} [body]
 */
function testNotFound(method, suffix, body) {
  const send = (app) => {
    const req = request(app)[method](`/api/assistant/conversations/${UNKNOWN}${suffix}`);
    return body === undefined ? req : req.send(body);
  };

  test("answers 404 without an assistant", async () => {
    const res = await send(createApp(createStores({ dataDir: dataDir() })));

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: "Not found" });
  });

  test("answers 404 when the conversation is unknown", async (t) => {
    const res = await send(setup(t).app);

    assertJsonError(res, 404, "unknown conversation");
    assert.deepEqual(res.body, { error: `Unknown conversation: ${UNKNOWN}` });
  });
}

describe("GET /api/assistant", () => {
  test("answers enabled true with an assistant", async (t) => {
    const res = await request(setup(t).app).get("/api/assistant");

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { enabled: true });
  });

  test("answers enabled false while no provider is set up", async (t) => {
    const res = await request((await setupWithSettings(t)).app).get("/api/assistant");

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { enabled: false });
  });

  test("answers enabled false without an assistant", async () => {
    const res = await request(createApp(createStores({ dataDir: dataDir() }))).get(
      "/api/assistant",
    );

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { enabled: false });
  });
});

// Each page, by its path, and the file that it serves.
const PAGES = [
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/recipes.html", "recipes.html"],
  ["/ingredients.html", "ingredients.html"],
];

describe("markAssistantEnabled", () => {
  test("marks a root whose start tag has other attributes", () => {
    const page = '<!doctype html>\n<html class="app" lang="es">\n<head></head>\n</html>\n';

    assert.equal(
      markAssistantEnabled(page),
      '<!doctype html>\n<html class="app" lang="es" data-assistant-enabled>\n<head></head>\n</html>\n',
    );
  });

  test("marks a root whose start tag has no attributes", () => {
    assert.equal(
      markAssistantEnabled("<html><body></body></html>"),
      "<html data-assistant-enabled><body></body></html>",
    );
  });
});

/** Checks that the root of `page`, its `<html>` start tag, has `data-assistant-enabled`. */
function assertMarked(page) {
  const root = page.match(/<html\b[^>]*>/)?.[0];
  assert.match(root ?? "", /\sdata-assistant-enabled[\s>]/, `the root is ${root}`);
}

for (const [pagePath, file] of PAGES) {
  describe(`GET ${pagePath}`, () => {
    const page = () => readFile(path.join(PUBLIC_DIR, file), "utf8");

    test("answers the page as it is while the assistant is off", async (t) => {
      const res = await request((await setupWithSettings(t)).app).get(pagePath);

      assert.equal(res.status, 200);
      assert.match(res.headers["content-type"], /^text\/html/);
      assert.equal(res.text, await page());
    });

    test("marks the root of the page while the assistant is on", async (t) => {
      const res = await request(setup(t).app).get(pagePath);

      assert.equal(res.status, 200);
      assertMarked(res.text);
    });

    test("marks the root of the page once a key turns the assistant on", async (t) => {
      const { app } = await setupWithSettings(t);
      await request(app)
        .put("/api/assistant/settings")
        .send({ provider: "anthropic", model: "model-1", apiKey: KEY });

      const res = await request(app).get(pagePath);

      assertMarked(res.text);
    });

    test("asks the browser to check the page again before each use", async (t) => {
      const res = await request(setup(t).app).get(pagePath);

      assert.equal(res.headers["cache-control"], "no-cache");
    });
  });
}

describe("POST /api/assistant/conversations", () => {
  test("answers 404 without an assistant", async () => {
    const res = await request(createApp(createStores({ dataDir: dataDir() }))).post(
      "/api/assistant/conversations",
    );

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: "Not found" });
  });

  test("answers 201 with the ID of a new conversation", async (t) => {
    const { app, assistant } = setup(t);

    const res = await request(app).post("/api/assistant/conversations");

    assert.equal(res.status, 201);
    assert.deepEqual(Object.keys(res.body), ["id"]);
    assert.equal((await assistant.view(res.body.id)).status, "idle");
  });
});

describe("GET /api/assistant/conversations/:id", () => {
  testNotFound("get", "");

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
      revision: 0,
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

  test("logs nothing for a read that the browser has already", async (t) => {
    const { entries, logger } = collectingLogger();
    const { app } = setup(t, [], { logger });
    const id = await create(app);
    const first = await request(app).get(`/api/assistant/conversations/${id}`);

    const again = await request(app)
      .get(`/api/assistant/conversations/${id}`)
      .set("If-None-Match", first.headers.etag);

    assert.equal(again.status, 304);
    assert.deepEqual(
      entries.filter((entry) => entry.method === "GET"),
      [],
    );
  });

  test("logs a read that the client aborts as aborted", async () => {
    const { entries, logger } = collectingLogger();
    /** @type {PromiseWithResolvers<void>} */
    const logged = Promise.withResolvers();
    /** @type {PromiseWithResolvers<void>} */
    const reading = Promise.withResolvers();
    /** @type {PromiseWithResolvers<void>} */
    const release = Promise.withResolvers();
    const loggingInfo = logger.info;
    logger.info = (msg, fields) => {
      loggingInfo(msg, fields);
      logged.resolve();
    };
    // Conversations whose read waits until the test releases it.
    const assistant = /** @type {any} */ ({
      enabled: () => true,
      view: async () => {
        reading.resolve();
        await release.promise;
        return {};
      },
    });
    const app = createApp(createStores({ dataDir: dataDir() }), { assistant, logger });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");

    try {
      const socket = net.connect(server.address().port, "127.0.0.1");
      socket.write(
        `GET /api/assistant/conversations/${UNKNOWN} HTTP/1.1\r\nHost: localhost\r\n\r\n`,
      );
      await reading.promise;
      socket.destroy();
      await logged.promise;
    } finally {
      release.resolve();
      server.close();
    }

    assert.deepEqual(
      entries.map(({ msg, method, path, aborted }) => ({ msg, method, path, aborted })),
      [
        {
          msg: "request",
          method: "GET",
          path: `/api/assistant/conversations/${UNKNOWN}`,
          aborted: true,
        },
      ],
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
  testNotFound("post", "/messages", { text: "Hi." });

  test("answers 202 while the turn still runs", async (t) => {
    const held = heldStep();
    const { app } = setup(t, [held.step]);
    const id = await create(app);

    const res = await request(app)
      .post(`/api/assistant/conversations/${id}/messages`)
      .send({ text: "Hi." });

    assert.equal(res.status, 202);
    assert.deepEqual(res.body, {});
    await held.called();
  });

  test("answers 409 while no provider is set up", async (t) => {
    const { app } = await setupWithSettings(t);
    const id = await create(app);

    const res = await request(app)
      .post(`/api/assistant/conversations/${id}/messages`)
      .send({ text: "Hi." });

    assertJsonError(res, 409, "message without a provider");
    assert.deepEqual(res.body, { error: "The assistant isn't set up." });
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

  test("rejects a body over 30 MB with 413", async (t) => {
    const { app, provider } = setup(t, [{ text: "Got it." }]);
    const id = await create(app);

    const res = await request(app)
      .post(`/api/assistant/conversations/${id}/messages`)
      .send({ text: "a".repeat(30 * MB) });

    assertJsonError(res, 413, "a body over 30 MB");
    assert.equal(provider.calls.length, 0, "a turn started");
  });

  const BAD_MESSAGES = [
    ["no body", undefined],
    ["no text and no attachment", {}],
    ["a text that isn't a string", { text: 1 }],
    ["attachments that aren't a list", { text: "Hi.", attachments: "a.pdf" }],
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

describe("POST /api/assistant/conversations/:id/retry", () => {
  testNotFound("post", "/retry");

  test("answers 202 and runs the failed message again", async (t) => {
    const context = setup(t, [new Error("The provider is down."), { text: "Hello." }]);
    const id = await converse(context, { text: "Hi." });

    const res = await request(context.app).post(`/api/assistant/conversations/${id}/retry`);
    await context.assistant.settled(id);

    assert.equal(res.status, 202);
    assert.deepEqual(res.body, {});
    assert.deepEqual((await context.assistant.view(id)).messages, [
      { role: "user", text: "Hi." },
      { role: "assistant", text: "Hello." },
    ]);
  });
});

describe("POST /api/assistant/conversations/:id/apply", () => {
  testNotFound("post", "/apply", { revision: 0 });

  test("answers 200 with applied true and saves the pending changes", async (t) => {
    const context = setup(t, LEEK_STEPS);
    const id = await converse(context, { text: "Add leek." });

    const res = await applyShown(context.app, id);

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

    const res = await applyShown(context.app, id);

    assertJsonError(res, 409, "stale apply");
    assert.deepEqual(res.body.problems, [
      { target: "recipe:soup", message: "Squash soup changed after the assistant proposed this." },
    ]);
  });

  test("answers 500 with partly_saved when a write fails after another", async (t) => {
    const context = setup(t, [
      {
        toolCalls: [
          call("c1", "propose_ingredient", { name: "Leek", unit: "g" }),
          call("c2", "propose_recipe", { id: "soup", name: "Pumpkin soup" }),
        ],
      },
      { text: "Proposed." },
    ]);
    const id = await converse(context, { text: "Add leek and rename the soup." });
    // A directory in place of the temporary file makes the write of the
    // recipe book fail, after the write of the catalog.
    await mkdir(path.join(dataDir(), "v2", "recipes.json.tmp"));

    const res = await applyShown(context.app, id);

    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { error: "Internal server error", code: "partly_saved" });
  });

  test("answers 409 and saves nothing when the pending changes changed", async (t) => {
    const context = setup(t, LEEK_STEPS);
    const id = await converse(context, { text: "Add leek." });

    const res = await request(context.app)
      .post(`/api/assistant/conversations/${id}/apply`)
      .send({ revision: 0 });

    assertJsonError(res, 409, "apply of another revision");
    assert.deepEqual(res.body, { error: "The pending changes changed. Review them again." });
    const { ingredients } = await createStores({ dataDir: dataDir() }).read([]);
    assert.deepEqual(
      ingredients.map((entry) => entry.name),
      ["Onion"],
    );
  });

  for (const [label, body] of [
    ["no body", undefined],
    ["a revision that isn't an integer", { revision: "1" }],
  ]) {
    test(`rejects ${label} with 400`, async (t) => {
      const context = setup(t, LEEK_STEPS);
      const id = await converse(context, { text: "Add leek." });
      const req = request(context.app).post(`/api/assistant/conversations/${id}/apply`);

      const res = await (body === undefined ? req : req.send(body));

      assertJsonError(res, 400, label);
    });
  }
});

describe("POST /api/assistant/conversations/:id/discard", () => {
  testNotFound("post", "/discard");

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
  testNotFound("delete", "");

  test("answers 204 and ends the conversation", async (t) => {
    const { app } = setup(t);
    const id = await create(app);

    const res = await request(app).delete(`/api/assistant/conversations/${id}`);

    assert.equal(res.status, 204);
    assert.equal((await request(app).get(`/api/assistant/conversations/${id}`)).status, 404);
  });
});

describe("GET /api/assistant/settings", () => {
  test("answers the saved provider and model, and whether a key is saved", async (t) => {
    await writeDataFile(
      dataDir(),
      "v2/assistant.json",
      JSON.stringify({ provider: "openai", model: "model-1", apiKey: KEY }),
    );
    const { app } = await setupWithSettings(t);

    const res = await request(app).get("/api/assistant/settings");

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      provider: "openai",
      model: "model-1",
      keySaved: true,
      source: "settings",
    });
  });

  test("answers 404 without a setup", async () => {
    const res = await request(createApp(createStores({ dataDir: dataDir() }))).get(
      "/api/assistant/settings",
    );

    assert.equal(res.status, 404);
  });
});

describe("PUT /api/assistant/settings", () => {
  test("answers 200 with the saved settings", async (t) => {
    const { app } = await setupWithSettings(t);

    const res = await request(app)
      .put("/api/assistant/settings")
      .send({ provider: "anthropic", model: "model-1", apiKey: KEY });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      provider: "anthropic",
      model: "model-1",
      keySaved: true,
      source: "settings",
    });
  });

  test("turns the assistant on for the next message", async (t) => {
    const context = await setupWithSettings(t, { steps: [{ text: "Hello." }] });
    await request(context.app)
      .put("/api/assistant/settings")
      .send({ provider: "anthropic", model: "model-1", apiKey: KEY });

    const id = await converse(context, { text: "Hi." });

    assert.equal(context.provider.calls.length, 1);
    assert.deepEqual((await request(context.app).get("/api/assistant")).body, { enabled: true });
    assert.equal((await context.assistant.view(id)).status, "idle");
  });

  test("turns the assistant off when the key is removed", async (t) => {
    const { app } = await setupWithSettings(t);
    const settings = { provider: "anthropic", model: "model-1" };
    await request(app)
      .put("/api/assistant/settings")
      .send({ ...settings, apiKey: KEY });

    const res = await request(app)
      .put("/api/assistant/settings")
      .send({ ...settings, apiKey: null });

    assert.deepEqual(res.body, { ...settings, keySaved: false, source: "settings" });
    assert.deepEqual((await request(app).get("/api/assistant")).body, { enabled: false });
  });

  test("lets a running turn finish after the key is removed", async (t) => {
    const held = heldStep();
    const context = await setupWithSettings(t, { steps: [held.step, { text: "Hello." }] });
    const settings = { provider: "anthropic", model: "model-1" };
    const put = (body) => request(context.app).put("/api/assistant/settings").send(body);
    await put({ ...settings, apiKey: KEY });
    const id = await create(context.app);
    await request(context.app)
      .post(`/api/assistant/conversations/${id}/messages`)
      .send({ text: "Hi." });
    await held.called();

    await put({ ...settings, apiKey: null });
    // The turn calls the model again after the tool call.
    held.release({ toolCalls: [call("c1", "list_recipes", {})] });
    await context.assistant.settled(id);

    const view = await context.assistant.view(id);
    assert.deepEqual(
      [view.status, view.messages.at(-1)],
      ["idle", { role: "assistant", text: "Hello." }],
    );
  });

  test("answers 400 for a model that the provider doesn't list", async (t) => {
    const { app } = await setupWithSettings(t);

    const res = await request(app)
      .put("/api/assistant/settings")
      .send({ provider: "openai", model: "model-2", apiKey: KEY });

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: "Choose a model from the list." });
  });

  test("answers 400 when the provider rejects the key", async (t) => {
    const lists = { openai: new ProviderError("auth", "HTTP 401") };
    const { app } = await setupWithSettings(t, { lists });

    const res = await request(app)
      .put("/api/assistant/settings")
      .send({ provider: "openai", model: "model-1", apiKey: KEY });

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: "The provider didn't accept this key." });
  });

  test("answers 502 when the provider fails", async (t) => {
    const lists = { openai: new ProviderError("timeout", "No answer within 4000 ms") };
    const { app } = await setupWithSettings(t, { lists });

    const res = await request(app)
      .put("/api/assistant/settings")
      .send({ provider: "openai", model: "model-1", apiKey: KEY });

    assert.equal(res.status, 502);
    assert.deepEqual(res.body, { error: "Couldn't check the key." });
  });

  test("answers 409 while the environment sets the assistant up", async (t) => {
    const environment = { provider: "anthropic", model: "env-model", apiKey: "sk-env" };
    const { app } = await setupWithSettings(t, { environment });

    const res = await request(app)
      .put("/api/assistant/settings")
      .send({ provider: "openai", model: "model-1", apiKey: KEY });

    assertJsonError(res, 409, "settings over the environment");
    assert.deepEqual(res.body, { error: "The assistant is set up on the server." });
  });

  const BAD_SETTINGS = [
    ["no body", undefined],
    ["another field", { provider: "openai", model: "model-1", apiKey: KEY, other: 1 }],
    ["an unknown provider", { provider: "gemini", model: "model-1" }],
  ];
  for (const [label, body] of BAD_SETTINGS) {
    test(`rejects ${label} with 400`, async (t) => {
      const { app } = await setupWithSettings(t);
      const req = request(app).put("/api/assistant/settings");

      const res = await (body === undefined ? req : req.send(body));

      assertJsonError(res, 400, label);
    });
  }

  test("never puts a key in a response or a log entry", async (t) => {
    const environment = { provider: "anthropic", model: "env-model", apiKey: "sk-env" };
    const plain = await setupWithSettings(t);
    const fromEnvironment = await setupWithSettings(t, { environment });
    const settings = { provider: "openai", model: "model-1" };
    const put = (app, body) => request(app).put("/api/assistant/settings").send(body);
    const responses = [
      await put(plain.app, { ...settings, apiKey: KEY }),
      await request(plain.app).get("/api/assistant/settings"),
      await put(plain.app, { ...settings, apiKey: `${KEY} x` }),
      await put(plain.app, { ...settings, apiKey: `${KEY}\u0007` }),
      await put(plain.app, { ...settings, apiKey: KEY, other: KEY }),
      await put(plain.app, { provider: KEY, model: "model-1" }),
      await request(plain.app)
        .put("/api/assistant/settings")
        .set("Content-Type", "application/json")
        .send(`{"provider":"openai","model":"model-1","apiKey":${KEY}}`),
      await put(fromEnvironment.app, { ...settings, apiKey: KEY }),
      await request(fromEnvironment.app).get("/api/assistant/settings"),
    ];

    // Both keys start with "sk-", and nothing else does, so this finds a
    // part of a key too, such as the excerpt in an error of JSON.parse.
    for (const res of responses) {
      assert.equal(res.text.includes("sk-"), false, `${res.status} ${res.text}`);
    }
    const logged = JSON.stringify([...plain.entries, ...fromEnvironment.entries]);
    assert.equal(logged.includes("sk-"), false, logged);
  });
});

describe("POST /api/assistant/models", () => {
  test("answers 200 with the models that the provider lists for the key", async (t) => {
    const { app } = await setupWithSettings(t);

    const res = await request(app)
      .post("/api/assistant/models")
      .send({ provider: "openai", apiKey: KEY });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { models: [LISTED_MODEL] });
  });

  test("answers 400 when the provider rejects the key", async (t) => {
    const lists = { openai: new ProviderError("auth", "HTTP 401") };
    const { app } = await setupWithSettings(t, { lists });

    const res = await request(app)
      .post("/api/assistant/models")
      .send({ provider: "openai", apiKey: KEY });

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: "The provider didn't accept this key." });
  });

  test("answers 502 when the provider fails", async (t) => {
    const lists = { openai: new ProviderError("network", "Network error: ECONNREFUSED") };
    const { app } = await setupWithSettings(t, { lists });

    const res = await request(app)
      .post("/api/assistant/models")
      .send({ provider: "openai", apiKey: KEY });

    assert.equal(res.status, 502);
    assert.deepEqual(res.body, { error: "Couldn't check the key." });
  });

  test("answers 409 while the environment sets the assistant up", async (t) => {
    const environment = { provider: "anthropic", model: "env-model", apiKey: "sk-env" };
    const { app } = await setupWithSettings(t, { environment });

    const res = await request(app)
      .post("/api/assistant/models")
      .send({ provider: "openai", apiKey: KEY });

    assert.equal(res.status, 409);
    assert.deepEqual(res.body, { error: "The assistant is set up on the server." });
  });

  test("answers 404 without a setup", async () => {
    const res = await request(createApp(createStores({ dataDir: dataDir() })))
      .post("/api/assistant/models")
      .send({ provider: "openai", apiKey: KEY });

    assert.equal(res.status, 404);
  });

  const BAD_REQUESTS = [
    ["no body", undefined],
    ["another field", { provider: "openai", apiKey: KEY, model: "model-1" }],
    ["an unknown provider", { provider: "gemini", apiKey: KEY }],
    ["a null key", { provider: "openai", apiKey: null }],
    ["a key with a space", { provider: "openai", apiKey: `${KEY} x` }],
  ];
  for (const [label, body] of BAD_REQUESTS) {
    test(`rejects ${label} with 400`, async (t) => {
      const { app } = await setupWithSettings(t);
      const req = request(app).post("/api/assistant/models");

      const res = await (body === undefined ? req : req.send(body));

      assertJsonError(res, 400, label);
    });
  }

  test("never puts a key in a response or a log entry", async (t) => {
    const environment = { provider: "anthropic", model: "env-model", apiKey: "sk-env" };
    const lists = {
      anthropic: new ProviderError("auth", "HTTP 401"),
      openai: new ProviderError("other", "The answer has no list of models"),
    };
    const plain = await setupWithSettings(t, { lists });
    const fromEnvironment = await setupWithSettings(t, { environment });
    const post = (app, body) => request(app).post("/api/assistant/models").send(body);
    const responses = [
      await post(plain.app, { provider: "anthropic", apiKey: KEY }),
      await post(plain.app, { provider: "openai", apiKey: KEY }),
      await post(plain.app, { provider: "openai", apiKey: `${KEY} x` }),
      await post(plain.app, { provider: KEY }),
      await request(plain.app)
        .put("/api/assistant/settings")
        .send({ provider: "anthropic", model: "model-1", apiKey: KEY }),
      await request(plain.app)
        .put("/api/assistant/settings")
        .send({ provider: "openai", model: "model-1", apiKey: KEY }),
      await request(plain.app)
        .post("/api/assistant/models")
        .set("Content-Type", "application/json")
        .send(`{"provider":"openai","apiKey":${KEY}}`),
      await post(fromEnvironment.app, { provider: "anthropic" }),
    ];

    // Both keys start with "sk-", and nothing else does, so this finds a
    // part of a key too.
    for (const res of responses) {
      assert.equal(res.text.includes("sk-"), false, `${res.status} ${res.text}`);
    }
    const logged = JSON.stringify([...plain.entries, ...fromEnvironment.entries]);
    assert.equal(logged.includes("sk-"), false, logged);
  });
});
