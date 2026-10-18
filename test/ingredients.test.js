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
import { createQueue } from "../server/files.js";
import { createIngredients } from "../server/ingredients.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let dataDir;
let ingredients;
/** What the stubbed recipe book says about each ingredient ID. */
let usage;

function ingredientsFile() {
  return path.join(dataDir, "v2", "ingredients.json");
}

function newIngredients() {
  return createIngredients({
    dataDir,
    enqueue: createQueue(),
    usageOf: async (id) => usage.get(id) ?? { inUnit: false, measureIds: new Set() },
  });
}

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "meals-ingredients-"));
  usage = new Map();
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

test("create rejects fields that aren't exactly a valid name and unit", async () => {
  const invalid = [
    undefined,
    null,
    "Onion",
    [],
    {},
    { name: "Onion" },
    { unit: "g" },
    { name: "Onion", unit: "kg" },
    { name: "Onion", unit: "G" },
    { name: "Onion", unit: "g", archived: false },
    { name: "", unit: "g" },
    { name: 42, unit: "g" },
    { name: "x".repeat(101), unit: "g" },
  ];

  for (const fields of invalid) {
    await assert.rejects(ingredients.create(fields), ValidationError, JSON.stringify(fields));
  }
  assert.deepEqual(await ingredients.list(), []);
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
    assert.deepEqual(error.entity, archived);
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

test("update changes the unit of an ingredient that no recipe uses", async () => {
  const milk = await ingredients.create({ name: "Milk", unit: "g" });

  assert.deepEqual(await ingredients.update(milk.id, { unit: "ml" }), { ...milk, unit: "ml" });
});

test("update rejects a new unit for an ingredient that a recipe uses, and changes nothing", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });
  usage.set(onion.id, { inUnit: true, measureIds: new Set() });

  await assert.rejects(ingredients.update(onion.id, { unit: "pcs" }), (error) => {
    assert.ok(error instanceof ConflictError);
    assert.equal(
      error.message,
      '"Onion" is used in recipes. To change its unit, remove it from those recipes first.',
    );
    return true;
  });
  await assert.rejects(
    ingredients.update(onion.id, { name: "Red onion", unit: "pcs" }),
    ConflictError,
  );
  assert.deepEqual(await ingredients.list(), [onion]);
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

test("update rejects changes that aren't a valid shape", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });
  const invalid = [
    undefined,
    null,
    "Onion",
    [],
    {},
    { archived: true, name: "Leek" },
    { archived: true, unit: "g" },
    { color: "red" },
    { name: "Leek", color: "red" },
    { archived: "yes" },
    { unit: "kg" },
    { name: "" },
  ];

  for (const changes of invalid) {
    await assert.rejects(
      ingredients.update(onion.id, changes),
      ValidationError,
      JSON.stringify(changes),
    );
  }
  assert.deepEqual(await ingredients.list(), [onion]);
});

test("update rejects an unknown ID", async () => {
  await assert.rejects(ingredients.update("no-such-id", { archived: true }), NotFoundError);
});

test("list skips malformed entries in the file", async () => {
  await mkdir(path.join(dataDir, "v2"), { recursive: true });
  await writeFile(
    ingredientsFile(),
    JSON.stringify({
      ingredients: [
        { id: "a", name: "Onion", unit: "g", archived: true },
        { id: "b", name: "Egg", unit: "pcs" }, // archived missing -> false
        { id: "c", name: "Flour", unit: "kg" }, // unknown unit
        { id: "d", name: "Salt" }, // no unit
        { id: 5, name: "Bad ID", unit: "g" },
        null,
        "Milk",
      ],
    }),
  );

  assert.deepEqual(await ingredients.list(), [
    { id: "b", name: "Egg", unit: "pcs", measures: [], archived: false },
    { id: "a", name: "Onion", unit: "g", measures: [], archived: true },
  ]);
});

test("an ingredients file with invalid JSON or the wrong shape makes reads and writes fail without overwriting it", async () => {
  await mkdir(path.join(dataDir, "v2"), { recursive: true });
  for (const content of [
    "{ not json",
    '[{"id":"a","name":"Onion","unit":"g"}]',
    '{"ingredients":1}',
  ]) {
    await writeFile(ingredientsFile(), content);

    await assert.rejects(ingredients.list(), Error);
    await assert.rejects(ingredients.create({ name: "Onion", unit: "g" }), Error);
    assert.equal(await readFile(ingredientsFile(), "utf8"), content);
  }
});

const GOOD = { id: "m1", name: "medium", amount: 150 };

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
  assert.deepEqual(await newIngredients().list(), [onion]);
});

test("create without measures stores an empty list", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });

  assert.deepEqual(onion.measures, []);
});

test("create rejects measures that are null, as update does", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });

  await assert.rejects(ingredients.create({ name: "Leek", unit: "g", measures: null }), (error) => {
    assert.ok(error instanceof ValidationError);
    assert.equal(error.message, '"measures" must be an array.');
    return true;
  });
  await assert.rejects(ingredients.update(onion.id, { measures: null }), ValidationError);
  assert.deepEqual(await ingredients.list(), [onion]);
});

test("list reads an ingredient without measures as an empty list", async () => {
  await mkdir(path.join(dataDir, "v2"), { recursive: true });
  await writeFile(
    ingredientsFile(),
    JSON.stringify({ ingredients: [{ id: "a", name: "Onion", unit: "g" }] }),
  );

  assert.deepEqual(await ingredients.list(), [
    { id: "a", name: "Onion", unit: "g", measures: [], archived: false },
  ]);
});

test("list drops measures with a bad id, name, or amount, a repeated id, or a repeated name key", async () => {
  await mkdir(path.join(dataDir, "v2"), { recursive: true });
  await writeFile(
    ingredientsFile(),
    JSON.stringify({
      ingredients: [
        {
          id: "a",
          name: "Onion",
          unit: "g",
          measures: [
            GOOD,
            { id: 5, name: "bad id", amount: 1 },
            { id: "m2", name: "", amount: 1 },
            { id: "m3", name: 7, amount: 1 },
            { id: "m4", name: "zero", amount: 0 },
            { id: "m5", name: "huge", amount: 10001 },
            { id: "m6", name: "decimals", amount: 1.234 },
            { id: "m7", name: "text", amount: "5" },
            { id: "m1", name: "repeated id", amount: 2 },
            { id: "m8", name: "MEDIUM", amount: 2 },
            { id: "m9", name: "Large", amount: 200.5 },
            null,
            "x",
          ],
        },
      ],
    }),
  );

  const [onion] = await ingredients.list();
  assert.deepEqual(onion.measures, [GOOD, { id: "m9", name: "Large", amount: 200.5 }]);
});

test("list keeps the first 20 valid measures in order, skipping invalid ones among them", async () => {
  const valid = Array.from({ length: 25 }, (_, index) => ({
    id: `m${index}`,
    name: `size ${index}`,
    amount: index + 1,
  }));
  const mixed = valid.flatMap((measure, index) =>
    index % 5 === 0 ? [{ id: `bad${index}`, name: "", amount: 1 }, measure] : [measure],
  );
  await mkdir(path.join(dataDir, "v2"), { recursive: true });
  await writeFile(
    ingredientsFile(),
    JSON.stringify({ ingredients: [{ id: "a", name: "Onion", unit: "g", measures: mixed }] }),
  );

  const [onion] = await ingredients.list();
  assert.deepEqual(onion.measures, valid.slice(0, 20));
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

test("update rejects two measures whose names share a name key", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });

  await assert.rejects(
    ingredients.update(onion.id, {
      measures: [
        { name: "Mediana", amount: 1 },
        { name: "mediana", amount: 2 },
      ],
    }),
    ValidationError,
  );
  assert.deepEqual(await ingredients.list(), [onion]);
});

test("update rejects a repeated measure ID", async () => {
  const onion = await ingredients.create({
    name: "Onion",
    unit: "g",
    measures: [{ name: "medium", amount: 150 }],
  });
  const [medium] = onion.measures;

  await assert.rejects(
    ingredients.update(onion.id, { measures: [medium, { ...medium, name: "other" }] }),
    ValidationError,
  );
});

test("update rejects more than 20 measures, and accepts exactly 20", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });
  const measures = (count) =>
    Array.from({ length: count }, (_, index) => ({ name: `m${index}`, amount: index + 1 }));

  await assert.rejects(ingredients.update(onion.id, { measures: measures(21) }), ValidationError);
  const updated = await ingredients.update(onion.id, { measures: measures(20) });
  assert.equal(updated.measures.length, 20);
});

test("update rejects an amount outside 0.01 to 10000 or with three decimals", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });

  for (const amount of [0, 0.009, 10000.01, -1, 1.234, "5", null, Number.NaN]) {
    await assert.rejects(
      ingredients.update(onion.id, { measures: [{ name: "medium", amount }] }),
      (error) => {
        assert.ok(error instanceof ValidationError, String(amount));
        assert.match(error.message, /^measures\[0\]\.amount must be from 0\.01 to 10000/);
        return true;
      },
    );
  }
  for (const amount of [0.01, 10000]) {
    await ingredients.update(onion.id, { measures: [{ name: "medium", amount }] });
  }
});

test("create and update reject measure entries with other keys, and create rejects an id", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });
  const invalid = [
    null,
    "medium",
    [],
    {},
    { name: "medium" },
    { amount: 1 },
    { name: "medium", amount: 1, color: "red" },
    { id: "x", name: "medium" },
  ];

  for (const entry of invalid) {
    await assert.rejects(
      ingredients.update(onion.id, { measures: [entry] }),
      ValidationError,
      JSON.stringify(entry),
    );
    await assert.rejects(
      ingredients.create({ name: "Leek", unit: "g", measures: [entry] }),
      ValidationError,
      JSON.stringify(entry),
    );
  }
  await assert.rejects(ingredients.update(onion.id, { measures: "medium" }), ValidationError);
  await assert.rejects(
    ingredients.create({ name: "Leek", unit: "g", measures: [{ id: "x", name: "a", amount: 1 }] }),
    ValidationError,
  );
  assert.deepEqual(await ingredients.list(), [onion]);
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

test("update that drops a measure and adds a new one with the same name still conflicts when recipes use the old one", async () => {
  const onion = await ingredients.create({
    name: "Onion",
    unit: "g",
    measures: [{ name: "medium", amount: 150 }],
  });
  usage.set(onion.id, { inUnit: false, measureIds: new Set([onion.measures[0].id]) });

  await assert.rejects(
    ingredients.update(onion.id, { measures: [{ name: "medium", amount: 150 }] }),
    ConflictError,
  );
  assert.deepEqual(await ingredients.list(), [onion]);
});

test("update keeps a measure that a recipe uses, and can change its name and amount", async () => {
  const onion = await ingredients.create({
    name: "Onion",
    unit: "g",
    measures: [{ name: "medium", amount: 150 }],
  });
  const [medium] = onion.measures;
  usage.set(onion.id, { inUnit: false, measureIds: new Set([medium.id]) });

  const updated = await ingredients.update(onion.id, {
    measures: [{ id: medium.id, name: "big", amount: 160 }],
  });

  assert.deepEqual(updated.measures, [{ id: medium.id, name: "big", amount: 160 }]);
});

test("update rejects a new unit for an ingredient whose measures a recipe uses", async () => {
  const onion = await ingredients.create({
    name: "Onion",
    unit: "g",
    measures: [{ name: "medium", amount: 150 }],
  });
  usage.set(onion.id, { inUnit: false, measureIds: new Set([onion.measures[0].id]) });

  await assert.rejects(ingredients.update(onion.id, { unit: "pcs" }), ConflictError);
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
