// The ingredient catalog: lists, creates, renames, archives, and restores
// ingredients, and changes their unit. Names are unique by name key, across
// active and archived ingredients. Ingredients are never deleted, so a recipe
// never points to an ingredient that doesn't exist.

import { randomUUID } from "node:crypto";
import { ConflictError, NameConflictError, NotFoundError, ValidationError } from "./errors.js";
import { dataPath, readJson, writeJson } from "./files.js";
import { byNameKey, holderOf, validName } from "./names.js";

export const UNITS = ["g", "ml", "pcs"];

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validUnit(unit) {
  if (!UNITS.includes(unit)) {
    throw new ValidationError(`"unit" must be one of ${UNITS.join(", ")}.`);
  }
  return unit;
}

// A POST body: exactly { name, unit }.
function validNewIngredient(fields) {
  const keys = isPlainObject(fields) ? Object.keys(fields).sort().join() : "";
  if (keys !== "name,unit") throw new ValidationError('Send exactly "name" and "unit".');
  return { name: validName(fields.name), unit: validUnit(fields.unit) };
}

// A PATCH body: { name }, { unit }, or both, or { archived } alone.
function validChanges(changes) {
  const keys = isPlainObject(changes) ? Object.keys(changes) : [];
  if (keys.length === 1 && keys[0] === "archived") {
    if (typeof changes.archived !== "boolean") {
      throw new ValidationError('"archived" must be true or false.');
    }
    return { archived: changes.archived };
  }
  if (keys.length === 0 || keys.some((key) => key !== "name" && key !== "unit")) {
    throw new ValidationError('Send "name", "unit", or both, or "archived" alone.');
  }
  const valid = {};
  if (keys.includes("name")) valid.name = validName(changes.name);
  if (keys.includes("unit")) valid.unit = validUnit(changes.unit);
  return valid;
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
      archived: entry.archived === true,
    }));
}

/**
 * `isInUse(id)` tells whether any recipe, active or archived, uses the
 * ingredient. The store calls it only inside the queue, so no recipe write
 * runs between the check and the save.
 */
export function createIngredients({ dataDir, enqueue, isInUse }) {
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

  async function create(fields) {
    const valid = validNewIngredient(fields);
    return enqueue(async () => {
      const all = await readAll();
      const holder = holderOf(all, valid.name);
      if (holder) throw conflict(holder);
      const ingredient = { id: randomUUID(), name: valid.name, unit: valid.unit, archived: false };
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
      if (valid.unit !== undefined && valid.unit !== ingredient.unit && (await isInUse(id))) {
        throw new ConflictError(
          `"${ingredient.name}" is used in recipes. To change its unit, remove it from those recipes first.`,
        );
      }
      Object.assign(ingredient, valid);
      await writeJson(file, { ingredients: all });
      return ingredient;
    });
  }

  return { create, list, update };
}
