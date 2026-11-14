import assert from "node:assert/strict";
import { chmod, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { createAssistantSettings } from "../server/assistant/settings.js";
import { ValidationError } from "../server/errors.js";
import { createQueue } from "../server/files.js";
import { modeOf, useDataDir, useUmask, writeDataFile } from "./backend-helpers.js";

// Nothing but a key holds "sk-", so a test finds a part of a key too.
const KEY = "sk-test-0123456789";

const dataDir = useDataDir("meals-assistant-settings-");

function newSettings() {
  return createAssistantSettings({ dataDir: dataDir(), enqueue: createQueue() });
}

/** The path of `v2/assistant.json`. */
function savedPath() {
  return path.join(dataDir(), "v2", "assistant.json");
}

/** The parsed content of `v2/assistant.json`. */
async function savedFile() {
  return JSON.parse(await readFile(savedPath(), "utf8"));
}

/** The message of the error that `promise` rejects with. */
async function rejection(promise) {
  return promise.then(
    () => assert.fail("expected a rejection"),
    (error) => error.message,
  );
}

describe("createAssistantSettings", () => {
  test("reads undefined when there is no file", async () => {
    assert.equal(await newSettings().read(), undefined);
  });

  test("saves the provider, the model, and the key in assistant.json", async () => {
    const saved = await newSettings().save({ provider: "openai", model: "model-1", apiKey: KEY });

    const expected = { provider: "openai", model: "model-1", apiKey: KEY };
    assert.deepEqual(saved, expected);
    assert.deepEqual(await savedFile(), expected);
    assert.deepEqual(await newSettings().read(), expected, "a new store reads the file");
  });

  // The umask of the container, which leaves other data files 0664.
  test("creates assistant.json with mode 0640", async (t) => {
    useUmask(t, 0o002);

    await newSettings().save({ provider: "openai", model: "model-1", apiKey: KEY });

    assert.equal(await modeOf(savedPath()), "640");
  });

  test("gives assistant.json mode 0640 when it replaces the file", async (t) => {
    useUmask(t, 0o002);
    const settings = newSettings();
    await settings.save({ provider: "openai", model: "model-1", apiKey: null });
    await chmod(savedPath(), 0o664);

    await settings.save({ provider: "openai", model: "model-1", apiKey: KEY });

    assert.equal(await modeOf(savedPath()), "640");
  });

  test("saves a provider and a model without a key as no key", async () => {
    const saved = await newSettings().save({ provider: "anthropic", model: "model-1" });

    assert.deepEqual(saved, { provider: "anthropic", model: "model-1", apiKey: null });
  });

  test("keeps the saved key when the changes have no key", async () => {
    const settings = newSettings();
    await settings.save({ provider: "anthropic", model: "model-1", apiKey: KEY });

    const saved = await settings.save({ provider: "anthropic", model: "model-2" });

    assert.deepEqual(saved, { provider: "anthropic", model: "model-2", apiKey: KEY });
  });

  // A save without a key checks the saved key before it waits for the queue,
  // so a save for the other provider can replace the key meanwhile.
  test("rejects changes without a key for another provider, and keeps the file", async () => {
    const settings = newSettings();
    await settings.save({ provider: "openai", model: "model-1", apiKey: KEY });

    await assert.rejects(settings.save({ provider: "anthropic", model: "model-2" }), {
      name: "ConflictError",
      message: "The saved key changed. Check the settings again.",
    });

    assert.deepEqual(await savedFile(), { provider: "openai", model: "model-1", apiKey: KEY });
  });

  test("removes the key and keeps the provider and the model with a null key", async () => {
    const settings = newSettings();
    await settings.save({ provider: "anthropic", model: "model-1", apiKey: KEY });

    const saved = await settings.save({ provider: "anthropic", model: "model-1", apiKey: null });

    assert.deepEqual(saved, { provider: "anthropic", model: "model-1", apiKey: null });
    assert.deepEqual(await settings.read(), saved);
  });

  test("accepts a model of 200 characters and a key of 500", async () => {
    const changes = { provider: "openai", model: "m".repeat(200), apiKey: "k".repeat(500) };

    assert.deepEqual(await newSettings().save(changes), changes);
  });

  const INVALID = [
    ["no changes", undefined],
    ["an array", [KEY]],
    ["no provider", { model: "model-1", apiKey: KEY }],
    ["no model", { provider: "openai", apiKey: KEY }],
    ["another key", { provider: "openai", model: "model-1", apiKey: KEY, key: KEY }],
    ["an unknown provider", { provider: "gemini", model: "model-1" }],
    ["an empty model", { provider: "openai", model: "" }],
    ["a model of 201 characters", { provider: "openai", model: "m".repeat(201) }],
    ["a model with a line break", { provider: "openai", model: "model\n1" }],
    ["a model that isn't a string", { provider: "openai", model: 1 }],
    ["an empty key", { provider: "openai", model: "model-1", apiKey: "" }],
    ["a key of 501 characters", { provider: "openai", model: "model-1", apiKey: "k".repeat(501) }],
    ["a key with a space", { provider: "openai", model: "model-1", apiKey: `${KEY} x` }],
    ["a key with a tab", { provider: "openai", model: "model-1", apiKey: `${KEY}\t` }],
    ["a key with an accent", { provider: "openai", model: "model-1", apiKey: `${KEY}é` }],
    ["a key that isn't a string", { provider: "openai", model: "model-1", apiKey: 1 }],
  ];
  for (const [label, changes] of INVALID) {
    test(`rejects ${label} as invalid, and keeps the file`, async () => {
      const settings = newSettings();
      await settings.save({ provider: "anthropic", model: "model-0", apiKey: "sk-old" });

      await assert.rejects(settings.save(changes), ValidationError);

      assert.deepEqual(await savedFile(), {
        provider: "anthropic",
        model: "model-0",
        apiKey: "sk-old",
      });
    });
  }

  test("never puts a key in the message of a rejection", async () => {
    const changes = [
      { provider: "openai", model: "model-1", apiKey: `${KEY} x` },
      { provider: "openai", model: "model-1", apiKey: `${KEY}\u0007` },
      { provider: KEY, model: "model-1" },
      { provider: "openai", model: `${KEY}\n` },
      { provider: "openai", model: "model-1", apiKey: KEY, [KEY]: KEY },
    ];

    for (const change of changes) {
      const message = await rejection(newSettings().save(change));
      assert.equal(message.includes("sk-"), false, message);
    }
  });

  for (const [label, content] of [
    ["an array", "[]"],
    ["an object without a key", '{"provider":"openai","model":"model-1"}'],
    ["an unknown provider", '{"provider":"gemini","model":"model-1","apiKey":null}'],
    ["a key with a space", `{"provider":"openai","model":"model-1","apiKey":"${KEY} x"}`],
    ["invalid JSON", `{"provider":"openai","model":"model-1","apiKey":${KEY}}`],
  ]) {
    test(`rejects a file that holds ${label}, and keeps it`, async () => {
      await writeDataFile(dataDir(), "v2/assistant.json", content);
      const settings = newSettings();

      await assert.rejects(settings.read(), /assistant\.json/);
      await assert.rejects(
        settings.save({ provider: "openai", model: "model-2" }),
        /assistant\.json/,
      );

      const file = await readFile(path.join(dataDir(), "v2", "assistant.json"), "utf8");
      assert.equal(file, content);
    });
  }

  test("keeps the content of an invalid file out of a rejection's message", async () => {
    const contents = [
      `{"provider":"openai","model":"model-1","apiKey":${KEY}}`,
      `{"provider":"openai","model":"model-1","apiKey":"${KEY}`,
      `{"provider":"openai","model":"model-1","apiKey":"${KEY} x"}`,
    ];

    for (const content of contents) {
      await writeDataFile(dataDir(), "v2/assistant.json", content);
      const message = await rejection(newSettings().read());
      assert.equal(message.includes("sk-"), false, message);
    }
  });
});
