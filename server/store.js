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
