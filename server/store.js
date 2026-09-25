import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

// Stable identifiers shared by the API and the storage format. Order matters.
export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const MEALS = ["breakfast", "snack_am", "lunch", "snack_pm", "dinner"];

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

export function createStore({ dataDir }) {
  const file = path.join(dataDir, "week.json");
  const tmpFile = `${file}.tmp`;
  // Every save runs after the previous one finishes, so two read-modify-write
  // cycles never interleave and lose each other's changes.
  let queue = Promise.resolve();

  async function readWeek() {
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return emptyWeek();
      throw error;
    }
    // Invalid JSON throws on purpose: treating it as empty would overwrite the
    // user's data on the next save.
    return normalize(JSON.parse(text));
  }

  async function writeCell(day, meal, text) {
    const week = await readWeek();
    week[day][meal] = text;
    await mkdir(dataDir, { recursive: true });
    await writeFile(tmpFile, `${JSON.stringify(week, null, 2)}\n`);
    await rename(tmpFile, file); // atomic replace
    return { day, meal, text };
  }

  async function saveCell(day, meal, text) {
    if (!DAYS.includes(day) || !MEALS.includes(meal)) {
      throw new RangeError(`Unknown cell: ${day}/${meal}`);
    }
    const run = queue.then(() => writeCell(day, meal, text));
    queue = run.catch(() => {}); // a failed save must not block later ones
    return run;
  }

  return { readWeek, saveCell };
}
