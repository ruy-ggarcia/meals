import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import * as conversations from "../server/assistant/conversations.js";
import * as assistantSettings from "../server/assistant/settings.js";
import * as ingredients from "../server/ingredients.js";
import * as preferences from "../server/preferences.js";
import * as quantities from "../server/quantities.js";
import * as recipes from "../server/recipes.js";
import * as weeks from "../server/weeks.js";

// public/ and server/ keep their own copy of each limit, because the browser
// never imports from server/. Both sides' tests read the values of
// test/fixtures/limits.json, so the two can't drift apart.
const limits = JSON.parse(
  await readFile(new URL("./fixtures/limits.json", import.meta.url), "utf8"),
);

/** Checks that each constant of MODULE equals the value in the table GROUP. */
function assertLimits(module, group) {
  for (const [name, value] of Object.entries(limits[group])) {
    assert.equal(module[name], value, name);
  }
}

describe("server/weeks.js", () => {
  test("has the menu limits of the shared table", () => {
    assertLimits(weeks, "menu");
  });
});

describe("server/recipes.js", () => {
  test("has the ingredient limit of the shared table", () => {
    assert.equal(recipes.MAX_INGREDIENTS, limits.recipe.MAX_INGREDIENTS, "MAX_INGREDIENTS");
  });
});

describe("server/quantities.js", () => {
  test("has the quantity limits of the shared table", () => {
    assert.equal(quantities.MIN_QUANTITY, limits.recipe.MIN_QUANTITY, "MIN_QUANTITY");
    assert.equal(quantities.MAX_QUANTITY, limits.recipe.MAX_QUANTITY, "MAX_QUANTITY");
  });
});

describe("server/ingredients.js", () => {
  test("has the measure limit of the shared table", () => {
    assertLimits(ingredients, "measure");
  });
});

describe("server/preferences.js", () => {
  test("has the preferences limit of the shared table", () => {
    assertLimits(preferences, "preferences");
  });
});

describe("server/assistant/conversations.js", () => {
  test("has the attachment limits of the shared table", () => {
    assertLimits(conversations, "attachment");
  });
});

describe("server/assistant/settings.js", () => {
  test("has the settings limits of the shared table", () => {
    assertLimits(assistantSettings, "settings");
  });
});
