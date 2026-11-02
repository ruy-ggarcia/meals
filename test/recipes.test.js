import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { NameConflictError, NotFoundError, ValidationError } from "../server/errors.js";
import { createStores } from "../server/stores.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let dataDir;
let ingredients;
let recipes;

function recipesFile() {
  return path.join(dataDir, "v2", "recipes.json");
}

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "meals-recipes-"));
  ({ ingredients, recipes } = createStores({ dataDir }));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

test("list returns an empty recipe book when there is no file", async () => {
  assert.deepEqual(await recipes.list(), []);
});

test("create stores a recipe with a UUID, the cleaned name, and archived false", async () => {
  const recipe = await recipes.create({ name: "  Gnocchi   carbonara " });

  assert.match(recipe.id, UUID);
  assert.deepEqual(recipe, {
    id: recipe.id,
    name: "Gnocchi carbonara",
    archived: false,
    ingredients: [],
  });
  assert.deepEqual(JSON.parse(await readFile(recipesFile(), "utf8")), { recipes: [recipe] });
  // A brand-new store over the same directory sees it too: it really is on disk.
  assert.deepEqual(await createStores({ dataDir }).recipes.list(), [recipe]);
});

test("list sorts recipes from A to Z by name key", async () => {
  for (const name of ["omelette", "Ñoquis", "Café", "banana"]) await recipes.create({ name });

  const names = (await recipes.list()).map((recipe) => recipe.name);
  assert.deepEqual(names, ["banana", "Café", "Ñoquis", "omelette"]);
});

test("create rejects a name whose key is taken, active or archived, and reports that recipe", async () => {
  const cafe = await recipes.create({ name: "Café" });

  await assert.rejects(recipes.create({ name: "  cafe " }), (error) => {
    assert.ok(error instanceof NameConflictError);
    assert.equal(error.kind, "recipe");
    assert.deepEqual(error.entity, cafe);
    return true;
  });

  const archived = await recipes.update(cafe.id, { archived: true });
  await assert.rejects(recipes.create({ name: "CAFE" }), (error) => {
    assert.ok(error instanceof NameConflictError);
    assert.equal(error.kind, "recipe");
    assert.deepEqual(error.entity, archived);
    return true;
  });
  assert.equal((await recipes.list()).length, 1);
});

test("concurrent creates with the same name key store only one recipe", async () => {
  const results = await Promise.allSettled([
    recipes.create({ name: "Soup" }),
    recipes.create({ name: "soup" }),
  ]);

  assert.deepEqual(
    results.map((result) => result.status),
    ["fulfilled", "rejected"],
  );
  assert.ok(/** @type {PromiseRejectedResult} */ (results[1]).reason instanceof NameConflictError);
  assert.equal((await recipes.list()).length, 1);
});

test("update renames a recipe and keeps its ID", async () => {
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

test("update accepts a new name with the recipe's own name key", async () => {
  const cafe = await recipes.create({ name: "Cafe" });
  assert.equal((await recipes.update(cafe.id, { name: "Café" })).name, "Café");
});

test("update accepts a name equal to the recipe's exact current name", async () => {
  const soup = await recipes.create({ name: "Soup" });
  assert.deepEqual(await recipes.update(soup.id, { name: "Soup" }), soup);
});

test("update rejects a name whose key another recipe has", async () => {
  const soup = await recipes.create({ name: "Soup" });
  const salad = await recipes.create({ name: "Salad" });

  await assert.rejects(recipes.update(salad.id, { name: "SOUP" }), (error) => {
    assert.ok(error instanceof NameConflictError);
    assert.equal(error.kind, "recipe");
    assert.deepEqual(error.entity, soup);
    return true;
  });
  assert.deepEqual(await recipes.list(), [salad, soup]);
});

test("update archives and restores a recipe", async () => {
  const soup = await recipes.create({ name: "Soup" });

  assert.deepEqual(await recipes.update(soup.id, { archived: true }), { ...soup, archived: true });
  assert.deepEqual(await recipes.list(), [{ ...soup, archived: true }]);
  assert.deepEqual(await recipes.update(soup.id, { archived: false }), soup);
});

test("update rejects an unknown ID", async () => {
  await assert.rejects(recipes.update("no-such-id", { archived: true }), NotFoundError);
});

test("a recipes file with invalid JSON makes reads and writes fail without overwriting it", async () => {
  await mkdir(path.join(dataDir, "v2"), { recursive: true });
  await writeFile(recipesFile(), "{ not json");

  await assert.rejects(recipes.list(), SyntaxError);
  await assert.rejects(recipes.create({ name: "Soup" }), SyntaxError);
  assert.equal(await readFile(recipesFile(), "utf8"), "{ not json");
});

test("a recipes file that is valid JSON but the wrong shape makes reads and writes fail without overwriting it", async () => {
  await mkdir(path.join(dataDir, "v2"), { recursive: true });
  for (const content of ['[{"id":"a","name":"Soup","archived":false}]', '{"recipes":"Soup"}']) {
    await writeFile(recipesFile(), content);

    await assert.rejects(recipes.list(), Error);
    await assert.rejects(recipes.create({ name: "Soup" }), Error);
    assert.equal(await readFile(recipesFile(), "utf8"), content);
  }
});

// ---------- Ingredients ----------

function entry(ingredientId, quantity) {
  return { ingredientId, quantity };
}

test("create stores the ingredients, each quantity rounded to two decimals", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });
  const egg = await ingredients.create({ name: "Egg", unit: "pcs" });

  const omelette = await recipes.create({
    name: "Omelette",
    ingredients: [entry(egg.id, 0.25), entry(onion.id, 0.1 * 3)], // 0.30000000000000004
  });

  assert.deepEqual(omelette.ingredients, [entry(egg.id, 0.25), entry(onion.id, 0.3)]);
  assert.deepEqual(await recipes.list(), [omelette]);
});

test("create and update reject an ingredient that isn't in the catalog", async () => {
  await assert.rejects(recipes.create({ name: "Soup", ingredients: [entry("gone", 1)] }), {
    name: "ValidationError",
    message: "Unknown ingredient: gone",
  });
  const soup = await recipes.create({ name: "Soup" });
  await assert.rejects(recipes.update(soup.id, { ingredients: [entry("gone", 1)] }), {
    message: "Unknown ingredient: gone",
  });
});

test("a recipe keeps and saves an archived ingredient", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });
  const soup = await recipes.create({ name: "Soup", ingredients: [entry(onion.id, 100)] });
  await ingredients.update(onion.id, { archived: true });

  const updated = await recipes.update(soup.id, { ingredients: [entry(onion.id, 120)] });

  assert.deepEqual(updated.ingredients, [entry(onion.id, 120)]);
  assert.deepEqual((await recipes.list())[0].ingredients, [entry(onion.id, 120)]);
});

test("update changes the name and the ingredients together", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });
  const soup = await recipes.create({ name: "Soup" });

  const updated = await recipes.update(soup.id, {
    name: "Onion soup",
    ingredients: [entry(onion.id, 200)],
  });

  assert.deepEqual(updated, { ...soup, name: "Onion soup", ingredients: [entry(onion.id, 200)] });
  assert.deepEqual(await recipes.list(), [updated]);
});

test("saving one recipe keeps another recipe's ingredients that the catalog doesn't have", async () => {
  await mkdir(path.join(dataDir, "v2"), { recursive: true });
  await writeFile(
    recipesFile(),
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

test("update returns the recipe without the ingredients that the catalog doesn't have", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });
  await writeFile(
    recipesFile(),
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

test("create and update store measureId, and keep lines without it in the unit", async () => {
  const onion = await ingredients.create({
    name: "Onion",
    unit: "g",
    measures: [{ name: "medium", amount: 150 }],
  });
  const inMeasure = { ingredientId: onion.id, measureId: onion.measures[0].id, quantity: 2 };

  const soup = await recipes.create({ name: "Soup", ingredients: [inMeasure] });
  assert.deepEqual(soup.ingredients, [inMeasure]);

  const inUnit = await recipes.update(soup.id, { ingredients: [entry(onion.id, 100)] });
  assert.deepEqual(inUnit.ingredients, [entry(onion.id, 100)]);
  assert.equal("measureId" in inUnit.ingredients[0], false);

  const back = await recipes.update(soup.id, { ingredients: [inMeasure] });
  assert.deepEqual(back.ingredients, [inMeasure]);
  assert.deepEqual((await recipes.list())[0].ingredients, [inMeasure]);
});

test("a recipe save that uses a measure and a removal of that measure never both succeed", async () => {
  for (const recipeFirst of [true, false]) {
    const onion = await ingredients.create({
      name: recipeFirst ? "Onion" : "Leek",
      unit: "g",
      measures: [
        { name: "medium", amount: 150 },
        { name: "small", amount: 80 },
      ],
    });
    const [medium, small] = onion.measures;
    const soup = await recipes.create({ name: `${onion.name} soup` });
    const useMedium = () =>
      recipes.update(soup.id, {
        ingredients: [{ ingredientId: onion.id, measureId: medium.id, quantity: 2 }],
      });
    const removeMedium = () => ingredients.update(onion.id, { measures: [small] });

    // Both start before either is awaited, so they meet in the shared queue.
    const results = await Promise.allSettled(
      recipeFirst ? [useMedium(), removeMedium()] : [removeMedium(), useMedium()],
    );

    const failures = results.filter((result) => result.status === "rejected");
    assert.equal(failures.length, 1, `recipe first: ${recipeFirst}`);
    if (recipeFirst) {
      assert.equal(failures[0].reason.name, "ConflictError");
    } else {
      assert.equal(failures[0].reason.message, `Unknown measure: ${medium.id}`);
    }
    const measureIds = new Set(
      (await ingredients.list()).flatMap((ingredient) => ingredient.measures.map(({ id }) => id)),
    );
    const onDisk = JSON.parse(await readFile(recipesFile(), "utf8"));
    for (const line of onDisk.recipes.flatMap((recipe) => recipe.ingredients)) {
      if ("measureId" in line) assert.ok(measureIds.has(line.measureId), line.measureId);
    }
  }
});

test("list drops a line whose measureId the catalog doesn't have, and keeps it in the file", async () => {
  const onion = await ingredients.create({
    name: "Onion",
    unit: "g",
    measures: [{ name: "medium", amount: 150 }],
  });
  const good = { ingredientId: onion.id, measureId: onion.measures[0].id, quantity: 1 };
  const stale = { ingredientId: onion.id, measureId: "gone", quantity: 2 };
  await writeFile(
    recipesFile(),
    JSON.stringify({
      recipes: [
        { id: "a", name: "Soup", archived: false, ingredients: [good] },
        { id: "b", name: "Stew", archived: false, ingredients: [stale] },
      ],
    }),
  );

  const [soup, stew] = await recipes.list();

  assert.deepEqual(soup.ingredients, [good]);
  assert.deepEqual(stew.ingredients, []);
  await recipes.update("a", { name: "Onion soup" });
  const onDisk = JSON.parse(await readFile(recipesFile(), "utf8"));
  assert.deepEqual(onDisk.recipes[1].ingredients, [stale]);
});

test("the catalog changes the unit of an ingredient that a recipe uses only with a conversion", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });
  const milk = await ingredients.create({ name: "Milk", unit: "g" });
  await recipes.create({ name: "Soup", ingredients: [entry(onion.id, 100)] });

  await assert.rejects(ingredients.update(onion.id, { unit: "pcs" }), ValidationError);
  const updated = await ingredients.update(onion.id, {
    unit: "pcs",
    conversion: { from: 100, to: 1, measureName: "portion" },
  });
  assert.deepEqual((await recipes.list())[0].ingredients, [
    { ...entry(onion.id, 100), measureId: updated.measures[0].id },
  ]);
  assert.equal((await ingredients.update(milk.id, { unit: "ml" })).unit, "ml");
});

describe("create", () => {
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

describe("list", () => {
  test("drops an ingredient that the catalog doesn't have", async () => {
    const onion = await ingredients.create({ name: "Onion", unit: "g" });
    await mkdir(path.join(dataDir, "v2"), { recursive: true });
    await writeFile(
      recipesFile(),
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
