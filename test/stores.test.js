import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, test } from "node:test";
import { createStores } from "../server/stores.js";
import { blankWeek, useDataDir, writeDataFile } from "./backend-helpers.js";

const WEEK = "2026-11-16";
const OTHER_WEEK = "2026-11-23";

const storedOnion = { id: "i1", name: "Onion", unit: "g", measures: [], archived: false };
const newLeek = { id: "i2", name: "Leek", unit: "pcs", measures: [], archived: false };
// The second line names an ingredient that the catalog doesn't have.
const storedSoup = {
  id: "r1",
  name: "Soup",
  archived: false,
  ingredients: [
    { ingredientId: "i1", quantity: 100 },
    { ingredientId: "gone", quantity: 1 },
  ],
};
const newStew = { id: "r2", name: "Stew", archived: false, ingredients: [] };

/** The stored week: its Monday lunch also holds a recipe that the recipe book doesn't have. */
function storedWeek() {
  const week = blankWeek();
  week.mon.lunch = {
    items: [
      { recipeId: "r1", servings: 2 },
      { recipeId: "gone", servings: 1 },
    ],
  };
  return week;
}

/** What `read` returns for WEEK and OTHER_WEEK after `writeStoredData`. */
function storedState() {
  return {
    ingredients: [storedOnion],
    recipes: [storedSoup],
    weeks: { [WEEK]: storedWeek(), [OTHER_WEEK]: blankWeek() },
  };
}

/** Writes the catalog, the recipe book, and WEEK; OTHER_WEEK has no file. */
async function writeStoredData(dataDir) {
  await writeDataFile(
    dataDir,
    "v2/ingredients.json",
    JSON.stringify({ ingredients: [storedOnion] }),
  );
  await writeDataFile(dataDir, "v2/recipes.json", JSON.stringify({ recipes: [storedSoup] }));
  await writeDataFile(dataDir, `v2/weeks/${WEEK}.json`, JSON.stringify(storedWeek()));
}

/** The paths, inside `dataDir`, of the files that `writeStoredData` writes. */
function storedFiles(dataDir) {
  return ["ingredients.json", "recipes.json", `weeks/${WEEK}.json`].map((file) =>
    path.join(dataDir, "v2", file),
  );
}

/**
 * Writes the stored data to a new data directory before each test. Returns
 * the directory and the stores on it of the test that runs.
 */
function useStoredData() {
  const dataDir = useDataDir("meals-stores-");
  let stores;
  beforeEach(async () => {
    await writeStoredData(dataDir());
    stores = createStores({ dataDir: dataDir() });
  });
  return { dataDir, stores: () => stores };
}

async function readText(files) {
  return Promise.all(files.map((file) => readFile(file, "utf8")));
}

async function readParsed(dataDir, file) {
  return JSON.parse(await readFile(path.join(dataDir, "v2", file), "utf8"));
}

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

  describe("read", () => {
    const { stores } = useStoredData();

    test("returns the data as stored, with lines and items of unknown entries", async () => {
      assert.deepEqual(await stores().read([WEEK, OTHER_WEEK]), storedState());
    });

    test("rejects a week that isn't a Monday", async () => {
      await assert.rejects(stores().read(["2026-11-17"]), {
        name: "RangeError",
        message: "Unknown week: 2026-11-17",
      });
    });

    test("resolves while a transaction holds the queue", async () => {
      // The transaction resolves to the promise of the read, so a read that
      // waited for the queue would wait for the transaction forever.
      const state = await stores().transaction([WEEK], (current) => ({
        state: current,
        result: stores().read([WEEK]),
      }));

      assert.deepEqual(state.recipes, [storedSoup]);
    });
  });

  describe("transaction", () => {
    const { dataDir, stores } = useStoredData();

    test("writes the catalog, recipe book, and weeks that compute replaces", async () => {
      const week = blankWeek();
      week.tue.dinner = { items: [{ recipeId: "r2", servings: 1 }] };

      await stores().transaction([WEEK, OTHER_WEEK], (state) => ({
        state: {
          ingredients: [...state.ingredients, newLeek],
          recipes: [...state.recipes, newStew],
          weeks: { ...state.weeks, [OTHER_WEEK]: week },
        },
        result: undefined,
      }));

      assert.deepEqual(
        [
          await readParsed(dataDir(), "ingredients.json"),
          await readParsed(dataDir(), "recipes.json"),
          await readParsed(dataDir(), `weeks/${OTHER_WEEK}.json`),
        ],
        [{ ingredients: [storedOnion, newLeek] }, { recipes: [storedSoup, newStew] }, week],
      );
    });

    test("resolves to the result of compute", async () => {
      const result = await stores().transaction([], (state) => ({ state, result: { id: "r2" } }));

      assert.deepEqual(result, { id: "r2" });
    });

    test("rejects with the error of compute and writes nothing", async () => {
      const before = await readText(storedFiles(dataDir()));
      const error = new Error("Broken compute");

      await assert.rejects(
        stores().transaction([WEEK], (state) => {
          state.recipes.push(newStew);
          throw error;
        }),
        error,
      );

      assert.deepEqual(await readText(storedFiles(dataDir())), before);
    });

    test("leaves untouched the files whose data compute returns as it got it", async () => {
      const files = storedFiles(dataDir());
      const past = new Date("2020-01-01T00:00:00Z");
      for (const file of files) await utimes(file, past, past);

      await stores().transaction([WEEK], (state) => ({
        state: { ...state, recipes: [...state.recipes, newStew] },
        result: undefined,
      }));

      const [ingredients, , week] = await Promise.all(files.map((file) => stat(file)));
      assert.deepEqual(
        [ingredients.mtime, week.mtime],
        [past, past],
        "the catalog and the week keep their modification time",
      );
    });

    test("runs a saveSlot queued during it after it", async () => {
      let saving;

      await stores().transaction([WEEK], (state) => {
        saving = stores().weeks.saveSlot(WEEK, "tue", "dinner", [{ recipeId: "r1", servings: 1 }]);
        const week = structuredClone(state.weeks[WEEK]);
        week.mon.lunch = { items: [] };
        return { state: { ...state, weeks: { [WEEK]: week } }, result: undefined };
      });
      await saving;

      const expected = blankWeek();
      expected.tue.dinner = { items: [{ recipeId: "r1", servings: 1 }] };
      assert.deepEqual(await readParsed(dataDir(), `weeks/${WEEK}.json`), expected);
    });
  });
});
