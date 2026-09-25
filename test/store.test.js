import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { createStore, DAYS, MEALS } from "../server/store.js";

// Expected values are written out literally so the tests do not trust the module under test.
const EXPECTED_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const EXPECTED_MEALS = ["breakfast", "snack_am", "lunch", "snack_pm", "dinner"];

function blankWeek() {
  return Object.fromEntries(
    EXPECTED_DAYS.map((day) => [day, Object.fromEntries(EXPECTED_MEALS.map((meal) => [meal, ""]))]),
  );
}

let dataDir;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "meals-store-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

test("exports the stable day and meal identifiers in order", () => {
  assert.deepEqual(DAYS, EXPECTED_DAYS);
  assert.deepEqual(MEALS, EXPECTED_MEALS);
});

test("readWeek returns a complete empty week when week.json does not exist", async () => {
  const store = createStore({ dataDir });
  assert.deepEqual(await store.readWeek(), blankWeek());
});

test("saveCell stores the text verbatim and it can be read back", async () => {
  const text = "  Toast\nOrange juice \n";
  const store = createStore({ dataDir });

  const result = await store.saveCell("mon", "breakfast", text);
  assert.deepEqual(result, { day: "mon", meal: "breakfast", text });

  const expected = blankWeek();
  expected.mon.breakfast = text;
  assert.deepEqual(await store.readWeek(), expected);
  // A brand-new store over the same directory sees it too: it really is on disk.
  assert.deepEqual(await createStore({ dataDir }).readWeek(), expected);
});

test("saveCell creates the data directory if it does not exist", async () => {
  const nestedDir = path.join(dataDir, "nested", "data");
  const store = createStore({ dataDir: nestedDir });

  await store.saveCell("sun", "dinner", "Soup");

  const onDisk = JSON.parse(await readFile(path.join(nestedDir, "week.json"), "utf8"));
  assert.equal(onDisk.sun.dinner, "Soup");
});

test("readWeek normalizes an incomplete week.json", async () => {
  await writeFile(
    path.join(dataDir, "week.json"),
    JSON.stringify({
      mon: { breakfast: "Bread", lunch: 42 }, // non-string value -> ""
      fri: null, // broken day -> all ""
      holiday: { lunch: "Paella" }, // unknown day -> dropped
    }),
  );

  const expected = blankWeek();
  expected.mon.breakfast = "Bread";
  assert.deepEqual(await createStore({ dataDir }).readWeek(), expected);
});

test("readWeek rejects when week.json is not valid JSON (never silently discards data)", async () => {
  await writeFile(path.join(dataDir, "week.json"), "{ not json");
  await assert.rejects(createStore({ dataDir }).readWeek(), SyntaxError);
});

test("saveCell leaves no temporary file behind", async () => {
  const store = createStore({ dataDir });
  await store.saveCell("tue", "lunch", "Lentils");
  assert.deepEqual(await readdir(dataDir), ["week.json"]);
});

test("concurrent saves to different cells are all kept", async () => {
  const store = createStore({ dataDir });
  const expected = blankWeek();
  const saves = [];
  for (const day of EXPECTED_DAYS) {
    for (const meal of EXPECTED_MEALS) {
      const text = `${day}-${meal}`;
      expected[day][meal] = text;
      saves.push(store.saveCell(day, meal, text)); // not awaited: all 35 in flight at once
    }
  }

  await Promise.all(saves);

  assert.deepEqual(await createStore({ dataDir }).readWeek(), expected);
});

test("saveCell rejects unknown day or meal identifiers without writing", async () => {
  const store = createStore({ dataDir });
  await assert.rejects(store.saveCell("funday", "lunch", "x"), RangeError);
  await assert.rejects(store.saveCell("mon", "brunch", "x"), RangeError);
  await assert.rejects(store.saveCell("__proto__", "lunch", "x"), RangeError);
  assert.deepEqual(await readdir(dataDir), []);
});
