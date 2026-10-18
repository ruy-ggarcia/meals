// The ingredient catalog: lists, creates, renames, archives, and restores
// ingredients, and changes their unit and measures. Names are unique by name
// key, across active and archived ingredients. Ingredients are never deleted,
// so a recipe never points to an ingredient that doesn't exist.

import { randomUUID } from "node:crypto";
import { ConflictError, NameConflictError, NotFoundError, ValidationError } from "./errors.js";
import { dataPath, readJson, writeJson } from "./files.js";
import { byNameKey, holderOf, nameKey, validName, validNameAt } from "./names.js";
import { cleanQuantity, MAX_QUANTITY, MIN_QUANTITY, requireQuantity } from "./quantities.js";

export const UNITS = ["g", "ml", "pcs"];
export const MAX_MEASURES = 20;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validUnit(unit) {
  if (!UNITS.includes(unit)) {
    throw new ValidationError(`"unit" must be one of ${UNITS.join(", ")}.`);
  }
  return unit;
}

// The measures of a request, as clean { id, name, amount } entries. A new
// entry has only name and amount and gets a new ID. An entry with an id must
// have an ID in `existing`, the measures that the ingredient has now.
function validMeasures(measures, existing) {
  if (!Array.isArray(measures)) throw new ValidationError('"measures" must be an array.');
  if (measures.length > MAX_MEASURES) {
    throw new ValidationError(`An ingredient holds at most ${MAX_MEASURES} measures.`);
  }
  const ids = new Set();
  const keys = new Set();
  return measures.map((entry, index) => {
    const where = `measures[${index}]`;
    const shape = isPlainObject(entry) ? Object.keys(entry).sort().join() : "";
    if (shape !== "amount,name" && shape !== "amount,id,name") {
      throw new ValidationError(`${where} must have "name" and "amount", or also "id".`);
    }
    let id = entry.id;
    if (shape === "amount,name") {
      id = randomUUID();
    } else if (!existing.some((measure) => measure.id === id)) {
      throw new ValidationError(`${where}.id isn't a measure of this ingredient.`);
    }
    if (ids.has(id)) throw new ValidationError(`${where} repeats measure ${id}.`);
    ids.add(id);
    const name = validNameAt(entry.name, where);
    if (keys.has(nameKey(name))) {
      throw new ValidationError(`${where} repeats the measure name "${name}".`);
    }
    keys.add(nameKey(name));
    const amount = requireQuantity(entry.amount, `${where}.amount`);
    return { id, name, amount };
  });
}

// A POST body: { name, unit } and optionally { measures }.
function validNewIngredient(fields) {
  const keys = isPlainObject(fields) ? Object.keys(fields).sort().join() : "";
  if (keys !== "name,unit" && keys !== "measures,name,unit") {
    throw new ValidationError('Send "name" and "unit", and optionally "measures".');
  }
  return {
    name: validName(fields.name),
    unit: validUnit(fields.unit),
    measures: "measures" in fields ? validMeasures(fields.measures, []) : [],
  };
}

// A PATCH body: any non-empty combination of name, unit, and measures, or
// { archived } alone. The measures stay as sent, because their IDs are checked
// against the stored ingredient inside the queue.
function validChanges(changes) {
  const keys = isPlainObject(changes) ? Object.keys(changes) : [];
  if (keys.length === 1 && keys[0] === "archived") {
    if (typeof changes.archived !== "boolean") {
      throw new ValidationError('"archived" must be true or false.');
    }
    return { archived: changes.archived };
  }
  if (keys.length === 0 || keys.some((key) => !["measures", "name", "unit"].includes(key))) {
    throw new ValidationError(
      'Send "name", "unit", "measures", or any combination, or "archived" alone.',
    );
  }
  const valid = {};
  if (keys.includes("name")) valid.name = validName(changes.name);
  if (keys.includes("unit")) valid.unit = validUnit(changes.unit);
  if (keys.includes("measures")) {
    if (!Array.isArray(changes.measures)) throw new ValidationError('"measures" must be an array.');
    valid.measures = changes.measures;
  }
  return valid;
}

// Keeps only the measures that a PATCH would accept, so a hand-edited file
// can't break the app. A missing `measures` is an empty list.
function normalizeMeasures(raw) {
  if (!Array.isArray(raw)) return [];
  const ids = new Set();
  const keys = new Set();
  const measures = [];
  for (const entry of raw) {
    if (!isPlainObject(entry) || typeof entry.id !== "string" || ids.has(entry.id)) continue;
    const amount = cleanQuantity(entry.amount);
    if (amount === undefined) continue;
    let name;
    try {
      name = validName(entry.name);
    } catch {
      continue;
    }
    if (keys.has(nameKey(name))) continue;
    ids.add(entry.id);
    keys.add(nameKey(name));
    measures.push({ id: entry.id, name, amount });
  }
  return measures.slice(0, MAX_MEASURES);
}

// Keeps only well-formed entries, so a hand-edited file can't break the app.
// `raw` is undefined when the file doesn't exist, which is an empty catalog.
// A file that exists but isn't shaped like { ingredients: [...] } is rejected
// instead, the same as invalid JSON, so it's never overwritten.
function normalize(raw) {
  if (raw === undefined) return [];
  if (!isPlainObject(raw) || !Array.isArray(raw.ingredients)) {
    throw new Error('ingredients.json must be an object with an "ingredients" array.');
  }
  return raw.ingredients
    .filter(
      (entry) =>
        typeof entry?.id === "string" &&
        typeof entry.name === "string" &&
        UNITS.includes(entry.unit),
    )
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      unit: entry.unit,
      measures: normalizeMeasures(entry.measures),
      archived: entry.archived === true,
    }));
}

/**
 * `usageOf(id)` resolves to what the recipes, active or archived, use of the
 * ingredient: `{ inUnit, measureIds }`, where `inUnit` tells whether a recipe
 * has it in its unit, and `measureIds` holds the IDs of its measures that
 * recipes use. The store calls it only inside the queue, so no recipe write
 * runs between the check and the save.
 */
export function createIngredients({ dataDir, enqueue, usageOf }) {
  const file = dataPath(dataDir, "ingredients.json");

  async function readAll() {
    return normalize(await readJson(file));
  }

  function conflict(ingredient) {
    return new NameConflictError(
      `An ingredient named "${ingredient.name}" already exists.`,
      "ingredient",
      ingredient,
    );
  }

  /** Every ingredient, archived ones included, from A to Z. Never waits for the queue. */
  async function list() {
    return (await readAll()).sort(byNameKey);
  }

  // Throws a ConflictError when a recipe uses a measure of the ingredient that
  // `measures`, its new list, leaves out.
  async function checkRemovedMeasuresUnused(ingredient, measures) {
    const kept = new Set(measures.map((measure) => measure.id));
    const removed = ingredient.measures.filter((measure) => !kept.has(measure.id));
    if (removed.length === 0) return;
    const { measureIds } = await usageOf(ingredient.id);
    const used = removed.find((measure) => measureIds.has(measure.id));
    if (used) {
      throw new ConflictError(
        `"${used.name}" is used in recipes. To remove it, change those recipes first.`,
      );
    }
  }

  async function create(fields) {
    const valid = validNewIngredient(fields);
    return enqueue(async () => {
      const all = await readAll();
      const holder = holderOf(all, valid.name);
      if (holder) throw conflict(holder);
      const ingredient = {
        id: randomUUID(),
        name: valid.name,
        unit: valid.unit,
        measures: valid.measures,
        archived: false,
      };
      await writeJson(file, { ingredients: [...all, ingredient] });
      return ingredient;
    });
  }

  async function update(id, changes) {
    const valid = validChanges(changes);
    return enqueue(async () => {
      const all = await readAll();
      const ingredient = all.find((entry) => entry.id === id);
      if (!ingredient) throw new NotFoundError(`Unknown ingredient: ${id}`);
      if (valid.name !== undefined) {
        const holder = holderOf(all, valid.name, id);
        if (holder) throw conflict(holder);
      }
      if (valid.measures !== undefined) {
        valid.measures = validMeasures(valid.measures, ingredient.measures);
        await checkRemovedMeasuresUnused(ingredient, valid.measures);
      }
      if (valid.unit !== undefined && valid.unit !== ingredient.unit) {
        const usage = await usageOf(id);
        if (usage.inUnit || usage.measureIds.size > 0) {
          throw new ConflictError(
            `"${ingredient.name}" is used in recipes. To change its unit, remove it from those recipes first.`,
          );
        }
      }
      Object.assign(ingredient, valid);
      await writeJson(file, { ingredients: all });
      return ingredient;
    });
  }

  return { create, list, update };
}
