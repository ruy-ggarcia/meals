import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, test } from "node:test";
import { NameConflictError, NotFoundError, ValidationError } from "../server/errors.js";
import { createStores } from "../server/stores.js";
import { UUID_V4, useDataDir, writeDataFile } from "./backend-helpers.js";

const dataDir = useDataDir("meals-recipes-");

// The recipe book, inside the data directory.
const RECIPES = "v2/recipes.json";
let ingredients;
let recipes;

function recipesFile() {
  return path.join(dataDir(), RECIPES);
}

beforeEach(() => {
  ({ ingredients, recipes } = createStores({ dataDir: dataDir() }));
});

/** An onion with the measure "medium", and a recipe of each kind that has it in its unit. */
async function onionInTwoRecipes() {
  const onion = await ingredients.create({
    name: "Onion",
    unit: "g",
    measures: [{ name: "medium", amount: 150 }],
  });
  await recipes.create({ name: "Soup", ingredients: [entry(onion.id, 100)] });
  const stew = await recipes.create({ name: "Stew", ingredients: [entry(onion.id, 50)] });
  await recipes.update(stew.id, { archived: true });
  return { medium: onion.measures[0], onion };
}

function entry(ingredientId, quantity) {
  return { ingredientId, quantity };
}

/**
 * Starts, before awaiting either, a save of a recipe that uses the measure
 * "medium" of a new ingredient and the removal of that measure, so that they
 * meet in the shared queue, in the order of `order`. Resolves to the measure
 * and the results of the save and of the removal.
 * @param {"recipe first" | "removal first"} order
 */
async function raceSaveAndRemoval(order) {
  const onion = await ingredients.create({
    name: "Onion",
    unit: "g",
    measures: [
      { name: "medium", amount: 150 },
      { name: "small", amount: 80 },
    ],
  });
  const [medium, small] = onion.measures;
  const soup = await recipes.create({ name: "Onion soup" });
  const save = () =>
    recipes.update(soup.id, {
      ingredients: [{ ingredientId: onion.id, measureId: medium.id, quantity: 2 }],
    });
  const removal = () => ingredients.update(onion.id, { measures: [small] });
  let saving;
  let removing;
  if (order === "recipe first") {
    saving = save();
    removing = removal();
  } else {
    removing = removal();
    saving = save();
  }
  const [saved, removed] = await Promise.allSettled([saving, removing]);
  return { medium, removed, saved };
}

/** Every measure that a recipe uses on disk still belongs to an ingredient of the catalog. */
async function assertNoMissingMeasure() {
  const measureIds = new Set(
    (await ingredients.list()).flatMap((ingredient) => ingredient.measures.map(({ id }) => id)),
  );
  const onDisk = JSON.parse(await readFile(recipesFile(), "utf8"));
  for (const line of onDisk.recipes.flatMap((recipe) => recipe.ingredients)) {
    if ("measureId" in line) assert.ok(measureIds.has(line.measureId), line.measureId);
  }
}

/** Writes a catalog with one ingredient in a measure, and a recipe book with a recipe that uses it and one whose measure is gone. */
async function writeStaleMeasure() {
  const onion = await ingredients.create({
    name: "Onion",
    unit: "g",
    measures: [{ name: "medium", amount: 150 }],
  });
  const good = { ingredientId: onion.id, measureId: onion.measures[0].id, quantity: 1 };
  const stale = { ingredientId: onion.id, measureId: "gone", quantity: 2 };
  await writeDataFile(
    dataDir(),
    RECIPES,
    JSON.stringify({
      recipes: [
        { id: "a", name: "Soup", archived: false, ingredients: [good] },
        { id: "b", name: "Stew", archived: false, ingredients: [stale] },
      ],
    }),
  );
  return { good, stale };
}

describe("recipe store", () => {
  describe("list", () => {
    test("returns an empty recipe book when there is no file", async () => {
      assert.deepEqual(await recipes.list(), []);
    });

    test("sorts recipes from A to Z by name key", async () => {
      for (const name of ["omelette", "Ñoquis", "Café", "banana"]) await recipes.create({ name });

      const names = (await recipes.list()).map((recipe) => recipe.name);
      assert.deepEqual(names, ["banana", "Café", "Ñoquis", "omelette"]);
    });

    test("drops an ingredient whose measureId the catalog doesn't have", async () => {
      const { good } = await writeStaleMeasure();

      const [soup, stew] = await recipes.list();

      assert.deepEqual(soup.ingredients, [good]);
      assert.deepEqual(stew.ingredients, []);
    });

    test("drops an ingredient that the catalog doesn't have", async () => {
      const onion = await ingredients.create({ name: "Onion", unit: "g" });
      await writeDataFile(
        dataDir(),
        RECIPES,
        JSON.stringify({
          recipes: [
            {
              id: "a",
              name: "Soup",
              archived: false,
              ingredients: [entry(onion.id, 100), entry("gone", 5)],
            },
          ],
        }),
      );

      assert.deepEqual(await recipes.list(), [
        { id: "a", name: "Soup", archived: false, ingredients: [entry(onion.id, 100)] },
      ]);
    });
  });

  describe("create", () => {
    test("stores a UUID, the cleaned name, and archived false", async () => {
      const recipe = await recipes.create({ name: "  Gnocchi   carbonara " });

      assert.match(recipe.id, UUID_V4);
      assert.deepEqual(recipe, {
        id: recipe.id,
        name: "Gnocchi carbonara",
        archived: false,
        ingredients: [],
      });
      assert.deepEqual(JSON.parse(await readFile(recipesFile(), "utf8")), { recipes: [recipe] });
      // A brand-new store over the same directory sees it too: it really is on disk.
      assert.deepEqual(await createStores({ dataDir: dataDir() }).recipes.list(), [recipe]);
    });

    test("rejects a taken name key, active or archived, and reports its holder", async () => {
      const cafe = await recipes.create({ name: "Café" });

      await assert.rejects(recipes.create({ name: "  cafe " }), {
        name: "NameConflictError",
        kind: "recipe",
        entity: cafe,
      });

      const archived = await recipes.update(cafe.id, { archived: true });
      await assert.rejects(recipes.create({ name: "CAFE" }), {
        name: "NameConflictError",
        kind: "recipe",
        entity: archived,
      });
      assert.equal((await recipes.list()).length, 1);
    });

    test("stores only one recipe for concurrent creates with one name key", async () => {
      const results = await Promise.allSettled([
        recipes.create({ name: "Soup" }),
        recipes.create({ name: "soup" }),
      ]);

      assert.deepEqual(
        results.map((result) => result.status),
        ["fulfilled", "rejected"],
      );
      assert.ok(
        /** @type {PromiseRejectedResult} */ (results[1]).reason instanceof NameConflictError,
      );
      assert.equal((await recipes.list()).length, 1);
    });

    test("stores the ingredients, with each quantity rounded to two decimals", async () => {
      const onion = await ingredients.create({ name: "Onion", unit: "g" });
      const egg = await ingredients.create({ name: "Egg", unit: "pcs" });

      const omelette = await recipes.create({
        name: "Omelette",
        ingredients: [entry(egg.id, 0.25), entry(onion.id, 0.1 * 3)], // 0.30000000000000004
      });

      assert.deepEqual(omelette.ingredients, [entry(egg.id, 0.25), entry(onion.id, 0.3)]);
      assert.deepEqual(await recipes.list(), [omelette]);
    });

    test("rejects an ingredient that isn't in the catalog, like update", async () => {
      await assert.rejects(recipes.create({ name: "Soup", ingredients: [entry("gone", 1)] }), {
        name: "ValidationError",
        message: "Unknown ingredient: gone",
      });
      const soup = await recipes.create({ name: "Soup" });
      await assert.rejects(recipes.update(soup.id, { ingredients: [entry("gone", 1)] }), {
        message: "Unknown ingredient: gone",
      });
    });

    test("stores the measureId of an ingredient in a measure", async () => {
      const onion = await ingredients.create({
        name: "Onion",
        unit: "g",
        measures: [{ name: "medium", amount: 150 }],
      });
      const inMeasure = { ingredientId: onion.id, measureId: onion.measures[0].id, quantity: 2 };

      const soup = await recipes.create({ name: "Soup", ingredients: [inMeasure] });

      assert.deepEqual(soup.ingredients, [inMeasure]);
      assert.deepEqual((await recipes.list())[0].ingredients, [inMeasure]);
    });

    test("rejects invalid fields, and stores nothing", async () => {
      await assert.rejects(recipes.create({ name: "Soup", archived: false }), ValidationError);

      assert.deepEqual(await recipes.list(), []);
    });

    test("rejects invalid ingredients, and stores nothing", async () => {
      await assert.rejects(recipes.create({ name: "Soup", ingredients: "Onion" }), {
        name: "ValidationError",
        message: '"ingredients" must be an array.',
      });

      assert.deepEqual(await recipes.list(), []);
    });

    test("rejects a measure that the ingredient doesn't have", async () => {
      const onion = await ingredients.create({ name: "Onion", unit: "g" });

      await assert.rejects(
        recipes.create({
          name: "Stew",
          ingredients: [{ ingredientId: onion.id, measureId: "gone", quantity: 1 }],
        }),
        { name: "ValidationError", message: "Unknown measure: gone" },
      );
    });
  });

  describe("update", () => {
    test("keeps the ID of a renamed recipe", async () => {
      const soup = await recipes.create({ name: "Soup" });

      const renamed = await recipes.update(soup.id, { name: " Tomato  soup " });

      assert.deepEqual(renamed, {
        id: soup.id,
        name: "Tomato soup",
        archived: false,
        ingredients: [],
      });
      assert.deepEqual(await recipes.list(), [renamed]);
    });

    test("accepts a new name with the recipe's own name key", async () => {
      const cafe = await recipes.create({ name: "Cafe" });
      assert.equal((await recipes.update(cafe.id, { name: "Café" })).name, "Café");
    });

    test("accepts a name equal to the recipe's exact current name", async () => {
      const soup = await recipes.create({ name: "Soup" });
      assert.deepEqual(await recipes.update(soup.id, { name: "Soup" }), soup);
    });

    test("rejects a name whose key another recipe has", async () => {
      const soup = await recipes.create({ name: "Soup" });
      const salad = await recipes.create({ name: "Salad" });

      await assert.rejects(recipes.update(salad.id, { name: "SOUP" }), {
        name: "NameConflictError",
        kind: "recipe",
        entity: soup,
      });
      assert.deepEqual(await recipes.list(), [salad, soup]);
    });

    test("archives and restores a recipe", async () => {
      const soup = await recipes.create({ name: "Soup" });

      assert.deepEqual(await recipes.update(soup.id, { archived: true }), {
        ...soup,
        archived: true,
      });
      assert.deepEqual(await recipes.list(), [{ ...soup, archived: true }]);
      assert.deepEqual(await recipes.update(soup.id, { archived: false }), soup);
    });

    test("rejects an unknown ID", async () => {
      await assert.rejects(recipes.update("no-such-id", { archived: true }), NotFoundError);
    });

    test("saves an archived ingredient that the recipe already has", async () => {
      const onion = await ingredients.create({ name: "Onion", unit: "g" });
      const soup = await recipes.create({ name: "Soup", ingredients: [entry(onion.id, 100)] });
      await ingredients.update(onion.id, { archived: true });

      const updated = await recipes.update(soup.id, { ingredients: [entry(onion.id, 120)] });

      assert.deepEqual(updated.ingredients, [entry(onion.id, 120)]);
      assert.deepEqual((await recipes.list())[0].ingredients, [entry(onion.id, 120)]);
    });

    test("changes the name and the ingredients together", async () => {
      const onion = await ingredients.create({ name: "Onion", unit: "g" });
      const soup = await recipes.create({ name: "Soup" });

      const updated = await recipes.update(soup.id, {
        name: "Onion soup",
        ingredients: [entry(onion.id, 200)],
      });

      assert.deepEqual(updated, {
        ...soup,
        name: "Onion soup",
        ingredients: [entry(onion.id, 200)],
      });
      assert.deepEqual(await recipes.list(), [updated]);
    });

    test("keeps another recipe's ingredients that the catalog doesn't have", async () => {
      await writeDataFile(
        dataDir(),
        RECIPES,
        JSON.stringify({
          recipes: [
            { id: "a", name: "Soup", archived: false, ingredients: [entry("gone", 5)] },
            { id: "b", name: "Tea", archived: false, ingredients: [] },
          ],
        }),
      );

      await recipes.update("b", { name: "Green tea" });

      const onDisk = JSON.parse(await readFile(recipesFile(), "utf8"));
      assert.deepEqual(onDisk.recipes[0].ingredients, [entry("gone", 5)]);
    });

    test("returns the recipe without the ingredients that the catalog lacks", async () => {
      const onion = await ingredients.create({ name: "Onion", unit: "g" });
      await writeDataFile(
        dataDir(),
        RECIPES,
        JSON.stringify({
          recipes: [
            {
              id: "a",
              name: "Soup",
              archived: false,
              ingredients: [entry(onion.id, 100), entry("gone", 5)],
            },
          ],
        }),
      );

      const renamed = await recipes.update("a", { name: "Onion soup" });
      const archived = await recipes.update("a", { archived: true });

      assert.deepEqual(renamed.ingredients, [entry(onion.id, 100)]);
      assert.deepEqual(archived.ingredients, [entry(onion.id, 100)]);
      // The file keeps the whole list, the same as for any other recipe.
      const onDisk = JSON.parse(await readFile(recipesFile(), "utf8"));
      assert.deepEqual(onDisk.recipes[0].ingredients, [entry(onion.id, 100), entry("gone", 5)]);
    });

    test("stores the measureId of an ingredient in a measure", async () => {
      const onion = await ingredients.create({
        name: "Onion",
        unit: "g",
        measures: [{ name: "medium", amount: 150 }],
      });
      const inMeasure = { ingredientId: onion.id, measureId: onion.measures[0].id, quantity: 2 };
      const soup = await recipes.create({ name: "Soup" });

      const updated = await recipes.update(soup.id, { ingredients: [inMeasure] });

      assert.deepEqual(updated.ingredients, [inMeasure]);
      assert.deepEqual((await recipes.list())[0].ingredients, [inMeasure]);
    });

    test("keeps an ingredient without a measureId in the unit", async () => {
      const onion = await ingredients.create({
        name: "Onion",
        unit: "g",
        measures: [{ name: "medium", amount: 150 }],
      });
      const inMeasure = { ingredientId: onion.id, measureId: onion.measures[0].id, quantity: 2 };
      const soup = await recipes.create({ name: "Soup", ingredients: [inMeasure] });

      const updated = await recipes.update(soup.id, { ingredients: [entry(onion.id, 100)] });

      assert.deepEqual(updated.ingredients, [entry(onion.id, 100)]);
      assert.equal("measureId" in updated.ingredients[0], false);
    });

    test("rejects a measure that a removal in the queue already dropped", async () => {
      const { medium, removed, saved } = await raceSaveAndRemoval("removal first");

      assert.equal(removed.status, "fulfilled");
      assert.equal(saved.status, "rejected");
      assert.equal(saved.reason.message, `Unknown measure: ${medium.id}`);
      await assertNoMissingMeasure();
    });

    test("makes a removal of its measure in the queue fail with a ConflictError", async () => {
      const { removed, saved } = await raceSaveAndRemoval("recipe first");

      assert.equal(saved.status, "fulfilled");
      assert.equal(removed.status, "rejected");
      assert.equal(removed.reason.name, "ConflictError");
      await assertNoMissingMeasure();
    });

    test("keeps in the file an ingredient whose measure the catalog lacks", async () => {
      const { stale } = await writeStaleMeasure();

      await recipes.update("a", { name: "Onion soup" });

      const onDisk = JSON.parse(await readFile(recipesFile(), "utf8"));
      assert.deepEqual(onDisk.recipes[1].ingredients, [stale]);
    });

    test("rejects invalid changes, and leaves the recipe unchanged", async () => {
      const soup = await recipes.create({ name: "Soup" });

      await assert.rejects(
        recipes.update(soup.id, { name: "Stew", archived: true }),
        ValidationError,
      );

      assert.deepEqual(await recipes.list(), [soup]);
    });

    test("rejects invalid ingredients, and leaves the recipe unchanged", async () => {
      const soup = await recipes.create({ name: "Soup" });

      await assert.rejects(recipes.update(soup.id, { ingredients: null }), {
        name: "ValidationError",
        message: '"ingredients" must be an array.',
      });

      assert.deepEqual(await recipes.list(), [soup]);
    });

    test("rejects a measure of another ingredient", async () => {
      const onion = await ingredients.create({ name: "Onion", unit: "g" });
      const egg = await ingredients.create({
        name: "Egg",
        unit: "pcs",
        measures: [{ name: "large", amount: 1 }],
      });
      const soup = await recipes.create({ name: "Soup" });
      const measureId = egg.measures[0].id;

      await assert.rejects(
        recipes.update(soup.id, {
          ingredients: [{ ingredientId: onion.id, measureId, quantity: 1 }],
        }),
        { name: "ValidationError", message: `Unknown measure: ${measureId}` },
      );
    });
  });

  test("fails reads and writes without overwriting a file with invalid JSON", async () => {
    await writeDataFile(dataDir(), RECIPES, "{ not json");

    await assert.rejects(recipes.list(), SyntaxError);
    await assert.rejects(recipes.create({ name: "Soup" }), SyntaxError);
    assert.equal(await readFile(recipesFile(), "utf8"), "{ not json");
  });

  test("fails reads and writes without overwriting a file of the wrong shape", async () => {
    for (const content of ['[{"id":"a","name":"Soup","archived":false}]', '{"recipes":"Soup"}']) {
      await writeDataFile(dataDir(), RECIPES, content);

      await assert.rejects(recipes.list(), Error, `list with ${content}`);
      await assert.rejects(recipes.create({ name: "Soup" }), Error, `create with ${content}`);
      assert.equal(await readFile(recipesFile(), "utf8"), content, `the file ${content}`);
    }
  });

  describe("usageOf", () => {
    test("reads every recipe, archived ones included", async () => {
      const onion = await ingredients.create({
        name: "Onion",
        unit: "g",
        measures: [{ name: "medium", amount: 150 }],
      });
      const [medium] = onion.measures;
      const soup = await recipes.create({
        name: "Soup",
        ingredients: [{ ingredientId: onion.id, measureId: medium.id, quantity: 1 }],
      });
      await recipes.update(soup.id, { archived: true });
      await recipes.create({ name: "Stew", ingredients: [entry(onion.id, 100)] });

      assert.deepEqual(await recipes.usageOf(onion.id), {
        inUnit: true,
        measureIds: new Set([medium.id]),
      });
    });
  });

  describe("moveUnitLinesToMeasure", () => {
    test("saves the moved ingredients of every recipe, archived ones included", async () => {
      const { medium, onion } = await onionInTwoRecipes();

      await recipes.moveUnitLinesToMeasure(onion.id, medium.id);

      const moved = (await recipes.list()).map((recipe) => recipe.ingredients);
      assert.deepEqual(moved, [
        [{ ingredientId: onion.id, measureId: medium.id, quantity: 100 }],
        [{ ingredientId: onion.id, measureId: medium.id, quantity: 50 }],
      ]);
    });

    test("returns how many ingredients it moved", async () => {
      const { medium, onion } = await onionInTwoRecipes();

      assert.equal(await recipes.moveUnitLinesToMeasure(onion.id, medium.id), 2);
      assert.equal(await recipes.moveUnitLinesToMeasure(onion.id, medium.id), 0);
    });
  });
});
