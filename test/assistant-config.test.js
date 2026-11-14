import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readAssistantConfig } from "../server/assistant/config.js";

const KEY = "sk-test-0123456789";
const FULL = {
  ASSISTANT_API_KEY: KEY,
  ASSISTANT_MODEL: "model-1",
  ASSISTANT_PROVIDER: "anthropic",
};
const NAMES = Object.keys(FULL);

/** FULL without the variables in `missing`. */
function without(missing) {
  return Object.fromEntries(Object.entries(FULL).filter(([name]) => !missing.includes(name)));
}

/** The six ways to leave out some of the three variables, but not all. */
const PARTIAL = [
  [NAMES[0]],
  [NAMES[1]],
  [NAMES[2]],
  [NAMES[0], NAMES[1]],
  [NAMES[0], NAMES[2]],
  [NAMES[1], NAMES[2]],
];

describe("readAssistantConfig", () => {
  test("returns undefined when no variable is set", () => {
    assert.equal(readAssistantConfig({ PATH: "/usr/bin" }), undefined);
  });

  test("returns undefined when every variable is empty", () => {
    assert.equal(
      readAssistantConfig({ ASSISTANT_API_KEY: "", ASSISTANT_MODEL: "", ASSISTANT_PROVIDER: "" }),
      undefined,
    );
  });

  for (const provider of ["anthropic", "openai"]) {
    test(`returns the provider, the model, and the key for ${provider}`, () => {
      assert.deepEqual(readAssistantConfig({ ...FULL, ASSISTANT_PROVIDER: provider }), {
        provider,
        model: "model-1",
        apiKey: KEY,
      });
    });
  }

  for (const missing of PARTIAL) {
    test(`names ${missing.join(" and ")} as missing`, () => {
      const config = readAssistantConfig(without(missing));

      assert.ok(config && "problem" in config, `expected a problem, got ${JSON.stringify(config)}`);
      for (const name of NAMES) {
        assert.equal(config.problem.includes(name), missing.includes(name), name);
      }
    });
  }

  test("treats an empty variable as a missing one", () => {
    assert.deepEqual(
      readAssistantConfig({ ...FULL, ASSISTANT_MODEL: "" }),
      readAssistantConfig(without(["ASSISTANT_MODEL"])),
    );
  });

  test("names an unknown provider", () => {
    const config = readAssistantConfig({ ...FULL, ASSISTANT_PROVIDER: "gemini" });

    assert.ok(config && "problem" in config, `expected a problem, got ${JSON.stringify(config)}`);
    assert.match(config.problem, /ASSISTANT_PROVIDER/);
    assert.match(config.problem, /gemini/);
  });

  test("never puts the key in a problem", () => {
    const envs = [
      { ...FULL, ASSISTANT_PROVIDER: "gemini" },
      ...PARTIAL.filter((missing) => !missing.includes("ASSISTANT_API_KEY")).map(without),
    ];

    for (const env of envs) {
      const config = readAssistantConfig(env);
      assert.ok(config && "problem" in config, JSON.stringify(Object.keys(env)));
      assert.equal(config.problem.includes(KEY), false, config.problem);
    }
  });
});
