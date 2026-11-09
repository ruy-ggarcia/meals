import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import * as ingredients from "../server/ingredients.js";
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
