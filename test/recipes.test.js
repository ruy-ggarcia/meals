import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  ConflictError,
  NameConflictError,
  NotFoundError,
  ValidationError,
} from "../server/errors.js";
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

test("create rejects a name that isn't a string, is blank, or is too long", async () => {
  for (const name of [undefined, null, 42, ["Soup"], "", "   \n "]) {
    await assert.rejects(recipes.create({ name }), ValidationError, String(name));
  }
  await assert.rejects(recipes.create({ name: "x".repeat(101) }), ValidationError);

  // The limit counts the cleaned name.
  assert.equal((await recipes.create({ name: ` ${"x".repeat(100)} ` })).name, "x".repeat(100));
  assert.equal((await recipes.list()).length, 1);
});

test("create reports blank and too long names with readable messages", async () => {
  await assert.rejects(recipes.create({ name: " " }), { message: "The name can't be empty." });
  await assert.rejects(recipes.create({ name: "x".repeat(101) }), {
    message: "The name must be at most 100 characters.",
  });
});

test("create counts the name length in UTF-16 code units, so a surrogate pair counts as 2", async () => {
  // U+1F600 is a surrogate pair in UTF-16, so its .length is 2, not 1.
  const tooLong = `${"x".repeat(99)}😀`;
  assert.equal(tooLong.length, 101);
  await assert.rejects(recipes.create({ name: tooLong }), {
    message: "The name must be at most 100 characters.",
  });

  const justRight = `${"x".repeat(98)}😀`;
  assert.equal(justRight.length, 100);
  assert.equal((await recipes.create({ name: justRight })).name, justRight);
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
  assert.ok(results[1].reason instanceof NameConflictError);
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

test("update rejects changes that aren't a valid shape", async () => {
  const soup = await recipes.create({ name: "Soup" });
  const invalid = [
    undefined,
    null,
    "Soup",
    [],
    {},
    { name: "Stew", archived: true },
    { color: "red" },
    { archived: "yes" },
    { archived: null },
    { name: "" },
    { name: 42 },
    { name: "x".repeat(101) },
  ];

  for (const changes of invalid) {
    await assert.rejects(recipes.update(soup.id, changes), ValidationError, String(changes));
  }
  assert.deepEqual(await recipes.list(), [soup]);
});

test("update rejects an unknown ID", async () => {
  await assert.rejects(recipes.update("no-such-id", { archived: true }), NotFoundError);
});

test("list skips malformed entries in the file", async () => {
  await mkdir(path.join(dataDir, "v2"), { recursive: true });
  await writeFile(
    recipesFile(),
    JSON.stringify({
      recipes: [
        { id: "a", name: "Soup", archived: true },
        { id: "b", name: "Salad" }, // archived missing -> false
        { id: 3, name: "Bad ID" },
        { id: "c" },
        null,
        "Tea",
      ],
    }),
  );

  assert.deepEqual(await recipes.list(), [
    { id: "b", name: "Salad", archived: false, ingredients: [] },
    { id: "a", name: "Soup", archived: true, ingredients: [] },
  ]);
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

test("create rejects fields that aren't a name with optional ingredients", async () => {
  for (const fields of [undefined, null, "Soup", [], { name: "Soup", archived: false }]) {
    await assert.rejects(recipes.create(fields), ValidationError, JSON.stringify(fields));
  }
  assert.deepEqual(await recipes.list(), []);
});

test("create and update reject ingredients that break the rules", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });
  const invalid = [
    "Onion",
    null,
    {},
    [entry(onion.id, 1), entry(onion.id, 2)],
    [{ ingredientId: onion.id }],
    [{ ...entry(onion.id, 1), note: "chopped" }],
    [entry(42, 1)],
    ...[0, 0.001, 0.005, 1.255, 10000.01, -1, "1", Number.NaN, Number.POSITIVE_INFINITY, null].map(
      (quantity) => [entry(onion.id, quantity)],
    ),
    Array.from({ length: 51 }, (_, index) => entry(`id-${index}`, 1)),
  ];

  for (const list of invalid) {
    await assert.rejects(
      recipes.create({ name: "Soup", ingredients: list }),
      ValidationError,
      String(JSON.stringify(list)),
    );
  }
  const soup = await recipes.create({ name: "Soup" });
  for (const list of invalid) {
    await assert.rejects(recipes.update(soup.id, { ingredients: list }), ValidationError);
  }
  assert.deepEqual(await recipes.list(), [soup]);
});

test("a quantity with three decimals names the quantity rule", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });

  await assert.rejects(recipes.create({ name: "Soup", ingredients: [entry(onion.id, 0.125)] }), {
    name: "ValidationError",
    message: "ingredients[0].quantity must be from 0.01 to 10000, with at most two decimals.",
  });
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

test("a recipe accepts the limits: 50 ingredients, 0.01, and 10000", async () => {
  const many = [];
  for (let index = 0; index < 50; index += 1) {
    many.push(await ingredients.create({ name: `Ingredient ${index}`, unit: "g" }));
  }
  const list = many.map((ingredient, index) => entry(ingredient.id, index === 0 ? 0.01 : 10000));

  const big = await recipes.create({ name: "Big", ingredients: list });

  assert.deepEqual(big.ingredients, list);
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

test("update rejects archived together with other fields", async () => {
  const soup = await recipes.create({ name: "Soup" });

  for (const changes of [
    { archived: true, ingredients: [] },
    { archived: true, name: "Stew" },
    { name: "Stew", color: "red" },
  ]) {
    await assert.rejects(recipes.update(soup.id, changes), ValidationError);
  }
});

test("list drops ingredients the catalog doesn't have, and reads a recipe without a list as empty", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });
  await writeFile(
    recipesFile(),
    JSON.stringify({
      recipes: [
        {
          id: "a",
          name: "Soup",
          archived: false,
          ingredients: [
            entry(onion.id, 100),
            entry("gone", 5), // not in the catalog
            entry(onion.id, 7), // repeated
            entry("bad", 1.255), // three decimals
            "Salt",
          ],
        },
        { id: "b", name: "Tea", archived: false },
      ],
    }),
  );

  assert.deepEqual(await recipes.list(), [
    { id: "a", name: "Soup", archived: false, ingredients: [entry(onion.id, 100)] },
    { id: "b", name: "Tea", archived: false, ingredients: [] },
  ]);
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

test("usageOf reports lines in the unit and the measures used, archived recipes included", async () => {
  const onion = await ingredients.create({
    name: "Onion",
    unit: "g",
    measures: [
      { name: "medium", amount: 150 },
      { name: "small", amount: 80 },
    ],
  });
  const egg = await ingredients.create({ name: "Egg", unit: "pcs" });
  const [medium, small] = onion.measures;
  const soup = await recipes.create({
    name: "Soup",
    ingredients: [{ ingredientId: onion.id, measureId: medium.id, quantity: 1 }],
  });
  await recipes.update(soup.id, { archived: true });

  assert.deepEqual(await recipes.usageOf(onion.id), {
    inUnit: false,
    measureIds: new Set([medium.id]),
  });
  assert.equal((await recipes.usageOf(onion.id)).measureIds.has(small.id), false);
  assert.deepEqual(await recipes.usageOf(egg.id), { inUnit: false, measureIds: new Set() });

  await recipes.create({ name: "Stew", ingredients: [entry(onion.id, 100)] });
  assert.equal((await recipes.usageOf(onion.id)).inUnit, true);
});

test("moveUnitLinesToMeasure points only that ingredient's unit lines to the measure, in every recipe", async () => {
  const onion = await ingredients.create({
    name: "Onion",
    unit: "g",
    measures: [{ name: "medium", amount: 150 }],
  });
  const egg = await ingredients.create({ name: "Egg", unit: "pcs" });
  const [medium] = onion.measures;
  await recipes.create({ name: "Soup", ingredients: [entry(onion.id, 100), entry(egg.id, 2)] });
  const stew = await recipes.create({ name: "Stew", ingredients: [entry(onion.id, 50)] });
  await recipes.update(stew.id, { archived: true });
  await recipes.create({ name: "Tea" });

  assert.equal(await recipes.moveUnitLinesToMeasure(onion.id, medium.id), 2);

  const byName = Object.fromEntries((await recipes.list()).map((recipe) => [recipe.name, recipe]));
  assert.deepEqual(byName.Soup.ingredients, [
    { ingredientId: onion.id, measureId: medium.id, quantity: 100 },
    entry(egg.id, 2),
  ]);
  assert.deepEqual(byName.Stew.ingredients, [
    { ingredientId: onion.id, measureId: medium.id, quantity: 50 },
  ]);
  assert.deepEqual(byName.Tea.ingredients, []);
  // Nothing is left to move, so a second run changes nothing.
  assert.equal(await recipes.moveUnitLinesToMeasure(onion.id, medium.id), 0);
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

test("a measureId that isn't a measure of its ingredient is rejected", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });
  const egg = await ingredients.create({
    name: "Egg",
    unit: "pcs",
    measures: [{ name: "large", amount: 1 }],
  });
  const line = (measureId) => ({ ingredientId: onion.id, measureId, quantity: 1 });
  const soup = await recipes.create({ name: "Soup" });

  await assert.rejects(recipes.create({ name: "Stew", ingredients: [line("gone")] }), {
    name: "ValidationError",
    message: "Unknown measure: gone",
  });
  // A measure of another ingredient doesn't count.
  await assert.rejects(recipes.update(soup.id, { ingredients: [line(egg.measures[0].id)] }), {
    name: "ValidationError",
    message: `Unknown measure: ${egg.measures[0].id}`,
  });
  await assert.rejects(recipes.update(soup.id, { ingredients: [line(5)] }), ValidationError);
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
      assert.ok(failures[0].reason instanceof ConflictError);
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

test("an ingredient still appears once, even in two different measures", async () => {
  const onion = await ingredients.create({
    name: "Onion",
    unit: "g",
    measures: [
      { name: "medium", amount: 150 },
      { name: "small", amount: 80 },
    ],
  });
  const [medium, small] = onion.measures;

  await assert.rejects(
    recipes.create({
      name: "Soup",
      ingredients: [
        { ingredientId: onion.id, measureId: medium.id, quantity: 1 },
        { ingredientId: onion.id, measureId: small.id, quantity: 1 },
      ],
    }),
    ValidationError,
  );
});

test("a line with measureId and other extra keys is rejected", async () => {
  const onion = await ingredients.create({
    name: "Onion",
    unit: "g",
    measures: [{ name: "medium", amount: 150 }],
  });
  const line = { ingredientId: onion.id, measureId: onion.measures[0].id, quantity: 1 };

  for (const bad of [
    { ...line, note: "x" },
    { ingredientId: onion.id, measureId: line.measureId },
  ]) {
    await assert.rejects(recipes.create({ name: "Soup", ingredients: [bad] }), ValidationError);
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

test("a stored line whose measureId isn't a string is dropped, and a line without one stays in the unit", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });
  const leek = await ingredients.create({ name: "Leek", unit: "g" });
  const garlic = await ingredients.create({ name: "Garlic", unit: "g" });
  await writeFile(
    recipesFile(),
    JSON.stringify({
      recipes: [
        {
          id: "a",
          name: "Soup",
          archived: false,
          ingredients: [
            { ingredientId: onion.id, quantity: 1 },
            { ingredientId: leek.id, measureId: 5, quantity: 2 },
            { ingredientId: garlic.id, measureId: null, quantity: 3 },
          ],
        },
      ],
    }),
  );

  assert.deepEqual((await recipes.list())[0].ingredients, [entry(onion.id, 1)]);
  assert.equal((await recipes.usageOf(leek.id)).inUnit, false);
  assert.equal((await recipes.usageOf(garlic.id)).inUnit, false);
});

test("the catalog refuses a new unit for an ingredient that a recipe uses", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });
  const milk = await ingredients.create({ name: "Milk", unit: "g" });
  await recipes.create({ name: "Soup", ingredients: [entry(onion.id, 100)] });

  await assert.rejects(ingredients.update(onion.id, { unit: "pcs" }), ConflictError);
  assert.equal((await ingredients.update(milk.id, { unit: "ml" })).unit, "ml");
});
