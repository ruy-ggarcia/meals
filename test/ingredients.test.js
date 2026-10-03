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
/** The IDs that the stubbed recipe book says are in use. */
let usedIds;

function ingredientsFile() {
  return path.join(dataDir, "v2", "ingredients.json");
}

function newIngredients() {
  return createIngredients({
    dataDir,
    enqueue: createQueue(),
    isInUse: async (id) => usedIds.has(id),
  });
}

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "meals-ingredients-"));
  usedIds = new Set();
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
  assert.deepEqual(onion, { id: onion.id, name: "Red onion", unit: "g", archived: false });
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
  usedIds.add(onion.id);

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
  usedIds.add(onion.id);

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
    { id: "b", name: "Egg", unit: "pcs", archived: false },
    { id: "a", name: "Onion", unit: "g", archived: true },
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
