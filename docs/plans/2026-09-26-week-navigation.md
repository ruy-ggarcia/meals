# Week Navigation Implementation Plan

**Goal:** Replace the single generic week with unlimited dated weeks, navigated
with previous, next, and **Today** controls, with the week in the URL hash, dates
on the days, and a today marker on desktop and mobile.

**Architecture:** The server stores one JSON file per week in
`data/weeks/WEEK.json`, where `WEEK` is the week's Monday as `YYYY-MM-DD`, and
serves it through `/api/weeks/WEEK`. On startup, it moves the legacy
`data/week.json` into the current week. The frontend gets a pure date module,
`public/dates.js`, that Node.js tests import directly. `public/app.js` keys all
save state by week and changes weeks only after pending saves settle, asking
with `confirm()` before it discards unsaved text.

**Tech Stack:** Node.js 22 or later with `node:test`, ES modules, Express 5,
supertest 7, and plain HTML, CSS, and JavaScript with no framework or build step.
Biome checks the style.

**Spec:** `docs/plans/2026-09-26-week-navigation-design.md`. Read it before you
start any task.

## Global Constraints

- **Language:** all code, comments, UI text, test names, docs, and commit
  messages are in US English (`AGENTS.md`).
- **Checks before every commit:** `npm run lint` and `npm test` must both pass.
  To fix formatting, run `npm run format`.
- **Commits:** Conventional Commits. No planning labels such as task numbers
  in commit messages.
- **Branch:** `feature/week-navigation`. `main` changes only through pull
  requests.
- **Dependencies:** no new dependencies. Runtime `express` only; dev
  `@biomejs/biome` and `supertest` only.
- **Frontend boundary:** nothing in `public/` imports from `server/`. The
  frontend depends only on the HTTP API.
- **Week identifier:** the date of the week's Monday, `YYYY-MM-DD`. It must match
  `^\d{4}-\d{2}-\d{2}$`, be a real calendar date, and be a Monday. Validation
  runs in UTC.
- **Storage:** `data/weeks/WEEK.json`, same format as the old `week.json`:
  all 7 days (`mon` to `sun`), each with all 5 meals (`breakfast`, `snack_am`,
  `lunch`, `snack_pm`, `dinner`), each a string. Atomic write through
  `WEEK.json.tmp` and `rename`. One save queue for all weeks.
- **API:** `GET /api/weeks/WEEK` returns `200` with the full week or `404` for
  an invalid week. `PUT /api/weeks/WEEK/DAY/MEAL` with `{ "text" }` returns `200`
  with `{ "week", "day", "meal", "text" }`, `400` for missing, non-string, or
  longer than 2000-character text, and `404` for an invalid week, day, or
  meal. The `/api/week` routes no longer exist.
- **UI text (verbatim):** buttons `‹` (accessible name `Previous week`), `›`
  (accessible name `Next week`), and `Today`. The range uses
  `Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).formatRange`.
  Desktop day headers are `Monday 21`. Mobile day buttons show `M` over `21`
  with the accessible name `Monday, September 21`. The unsaved-changes question is
  `Some changes in this week couldn't be saved. Leave anyway and discard them?`.
- **Accent color:** `#2e7d32`.
- **Out of scope:** real-time updates, copying or deleting weeks, a date picker,
  and keyboard shortcuts.

## Review Focus

- **Rapid clicks on `‹`, `›`, or `Today`:** only one week change runs at a time,
  and the range label, the hash, and the grid always end on the same week.
  Task 4 disables the week bar while a change runs. Task 4 step 6 checks it by
  hand.
- **A hand-edited or invalid hash**, such as `#hello`, `#2026-09-22` (a Tuesday),
  or `#2026-02-30` (rolls over to a Monday in JavaScript): the app shows a valid
  week and rewrites the hash, and never requests an invalid week. Task 1 tests
  `isWeekId` with these values. Task 4 step 6 checks the hash by hand.
- **A save that finishes after a week change:** a status timer from the previous
  week must not hide a red cross in the new week. Task 3 keys `savedTimers` by
  the cell element, and `fillWeek` clears them through `setStatus`.
- **A failed load of the new week:** the grid hides, **Retry** reloads the same
  week, and `‹`, `›`, and **Today** still work. Leaving a hidden grid never asks
  the unsaved-changes question. Task 4 step 6 checks it with the server stopped.
- **A page left open overnight or across a week boundary:** **Today** computes
  the current week when you click it, and the today marker moves when the page
  becomes visible again. Task 5 step 5 checks it by changing the system clock.

## File Structure

```none
public/
  app.js           # Tasks 3, 4, 5: week-aware saves, week changes, dates and today marker.
  dates.js         # Task 1: pure date helpers, no DOM.
  index.html       # Task 4: week bar.
  styles.css       # Tasks 4, 5: week bar, dates on day buttons, today marker.
server/
  app.js           # Task 3: /api/weeks routes.
  index.js         # Task 3: runs the migration before listening.
  store.js         # Task 2: per-week files, isWeekId, weekIdOf, migrateLegacyWeek.
test/
  api.test.js      # Task 3.
  dates.test.js    # Task 1.
  store.test.js    # Task 2.
README.md          # Tasks 3, 4, 5.
```

Responsibilities stay as they are: `server/store.js` is the only module that
touches disk and knows nothing about HTTP. `server/app.js` maps validation to
status codes and never touches `fs`. `public/dates.js` knows dates and nothing
about the DOM or the API. `public/app.js` knows the DOM and the API.

---

### Task 1: Date helpers for the frontend

**Files:**

- Create: `public/dates.js`
- Test: `test/dates.test.js`

**Interfaces:**

- Consumes: nothing.
- Produces, all exported from `public/dates.js`:
  - `addDays(date: Date, days: number): Date`: a new `Date`, `days` calendar
    days later or earlier, same local time.
  - `dayIndex(date: Date): number`: `0` for Monday to `6` for Sunday.
  - `weekIdOf(date: Date): string`: the Monday of the week that contains
    `date`, as `YYYY-MM-DD`, in local time.
  - `isWeekId(id: unknown): boolean`.
  - `weekStart(id: string): Date`: the Monday of week `id`, local midnight.
  - `addWeeks(id: string, weeks: number): string`.
  - `formatWeekRange(id: string): string`, for example `Sep 21 – 27, 2026`.
  - `formatLongDate(date: Date): string`, for example `Monday, September 21`.

- [ ] **Step 1: Write the failing tests**

Create `test/dates.test.js`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";

// Set the time zone before the module creates any Date, so the results don't
// depend on the machine. Europe/Madrid ends daylight saving time on 2026-10-25.
process.env.TZ = "Europe/Madrid";
const {
  addDays,
  addWeeks,
  dayIndex,
  formatLongDate,
  formatWeekRange,
  isWeekId,
  weekIdOf,
  weekStart,
} = await import("../public/dates.js");

// Intl puts thin spaces around the dash in a range; compare with plain spaces.
function plain(text) {
  return text.replace(/\s/g, " ");
}

function localParts(date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours()];
}

test("dayIndex counts from Monday (0) to Sunday (6)", () => {
  for (let day = 21; day <= 27; day++) {
    assert.equal(dayIndex(new Date(2026, 8, day)), day - 21, `September ${day}`);
  }
});

test("weekIdOf maps every day of a week to its Monday", () => {
  for (let day = 21; day <= 27; day++) {
    assert.equal(weekIdOf(new Date(2026, 8, day, 12)), "2026-09-21", `September ${day}`);
  }
  assert.equal(weekIdOf(new Date(2026, 8, 27, 23, 59)), "2026-09-21");
  assert.equal(weekIdOf(new Date(2026, 8, 28, 0, 0)), "2026-09-28");
  // A Sunday late at night on the day daylight saving time ends.
  assert.equal(weekIdOf(new Date(2026, 9, 25, 23, 30)), "2026-10-19");
  // A week that spans two years.
  assert.equal(weekIdOf(new Date(2027, 0, 3)), "2026-12-28");
});

test("addDays counts calendar days across the end of daylight saving time", () => {
  // October 25, 2026 has 25 hours in Europe/Madrid; adding 24 hours would land at 23:00.
  assert.deepEqual(localParts(addDays(new Date(2026, 9, 25), 1)), [2026, 10, 26, 0]);
  assert.deepEqual(localParts(addDays(new Date(2026, 9, 26), -1)), [2026, 10, 25, 0]);
});

test("addDays doesn't change its argument", () => {
  const date = new Date(2026, 8, 21);
  addDays(date, 3);
  assert.deepEqual(localParts(date), [2026, 9, 21, 0]);
});

test("isWeekId accepts a Monday in YYYY-MM-DD format", () => {
  for (const id of ["2026-09-21", "2026-12-28", "2027-01-04"]) {
    assert.equal(isWeekId(id), true, id);
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
    "hello",
    "",
    undefined,
    21,
  ];
  for (const id of invalid) {
    assert.equal(isWeekId(id), false, String(id));
  }
});

test("weekStart returns the Monday at local midnight", () => {
  assert.deepEqual(localParts(weekStart("2026-09-21")), [2026, 9, 21, 0]);
  // The Date constructor would turn year 1 into 1901.
  assert.equal(weekStart("0001-01-01").getFullYear(), 1);
});

test("addWeeks moves across months, years, and daylight saving time", () => {
  assert.equal(addWeeks("2026-09-21", 1), "2026-09-28");
  assert.equal(addWeeks("2026-09-21", -1), "2026-09-14");
  assert.equal(addWeeks("2026-09-28", 1), "2026-10-05");
  assert.equal(addWeeks("2026-10-19", 1), "2026-10-26");
  assert.equal(addWeeks("2026-12-28", 1), "2027-01-04");
  assert.equal(addWeeks("2027-01-04", -1), "2026-12-28");
  // Years below 1000 keep four digits, so the result is still a valid week.
  assert.equal(addWeeks("0001-01-01", 1), "0001-01-08");
});

test("formatWeekRange shares the month and the year when they match", () => {
  assert.equal(plain(formatWeekRange("2026-09-21")), "Sep 21 – 27, 2026");
  assert.equal(plain(formatWeekRange("2026-09-28")), "Sep 28 – Oct 4, 2026");
  assert.equal(plain(formatWeekRange("2026-12-28")), "Dec 28, 2026 – Jan 3, 2027");
});

test("formatLongDate returns the weekday, month, and day", () => {
  assert.equal(formatLongDate(new Date(2026, 8, 21)), "Monday, September 21");
});
```

- [ ] **Step 2: Run the tests to verify that they fail**

Run: `node --test test/dates.test.js`

Expected: FAIL with `Cannot find module` for `public/dates.js`.

- [ ] **Step 3: Write the module**

Create `public/dates.js`:

```js
// Date helpers for the week grid. They use the browser's local time and never
// touch the DOM, so tests import this module directly in Node.js.

const WEEK_ID_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function pad(number, length = 2) {
  return String(number).padStart(length, "0");
}

/** A new Date `days` calendar days later (or earlier), at the same local time. */
export function addDays(date, days) {
  const result = new Date(date);
  // setDate counts calendar days, so a daylight saving time change doesn't shift the time.
  result.setDate(result.getDate() + days);
  return result;
}

/** Position of `date` in its week: 0 = Monday, ..., 6 = Sunday. */
export function dayIndex(date) {
  // Date#getDay(): 0 = Sunday, 1 = Monday, ..., 6 = Saturday.
  return (date.getDay() + 6) % 7;
}

/** Identifier of the week that contains `date`: its Monday as YYYY-MM-DD. */
export function weekIdOf(date) {
  const monday = addDays(date, -dayIndex(date));
  return `${pad(monday.getFullYear(), 4)}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
}

/** True for a real calendar date in YYYY-MM-DD format that falls on a Monday. */
export function isWeekId(id) {
  if (typeof id !== "string" || !WEEK_ID_PATTERN.test(id)) return false;
  // UTC, so the answer doesn't depend on the time zone. An impossible date such
  // as 2026-02-30 rolls over to another day, so it fails the round trip.
  const date = new Date(`${id}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().startsWith(id) && date.getUTCDay() === 1
  );
}

/** The Monday of week `id` as a local Date at midnight. */
export function weekStart(id) {
  const [year, month, day] = id.split("-").map(Number);
  const date = new Date(2000, 0, 1);
  // Unlike the Date constructor, setFullYear doesn't map years 0-99 to 1900-1999.
  date.setFullYear(year, month - 1, day);
  return date;
}

export function addWeeks(id, weeks) {
  return weekIdOf(addDays(weekStart(id), weeks * 7));
}

/** For example, "Sep 21 – 27, 2026". */
export function formatWeekRange(id) {
  const monday = weekStart(id);
  const format = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return format.formatRange(monday, addDays(monday, 6));
}

/** For example, "Monday, September 21". */
export function formatLongDate(date) {
  const format = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  return format.format(date);
}
```

- [ ] **Step 4: Run the tests to verify that they pass**

Run: `node --test test/dates.test.js`

Expected: PASS, 10 tests.

- [ ] **Step 5: Run the checks and commit**

```bash
npm run format
npm run lint
npm test
git add public/dates.js test/dates.test.js
git commit -m "feat(ui): add week date helpers"
```

---

### Task 2: Per-week storage and migration

**Files:**

- Modify: `server/store.js` (whole file)
- Test: `test/store.test.js` (whole file)

**Interfaces:**

- Consumes: nothing.
- Produces, exported from `server/store.js`:
  - `DAYS`, `MEALS`: unchanged.
  - `isWeekId(week: unknown): boolean`: same rules as in `public/dates.js`.
  - `weekIdOf(date: Date): string`: the week's Monday in the server's local time.
  - `createStore({ dataDir })` returns:
    - `readWeek(week: string): Promise<Week>`: rejects with `RangeError` for an
      invalid week and `SyntaxError` for invalid JSON.
    - `saveCell(week, day, meal, text): Promise<{ week, day, meal, text }>`:
      rejects with `RangeError` for an invalid week, day, or meal.
    - `migrateLegacyWeek(week: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Replace `test/store.test.js` with:

```js
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
```

- [ ] **Step 2: Run the tests to verify that they fail**

Run: `node --test test/store.test.js`

Expected: FAIL. The import of `isWeekId` and `weekIdOf` fails with
`does not provide an export named`.

- [ ] **Step 3: Write the store**

Replace `server/store.js` with:

```js
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

// Stable identifiers shared by the API and the storage format. Order matters.
export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const MEALS = ["breakfast", "snack_am", "lunch", "snack_pm", "dinner"];

const WEEK_ID_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// A week is identified by its Monday as YYYY-MM-DD. Validation runs in UTC, so
// the answer doesn't depend on the server's time zone. An impossible date such
// as 2026-02-30 rolls over to another day, so it fails the round trip.
export function isWeekId(week) {
  if (typeof week !== "string" || !WEEK_ID_PATTERN.test(week)) return false;
  const date = new Date(`${week}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().startsWith(week) && date.getUTCDay() === 1
  );
}

// The week that contains `date`, in the server's local time.
export function weekIdOf(date) {
  const monday = new Date(date);
  // Date#getDay(): 0 = Sunday, 1 = Monday, ..., 6 = Saturday.
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const pad = (number) => String(number).padStart(2, "0");
  return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
}

function emptyWeek() {
  return Object.fromEntries(
    DAYS.map((day) => [day, Object.fromEntries(MEALS.map((meal) => [meal, ""]))]),
  );
}

// Builds a complete 7 x 5 week from whatever was parsed: missing or non-string
// cells become "", unknown keys are dropped.
function normalize(raw) {
  const week = emptyWeek();
  for (const day of DAYS) {
    for (const meal of MEALS) {
      const value = raw?.[day]?.[meal];
      if (typeof value === "string") week[day][meal] = value;
    }
  }
  return week;
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export function createStore({ dataDir }) {
  const weeksDir = path.join(dataDir, "weeks");
  const legacyFile = path.join(dataDir, "week.json");
  // Every save runs after the previous one finishes, so two read-modify-write
  // cycles never interleave and lose each other's changes.
  let queue = Promise.resolve();

  function weekFile(week) {
    return path.join(weeksDir, `${week}.json`);
  }

  async function readWeek(week) {
    if (!isWeekId(week)) throw new RangeError(`Unknown week: ${week}`);
    let text;
    try {
      text = await readFile(weekFile(week), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return emptyWeek();
      throw error;
    }
    // Invalid JSON throws on purpose: treating it as empty would overwrite the
    // user's data on the next save.
    return normalize(JSON.parse(text));
  }

  async function writeCell(week, day, meal, text) {
    const cells = await readWeek(week);
    cells[day][meal] = text;
    const file = weekFile(week);
    const tmpFile = `${file}.tmp`;
    await mkdir(weeksDir, { recursive: true });
    await writeFile(tmpFile, `${JSON.stringify(cells, null, 2)}\n`);
    await rename(tmpFile, file); // atomic replace
    return { week, day, meal, text };
  }

  async function saveCell(week, day, meal, text) {
    if (!isWeekId(week) || !DAYS.includes(day) || !MEALS.includes(meal)) {
      throw new RangeError(`Unknown cell: ${week}/${day}/${meal}`);
    }
    const run = queue.then(() => writeCell(week, day, meal, text));
    queue = run.catch(() => {}); // a failed save must not block later ones
    return run;
  }

  // Moves the week.json of the single-week version into `week`. It never
  // parses the file, so even invalid JSON keeps its exact content.
  async function migrateLegacyWeek(week) {
    if (!isWeekId(week)) throw new RangeError(`Unknown week: ${week}`);
    if (!(await exists(legacyFile))) return;
    const target = weekFile(week);
    if (await exists(target)) {
      console.warn(`Didn't move ${legacyFile} because ${target} already exists.`);
      return;
    }
    await mkdir(weeksDir, { recursive: true });
    await rename(legacyFile, target);
    console.log(`Moved ${legacyFile} to ${target}.`);
  }

  return { migrateLegacyWeek, readWeek, saveCell };
}
```

- [ ] **Step 4: Run the store tests to verify that they pass**

Run: `node --test test/store.test.js`

Expected: PASS, 18 tests.

`test/api.test.js` now fails because `server/app.js` still calls the old
`readWeek()` and `saveCell(day, meal, text)`. Task 3 fixes it. Don't commit
yet: this task and Task 3 go in separate commits, but each commit must pass
`npm test`. Go to step 5.

- [ ] **Step 5: Adapt the API routes to the new store signatures**

Keep the old URLs for now, so this commit stays working on its own. In
`server/app.js`, add `weekIdOf` to the import from `./store.js`, and in both
handlers pass the current week as the first argument:

```js
import { DAYS, MEALS, weekIdOf } from "./store.js";
```

```js
  app.get("/api/week", async (_req, res) => {
    res.json(await store.readWeek(weekIdOf(new Date())));
  });
```

```js
    const saved = await store.saveCell(weekIdOf(new Date()), day, meal, text);
    res.json({ day: saved.day, meal: saved.meal, text: saved.text });
```

This last snippet replaces `res.json(await store.saveCell(day, meal, text));`,
so the response keeps its old shape `{ day, meal, text }`.

In `test/api.test.js`, the test "GET /api/week returns 500 JSON when week.json
is corrupt" writes the old file. Change its setup to write the current week's
file instead:

```js
test("GET /api/week returns 500 JSON when the week file is corrupt", async () => {
  await mkdir(path.join(dataDir, "weeks"));
  await writeFile(path.join(dataDir, "weeks", `${weekIdOf(new Date())}.json`), "{ not json");
```

Add `mkdir` to the `node:fs/promises` import and change the import from
`../server/store.js` to `import { createStore, weekIdOf } from "../server/store.js";`.

- [ ] **Step 6: Run the checks and commit**

```bash
npm run format
npm run lint
npm test
git add server/app.js server/store.js test/api.test.js test/store.test.js
git commit -m "feat(store): store each week in its own file" -m "Validate week identifiers, keep one JSON file per week in data/weeks/, and
move the legacy week.json into a given week without parsing it."
```

Expected: `npm test` passes all tests.

---

### Task 3: Week API, migration on startup, and week-aware saves

**Files:**

- Modify: `server/app.js` (routes)
- Modify: `server/index.js` (whole file)
- Modify: `public/app.js` (save state, load, and startup)
- Modify: `README.md` (configuration, backup, API reference, project structure)
- Test: `test/api.test.js` (whole file)

**Interfaces:**

- Consumes: `isWeekId`, `weekIdOf`, `createStore` and its `readWeek`,
  `saveCell`, and `migrateLegacyWeek` from Task 2. `dayIndex` and `weekIdOf`
  from `public/dates.js` (Task 1).
- Produces, in `public/app.js` for Tasks 4 and 5:
  - `grid.dataset.week`: the loaded week, set by `fillWeek`.
  - `cellKey(week, day, meal)`: `"WEEK/DAY/MEAL"`.
  - `fillWeek(week, cells)`, `loadWeek(week)`, `todayId()`.
  - `savedTimers`: a `Map` keyed by the cell element.

- [ ] **Step 1: Write the failing API tests**

Replace `test/api.test.js` with:

```js
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import request from "supertest";
import { createApp } from "../server/app.js";
import { createStore } from "../server/store.js";

const EXPECTED_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const EXPECTED_MEALS = ["breakfast", "snack_am", "lunch", "snack_pm", "dinner"];

const WEEK = "2026-09-21";
const OTHER_WEEK = "2026-09-28";
// A Tuesday, an impossible date that JavaScript rolls over to a Monday, and non-dates.
const INVALID_WEEKS = ["2026-09-22", "2026-02-30", "2026-9-21", "hello"];

function blankWeek() {
  return Object.fromEntries(
    EXPECTED_DAYS.map((day) => [day, Object.fromEntries(EXPECTED_MEALS.map((meal) => [meal, ""]))]),
  );
}

let dataDir;
let app;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "meals-api-"));
  app = createApp({ store: createStore({ dataDir }) });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

test("GET /api/weeks/WEEK returns 200 with a complete 7 x 5 week", async () => {
  const res = await request(app).get(`/api/weeks/${WEEK}`);

  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /application\/json/);
  assert.deepEqual(res.body, blankWeek());
});

test("PUT a valid cell returns 200 with the saved cell and a later GET reflects it", async () => {
  const text = "Lentils\nFruit";

  const put = await request(app).put(`/api/weeks/${WEEK}/wed/lunch`).send({ text });
  assert.equal(put.status, 200);
  assert.match(put.headers["content-type"], /application\/json/);
  assert.deepEqual(put.body, { week: WEEK, day: "wed", meal: "lunch", text });

  const get = await request(app).get(`/api/weeks/${WEEK}`);
  const expected = blankWeek();
  expected.wed.lunch = text;
  assert.deepEqual(get.body, expected);
});

test("a PUT in one week doesn't change another week", async () => {
  await request(app).put(`/api/weeks/${WEEK}/wed/lunch`).send({ text: "Lentils" });

  const get = await request(app).get(`/api/weeks/${OTHER_WEEK}`);
  assert.equal(get.status, 200);
  assert.deepEqual(get.body, blankWeek());
});

test("PUT accepts an empty string (clearing a cell)", async () => {
  await request(app).put(`/api/weeks/${WEEK}/mon/dinner`).send({ text: "Soup" });

  const put = await request(app).put(`/api/weeks/${WEEK}/mon/dinner`).send({ text: "" });
  assert.equal(put.status, 200);

  const get = await request(app).get(`/api/weeks/${WEEK}`);
  assert.equal(get.body.mon.dinner, "");
});

test("PUT accepts text of exactly 2000 characters", async () => {
  const text = "x".repeat(2000);
  const put = await request(app).put(`/api/weeks/${WEEK}/fri/snack_pm`).send({ text });
  assert.equal(put.status, 200);
  assert.equal(put.body.text, text);
});

test("GET with an invalid week returns 404 JSON", async () => {
  for (const week of INVALID_WEEKS) {
    const res = await request(app).get(`/api/weeks/${week}`);
    assert.equal(res.status, 404, week);
    assert.match(res.headers["content-type"], /application\/json/, week);
    assert.equal(typeof res.body.error, "string", week);
  }
});

test("PUT with an unknown week, day, or meal returns 404 JSON and saves nothing", async () => {
  const urls = [
    ...INVALID_WEEKS.map((week) => `/api/weeks/${week}/mon/lunch`),
    `/api/weeks/${WEEK}/funday/lunch`,
    `/api/weeks/${WEEK}/mon/brunch`,
  ];
  for (const url of urls) {
    const res = await request(app).put(url).send({ text: "x" });
    assert.equal(res.status, 404, url);
    assert.match(res.headers["content-type"], /application\/json/, url);
    assert.equal(typeof res.body.error, "string", url);
  }
  assert.deepEqual(await readdir(dataDir), []);
});

test("PUT with missing, non-string or too long text returns 400 JSON and saves nothing", async () => {
  const url = `/api/weeks/${WEEK}/mon/lunch`;
  const bodies = [
    {},
    { text: 123 },
    { text: null },
    { text: ["Bread"] },
    { text: "x".repeat(2001) },
  ];
  for (const body of bodies) {
    const res = await request(app).put(url).send(body);
    const label = JSON.stringify(body).slice(0, 40);
    assert.equal(res.status, 400, label);
    assert.match(res.headers["content-type"], /application\/json/, label);
    assert.equal(typeof res.body.error, "string", label);
  }

  const noBody = await request(app).put(url);
  assert.equal(noBody.status, 400, "no body at all");

  const get = await request(app).get(`/api/weeks/${WEEK}`);
  assert.deepEqual(get.body, blankWeek());
});

test("PUT with a malformed JSON body returns 400 JSON", async () => {
  const res = await request(app)
    .put(`/api/weeks/${WEEK}/mon/lunch`)
    .set("Content-Type", "application/json")
    .send('{"text":');

  assert.equal(res.status, 400);
  assert.match(res.headers["content-type"], /application\/json/);
  assert.equal(typeof res.body.error, "string");
});

test("GET returns 500 JSON when the week file is corrupt", async () => {
  await mkdir(path.join(dataDir, "weeks"));
  await writeFile(path.join(dataDir, "weeks", `${WEEK}.json`), "{ not json");

  const res = await request(app).get(`/api/weeks/${WEEK}`);

  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: "Internal server error" });
});

test("the single-week routes no longer exist", async () => {
  const get = await request(app).get("/api/week");
  assert.equal(get.status, 404);
  assert.match(get.headers["content-type"], /application\/json/);

  const put = await request(app).put("/api/week/mon/lunch").send({ text: "x" });
  assert.equal(put.status, 404);
  assert.deepEqual(await readdir(dataDir), []);
});

test("unknown /api routes return 404 JSON", async () => {
  const res = await request(app).get("/api/nope");

  assert.equal(res.status, 404);
  assert.match(res.headers["content-type"], /application\/json/);
  assert.equal(typeof res.body.error, "string");
});

test("GET / serves the frontend page", async () => {
  const res = await request(app).get("/");

  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /text\/html/);
  assert.match(res.text, /<title>Weekly meal plan<\/title>/);
});

test("GET /dates.js serves the date helpers", async () => {
  const res = await request(app).get("/dates.js");

  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /javascript/);
});
```

- [ ] **Step 2: Run the tests to verify that they fail**

Run: `node --test test/api.test.js`

Expected: FAIL. The `/api/weeks` tests get `404`, and "the single-week routes
no longer exist" gets `200`.

- [ ] **Step 3: Replace the routes**

In `server/app.js`, change the store import to:

```js
import { DAYS, isWeekId, MEALS } from "./store.js";
```

Replace both `/api/week` handlers (from `app.get("/api/week", ...` through the
end of `app.put("/api/week/:day/:meal", ...)`) with:

```js
  app.get("/api/weeks/:week", async (req, res) => {
    const { week } = req.params;
    if (!isWeekId(week)) {
      res.status(404).json({ error: `Unknown week: ${week}` });
      return;
    }
    res.json(await store.readWeek(week));
  });

  app.put("/api/weeks/:week/:day/:meal", async (req, res) => {
    const { week, day, meal } = req.params;
    if (!isWeekId(week) || !DAYS.includes(day) || !MEALS.includes(meal)) {
      res.status(404).json({ error: `Unknown week, day, or meal: ${week}/${day}/${meal}` });
      return;
    }

    // Express 5 leaves req.body undefined when there is no JSON body.
    const text = req.body?.text;
    if (typeof text !== "string") {
      res.status(400).json({ error: '"text" must be a string' });
      return;
    }
    if (text.length > MAX_TEXT_LENGTH) {
      res.status(400).json({ error: `"text" must be at most ${MAX_TEXT_LENGTH} characters` });
      return;
    }

    res.json(await store.saveCell(week, day, meal, text));
  });
```

- [ ] **Step 4: Run the API tests to verify that they pass**

Run: `node --test test/api.test.js`

Expected: PASS, 14 tests.

- [ ] **Step 5: Run the migration on startup**

Replace `server/index.js` with:

```js
import path from "node:path";
import { createApp } from "./app.js";
import { createStore, weekIdOf } from "./store.js";

const port = Number(process.env.PORT || 3000);
const dataDir = path.resolve(process.env.DATA_DIR || "data");

const store = createStore({ dataDir });
// Data from the single-week version becomes the current week.
await store.migrateLegacyWeek(weekIdOf(new Date()));

const app = createApp({ store });

app.listen(port, "0.0.0.0", (error) => {
  if (error) throw error;
  console.log(`Meals listening on http://0.0.0.0:${port} (data: ${dataDir})`);
});
```

- [ ] **Step 6: Make the frontend save state week-aware**

Apply these edits to `public/app.js`.

Replace the first line with the new comment and import:

```js
// Weekly grid frontend. Depends ONLY on the HTTP API (/api/weeks); never import from server/.

import { dayIndex, weekIdOf } from "./dates.js";
```

Replace the four save-state maps and `cellKey` with:

```js
/** Last text confirmed by the server, per cell ("2026-09-21/mon/breakfast" -> text). */
const lastSaved = new Map();
/** Per-cell promise chain so saves of one cell run strictly in order. */
const saveChains = new Map();
/** Timer that hides the "✓" badge, per cell element: it acts on what is on screen, whatever the week. */
const savedTimers = new Map();
/** Text currently being PUT by the per-cell chain (cleared when that PUT settles). */
const inFlight = new Map();

// Keys include the week, so the same cell in two weeks never shares save state.
function cellKey(week, day, meal) {
  return `${week}/${day}/${meal}`;
}
```

Replace `todayId` with:

```js
function todayId() {
  return DAYS[dayIndex(new Date())].id;
}
```

Replace `fillWeek` with:

```js
function fillWeek(week, cells) {
  grid.dataset.week = week;
  for (const cell of grid.querySelectorAll(".cell")) {
    const { day, meal } = cell.dataset;
    const text = cells[day][meal];
    cell.querySelector("textarea").value = text;
    lastSaved.set(cellKey(week, day, meal), text);
    setStatus(cell, "idle"); // also clears a pending "✓" timer from the previous week
  }
}
```

In `setStatus`, delete the line
`const key = cellKey(cell.dataset.day, cell.dataset.meal);`, change
`clearTimeout(savedTimers.get(key));` to `clearTimeout(savedTimers.get(cell));`,
and change the timer block at the end to:

```js
  if (state === "saved") {
    savedTimers.set(
      cell,
      setTimeout(() => setStatus(cell, "idle"), SAVED_BADGE_MS),
    );
  }
```

Replace `queueSave` and the first lines of `saveIfChanged` (through the
`fetch` URL) so that both use the week the save was queued for:

```js
// Chains saves per cell: an older PUT can never finish after a newer one.
function queueSave(cell) {
  const { week } = grid.dataset;
  const key = cellKey(week, cell.dataset.day, cell.dataset.meal);
  const previous = saveChains.get(key) ?? Promise.resolve();
  const next = previous.then(() => saveIfChanged(cell, week));
  saveChains.set(key, next);
}

// Never rejects. Always saves the textarea's CURRENT value.
async function saveIfChanged(cell, week) {
  const { day, meal } = cell.dataset;
  const key = cellKey(week, day, meal);
  const text = cell.querySelector("textarea").value;
```

and, further down in `saveIfChanged`:

```js
    const response = await fetch(`/api/weeks/${week}/${day}/${meal}`, {
```

Leave the rest of `saveIfChanged` unchanged.

In `flushUnsaved`, add `const { week } = grid.dataset;` as the first line of
the function, change `const key = cellKey(day, meal);` to
`const key = cellKey(week, day, meal);`, change the URL to
`` `/api/weeks/${week}/${day}/${meal}` ``, and change the success handler to:

```js
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        // Server now has the text; clear a stale error badge if the page comes
        // back still showing this week.
        const status = cell.querySelector(".status");
        if (grid.dataset.week === week && status.dataset.state === "error") setStatus(cell, "idle");
      })
```

Replace `loadWeek` and the startup code at the end of the file with:

```js
async function loadWeek(week) {
  loadError.hidden = true;
  retryLoadButton.disabled = true;
  try {
    const response = await fetch(`/api/weeks/${week}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    fillWeek(week, await response.json());
    dayBar.hidden = false;
    grid.hidden = false;
  } catch (error) {
    console.error("Couldn't load the meal plan:", error);
    dayBar.hidden = true;
    grid.hidden = true;
    loadError.hidden = false;
  } finally {
    retryLoadButton.disabled = false;
  }
}

const currentWeek = weekIdOf(new Date());

buildDayBar();
buildGrid();
selectDay(todayId());
retryLoadButton.addEventListener("click", () => loadWeek(currentWeek));
window.addEventListener("pagehide", () => flushUnsaved({ skipInFlight: false }));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushUnsaved({ skipInFlight: true });
});
loadWeek(currentWeek);
```

- [ ] **Step 7: Check the migration and the app by hand**

Run these commands from the repository root. The scratch directory keeps your
real `data/` untouched:

```bash
SCRATCH=$(mktemp -d)
printf '{"mon":{"lunch":"Paella"}}\n' > "$SCRATCH/week.json"
DATA_DIR="$SCRATCH" PORT=3001 npm start
```

Expected output includes `Moved .../week.json to .../weeks/WEEK.json.`, where
`WEEK` is this week's Monday. Open `http://localhost:3001`:

- Monday lunch shows `Paella`.
- Edit a cell, click elsewhere, and reload: the text stays.

Stop the server with `Control+C`, start it again with the same command, and
check that no `Moved` line appears. Then run `rm -r "$SCRATCH"`.

- [ ] **Step 8: Update the README**

In `README.md`, make these changes.

In "Configure the server", change the `DATA_DIR` row to:

```markdown
| `DATA_DIR` | `./data` | The directory that stores the meal plan. |
```

Replace the whole "Back up and restore data" section with:

````markdown
## Back up and restore data

The meal plan lives in `data/weeks/`, with one file per week. Each file is
named after the week's Monday, for example `data/weeks/2026-09-21.json`. The
server creates a week's file on the first save in that week. Git ignores the
`data/` directory.

To back up the meal plan, copy the directory:

```bash
cp -r data/weeks weeks.backup
```

If a week file contains invalid JSON, the app shows
`Couldn't load the meal plan.` for that week and doesn't overwrite the file.
To recover, do the following:

1. Restore a backup copy of the week file, or fix the JSON by hand.
1. In the app, click **Retry**.

### Upgrade from a single week

Earlier versions stored one generic week in `data/week.json`. On startup, the
server moves that file to the current week, for example
`data/weeks/2026-09-21.json`, and prints a line about the move. If the current
week already has a file, the server leaves both files unchanged and prints a
warning.
````

In "Project structure", change the `store.js` line to:

```none
  store.js   # Reads and writes week files. The only module that touches disk.
```

Replace the whole "API reference" section after its introductory sentence with:

```markdown
A week is identified by the date of its Monday, formatted as `YYYY-MM-DD`, for
example `2026-09-21`.

### Get a week

`GET /api/weeks/WEEK`

| Status | Meaning |
|--------|---------|
| `200`  | The body is the full week. It contains the days `mon` through `sun`. Each day contains the meals `breakfast`, `snack_am`, `lunch`, `snack_pm`, and `dinner`, and each meal is a string. A week without saved cells has empty strings. |
| `404`  | `WEEK` isn't a valid week identifier. |

### Save a cell

`PUT /api/weeks/WEEK/DAY/MEAL`

Request body: `{ "text": "TEXT" }`

| Status | Meaning |
|--------|---------|
| `200`  | The cell was saved. The body is `{ "week", "day", "meal", "text" }`. |
| `400`  | `text` is missing, isn't a string, or is longer than 2000 characters. Length is counted in UTF-16 code units, like JavaScript's `String.length`. |
| `404`  | `WEEK`, `DAY`, or `MEAL` isn't a valid identifier. |
```

- [ ] **Step 9: Run the checks and commit**

```bash
npm run format
npm run lint
npm test
git add README.md public/app.js server/app.js server/index.js test/api.test.js
git commit -m "feat(api): serve and save meal plans by week" -m "Replace /api/week with /api/weeks/WEEK, move the legacy week.json into the
current week on startup, and key the frontend's save state by week."
```

---

### Task 4: Week bar, week changes, and the week in the URL

**Files:**

- Modify: `public/index.html` (header)
- Modify: `public/app.js` (week changes, hash, startup)
- Modify: `public/styles.css` (week bar)
- Modify: `README.md` (intro, use the app, project structure)

**Interfaces:**

- Consumes: `addWeeks`, `formatWeekRange`, `isWeekId`, and `weekIdOf` from
  `public/dates.js` (Task 1). `grid.dataset.week`, `cellKey`, `lastSaved`,
  `saveChains`, `loadWeek`, `selectDay`, and `todayId` from Task 3.
- Produces, in `public/app.js` for Task 5:
  - `goToWeek(week: string, { selectToday?: boolean }): Promise<void>`.
  - `blurActiveCell()`.
  - `loadWeek(week)` stays the single place where a week finishes loading.

- [ ] **Step 1: Add the week bar to the page**

In `public/index.html`, replace the `<header>` element with:

```html
    <header class="page-header">
      <h1>Weekly meal plan</h1>
      <nav id="week-bar" class="week-bar" aria-label="Week">
        <button type="button" id="previous-week" aria-label="Previous week">‹</button>
        <span id="week-range" class="week-range" aria-live="polite"></span>
        <button type="button" id="next-week" aria-label="Next week">›</button>
        <button type="button" id="today">Today</button>
      </nav>
    </header>
```

- [ ] **Step 2: Style the week bar**

In `public/styles.css`, add after the `.page-header h1` rule:

```css
.week-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.week-bar button {
  min-width: 2.5rem;
  padding: 0.4rem 0.8rem;
  border: 1px solid #ccc;
  border-radius: 0.4rem;
  background: #fff;
  font: inherit;
}

.week-range {
  flex: 1;
  font-weight: 600;
  text-align: center;
}
```

Inside the desktop block (`@media (min-width: 768px)`), add after the `body`
rule:

```css
  /* Fixed width, so the buttons don't move when the range text changes. */
  .week-range {
    flex: 0 0 14rem;
  }
```

- [ ] **Step 3: Change weeks in `public/app.js`**

Change the import to:

```js
import { addWeeks, dayIndex, formatWeekRange, isWeekId, weekIdOf } from "./dates.js";
```

After `const REQUEST_TIMEOUT_MS = ...`, add:

```js
const UNSAVED_QUESTION =
  "Some changes in this week couldn't be saved. Leave anyway and discard them?";
```

After `const retryLoadButton = ...`, add:

```js
const weekBar = document.getElementById("week-bar");
const weekRange = document.getElementById("week-range");
```

After the `inFlight` map, add:

```js
/** The week in the URL hash and the range label. Retry loads it again. */
let requestedWeek;
/** True while a week change runs, so two changes never overlap. */
let changingWeek = false;
```

Replace `selectDay` with these two functions:

```js
function blurActiveCell() {
  // Hiding a focused textarea doesn't reliably fire blur (and Safari doesn't
  // focus buttons on click), so blur it explicitly to trigger its save.
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement && grid.contains(active)) active.blur();
}

function selectDay(dayId) {
  blurActiveCell();
  grid.dataset.selectedDay = dayId;
  for (const button of dayBar.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.day === dayId));
  }
}
```

Add these functions after `loadWeek`:

```js
function syncHash() {
  // replaceState adds no history entry, so Back doesn't step through weeks.
  if (requestedWeek) history.replaceState(null, "", `#${requestedWeek}`);
}

function setChangingWeek(changing) {
  changingWeek = changing;
  for (const button of weekBar.querySelectorAll("button")) button.disabled = changing;
  grid.inert = changing; // no typing into a week that is being left
}

// Waits for pending saves, then returns true if the loaded week can be left:
// every cell is saved, or the user agreed to discard what couldn't be saved.
async function leaveLoadedWeek() {
  await Promise.all(saveChains.values());
  const { week } = grid.dataset;
  const unsaved = [...grid.querySelectorAll(".cell")].filter((cell) => {
    const saved = lastSaved.get(cellKey(week, cell.dataset.day, cell.dataset.meal));
    // undefined: never loaded, or already discarded.
    return saved !== undefined && cell.querySelector("textarea").value !== saved;
  });
  if (unsaved.length === 0) return true;
  if (!window.confirm(UNSAVED_QUESTION)) return false;
  // Forgetting the saved text makes the save on page hide skip these cells.
  for (const cell of unsaved) {
    lastSaved.delete(cellKey(week, cell.dataset.day, cell.dataset.meal));
  }
  return true;
}

// Shows `week` without ever dropping unsaved text silently. On mobile, the
// selected day stays the same unless `selectToday` is set.
async function goToWeek(week, { selectToday = false } = {}) {
  if (changingWeek) return;
  blurActiveCell(); // starts the save of the focused cell before the wait
  setChangingWeek(true);
  try {
    if (week !== grid.dataset.week || grid.hidden) {
      if (!(await leaveLoadedWeek())) return;
      requestedWeek = week;
      syncHash();
      weekRange.textContent = formatWeekRange(week);
      await loadWeek(week);
    }
    if (selectToday) selectDay(todayId());
  } finally {
    setChangingWeek(false);
    syncHash(); // also undoes a hash edit that was cancelled or ignored
  }
}
```

Replace the startup code at the end of the file (from
`const currentWeek = ...` to the end) with:

```js
buildDayBar();
buildGrid();
selectDay(todayId());
retryLoadButton.addEventListener("click", () => goToWeek(requestedWeek));
document
  .getElementById("previous-week")
  .addEventListener("click", () => goToWeek(addWeeks(requestedWeek, -1)));
document
  .getElementById("next-week")
  .addEventListener("click", () => goToWeek(addWeeks(requestedWeek, 1)));
document
  .getElementById("today")
  .addEventListener("click", () => goToWeek(weekIdOf(new Date()), { selectToday: true }));
window.addEventListener("hashchange", () => {
  const week = location.hash.slice(1);
  if (isWeekId(week)) goToWeek(week);
  else syncHash();
});
window.addEventListener("pagehide", () => flushUnsaved({ skipInFlight: false }));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushUnsaved({ skipInFlight: true });
});

const hashWeek = location.hash.slice(1);
goToWeek(isWeekId(hashWeek) ? hashWeek : weekIdOf(new Date()));
```

`goToWeek` disables the week bar synchronously, before its first `await`, so
`requestedWeek` is always set by the time a week bar button can fire.

- [ ] **Step 4: Update the README**

In `README.md`, change the second sentence of the introduction to:

```markdown
It shows one week at a time as a grid of 7 days by 5 meals (breakfast, morning
snack, lunch, afternoon snack, and dinner).
```

In "Use the app", after the Desktop and Mobile list, add:

```markdown
To move between weeks, use the week bar below the title. It shows the dates of
the displayed week:

- `‹` shows the previous week.
- `›` shows the next week.
- **Today** shows the current week. On mobile, it also selects today.

On mobile, changing weeks keeps the selected day. The address bar holds the
displayed week, for example `http://localhost:3000/#2026-09-21`, so a reload
shows the same week and you can bookmark a week.
```

After the paragraph that starts with "To retry a failed save", add:

```markdown
Before the app changes weeks, it waits for pending saves. If a cell couldn't be
saved, the app asks whether to leave the week anyway. To stay and retry the
save, click **Cancel**. To discard the unsaved text and change weeks, click
**OK**.
```

In "Project structure", replace the `public/` line with:

```none
public/      # User interface: HTML, CSS, and JavaScript, with no framework or build step.
  app.js     # Grid, week changes, and saves.
  dates.js   # Date helpers with no DOM access, so tests run them in Node.js.
  index.html
  styles.css
```

- [ ] **Step 5: Run the checks**

```bash
npm run format
npm run lint
npm test
```

Expected: all pass.

- [ ] **Step 6: Check the week changes by hand**

Start a scratch server with `DATA_DIR=$(mktemp -d) PORT=3001 npm start` and
open `http://localhost:3001` in a desktop browser. Check each item:

- The hash is this week's Monday, and the range shows this week.
- `›` and `‹` change the range and the hash. Text typed in one week doesn't
  appear in the next, and it's still there when you come back.
- Reloading keeps the displayed week.
- Clicking `›` five times as fast as you can ends with the range, the hash, and
  the grid on the same week.
- Editing the hash to `#hello`, `#2026-09-22`, or `#2026-02-30` puts the
  displayed week's hash back and changes nothing else. Editing it to another
  Monday shows that week.
- In mobile emulation (DevTools, a width below 768 px), select Thursday and
  click `›`: Thursday stays selected. Click **Today**: today is selected.
- Type in a cell, stop the server, and click `›`: the cell shows the red cross
  and the unsaved-changes question appears. **Cancel** keeps the week and the
  text. Click `›` again and choose **OK**: the week changes and
  `Couldn't load the meal plan.` appears. Start the server again and click
  **Retry**: the new week loads with no question.

- [ ] **Step 7: Commit**

```bash
git add README.md public/app.js public/index.html public/styles.css
git commit -m "feat(ui): navigate between weeks" -m "Add previous, next, and Today buttons with the week's date range, keep the
displayed week in the URL hash, and wait for pending saves before leaving a
week, asking before discarding text that couldn't be saved."
```

---

### Task 5: Dates on days and the today marker

**Files:**

- Modify: `public/app.js` (day bar, day headers, today marker)
- Modify: `public/styles.css` (day buttons, today marker)
- Modify: `README.md` (use the app)

**Interfaces:**

- Consumes: `addDays`, `formatLongDate`, `weekIdOf`, and `weekStart` from
  `public/dates.js` (Task 1). `grid.dataset.week` and `todayId` from Task 3.
  `loadWeek` from Task 3.
- Produces: `showDayDates(week)` and `markToday()` in `public/app.js`. Elements
  that show today get the `data-today` attribute.

- [ ] **Step 1: Show the date on each day**

Change the import in `public/app.js` to:

```js
import {
  addDays,
  addWeeks,
  dayIndex,
  formatLongDate,
  formatWeekRange,
  isWeekId,
  weekIdOf,
  weekStart,
} from "./dates.js";
```

In `buildDayBar`, replace
`const button = createElement("button", "", day.short);` with:

```js
    const button = createElement("button");
    // The day number is filled in when a week loads.
    button.append(createElement("span", "day-letter", day.short), createElement("span", "day-number"));
```

In `buildGrid`, replace
`for (const day of DAYS) grid.append(createElement("div", "day-header", day.label));`
with:

```js
  for (const day of DAYS) {
    const header = createElement("div", "day-header", day.label);
    header.dataset.day = day.id;
    grid.append(header);
  }
```

Add these functions after `fillWeek`:

```js
// Puts the day of the month on the desktop headers and the mobile day bar.
function showDayDates(week) {
  const monday = weekStart(week);
  for (const [index, day] of DAYS.entries()) {
    const date = addDays(monday, index);
    grid.querySelector(`.day-header[data-day="${day.id}"]`).textContent =
      `${day.label} ${date.getDate()}`;
    const button = dayBar.querySelector(`button[data-day="${day.id}"]`);
    button.querySelector(".day-number").textContent = String(date.getDate());
    button.setAttribute("aria-label", formatLongDate(date));
  }
}

// Marks today's header, cells, and day bar button when the loaded week contains today.
function markToday() {
  const todayDay = weekIdOf(new Date()) === grid.dataset.week ? todayId() : null;
  for (const element of document.querySelectorAll("[data-day]")) {
    element.toggleAttribute("data-today", element.dataset.day === todayDay);
  }
}
```

In `loadWeek`, after `fillWeek(week, await response.json());`, add:

```js
    showDayDates(week);
    markToday();
```

Replace the `visibilitychange` listener at the end of the file with:

```js
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushUnsaved({ skipInFlight: true });
  else markToday(); // the day may have changed while the page was hidden
});
```

- [ ] **Step 2: Style the dates and the today marker**

In `public/styles.css`, inside the desktop block, add after the `.cell` rule:

```css
  .day-header[data-today] {
    background: #2e7d32;
    color: #fff;
  }

  .cell[data-today] {
    background: #eef6ee;
  }
```

Inside the mobile block (`@media (max-width: 767.98px)`), add these
declarations to the existing `.day-bar button` rule:

```css
    display: flex;
    flex-direction: column;
    align-items: center;
    line-height: 1.2;
```

and add after the `.day-bar button[aria-pressed="true"]` rule:

```css
  .day-number {
    font-size: 0.8rem;
    font-weight: 400;
  }

  /* Today: accent outline. Selected: filled accent. Both: filled with an inner white ring. */
  .day-bar button[data-today] {
    border-color: #2e7d32;
    box-shadow: inset 0 0 0 1px #2e7d32;
  }

  .day-bar button[data-today][aria-pressed="true"] {
    box-shadow: inset 0 0 0 2px #fff;
  }
```

- [ ] **Step 3: Update the README**

In "Use the app", replace the Desktop and Mobile list with:

```markdown
- **Desktop** (windows 768 px wide or wider): the full grid shows one column
  per day and one row per meal. Each day header shows the weekday and the day
  of the month.
- **Mobile:** the app shows one day at a time. To switch days, tap a day in the
  day bar. Each button shows the weekday letter and the day of the month. When
  the page opens, it shows the current day.

When the displayed week contains today, the app marks today in green. On
desktop, it marks today's column. On mobile, it outlines today's button in the
day bar.
```

- [ ] **Step 4: Run the checks**

```bash
npm run format
npm run lint
npm test
```

Expected: all pass.

- [ ] **Step 5: Check the dates and the marker by hand**

Start a scratch server with `DATA_DIR=$(mktemp -d) PORT=3001 npm start` and
check each item:

- On desktop, the headers read like `Monday 21`, and only today's header is
  green, with a light green column. In the next week, no column is marked.
- On mobile emulation, each button shows a letter over a number. Today has a
  green outline. Selecting another day keeps the outline on today, and
  selecting today shows the green fill with a white inner ring.
- A screen reader or the DevTools accessibility pane gives the day buttons
  names like `Monday, September 21`.
- With the page open, set the system clock to the next day and switch to
  another tab and back: the marker moves to the new day. **Today** goes to the
  week of the new date. Set the clock back afterward.

- [ ] **Step 6: Commit**

```bash
git add README.md public/app.js public/styles.css
git commit -m "feat(ui): show dates on days and mark today" -m "Show the day of the month on desktop headers and mobile day buttons, and
mark today's column on desktop and today's button on mobile."
```

---

## Final verification

Before you open the pull request, run the full manual check list in the spec,
"Testing" > "Manual checks", against a scratch server, on desktop and on mobile
emulation. Then run `npm run lint` and `npm test` once more on the final branch.
