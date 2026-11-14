import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import * as menus from "../public/menus.js";
import * as quantities from "../public/quantities.js";
import * as settings from "../public/settings.js";

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

describe("public/menus.js", () => {
  test("has the menu limits of the shared table", () => {
    assertLimits(menus, "menu");
  });
});

describe("public/quantities.js", () => {
  test("has the recipe limits of the shared table", () => {
    // MAX_INGREDIENTS belongs to the recipe table, with the quantity limits.
    assertLimits(quantities, "recipe");
  });

  test("has the measure limit of the shared table", () => {
    assertLimits(quantities, "measure");
  });
});

describe("public/settings.js", () => {
  test("has the preferences limit of the shared table", () => {
    assertLimits(settings, "preferences");
  });

  test("has the key limit of the shared table", () => {
    // Settings lists the models of the provider, so it has no model limit.
    assert.equal(settings.MAX_KEY, limits.settings.MAX_KEY, "MAX_KEY");
  });
});
