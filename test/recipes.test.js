import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { NameConflictError, NotFoundError, ValidationError } from "../server/errors.js";
import { createQueue } from "../server/files.js";
import { cleanName, createRecipes, nameKey } from "../server/recipes.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let dataDir;
let recipes;

function recipesFile() {
  return path.join(dataDir, "v2", "recipes.json");
}

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "meals-recipes-"));
  recipes = createRecipes({ dataDir, enqueue: createQueue() });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

test("cleanName trims the name and collapses runs of whitespace", () => {
  assert.equal(cleanName("  Green \t salad\n "), "Green salad");
});

test("nameKey ignores case and accents", () => {
  assert.equal(nameKey("Café"), nameKey("CAFE"));
  assert.equal(nameKey("Ñoquis"), "noquis");
  assert.notEqual(nameKey("Cafe"), nameKey("Cafes"));
});

test("list returns an empty recipe book when there is no file", async () => {
  assert.deepEqual(await recipes.list(), []);
});

test("create stores a recipe with a UUID, the cleaned name, and archived false", async () => {
  const recipe = await recipes.create("  Gnocchi   carbonara ");

  assert.match(recipe.id, UUID);
  assert.deepEqual(recipe, { id: recipe.id, name: "Gnocchi carbonara", archived: false });
  assert.deepEqual(JSON.parse(await readFile(recipesFile(), "utf8")), { recipes: [recipe] });
  // A brand-new store over the same directory sees it too: it really is on disk.
  assert.deepEqual(await createRecipes({ dataDir, enqueue: createQueue() }).list(), [recipe]);
});

test("list sorts recipes from A to Z by name key", async () => {
  for (const name of ["omelette", "Ñoquis", "Café", "banana"]) await recipes.create(name);

  const names = (await recipes.list()).map((recipe) => recipe.name);
  assert.deepEqual(names, ["banana", "Café", "Ñoquis", "omelette"]);
});

test("create rejects a name that isn't a string, is blank, or is too long", async () => {
  for (const name of [undefined, null, 42, ["Soup"], "", "   \n "]) {
    await assert.rejects(recipes.create(name), ValidationError, String(name));
  }
  await assert.rejects(recipes.create("x".repeat(101)), ValidationError);

  // The limit counts the cleaned name.
  assert.equal((await recipes.create(` ${"x".repeat(100)} `)).name, "x".repeat(100));
  assert.equal((await recipes.list()).length, 1);
});

test("create reports blank and too long names with readable messages", async () => {
  await assert.rejects(recipes.create(" "), { message: "The name can't be empty." });
  await assert.rejects(recipes.create("x".repeat(101)), {
    message: "The name must be at most 100 characters.",
  });
});

test("create rejects a name whose key is taken, active or archived, and reports that recipe", async () => {
  const cafe = await recipes.create("Café");

  await assert.rejects(recipes.create("  cafe "), (error) => {
    assert.ok(error instanceof NameConflictError);
    assert.deepEqual(error.recipe, cafe);
    return true;
  });

  const archived = await recipes.update(cafe.id, { archived: true });
  await assert.rejects(recipes.create("CAFE"), (error) => {
    assert.ok(error instanceof NameConflictError);
    assert.deepEqual(error.recipe, archived);
    return true;
  });
  assert.equal((await recipes.list()).length, 1);
});

test("concurrent creates with the same name key store only one recipe", async () => {
  const results = await Promise.allSettled([recipes.create("Soup"), recipes.create("soup")]);

  assert.deepEqual(
    results.map((result) => result.status),
    ["fulfilled", "rejected"],
  );
  assert.ok(results[1].reason instanceof NameConflictError);
  assert.equal((await recipes.list()).length, 1);
});

test("update renames a recipe and keeps its ID", async () => {
  const soup = await recipes.create("Soup");

  const renamed = await recipes.update(soup.id, { name: " Tomato  soup " });

  assert.deepEqual(renamed, { id: soup.id, name: "Tomato soup", archived: false });
  assert.deepEqual(await recipes.list(), [renamed]);
});

test("update accepts a new name with the recipe's own name key", async () => {
  const cafe = await recipes.create("Cafe");
  assert.equal((await recipes.update(cafe.id, { name: "Café" })).name, "Café");
});

test("update rejects a name whose key another recipe has", async () => {
  const soup = await recipes.create("Soup");
  const salad = await recipes.create("Salad");

  await assert.rejects(recipes.update(salad.id, { name: "SOUP" }), (error) => {
    assert.ok(error instanceof NameConflictError);
    assert.deepEqual(error.recipe, soup);
    return true;
  });
  assert.deepEqual(await recipes.list(), [salad, soup]);
});

test("update archives and restores a recipe", async () => {
  const soup = await recipes.create("Soup");

  assert.deepEqual(await recipes.update(soup.id, { archived: true }), { ...soup, archived: true });
  assert.deepEqual(await recipes.list(), [{ ...soup, archived: true }]);
  assert.deepEqual(await recipes.update(soup.id, { archived: false }), soup);
});

test("update rejects changes that aren't exactly one valid field", async () => {
  const soup = await recipes.create("Soup");
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
    { id: "b", name: "Salad", archived: false },
    { id: "a", name: "Soup", archived: true },
  ]);
});

test("a recipes file with invalid JSON makes reads and writes fail without overwriting it", async () => {
  await mkdir(path.join(dataDir, "v2"), { recursive: true });
  await writeFile(recipesFile(), "{ not json");

  await assert.rejects(recipes.list(), SyntaxError);
  await assert.rejects(recipes.create("Soup"), SyntaxError);
  assert.equal(await readFile(recipesFile(), "utf8"), "{ not json");
});

test("a recipes file that is valid JSON but the wrong shape makes reads and writes fail without overwriting it", async () => {
  await mkdir(path.join(dataDir, "v2"), { recursive: true });
  for (const content of ['[{"id":"a","name":"Soup","archived":false}]', '{"recipes":"Soup"}']) {
    await writeFile(recipesFile(), content);

    await assert.rejects(recipes.list(), Error);
    await assert.rejects(recipes.create("Soup"), Error);
    assert.equal(await readFile(recipesFile(), "utf8"), content);
  }
});
