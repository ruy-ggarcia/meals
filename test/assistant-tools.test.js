import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { runTool, TOOLS } from "../server/assistant/tools.js";
import { createStores } from "../server/stores.js";
import { blankWeek, collectingLogger, useDataDir, writeDataFile } from "./backend-helpers.js";

const WEEK = "2026-11-16";

const onion = { id: "onion", name: "Onion", unit: "g", measures: [], archived: false };
const soup = {
  id: "soup",
  name: "Soup",
  archived: false,
  ingredients: [
    { ingredientId: "onion", quantity: 100 },
    { ingredientId: "gone", quantity: 1 },
  ],
};
const bread = { id: "bread", name: "Bread", archived: false, ingredients: [] };

/**
 * Writes a catalog, a recipe book, and a week to a new data directory before
 * each test. Returns the stores on it of the test that runs.
 */
function useStores() {
  const dataDir = useDataDir("meals-assistant-tools-");
  let stores;
  beforeEach(async () => {
    await writeDataFile(dataDir(), "v2/ingredients.json", JSON.stringify({ ingredients: [onion] }));
    await writeDataFile(dataDir(), "v2/recipes.json", JSON.stringify({ recipes: [soup, bread] }));
    const week = blankWeek();
    week.mon.lunch = { items: [{ recipeId: "soup", servings: 2 }] };
    await writeDataFile(dataDir(), `v2/weeks/${WEEK}.json`, JSON.stringify(week));
    stores = createStores({ dataDir: dataDir() });
  });
  return () => stores;
}

/** Runs a tool that must succeed and returns its result. */
async function succeed(name, input, context) {
  const result = await runTool(name, input, context);
  assert.equal(result.isError, false, JSON.stringify(result.output));
  return result;
}

describe("TOOLS", () => {
  test("lists the tools by name from A to Z", () => {
    const names = TOOLS.map((tool) => tool.name);
    assert.deepEqual(names, [...names].sort());
    assert.equal(names.length, 7);
  });

  test("describes the parameters of every tool as a JSON Schema object", () => {
    for (const tool of TOOLS) {
      assert.equal(tool.parameters.type, "object", tool.name);
      assert.ok(tool.description.length > 0, tool.name);
    }
  });

  test("states in every proposal tool that nothing is saved until you apply it", () => {
    for (const tool of TOOLS.filter((candidate) => candidate.name.startsWith("propose_"))) {
      assert.match(tool.description, /not saved until the user applies/i, tool.name);
    }
  });
});

describe("runTool", () => {
  const stores = useStores();

  test("shows a pending ingredient in list_ingredients marked as pending", async () => {
    const created = await succeed(
      "propose_ingredient",
      { name: "Leek", unit: "g" },
      { stores: stores(), pending: [] },
    );

    const { output } = await succeed(
      "list_ingredients",
      {},
      { stores: stores(), pending: created.pending },
    );

    assert.deepEqual(
      output.ingredients.map((entry) => [entry.name, entry.pending]),
      [
        ["Leek", true],
        ["Onion", undefined],
      ],
    );
  });

  test("shows a pending recipe in list_recipes marked as pending", async () => {
    const created = await succeed(
      "propose_recipe",
      { name: "Apple Pie" },
      { stores: stores(), pending: [] },
    );

    const { output } = await succeed(
      "list_recipes",
      {},
      { stores: stores(), pending: created.pending },
    );

    assert.deepEqual(
      output.recipes.map((entry) => [entry.name, entry.pending]),
      [
        ["Apple Pie", true],
        ["Bread", undefined],
        ["Soup", undefined],
      ],
    );
  });

  test("leaves the unknown ingredients out of list_recipes", async () => {
    const { output } = await succeed("list_recipes", {}, { stores: stores(), pending: [] });

    const listed = output.recipes.find((entry) => entry.id === "soup");
    assert.deepEqual(listed.ingredients, [{ ingredientId: "onion", quantity: 100 }]);
  });

  test("shows a pending menu in read_week marked as pending", async () => {
    const staged = await succeed(
      "propose_menus",
      {
        menus: [
          { week: WEEK, day: "tue", meal: "dinner", items: [{ recipeId: "bread", servings: 1 }] },
        ],
      },
      { stores: stores(), pending: [] },
    );

    const { output } = await succeed(
      "read_week",
      { week: WEEK },
      { stores: stores(), pending: staged.pending },
    );

    assert.deepEqual(output.days.tue.dinner, {
      items: [{ recipeId: "bread", servings: 1 }],
      pending: true,
    });
    assert.deepEqual(output.days.mon.lunch, { items: [{ recipeId: "soup", servings: 2 }] });
  });

  test("returns the target, the ID, and the entry of a proposed recipe", async () => {
    const { output, pending } = await succeed(
      "propose_recipe",
      { name: "Onion Soup", ingredients: [{ ingredientId: "onion", quantity: 50 }] },
      { stores: stores(), pending: [] },
    );

    assert.equal(output.target, `recipe:${output.id}`);
    assert.equal(output.recipe.name, "Onion Soup");
    assert.equal(pending.length, 1);
  });

  test("proposes a change of a pending ingredient without repeating its fields", async () => {
    const created = await succeed(
      "propose_ingredient",
      { name: "Leek", unit: "g" },
      { stores: stores(), pending: [] },
    );

    const renamed = await succeed(
      "propose_ingredient",
      { id: created.output.id, name: "Big Leek" },
      { stores: stores(), pending: created.pending },
    );

    assert.equal(renamed.pending.length, 1);
    assert.deepEqual(
      [renamed.output.ingredient.name, renamed.output.ingredient.unit],
      ["Big Leek", "g"],
    );
  });

  test("never puts the pending list in the output of a proposal", async () => {
    const { output } = await succeed(
      "propose_ingredient",
      { name: "Leek", unit: "g" },
      { stores: stores(), pending: [] },
    );

    assert.equal("pending" in output, false);
  });

  test("stages no menu when one of three is invalid, and names its slot", async () => {
    const items = [{ recipeId: "bread", servings: 1 }];
    const result = await runTool(
      "propose_menus",
      {
        menus: [
          { week: WEEK, day: "mon", meal: "dinner", items },
          { week: WEEK, day: "tue", meal: "dinner", items: [{ recipeId: "nope", servings: 1 }] },
          { week: WEEK, day: "wed", meal: "dinner", items },
        ],
      },
      { stores: stores(), pending: [] },
    );

    assert.equal(result.isError, true);
    assert.deepEqual(result.pending, []);
    assert.match(result.output.error, /Tuesday dinner/);
  });

  test("withdraws a pending change by its target", async () => {
    const created = await succeed(
      "propose_ingredient",
      { name: "Leek", unit: "g" },
      { stores: stores(), pending: [] },
    );

    const result = await succeed(
      "withdraw_pending_change",
      { target: created.output.target },
      { stores: stores(), pending: created.pending },
    );

    assert.deepEqual(result.pending, []);
    assert.equal(result.output.target, created.output.target);
  });

  test("returns an error when the target to withdraw isn't pending", async () => {
    const result = await runTool(
      "withdraw_pending_change",
      { target: "recipe:nope" },
      { stores: stores(), pending: [] },
    );

    assert.equal(result.isError, true);
    assert.match(result.output.error, /nope/);
  });

  test("returns an error for an unknown tool", async () => {
    const result = await runTool("fly", {}, { stores: stores(), pending: [] });

    assert.equal(result.isError, true);
    assert.match(result.output.error, /fly/);
  });

  for (const [label, input] of [
    ["null", null],
    ["an array", []],
    ["a string", "mon"],
  ]) {
    test(`returns an error without throwing when the input is ${label}`, async () => {
      const result = await runTool("propose_recipe", input, { stores: stores(), pending: [] });

      assert.equal(result.isError, true);
      assert.deepEqual(result.pending, []);
    });
  }

  test("returns an error when the week isn't a Monday", async () => {
    const result = await runTool(
      "read_week",
      { week: "2026-11-17" },
      { stores: stores(), pending: [] },
    );

    assert.equal(result.isError, true);
    assert.match(result.output.error, /2026-11-17/);
  });

  test("returns an error when an input has a key that the tool doesn't take", async () => {
    const result = await runTool(
      "read_week",
      { week: WEEK, day: "mon" },
      { stores: stores(), pending: [] },
    );

    assert.equal(result.isError, true);
  });

  test("returns a generic error and logs it when the stores fail", async () => {
    const failing = {
      read: async () => {
        throw new Error("EACCES: /data/recipes.json");
      },
    };
    const pending = [{ kind: "menu", week: WEEK, day: "mon", meal: "lunch", items: [], base: [] }];
    const { entries, logger } = collectingLogger();

    const result = await runTool("list_recipes", {}, { stores: failing, pending, logger });

    assert.deepEqual(result, { output: { error: "The tool failed." }, isError: true, pending });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].msg, "assistant tool failed");
    assert.equal(entries[0].tool, "list_recipes");
    assert.match(entries[0].error, /EACCES/);
  });

  test("returns the message of a name conflict and logs nothing", async () => {
    const { entries, logger } = collectingLogger();

    const result = await runTool(
      "propose_recipe",
      { name: "soup" },
      { stores: stores(), pending: [], logger },
    );

    assert.equal(result.isError, true);
    assert.match(result.output.error, /Soup/);
    assert.deepEqual(entries, []);
  });
});
