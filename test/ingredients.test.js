import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  ConflictError,
  NameConflictError,
  NotFoundError,
  ValidationError,
} from "../server/errors.js";
import { createQueue } from "../server/files.js";
import { createIngredients } from "../server/ingredients.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let dataDir;
let ingredients;
/** What the stubbed recipe book says about each ingredient ID. */
let usage;
/** The calls to the stubbed moveUnitLinesToMeasure, as [ingredientId, measureId]. */
let moves;
/** How many of the next calls to moveUnitLinesToMeasure reject. */
let failingMoves;

function ingredientsFile() {
  return path.join(dataDir, "v2", "ingredients.json");
}

function newIngredients() {
  return createIngredients({
    dataDir,
    enqueue: createQueue(),
    moveUnitLinesToMeasure: async (ingredientId, measureId) => {
      if (failingMoves > 0) {
        failingMoves -= 1;
        throw new Error("The recipes file can't be written.");
      }
      moves.push([ingredientId, measureId]);
      return 1;
    },
    usageOf: async (id) => usage.get(id) ?? { inUnit: false, measureIds: new Set() },
  });
}

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "meals-ingredients-"));
  usage = new Map();
  moves = [];
  failingMoves = 0;
  ingredients = newIngredients();
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

test("list returns an empty catalog when there is no file", async () => {
  assert.deepEqual(await ingredients.list(), []);
});

test("create stores an ingredient with a UUID, the cleaned name, the unit, and archived false", async () => {
  const onion = await ingredients.create({ name: "  Red   onion ", unit: "g" });

  assert.match(onion.id, UUID);
  assert.deepEqual(onion, {
    id: onion.id,
    name: "Red onion",
    unit: "g",
    measures: [],
    archived: false,
  });
  assert.deepEqual(JSON.parse(await readFile(ingredientsFile(), "utf8")), {
    ingredients: [onion],
  });
  // A brand-new store over the same directory sees it too: it really is on disk.
  assert.deepEqual(await newIngredients().list(), [onion]);
});

test("list sorts ingredients from A to Z by name key", async () => {
  for (const name of ["onion", "Ñora", "Egg", "almond"]) {
    await ingredients.create({ name, unit: "g" });
  }

  const names = (await ingredients.list()).map((ingredient) => ingredient.name);
  assert.deepEqual(names, ["almond", "Egg", "Ñora", "onion"]);
});

test("create rejects a name whose key is taken, active or archived, and reports that ingredient", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });

  await assert.rejects(ingredients.create({ name: " ONION ", unit: "pcs" }), (error) => {
    assert.ok(error instanceof NameConflictError);
    assert.equal(error.kind, "ingredient");
    assert.deepEqual(error.entity, onion);
    return true;
  });

  const archived = await ingredients.update(onion.id, { archived: true });
  await assert.rejects(ingredients.create({ name: "onion", unit: "g" }), (error) => {
    assert.deepEqual(/** @type {NameConflictError} */ (error).entity, archived);
    return true;
  });
  assert.equal((await ingredients.list()).length, 1);
});

test("update renames an ingredient, and accepts its own name key", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });

  const renamed = await ingredients.update(onion.id, { name: " Red  onion " });
  assert.deepEqual(renamed, { ...onion, name: "Red onion" });

  const cafe = await ingredients.create({ name: "Cafe", unit: "g" });
  assert.equal((await ingredients.update(cafe.id, { name: "Café" })).name, "Café");
});

test("update rejects a name whose key another ingredient has", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });
  const egg = await ingredients.create({ name: "Egg", unit: "pcs" });

  await assert.rejects(ingredients.update(egg.id, { name: "onion" }), (error) => {
    assert.ok(error instanceof NameConflictError);
    assert.deepEqual(error.entity, onion);
    return true;
  });
  assert.deepEqual(await ingredients.list(), [egg, onion]);
});

test("update accepts the current unit and renames an ingredient that a recipe uses", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });
  usage.set(onion.id, { inUnit: true, measureIds: new Set() });

  const renamed = await ingredients.update(onion.id, { name: "Red onion", unit: "g" });

  assert.deepEqual(renamed, { ...onion, name: "Red onion" });
});

test("update changes the name and the unit together", async () => {
  const milk = await ingredients.create({ name: "Milk", unit: "g" });

  const updated = await ingredients.update(milk.id, { name: "Whole milk", unit: "ml" });

  assert.deepEqual(updated, { ...milk, name: "Whole milk", unit: "ml" });
  assert.deepEqual(await ingredients.list(), [updated]);
});

test("update archives and restores an ingredient", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });

  assert.deepEqual(await ingredients.update(onion.id, { archived: true }), {
    ...onion,
    archived: true,
  });
  assert.deepEqual(await ingredients.update(onion.id, { archived: false }), onion);
});

test("update rejects an unknown ID", async () => {
  await assert.rejects(ingredients.update("no-such-id", { archived: true }), NotFoundError);
});

test("an ingredients file with invalid JSON or the wrong shape makes reads and writes fail without overwriting it", async () => {
  await mkdir(path.join(dataDir, "v2"), { recursive: true });
  for (const content of [
    "{ not json",
    '[{"id":"a","name":"Onion","unit":"g"}]',
    '{"ingredients":1}',
  ]) {
    await writeFile(ingredientsFile(), content);

    await assert.rejects(ingredients.list(), Error, `list with ${content}`);
    await assert.rejects(
      ingredients.create({ name: "Onion", unit: "g" }),
      Error,
      `create with ${content}`,
    );
    assert.equal(await readFile(ingredientsFile(), "utf8"), content, `the file ${content}`);
  }
});

test("create stores measures with new UUIDs, cleaned names, and rounded amounts", async () => {
  const onion = await ingredients.create({
    name: "Onion",
    unit: "g",
    measures: [
      { name: " medium ", amount: 150 },
      { name: "small", amount: 0.1 + 0.2 },
    ],
  });

  assert.equal(onion.measures.length, 2);
  assert.match(onion.measures[0].id, UUID);
  assert.deepEqual(onion.measures[0], { id: onion.measures[0].id, name: "medium", amount: 150 });
  assert.equal(onion.measures[1].amount, 0.3);
  assert.deepEqual(await ingredients.list(), [onion]);
});

test("create without measures stores an empty list", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });

  assert.deepEqual(onion.measures, []);
});

test("update replaces the measures, keeping sent IDs and giving new ones IDs", async () => {
  const onion = await ingredients.create({
    name: "Onion",
    unit: "g",
    measures: [
      { name: "small", amount: 80 },
      { name: "medium", amount: 150 },
    ],
  });
  const [small] = onion.measures;

  const updated = await ingredients.update(onion.id, {
    measures: [
      { id: small.id, name: "tiny", amount: 70 },
      { name: "large", amount: 220 },
    ],
  });

  assert.deepEqual(updated.measures[0], { id: small.id, name: "tiny", amount: 70 });
  assert.match(updated.measures[1].id, UUID);
  assert.notEqual(updated.measures[1].id, onion.measures[1].id);
  assert.equal(updated.measures[1].name, "large");
  assert.deepEqual(await ingredients.list(), [updated]);
});

test("update rejects a measure ID that isn't the ingredient's", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });
  const egg = await ingredients.create({
    name: "Egg",
    unit: "pcs",
    measures: [{ name: "large", amount: 2 }],
  });

  await assert.rejects(
    ingredients.update(onion.id, { measures: [{ ...egg.measures[0] }] }),
    ValidationError,
  );
  assert.deepEqual(
    (await ingredients.list()).find((entry) => entry.id === onion.id),
    onion,
  );
});

test("update that leaves out a measure a recipe uses throws a ConflictError naming it", async () => {
  const onion = await ingredients.create({
    name: "Onion",
    unit: "g",
    measures: [{ name: "medium", amount: 150 }],
  });
  usage.set(onion.id, { inUnit: false, measureIds: new Set([onion.measures[0].id]) });
  const before = await readFile(ingredientsFile(), "utf8");

  await assert.rejects(ingredients.update(onion.id, { measures: [] }), (error) => {
    assert.ok(error instanceof ConflictError);
    assert.match(error.message, /"medium"/);
    return true;
  });
  assert.equal(await readFile(ingredientsFile(), "utf8"), before);
});

test("update can send name, unit, and measures together", async () => {
  const milk = await ingredients.create({ name: "Milk", unit: "g" });

  const updated = await ingredients.update(milk.id, {
    name: "Whole milk",
    unit: "ml",
    measures: [{ name: "glass", amount: 250 }],
  });

  assert.equal(updated.name, "Whole milk");
  assert.equal(updated.unit, "ml");
  assert.deepEqual(updated.measures, [{ id: updated.measures[0].id, name: "glass", amount: 250 }]);
});

// ---------- Changing the unit ----------

/** Creates an ingredient, and says whether a recipe has it in its unit. */
async function inUse(fields, inUnit) {
  const ingredient = await ingredients.create(fields);
  usage.set(ingredient.id, { inUnit, measureIds: new Set() });
  return ingredient;
}

test("a unit change with no measures and no unit lines needs no conversion", async () => {
  const milk = await ingredients.create({ name: "Milk", unit: "g" });

  assert.deepEqual(await ingredients.update(milk.id, { unit: "ml" }), { ...milk, unit: "ml" });
  assert.deepEqual(moves, []);
});

test("pcs to g with 1 = 120 multiplies measures and turns unit lines into a measure", async () => {
  const carrot = await inUse(
    { name: "Carrot", unit: "pcs", measures: [{ name: "net", amount: 4 }] },
    true,
  );
  const [net] = carrot.measures;

  const updated = await ingredients.update(carrot.id, {
    name: "Orange carrot",
    unit: "g",
    conversion: { from: 1, to: 120, measureName: " piece " },
  });

  const piece = updated.measures[1];
  assert.match(piece.id, UUID);
  assert.deepEqual(updated, {
    ...carrot,
    name: "Orange carrot",
    unit: "g",
    measures: [
      { id: net.id, name: "net", amount: 480 },
      { id: piece.id, name: "piece", amount: 120 },
    ],
  });
  assert.deepEqual(moves, [[carrot.id, piece.id]]);
  assert.deepEqual(await ingredients.list(), [updated]);
});

test("150 g = 1 pcs converts with the factor to ÷ from", async () => {
  const onion = await inUse(
    {
      name: "Onion",
      unit: "g",
      measures: [
        { name: "medium", amount: 150 },
        { name: "large", amount: 250 },
      ],
    },
    false,
  );

  const updated = await ingredients.update(onion.id, {
    unit: "pcs",
    conversion: { from: 150, to: 1 },
  });

  assert.equal(updated.unit, "pcs");
  assert.deepEqual(updated.measures, [
    { ...onion.measures[0], amount: 1 },
    // 250 ÷ 150 is 1.666..., rounded to two decimals.
    { ...onion.measures[1], amount: 1.67 },
  ]);
  assert.deepEqual(moves, []);
});

test("a retry after a failed step 2 with the same measureName reuses the measure from step 1", async () => {
  const carrot = await inUse(
    { name: "Carrot", unit: "pcs", measures: [{ name: "net", amount: 4 }] },
    true,
  );
  failingMoves = 1;
  const changes = { unit: "g", conversion: { from: 1, to: 120, measureName: "piece" } };

  await assert.rejects(ingredients.update(carrot.id, changes), /can't be written/);
  const [, piece] = (await ingredients.list())[0].measures;
  assert.deepEqual(moves, []);

  const updated = await ingredients.update(carrot.id, changes);

  assert.equal(updated.unit, "g");
  assert.deepEqual(updated.measures, [
    { ...carrot.measures[0], amount: 480 },
    { ...piece, amount: 120 },
  ]);
  assert.deepEqual(moves, [[carrot.id, piece.id]]);
  assert.deepEqual(await ingredients.list(), [updated]);
});

describe("create", () => {
  test("rejects invalid fields, and stores nothing", async () => {
    await assert.rejects(ingredients.create({ name: "Onion", unit: "kg" }), ValidationError);

    assert.deepEqual(await ingredients.list(), []);
  });

  test("rejects invalid measures, and stores nothing", async () => {
    await assert.rejects(ingredients.create({ name: "Leek", unit: "g", measures: null }), {
      name: "ValidationError",
      message: '"measures" must be an array.',
    });

    assert.deepEqual(await ingredients.list(), []);
  });
});

describe("update", () => {
  /** A carrot in pcs that a recipe uses, whose change to g fails when it moves the recipe ingredients. */
  async function carrotWithFailedMove() {
    const carrot = await inUse(
      { name: "Carrot", unit: "pcs", measures: [{ name: "net", amount: 4 }] },
      true,
    );
    failingMoves = 1;
    await assert.rejects(
      ingredients.update(carrot.id, {
        unit: "g",
        conversion: { from: 1, to: 120, measureName: "piece" },
      }),
      /can't be written/,
    );
    return carrot;
  }

  test("keeps the unit and adds the measure when moving the ingredients fails", async () => {
    const carrot = await carrotWithFailedMove();

    const { ingredients: stored } = JSON.parse(await readFile(ingredientsFile(), "utf8"));
    const piece = stored[0].measures[1];
    assert.deepEqual(stored, [
      { ...carrot, measures: [...carrot.measures, { id: piece.id, name: "piece", amount: 1 }] },
    ]);
  });

  test("needs no measureName to retry after moving the ingredients failed", async () => {
    const carrot = await carrotWithFailedMove();
    const [, piece] = (await ingredients.list())[0].measures;
    usage.set(carrot.id, { inUnit: false, measureIds: new Set([piece.id]) });

    const updated = await ingredients.update(carrot.id, {
      unit: "g",
      conversion: { from: 1, to: 120 },
    });

    assert.equal(updated.unit, "g");
    assert.deepEqual(updated.measures, [
      { ...carrot.measures[0], amount: 480 },
      { ...piece, amount: 120 },
    ]);
    assert.deepEqual(moves, []);
  });

  test("rejects an invalid change, and leaves the ingredient unchanged", async () => {
    const onion = await ingredients.create({ name: "Onion", unit: "g" });

    await assert.rejects(ingredients.update(onion.id, { unit: "kg" }), ValidationError);

    assert.deepEqual(await ingredients.list(), [onion]);
  });

  test("rejects a unit change without a conversion when measures exist", async () => {
    const onion = await inUse(
      { name: "Onion", unit: "g", measures: [{ name: "medium", amount: 150 }] },
      false,
    );
    const before = await readFile(ingredientsFile(), "utf8");

    await assert.rejects(ingredients.update(onion.id, { unit: "pcs" }), {
      name: "ValidationError",
      message: '"Onion" has measures or recipes in g. Reload the page to change its unit.',
    });

    assert.equal(await readFile(ingredientsFile(), "utf8"), before);
  });

  test("says to save the measures first when the unit change sends measures", async () => {
    const onion = await inUse(
      { name: "Onion", unit: "g", measures: [{ name: "medium", amount: 150 }] },
      false,
    );
    const before = await readFile(ingredientsFile(), "utf8");

    await assert.rejects(ingredients.update(onion.id, { unit: "pcs", measures: [] }), {
      name: "ValidationError",
      message:
        'To change the unit of "Onion", save your measure changes first, and then change the unit.',
    });

    assert.equal(await readFile(ingredientsFile(), "utf8"), before);
  });

  test("rejects a unit change without a conversion when a recipe uses the unit", async () => {
    const egg = await inUse({ name: "Egg", unit: "pcs" }, true);
    const before = await readFile(ingredientsFile(), "utf8");

    await assert.rejects(ingredients.update(egg.id, { unit: "g" }), {
      name: "ValidationError",
      message: '"Egg" has measures or recipes in pcs. Reload the page to change its unit.',
    });

    assert.equal(await readFile(ingredientsFile(), "utf8"), before);
  });

  test("rejects a conversion without a unit change", async () => {
    const onion = await inUse({ name: "Onion", unit: "g" }, true);
    const before = await readFile(ingredientsFile(), "utf8");

    await assert.rejects(
      ingredients.update(onion.id, { unit: "g", conversion: { from: 1, to: 1, measureName: "g" } }),
      ValidationError,
    );

    assert.equal(await readFile(ingredientsFile(), "utf8"), before);
    assert.deepEqual(moves, []);
  });

  test("rejects a conversion when no measure or recipe needs it", async () => {
    const milk = await ingredients.create({ name: "Milk", unit: "g" });
    const before = await readFile(ingredientsFile(), "utf8");

    await assert.rejects(
      ingredients.update(milk.id, { unit: "ml", conversion: { from: 1, to: 1, measureName: "g" } }),
      ValidationError,
    );

    assert.equal(await readFile(ingredientsFile(), "utf8"), before);
    assert.deepEqual(moves, []);
  });

  test("rejects a converted amount outside the limits, and writes nothing", async () => {
    const onion = await inUse(
      { name: "Onion", unit: "g", measures: [{ name: "medium", amount: 150 }] },
      true,
    );
    const before = await readFile(ingredientsFile(), "utf8");

    await assert.rejects(
      ingredients.update(onion.id, {
        unit: "pcs",
        conversion: { from: 150, to: 1, measureName: "g" },
      }),
      {
        name: "ValidationError",
        message:
          '"g" would be 0.006667 pcs, outside 0.01 to 10000. To change the unit, first change the recipes that use "Onion" in g to a measure.',
      },
    );

    assert.equal(await readFile(ingredientsFile(), "utf8"), before);
    assert.deepEqual(moves, []);
  });

  test("rejects a conversion without measureName, and writes nothing", async () => {
    const carrot = await inUse({ name: "Carrot", unit: "pcs" }, true);
    const before = await readFile(ingredientsFile(), "utf8");

    await assert.rejects(
      ingredients.update(carrot.id, { unit: "g", conversion: { from: 1, to: 120 } }),
      ValidationError,
    );

    assert.equal(await readFile(ingredientsFile(), "utf8"), before);
    assert.deepEqual(moves, []);
  });
});
