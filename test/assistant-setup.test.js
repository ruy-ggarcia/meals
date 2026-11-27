import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ProviderError } from "../server/assistant/providers/errors.js";
import { createAssistantSettings } from "../server/assistant/settings.js";
import { createAssistantSetup } from "../server/assistant/setup.js";
import { ConflictError, UpstreamError, ValidationError } from "../server/errors.js";
import { createQueue } from "../server/files.js";
import { fakeModelLists, LISTED_MODEL, scriptedProvider } from "./assistant-helpers.js";
import { collectingLogger, useDataDir, writeDataFile } from "./backend-helpers.js";

// Nothing but a key holds "sk-", so a test finds a part of a key too.
const KEY = "sk-test-0123456789";
const ENVIRONMENT = { provider: "anthropic", model: "env-model", apiKey: "sk-env" };

const dataDir = useDataDir("meals-assistant-setup-");

/**
 * Factories that build a scripted provider named after the factory, with
 * the model they get, and record the options of each build in `builds`.
 */
function recordingFactories() {
  /** @type {{ provider: string, apiKey: string, model: string }[]} */
  const builds = [];
  /** @param {"anthropic" | "openai"} name */
  const factory =
    (name) =>
    ({ apiKey, model }) => {
      builds.push({ provider: name, apiKey, model });
      return { ...scriptedProvider([]), name, model };
    };
  return { builds, factories: { anthropic: factory("anthropic"), openai: factory("openai") } };
}

/**
 * A loaded setup on the data directory of the test, with recording
 * factories, fake model lists that answer with `lists`, and a collecting
 * logger. `environment` replaces none.
 * @param {{ environment?: any, lists?: Parameters<typeof fakeModelLists>[0] }} [options]
 */
async function newSetup({ environment, lists } = {}) {
  const { builds, factories } = recordingFactories();
  const { calls, modelLists } = fakeModelLists(lists);
  const { entries, logger } = collectingLogger();
  const settings = createAssistantSettings({ dataDir: dataDir(), enqueue: createQueue() });
  const setup = createAssistantSetup({
    environment,
    settings,
    providerFactories: factories,
    modelLists,
    logger,
  });
  await setup.load();
  return { builds, calls, entries, settings, setup };
}

/** The errors of a provider's failures other than a rejected key. */
const FAILURES = ["network", "other", "overloaded", "rate_limit", "timeout"].map(
  (kind) => new ProviderError(/** @type {any} */ (kind), `A failure of kind ${kind}`),
);
const REJECTED_KEY = new ValidationError("The provider didn't accept this key.");
const NO_KEY = new ValidationError("Enter an API key for this provider.");
const CHECK_FAILED = new UpstreamError("Couldn't check the key.");

/** Writes the settings file of the test. */
function writeSettings(settings) {
  return writeDataFile(dataDir(), "v2/assistant.json", JSON.stringify(settings));
}

describe("createAssistantSetup", () => {
  test("has no provider when nothing is set up", async () => {
    const { setup } = await newSetup();

    assert.equal(setup.provider(), undefined);
    assert.equal(setup.status(), undefined);
  });

  test("builds the provider of a complete environment", async () => {
    const { builds, setup } = await newSetup({ environment: ENVIRONMENT });

    assert.deepEqual(builds, [ENVIRONMENT]);
    assert.equal(setup.provider()?.model, "env-model");
    assert.deepEqual(setup.status(), { provider: "anthropic", source: "environment" });
  });

  test("builds the provider of the saved settings without an environment", async () => {
    await writeSettings({ provider: "openai", model: "model-1", apiKey: KEY });

    const { builds, setup } = await newSetup();

    assert.deepEqual(builds, [{ provider: "openai", model: "model-1", apiKey: KEY }]);
    assert.deepEqual(setup.status(), { provider: "openai", source: "settings" });
  });

  test("prefers the environment to the saved settings", async () => {
    await writeSettings({ provider: "openai", model: "model-1", apiKey: KEY });

    const { builds, setup } = await newSetup({ environment: ENVIRONMENT });

    assert.deepEqual(builds, [ENVIRONMENT]);
    assert.deepEqual(setup.status(), { provider: "anthropic", source: "environment" });
  });

  test("has no provider when the saved settings have no key", async () => {
    await writeSettings({ provider: "openai", model: "model-1", apiKey: null });

    const { builds, setup } = await newSetup();

    assert.deepEqual(builds, []);
    assert.equal(setup.provider(), undefined);
  });

  test("has no provider when the settings file is unreadable", async () => {
    await writeDataFile(dataDir(), "v2/assistant.json", `{"apiKey":${KEY}}`);

    const { setup } = await newSetup();

    assert.equal(setup.provider(), undefined);
  });

  test("logs an unreadable settings file without its content", async () => {
    await writeDataFile(dataDir(), "v2/assistant.json", `{"apiKey":${KEY}}`);

    const { entries } = await newSetup();

    assert.deepEqual(
      entries.map(({ level, msg }) => ({ level, msg })),
      [{ level: "error", msg: "assistant settings unreadable" }],
    );
    assert.equal(JSON.stringify(entries).includes("sk-"), false, JSON.stringify(entries));
  });

  describe("read", () => {
    test("answers no provider, no model, and no key when nothing is saved", async () => {
      const { setup } = await newSetup();

      assert.deepEqual(await setup.read(), {
        provider: null,
        model: null,
        keySaved: false,
        source: "settings",
      });
    });

    test("answers the saved provider and model, and that a key is saved", async () => {
      await writeSettings({ provider: "openai", model: "model-1", apiKey: KEY });
      const { setup } = await newSetup();

      assert.deepEqual(await setup.read(), {
        provider: "openai",
        model: "model-1",
        keySaved: true,
        source: "settings",
      });
    });

    test("answers the provider and the model of the environment", async () => {
      await writeSettings({ provider: "openai", model: "model-1", apiKey: KEY });
      const { setup } = await newSetup({ environment: ENVIRONMENT });

      assert.deepEqual(await setup.read(), {
        provider: "anthropic",
        model: "env-model",
        keySaved: true,
        source: "environment",
      });
    });
  });

  describe("save", () => {
    test("replaces the provider at once with the saved settings", async () => {
      const { builds, setup } = await newSetup();

      await setup.save({ provider: "openai", model: "model-1", apiKey: KEY });

      assert.deepEqual(builds, [{ provider: "openai", model: "model-1", apiKey: KEY }]);
      assert.equal(setup.provider()?.name, "openai");
    });

    test("answers what read answers after the save", async () => {
      const { setup } = await newSetup();

      const view = await setup.save({ provider: "openai", model: "model-1", apiKey: KEY });

      assert.deepEqual(view, await setup.read());
    });

    test("rejects a save without any key before asking the provider", async () => {
      const { calls, setup } = await newSetup();

      await assert.rejects(setup.save({ provider: "openai", model: "model-1" }), NO_KEY);

      assert.deepEqual(calls, []);
      assert.equal(setup.provider(), undefined);
    });

    test("checks the key and the model with the provider before it saves", async () => {
      const { calls, setup } = await newSetup();

      await setup.save({ provider: "openai", model: "model-1", apiKey: KEY });

      assert.deepEqual(calls, [{ provider: "openai", apiKey: KEY }]);
    });

    test("checks the saved key when the save has no key", async () => {
      await writeSettings({ provider: "openai", model: "model-1", apiKey: KEY });
      const { calls, setup } = await newSetup();

      await setup.save({ provider: "openai", model: "model-1" });

      assert.deepEqual(calls, [{ provider: "openai", apiKey: KEY }]);
    });

    test("rejects a model that the list doesn't hold and saves nothing", async () => {
      const { settings, setup } = await newSetup();

      await assert.rejects(
        setup.save({ provider: "openai", model: "model-2", apiKey: KEY }),
        new ValidationError("Choose a model from the list."),
      );

      assert.equal(await settings.read(), undefined);
      assert.equal(setup.provider(), undefined);
    });

    test("rejects every model when the list is empty", async () => {
      const { setup } = await newSetup({ lists: { openai: [] } });

      await assert.rejects(
        setup.save({ provider: "openai", model: "model-1", apiKey: KEY }),
        new ValidationError("Choose a model from the list."),
      );
    });

    test("rejects a key that the provider doesn't accept and saves nothing", async () => {
      const lists = { openai: new ProviderError("auth", "HTTP 401") };
      const { settings, setup } = await newSetup({ lists });

      await assert.rejects(
        setup.save({ provider: "openai", model: "model-1", apiKey: KEY }),
        REJECTED_KEY,
      );

      assert.equal(await settings.read(), undefined);
    });

    test("saves nothing when the provider fails", async () => {
      const { settings, setup } = await newSetup({ lists: { openai: FAILURES[0] } });

      await assert.rejects(
        setup.save({ provider: "openai", model: "model-1", apiKey: KEY }),
        CHECK_FAILED,
      );

      assert.equal(await settings.read(), undefined);
    });

    test("rejects the saved key of the other provider before asking", async () => {
      await writeSettings({ provider: "openai", model: "model-1", apiKey: KEY });
      const { calls, setup } = await newSetup();

      await assert.rejects(setup.save({ provider: "anthropic", model: "model-1" }), NO_KEY);

      assert.deepEqual(calls, []);
      assert.equal(setup.provider()?.name, "openai");
    });

    test("removes the key without asking the provider", async () => {
      await writeSettings({ provider: "openai", model: "model-1", apiKey: KEY });
      const { calls, setup } = await newSetup();

      await setup.save({ provider: "openai", model: "model-2", apiKey: null });

      assert.deepEqual(calls, []);
    });

    test("rejects invalid settings before asking the provider", async () => {
      const { calls, setup } = await newSetup();

      await assert.rejects(
        setup.save({ provider: "openai", model: "model-1", apiKey: `${KEY} x` }),
        ValidationError,
      );

      assert.deepEqual(calls, []);
    });

    test("removes the provider when the key is removed", async () => {
      await writeSettings({ provider: "openai", model: "model-1", apiKey: KEY });
      const { setup } = await newSetup();

      await setup.save({ provider: "openai", model: "model-1", apiKey: null });

      assert.equal(setup.provider(), undefined);
    });

    test("keeps the provider after a rejected save", async () => {
      await writeSettings({ provider: "openai", model: "model-1", apiKey: KEY });
      const { setup } = await newSetup();
      const before = setup.provider();

      await assert.rejects(setup.save({ provider: "gemini", model: "model-2" }));

      assert.equal(setup.provider(), before);
    });

    test("rejects with a ConflictError while the environment sets it up", async () => {
      const { calls, setup } = await newSetup({ environment: ENVIRONMENT });

      await assert.rejects(
        setup.save({ provider: "openai", model: "model-1", apiKey: KEY }),
        new ConflictError("The assistant is set up on the server."),
      );
      assert.deepEqual(calls, []);
    });

    test("logs the provider and the model, and never the key", async () => {
      const { entries, setup } = await newSetup();

      await setup.save({ provider: "openai", model: "model-1", apiKey: KEY });

      assert.deepEqual(entries, [
        { level: "info", msg: "assistant settings changed", provider: "openai", model: "model-1" },
      ]);
    });
  });

  describe("models", () => {
    test("lists the models of the provider with the given key", async () => {
      const { calls, setup } = await newSetup();

      const models = await setup.models({ provider: "openai", apiKey: KEY });

      assert.deepEqual(models, [LISTED_MODEL]);
      assert.deepEqual(calls, [{ provider: "openai", apiKey: KEY }]);
    });

    test("lists the models with the saved key without a key", async () => {
      await writeSettings({ provider: "openai", model: "model-1", apiKey: KEY });
      const { calls, setup } = await newSetup();

      await setup.models({ provider: "openai" });

      assert.deepEqual(calls, [{ provider: "openai", apiKey: KEY }]);
    });

    test("answers an empty list when the provider has no models to chat", async () => {
      const { setup } = await newSetup({ lists: { anthropic: [] } });

      assert.deepEqual(await setup.models({ provider: "anthropic", apiKey: KEY }), []);
    });

    test("rejects without a key when none is saved, before asking", async () => {
      await writeSettings({ provider: "openai", model: "model-1", apiKey: null });
      const { calls, setup } = await newSetup();

      await assert.rejects(setup.models({ provider: "openai" }), NO_KEY);

      assert.deepEqual(calls, []);
    });

    test("rejects without a key when the saved key is of the other provider", async () => {
      await writeSettings({ provider: "openai", model: "model-1", apiKey: KEY });
      const { calls, setup } = await newSetup();

      await assert.rejects(setup.models({ provider: "anthropic" }), NO_KEY);

      assert.deepEqual(calls, []);
    });

    test("rejects a key that the provider doesn't accept", async () => {
      const { setup } = await newSetup({
        lists: { openai: new ProviderError("auth", "HTTP 401") },
      });

      await assert.rejects(setup.models({ provider: "openai", apiKey: KEY }), REJECTED_KEY);
    });

    test("rejects with an UpstreamError for every other failure", async () => {
      for (const failure of FAILURES) {
        const { setup } = await newSetup({ lists: { openai: failure } });

        await assert.rejects(
          setup.models({ provider: "openai", apiKey: KEY }),
          CHECK_FAILED,
          failure.kind,
        );
      }
    });

    test("logs a failure of the provider with its kind and message", async () => {
      const { entries, setup } = await newSetup({ lists: { openai: FAILURES[0] } });

      await setup.models({ provider: "openai", apiKey: KEY }).catch(() => {});

      assert.deepEqual(entries, [
        {
          level: "error",
          msg: "assistant key check failed",
          provider: "openai",
          kind: "network",
          error: "A failure of kind network",
        },
      ]);
    });

    test("rejects an invalid request before asking the provider", async () => {
      const { calls, setup } = await newSetup();
      const requests = [
        undefined,
        { provider: "gemini", apiKey: KEY },
        { provider: "openai", apiKey: null },
        { provider: "openai", apiKey: `${KEY} x` },
        { provider: "openai", apiKey: KEY, model: "model-1" },
      ];

      for (const request of requests) {
        await assert.rejects(setup.models(request), ValidationError, JSON.stringify(request));
      }
      assert.deepEqual(calls, []);
    });

    test("rejects with a ConflictError while the environment sets it up", async () => {
      const { calls, setup } = await newSetup({ environment: ENVIRONMENT });

      await assert.rejects(
        setup.models({ provider: "openai", apiKey: KEY }),
        new ConflictError("The assistant is set up on the server."),
      );
      assert.deepEqual(calls, []);
    });

    test("never puts the key in an error or a log entry", async () => {
      const lists = { anthropic: new ProviderError("auth", "HTTP 401"), openai: FAILURES[0] };
      const { entries, setup } = await newSetup({ lists });
      const failures = [
        setup.models({ provider: "anthropic", apiKey: KEY }),
        setup.models({ provider: "openai", apiKey: KEY }),
        setup.models({ provider: "openai", apiKey: `${KEY} x` }),
        setup.save({ provider: "openai", model: "model-1", apiKey: KEY }),
      ];

      for (const failure of failures) {
        const error = await failure.then(
          () => assert.fail("expected a rejection"),
          (reason) => reason,
        );
        const text = `${error.stack} ${JSON.stringify(error)} ${error.cause?.stack}`;
        assert.equal(text.includes("sk-"), false, text);
      }
      assert.equal(JSON.stringify(entries).includes("sk-"), false, JSON.stringify(entries));
    });
  });
});
