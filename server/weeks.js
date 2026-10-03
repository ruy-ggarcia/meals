// Weeks of menus. Each slot of a week holds a menu, { items: [{ recipeId,
// servings }] }. One file per week in DATA_DIR/v2/weeks/, named after the
// week's Monday.

import { ValidationError } from "./errors.js";
import { dataPath, readJson, writeJson } from "./files.js";

// Stable identifiers shared by the API and the storage format. Order matters.
export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const MEALS = ["breakfast", "snack_am", "lunch", "snack_pm", "dinner"];

export const MAX_ITEMS = 20;
export const MIN_SERVINGS = 0.5;
export const MAX_SERVINGS = 99;

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

// Multiples of 0.5 are exact in binary floating point, so this check is exact.
function isValidServings(servings) {
  return (
    typeof servings === "number" &&
    Number.isInteger(servings * 2) &&
    servings >= MIN_SERVINGS &&
    servings <= MAX_SERVINGS
  );
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function emptyWeek() {
  return Object.fromEntries(
    DAYS.map((day) => [day, Object.fromEntries(MEALS.map((meal) => [meal, { items: [] }]))]),
  );
}

// Keeps only well-formed items, in the shape saveSlot writes: a string
// recipeId, valid servings, no repeats, at most MAX_ITEMS. Doesn't check that
// each recipe still exists, so a save never drops another slot's items just
// because the recipe book on disk is older, missing, or the wrong shape.
function normalizeMenuShape(raw) {
  const items = [];
  const seen = new Set();
  for (const item of Array.isArray(raw?.items) ? raw.items : []) {
    if (items.length === MAX_ITEMS) break;
    if (
      !isPlainObject(item) ||
      typeof item.recipeId !== "string" ||
      !isValidServings(item.servings)
    ) {
      continue;
    }
    if (seen.has(item.recipeId)) continue;
    seen.add(item.recipeId);
    items.push({ recipeId: item.recipeId, servings: item.servings });
  }
  return { items };
}

// Also drops items whose recipe isn't in the current recipe book, so a
// hand-edited file, or a recipe book restored from an older backup, never
// produces a slot that can't be saved again. Used for reads only.
function normalizeMenu(raw, knownRecipeIds) {
  const shaped = normalizeMenuShape(raw);
  return { items: shaped.items.filter((item) => knownRecipeIds.has(item.recipeId)) };
}

// Builds a complete 7 x 5 week from whatever was parsed: unknown keys are
// dropped, and missing or broken menus become empty.
function normalize(raw, knownRecipeIds) {
  const week = emptyWeek();
  for (const day of DAYS) {
    for (const meal of MEALS) {
      week[day][meal] = normalizeMenu(raw?.[day]?.[meal], knownRecipeIds);
    }
  }
  return week;
}

// Same shape as normalize, but for the save path: keeps only the item shape,
// never the recipe-book filter, so saving one slot can't erase another
// slot's items just because the recipe book on disk is older, missing, or
// the wrong shape.
function normalizeStructure(raw) {
  const week = emptyWeek();
  for (const day of DAYS) {
    for (const meal of MEALS) {
      week[day][meal] = normalizeMenuShape(raw?.[day]?.[meal]);
    }
  }
  return week;
}

// Checks the items of a PUT body, except that their recipes exist. Returns
// clean copies with only recipeId and servings.
function validItems(items) {
  if (!Array.isArray(items)) throw new ValidationError('"items" must be an array.');
  if (items.length > MAX_ITEMS) {
    throw new ValidationError(`A menu holds at most ${MAX_ITEMS} menu items.`);
  }
  const seen = new Set();
  return items.map((item, index) => {
    const where = `items[${index}]`;
    if (!isPlainObject(item) || Object.keys(item).sort().join() !== "recipeId,servings") {
      throw new ValidationError(`${where} must have exactly "recipeId" and "servings".`);
    }
    if (typeof item.recipeId !== "string") {
      throw new ValidationError(`${where}.recipeId must be a string.`);
    }
    if (seen.has(item.recipeId)) {
      throw new ValidationError(`${where} repeats recipe ${item.recipeId}.`);
    }
    seen.add(item.recipeId);
    if (!isValidServings(item.servings)) {
      throw new ValidationError(
        `${where}.servings must be a multiple of ${MIN_SERVINGS} from ${MIN_SERVINGS} to ${MAX_SERVINGS}.`,
      );
    }
    return { recipeId: item.recipeId, servings: item.servings };
  });
}

export function createWeeks({ dataDir, enqueue, recipes }) {
  function weekFile(week) {
    return dataPath(dataDir, "weeks", `${week}.json`);
  }

  async function knownRecipeIds() {
    return new Set(await recipes.ids());
  }

  async function readWeek(week) {
    if (!isWeekId(week)) throw new RangeError(`Unknown week: ${week}`);
    // Read the week before the recipe book: recipes are never deleted, so
    // this order can't drop a menu item whose recipe a concurrent save just
    // created (the reverse order could, if that save's new recipe reaches
    // disk between the two reads).
    const raw = await readJson(weekFile(week));
    return normalize(raw, await knownRecipeIds());
  }

  async function saveSlot(week, day, meal, items) {
    if (!isWeekId(week) || !DAYS.includes(day) || !MEALS.includes(meal)) {
      throw new RangeError(`Unknown slot: ${week}/${day}/${meal}`);
    }
    const clean = validItems(items);
    return enqueue(async () => {
      // Inside the queue, so no recipe write runs between this check and the
      // save.
      const known = await knownRecipeIds();
      const unknown = clean.find((item) => !known.has(item.recipeId));
      if (unknown) throw new ValidationError(`Unknown recipe: ${unknown.recipeId}`);
      const raw = await readJson(weekFile(week));
      const data = normalizeStructure(raw);
      data[day][meal] = { items: clean };
      await writeJson(weekFile(week), data);
      return { week, day, meal, items: clean };
    });
  }

  return { readWeek, saveSlot };
}
