import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { createStore, DAYS, isWeekId, MEALS, weekIdOf } from "../server/store.js";

// Expected values are written out literally so the tests do not trust the module under test.
const EXPECTED_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const EXPECTED_MEALS = ["breakfast", "snack_am", "lunch", "snack_pm", "dinner"];

const WEEK = "2026-09-21";
const OTHER_WEEK = "2026-09-28";

function blankWeek() {
  return Object.fromEntries(
    EXPECTED_DAYS.map((day) => [day, Object.fromEntries(EXPECTED_MEALS.map((meal) => [meal, ""]))]),
  );
}

let dataDir;

function weekFile(week) {
  return path.join(dataDir, "weeks", `${week}.json`);
}

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

test("isWeekId accepts a Monday in YYYY-MM-DD format", () => {
  for (const week of ["2026-09-21", "2026-12-28", "2027-01-04"]) {
    assert.equal(isWeekId(week), true, week);
  }
});

test("isWeekId rejects other weekdays, impossible dates, and other formats", () => {
  const invalid = [
    "2026-09-22", // Tuesday
    "2026-09-27", // Sunday
    "2026-02-30", // doesn't exist; JavaScript rolls it over to Monday, March 2
    "2026-13-07",
    "2026-9-21",
    "20260921",
    "2026-09-21T00:00:00Z",
    " 2026-09-21",
    "__proto__",
    "",
    undefined,
    21,
  ];
  for (const week of invalid) {
    assert.equal(isWeekId(week), false, String(week));
  }
});

test("weekIdOf maps every day of a week to its Monday", () => {
  for (let day = 21; day <= 27; day++) {
    assert.equal(weekIdOf(new Date(2026, 8, day, 12)), "2026-09-21", `September ${day}`);
  }
  assert.equal(weekIdOf(new Date(2026, 8, 27, 23, 59)), "2026-09-21");
  assert.equal(weekIdOf(new Date(2026, 8, 28, 0, 0)), "2026-09-28");
  assert.equal(weekIdOf(new Date(2027, 0, 3)), "2026-12-28");
});

test("readWeek returns a complete empty week when the week has no file", async () => {
  const store = createStore({ dataDir });
  assert.deepEqual(await store.readWeek(WEEK), blankWeek());
});

test("readWeek rejects an invalid week", async () => {
  await assert.rejects(createStore({ dataDir }).readWeek("2026-09-22"), RangeError);
});

test("saveCell stores the text verbatim and it can be read back", async () => {
  const text = "  Toast\nOrange juice \n";
  const store = createStore({ dataDir });

  const result = await store.saveCell(WEEK, "mon", "breakfast", text);
  assert.deepEqual(result, { week: WEEK, day: "mon", meal: "breakfast", text });

  const expected = blankWeek();
  expected.mon.breakfast = text;
  assert.deepEqual(await store.readWeek(WEEK), expected);
  // A brand-new store over the same directory sees it too: it really is on disk.
  assert.deepEqual(await createStore({ dataDir }).readWeek(WEEK), expected);
});

test("saveCell writes each week to its own file and leaves other weeks unchanged", async () => {
  const store = createStore({ dataDir });

  await Promise.all([
    store.saveCell(WEEK, "tue", "lunch", "Lentils"),
    store.saveCell(OTHER_WEEK, "tue", "lunch", "Paella"),
  ]);

  const first = blankWeek();
  first.tue.lunch = "Lentils";
  const second = blankWeek();
  second.tue.lunch = "Paella";
  assert.deepEqual(await store.readWeek(WEEK), first);
  assert.deepEqual(await store.readWeek(OTHER_WEEK), second);
  assert.deepEqual(await store.readWeek("2026-10-05"), blankWeek());
});

test("saveCell creates the data directory if it does not exist", async () => {
  const nestedDir = path.join(dataDir, "nested", "data");
  const store = createStore({ dataDir: nestedDir });

  await store.saveCell(WEEK, "sun", "dinner", "Soup");

  const file = path.join(nestedDir, "weeks", `${WEEK}.json`);
  const onDisk = JSON.parse(await readFile(file, "utf8"));
  assert.equal(onDisk.sun.dinner, "Soup");
});

test("readWeek normalizes an incomplete week file", async () => {
  await mkdir(path.join(dataDir, "weeks"));
  await writeFile(
    weekFile(WEEK),
    JSON.stringify({
      mon: { breakfast: "Bread", lunch: 42 }, // non-string value -> ""
      fri: null, // broken day -> all ""
      holiday: { lunch: "Paella" }, // unknown day -> dropped
    }),
  );

  const expected = blankWeek();
  expected.mon.breakfast = "Bread";
  assert.deepEqual(await createStore({ dataDir }).readWeek(WEEK), expected);
});

test("readWeek rejects when the week file is not valid JSON (never silently discards data)", async () => {
  await mkdir(path.join(dataDir, "weeks"));
  await writeFile(weekFile(WEEK), "{ not json");
  await assert.rejects(createStore({ dataDir }).readWeek(WEEK), SyntaxError);
});

test("saveCell leaves no temporary file behind", async () => {
  const store = createStore({ dataDir });
  await store.saveCell(WEEK, "tue", "lunch", "Lentils");
  assert.deepEqual(await readdir(dataDir), ["weeks"]);
  assert.deepEqual(await readdir(path.join(dataDir, "weeks")), [`${WEEK}.json`]);
});

test("concurrent saves to different cells are all kept", async () => {
  const store = createStore({ dataDir });
  const expected = blankWeek();
  const saves = [];
  for (const day of EXPECTED_DAYS) {
    for (const meal of EXPECTED_MEALS) {
      const text = `${day}-${meal}`;
      expected[day][meal] = text;
      saves.push(store.saveCell(WEEK, day, meal, text)); // not awaited: all 35 in flight at once
    }
  }

  await Promise.all(saves);

  assert.deepEqual(await createStore({ dataDir }).readWeek(WEEK), expected);
});

test("saveCell rejects unknown week, day, or meal identifiers without writing", async () => {
  const store = createStore({ dataDir });
  await assert.rejects(store.saveCell("2026-09-22", "mon", "lunch", "x"), RangeError);
  await assert.rejects(store.saveCell("../week", "mon", "lunch", "x"), RangeError);
  await assert.rejects(store.saveCell(WEEK, "funday", "lunch", "x"), RangeError);
  await assert.rejects(store.saveCell(WEEK, "mon", "brunch", "x"), RangeError);
  await assert.rejects(store.saveCell(WEEK, "__proto__", "lunch", "x"), RangeError);
  assert.deepEqual(await readdir(dataDir), []);
});

test("migrateLegacyWeek moves week.json to the given week", async (t) => {
  const log = t.mock.method(console, "log", () => {});
  const legacy = JSON.stringify({ mon: { lunch: "Paella" } });
  await writeFile(path.join(dataDir, "week.json"), legacy);

  await createStore({ dataDir }).migrateLegacyWeek(WEEK);

  assert.deepEqual(await readdir(dataDir), ["weeks"]);
  assert.equal(await readFile(weekFile(WEEK), "utf8"), legacy);
  assert.equal(log.mock.callCount(), 1);
});

test("migrateLegacyWeek does nothing without week.json", async () => {
  await createStore({ dataDir }).migrateLegacyWeek(WEEK);
  assert.deepEqual(await readdir(dataDir), []);

  // A data directory that doesn't exist yet, as on a fresh install.
  await createStore({ dataDir: path.join(dataDir, "missing") }).migrateLegacyWeek(WEEK);
  assert.deepEqual(await readdir(dataDir), []);
});

test("migrateLegacyWeek leaves both files unchanged when the week already has a file", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  await writeFile(path.join(dataDir, "week.json"), "legacy");
  await mkdir(path.join(dataDir, "weeks"));
  await writeFile(weekFile(WEEK), "current");

  await createStore({ dataDir }).migrateLegacyWeek(WEEK);

  assert.equal(await readFile(path.join(dataDir, "week.json"), "utf8"), "legacy");
  assert.equal(await readFile(weekFile(WEEK), "utf8"), "current");
  assert.equal(warn.mock.callCount(), 1);
});

test("migrateLegacyWeek keeps a week.json with invalid JSON byte for byte", async (t) => {
  t.mock.method(console, "log", () => {});
  await writeFile(path.join(dataDir, "week.json"), "{ not json");

  await createStore({ dataDir }).migrateLegacyWeek(WEEK);

  assert.equal(await readFile(weekFile(WEEK), "utf8"), "{ not json");
});
