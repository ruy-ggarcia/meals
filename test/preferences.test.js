import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ValidationError } from "../server/errors.js";
import { createQueue } from "../server/files.js";
import { createPreferences, MAX_PREFERENCES } from "../server/preferences.js";
import { useDataDir, writeDataFile } from "./backend-helpers.js";

const dataDir = useDataDir("meals-preferences-");

function newPreferences() {
  return createPreferences({ dataDir: dataDir(), enqueue: createQueue() });
}

describe("createPreferences", () => {
  test("reads an empty text when there is no file", async () => {
    assert.equal(await newPreferences().read(), "");
  });

  test("reads back a saved text, with line breaks and accents unchanged", async () => {
    const text = "No pork.\n\nCafé con leche at breakfast.\r\nNiño eats at school on Tuesdays.";
    const preferences = newPreferences();
    assert.equal(await preferences.save(text), text);
    assert.equal(await preferences.read(), text);
    assert.equal(await newPreferences().read(), text, "a new store reads the file");
  });

  test("accepts the longest text", async () => {
    const text = "a".repeat(MAX_PREFERENCES);
    assert.equal(await newPreferences().save(text), text);
  });

  test("rejects a text one character too long, and keeps the saved text", async () => {
    const preferences = newPreferences();
    await preferences.save("Vegetarian.");
    await assert.rejects(
      preferences.save("a".repeat(MAX_PREFERENCES + 1)),
      new ValidationError('"text" must be a string of at most 10000 characters.'),
    );
    assert.equal(await preferences.read(), "Vegetarian.");
  });

  test("rejects a value that isn't a string", async () => {
    await assert.rejects(newPreferences().save(1), ValidationError);
  });

  for (const [label, content] of [
    ["an array", "[]"],
    ["an object without text", "{}"],
    ["an object with a text that isn't a string", '{"text":1}'],
  ]) {
    test(`rejects a file that holds ${label}, and doesn't overwrite it`, async () => {
      await writeDataFile(dataDir(), "v2/preferences.json", content);
      const preferences = newPreferences();
      await assert.rejects(preferences.read(), /preferences\.json/);
      await assert.rejects(preferences.save("New"), /preferences\.json/);
    });
  }
});
