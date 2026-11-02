import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, test } from "node:test";
import { createQueue } from "../server/files.js";
import { createStores } from "../server/stores.js";
import { createWeeks } from "../server/weeks.js";
import {
  blankWeek,
  EXPECTED_DAYS,
  EXPECTED_MEALS,
  useDataDir,
  writeDataFile,
} from "./backend-helpers.js";

const WEEK = "2026-09-21";
const OTHER_WEEK = "2026-09-28";

const dataDir = useDataDir("meals-weeks-");
let recipes;
let weeks;
let soup;
let salad;

function weekFile(week) {
  return path.join(dataDir(), "v2", "weeks", `${week}.json`);
}

function recipesFile() {
  return path.join(dataDir(), "v2", "recipes.json");
}

function writeWeekFile(week, content) {
  return writeDataFile(dataDir(), `v2/weeks/${week}.json`, content);
}

function newWeeks() {
  return createStores({ dataDir: dataDir() }).weeks;
}

beforeEach(async () => {
  ({ recipes, weeks } = createStores({ dataDir: dataDir() }));
  soup = await recipes.create({ name: "Soup" });
  salad = await recipes.create({ name: "Salad" });
});

test("readWeek returns a complete week of empty menus when the week has no file", async () => {
  assert.deepEqual(await weeks.readWeek(WEEK), blankWeek());
});

test("readWeek rejects an invalid week", async () => {
  await assert.rejects(weeks.readWeek("2026-09-22"), RangeError);
});

test("readWeek reads the week before the recipe book, so a concurrent create's item isn't dropped", async () => {
  const newRecipeId = "brand-new-recipe";
  let idsCalls = 0;
  const stubRecipes = {
    async ids() {
      idsCalls++;
      if (idsCalls === 1) {
        // Simulates a concurrent save that finishes writing the week file
        // for a recipe created after readWeek's read of the week file, but
        // before readWeek's read of the recipe book (this call).
        await writeWeekFile(
          WEEK,
          JSON.stringify({ mon: { lunch: { items: [{ recipeId: newRecipeId, servings: 1 }] } } }),
        );
      }
      return [newRecipeId];
    },
  };
  const stubWeeks = createWeeks({
    dataDir: dataDir(),
    enqueue: createQueue(),
    recipes: stubRecipes,
  });

  // The week file didn't exist yet when readWeek read it, so the item the
  // recipe book stub wrote as a side effect of its own read isn't there.
  const first = await stubWeeks.readWeek(WEEK);
  assert.deepEqual(first.mon.lunch, { items: [] });

  // Now the week file has the item, and the recipe is known: it's kept.
  const second = await stubWeeks.readWeek(WEEK);
  assert.deepEqual(second.mon.lunch, { items: [{ recipeId: newRecipeId, servings: 1 }] });
});

test("saveSlot doesn't drop another slot's items when the recipe book on disk is older or missing", async () => {
  await weeks.saveSlot(WEEK, "mon", "lunch", [{ recipeId: soup.id, servings: 1 }]);
  const currentRecipes = await readFile(recipesFile(), "utf8");

  // Simulates a recipe book restored from an older backup, or a missing
  // file, that doesn't know about `soup` yet.
  await writeDataFile(dataDir(), "v2/recipes.json", JSON.stringify({ recipes: [] }));
  const saladOnly = await recipes.create({ name: "Salad only" });
  await weeks.saveSlot(WEEK, "tue", "lunch", [{ recipeId: saladOnly.id, servings: 1 }]);

  await writeDataFile(dataDir(), "v2/recipes.json", currentRecipes);

  const week = await weeks.readWeek(WEEK);
  assert.deepEqual(week.mon.lunch, { items: [{ recipeId: soup.id, servings: 1 }] });
});

test("readWeek and saveSlot work when the ingredient catalog isn't valid JSON", async () => {
  await writeDataFile(dataDir(), "v2/ingredients.json", "{ not json");
  const items = [{ recipeId: soup.id, servings: 1 }];

  await weeks.saveSlot(WEEK, "mon", "lunch", items);

  const week = await weeks.readWeek(WEEK);
  assert.deepEqual(week.mon.lunch, { items });
});

test("saveSlot with no items empties the slot", async () => {
  await weeks.saveSlot(WEEK, "tue", "dinner", [{ recipeId: soup.id, servings: 1 }]);
  await weeks.saveSlot(WEEK, "tue", "dinner", []);
  assert.deepEqual(await weeks.readWeek(WEEK), blankWeek());
});

test("concurrent saves to different slots are all kept", async () => {
  const expected = blankWeek();
  const saves = [];
  for (const day of EXPECTED_DAYS) {
    for (const [index, meal] of EXPECTED_MEALS.entries()) {
      const items = [{ recipeId: soup.id, servings: index + 1 }];
      expected[day][meal] = { items };
      saves.push(weeks.saveSlot(WEEK, day, meal, items)); // not awaited: all 35 in flight at once
    }
  }

  await Promise.all(saves);

  assert.deepEqual(await weeks.readWeek(WEEK), expected);
});

describe("saveSlot", () => {
  test("keeps the slot of each week when two weeks save at once", async () => {
    const items = [{ recipeId: soup.id, servings: 1 }];
    await Promise.all([
      weeks.saveSlot(WEEK, "tue", "lunch", items),
      weeks.saveSlot(OTHER_WEEK, "wed", "lunch", items),
    ]);

    const first = blankWeek();
    first.tue.lunch = { items };
    const second = blankWeek();
    second.wed.lunch = { items };
    assert.deepEqual(await weeks.readWeek(WEEK), first);
    assert.deepEqual(await weeks.readWeek(OTHER_WEEK), second);
    assert.deepEqual(await weeks.readWeek("2026-10-05"), blankWeek());
  });

  test("returns the saved slot", async () => {
    const items = [
      { recipeId: soup.id, servings: 1.5 },
      { recipeId: salad.id, servings: 2 },
    ];

    const result = await weeks.saveSlot(WEEK, "mon", "lunch", items);

    assert.deepEqual(result, { week: WEEK, day: "mon", meal: "lunch", items });
  });

  test("stores the menu, and a new store reads it back", async () => {
    const items = [
      { recipeId: soup.id, servings: 1.5 },
      { recipeId: salad.id, servings: 2 },
    ];

    await weeks.saveSlot(WEEK, "mon", "lunch", items);

    const expected = blankWeek();
    expected.mon.lunch = { items };
    assert.deepEqual(await weeks.readWeek(WEEK), expected);
    // A brand-new store over the same directory sees it too: it really is on disk.
    assert.deepEqual(await newWeeks().readWeek(WEEK), expected);
  });

  test("rejects a week file that isn't valid JSON, and keeps it", async () => {
    await writeWeekFile(WEEK, "{ not json");

    await assert.rejects(
      weeks.saveSlot(WEEK, "mon", "lunch", [{ recipeId: soup.id, servings: 1 }]),
      SyntaxError,
    );

    assert.equal(await readFile(weekFile(WEEK), "utf8"), "{ not json");
  });

  test("rejects an unknown slot, and writes no file", async () => {
    const items = [{ recipeId: soup.id, servings: 1 }];

    await assert.rejects(weeks.saveSlot(WEEK, "mon", "brunch", items), RangeError);

    assert.deepEqual(
      await readdir(path.join(dataDir(), "v2")),
      ["recipes.json"],
      "only the recipe book is on disk, so no week file was written",
    );
  });

  test("rejects invalid items, and writes no file", async () => {
    await assert.rejects(weeks.saveSlot(WEEK, "mon", "lunch", [{ recipeId: soup.id }]), {
      name: "ValidationError",
    });

    assert.deepEqual(
      await readdir(path.join(dataDir(), "v2")),
      ["recipes.json"],
      "only the recipe book is on disk, so no week file was written",
    );
  });

  test("rejects a recipe that doesn't exist, and writes no file", async () => {
    await assert.rejects(
      weeks.saveSlot(WEEK, "mon", "lunch", [{ recipeId: "no-such-recipe", servings: 1 }]),
      { name: "ValidationError", message: "Unknown recipe: no-such-recipe" },
    );

    assert.deepEqual(
      await readdir(path.join(dataDir(), "v2")),
      ["recipes.json"],
      "only the recipe book is on disk, so no week file was written",
    );
  });
});

describe("readWeek", () => {
  test("rejects a week file that isn't valid JSON", async () => {
    await writeWeekFile(WEEK, "{ not json");

    await assert.rejects(weeks.readWeek(WEEK), SyntaxError);
  });

  test("drops the items whose recipe isn't in the recipe book", async () => {
    await writeWeekFile(
      WEEK,
      JSON.stringify({
        mon: {
          lunch: {
            items: [
              { recipeId: soup.id, servings: 1 },
              { recipeId: "gone", servings: 1 },
            ],
          },
        },
      }),
    );

    const week = await weeks.readWeek(WEEK);

    assert.deepEqual(week.mon.lunch, { items: [{ recipeId: soup.id, servings: 1 }] });
  });
});

test("saveSlot accepts an archived recipe", async () => {
  await recipes.update(soup.id, { archived: true });
  const items = [{ recipeId: soup.id, servings: 2 }];
  assert.deepEqual((await weeks.saveSlot(WEEK, "fri", "dinner", items)).items, items);
});

test("the free-text weeks of earlier versions are never read or changed", async () => {
  const legacyWeek = path.join(dataDir(), "weeks", `${WEEK}.json`);
  const legacySingleWeek = path.join(dataDir(), "week.json");
  const legacyText = JSON.stringify({ mon: { lunch: "Paella" } });
  await writeDataFile(dataDir(), `weeks/${WEEK}.json`, legacyText);
  await writeDataFile(dataDir(), "week.json", legacyText);

  assert.deepEqual(await weeks.readWeek(WEEK), blankWeek());
  await weeks.saveSlot(WEEK, "mon", "lunch", [{ recipeId: soup.id, servings: 1 }]);

  assert.equal(await readFile(legacyWeek, "utf8"), legacyText);
  assert.equal(await readFile(legacySingleWeek, "utf8"), legacyText);
});
