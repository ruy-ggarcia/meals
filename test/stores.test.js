import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { createStores } from "../server/stores.js";

describe("createStores", () => {
  test("moves the recipe ingredients in the old unit to the new measure", async (t) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "meals-stores-"));
    t.after(() => rm(dataDir, { recursive: true, force: true }));
    const { ingredients, recipes } = createStores({ dataDir });
    const carrot = await ingredients.create({
      name: "Carrot",
      unit: "pcs",
      measures: [{ name: "net", amount: 4 }],
    });
    const [net] = carrot.measures;
    const inNet = { ingredientId: carrot.id, measureId: net.id, quantity: 1 };
    const inUnit = { ingredientId: carrot.id, quantity: 2 };
    await recipes.create({ name: "Salad", ingredients: [inNet] });
    await recipes.create({ name: "Soup", ingredients: [inUnit] });
    const stew = await recipes.create({ name: "Stew", ingredients: [inUnit] });
    await recipes.update(stew.id, { archived: true });

    const updated = await ingredients.update(carrot.id, {
      unit: "g",
      conversion: { from: 1, to: 120, measureName: "piece" },
    });

    const piece = updated.measures[1];
    assert.equal(piece.name, "piece");
    assert.deepEqual(
      (await recipes.list()).map((recipe) => [recipe.name, recipe.ingredients]),
      [
        ["Salad", [inNet]],
        ["Soup", [{ ...inUnit, measureId: piece.id }]],
        ["Stew", [{ ...inUnit, measureId: piece.id }]],
      ],
    );
  });

  test("rejects a unit change without a conversion while a recipe uses it", async (t) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "meals-stores-"));
    t.after(() => rm(dataDir, { recursive: true, force: true }));
    const { ingredients, recipes } = createStores({ dataDir });
    const onion = await ingredients.create({ name: "Onion", unit: "g" });
    await recipes.create({
      name: "Soup",
      ingredients: [{ ingredientId: onion.id, quantity: 100 }],
    });

    await assert.rejects(ingredients.update(onion.id, { unit: "pcs" }), {
      name: "ValidationError",
      message: '"Onion" has measures or recipes in g. Reload the page to change its unit.',
    });
  });
});
