// The recipe book: lists, creates, and changes recipes: their name, their
// ingredients, and whether they're archived. Names are unique by name key,
// across active and archived recipes. Recipes are never deleted, so a menu
// never points to a recipe that doesn't exist.

import { randomUUID } from "node:crypto";
import { NameConflictError, NotFoundError, ValidationError } from "./errors.js";
import { dataPath, readJson, writeJson } from "./files.js";
import { byNameKey, holderOf, validName } from "./names.js";
import { cleanQuantity, requireQuantity } from "./quantities.js";
import { isPlainObject, shapeOf } from "./shapes.js";

export const MAX_INGREDIENTS = 50;

// Checks the ingredients of a request, except that their ingredients exist.
// Returns clean copies with only ingredientId, quantity, and, for a line in a
// measure, measureId.
function validIngredients(ingredients) {
  if (!Array.isArray(ingredients)) throw new ValidationError('"ingredients" must be an array.');
  if (ingredients.length > MAX_INGREDIENTS) {
    throw new ValidationError(`A recipe holds at most ${MAX_INGREDIENTS} ingredients.`);
  }
  const seen = new Set();
  return ingredients.map((entry, index) => {
    const where = `ingredients[${index}]`;
    const shape = shapeOf(entry);
    if (shape !== "ingredientId,quantity" && shape !== "ingredientId,measureId,quantity") {
      throw new ValidationError(
        `${where} must have "ingredientId" and "quantity", and optionally "measureId".`,
      );
    }
    if (typeof entry.ingredientId !== "string") {
      throw new ValidationError(`${where}.ingredientId must be a string.`);
    }
    if (seen.has(entry.ingredientId)) {
      throw new ValidationError(`${where} repeats ingredient ${entry.ingredientId}.`);
    }
    seen.add(entry.ingredientId);
    const quantity = requireQuantity(entry.quantity, `${where}.quantity`);
    if ("measureId" in entry) {
      if (typeof entry.measureId !== "string") {
        throw new ValidationError(`${where}.measureId must be a string.`);
      }
      return { ingredientId: entry.ingredientId, measureId: entry.measureId, quantity };
    }
    return { ingredientId: entry.ingredientId, quantity };
  });
}

// A POST body: { name }, with optional ingredients, and nothing else.
function validNewRecipe(fields) {
  if (
    !isPlainObject(fields) ||
    Object.keys(fields).some((key) => key !== "name" && key !== "ingredients")
  ) {
    throw new ValidationError('Send "name" and, optionally, "ingredients".');
  }
  return {
    name: validName(fields.name),
    ingredients: fields.ingredients === undefined ? [] : validIngredients(fields.ingredients),
  };
}

// A PATCH body: { name }, { ingredients }, or both, or { archived } alone.
function validChanges(changes) {
  const keys = isPlainObject(changes) ? Object.keys(changes) : [];
  if (keys.length === 1 && keys[0] === "archived") {
    if (typeof changes.archived !== "boolean") {
      throw new ValidationError('"archived" must be true or false.');
    }
    return { archived: changes.archived };
  }
  if (keys.length === 0 || keys.some((key) => key !== "name" && key !== "ingredients")) {
    throw new ValidationError('Send "name", "ingredients", or both, or "archived" alone.');
  }
  const valid = {};
  if (keys.includes("name")) valid.name = validName(changes.name);
  if (keys.includes("ingredients")) valid.ingredients = validIngredients(changes.ingredients);
  return valid;
}

// Keeps only the ingredients that a PATCH would accept: a string
// ingredientId, a valid quantity, a string measureId if it has the key, no
// repeats, at most MAX_INGREDIENTS. Doesn't check the catalog, so a write
// never drops another recipe's ingredients just because the catalog on disk
// is older or missing.
function normalizeIngredients(raw) {
  const clean = [];
  const seen = new Set();
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (clean.length === MAX_INGREDIENTS) break;
    if (!isPlainObject(entry) || typeof entry.ingredientId !== "string") continue;
    const inMeasure = "measureId" in entry;
    if (inMeasure && typeof entry.measureId !== "string") continue;
    const quantity = cleanQuantity(entry.quantity);
    if (quantity === undefined || seen.has(entry.ingredientId)) continue;
    seen.add(entry.ingredientId);
    clean.push(
      inMeasure
        ? { ingredientId: entry.ingredientId, measureId: entry.measureId, quantity }
        : { ingredientId: entry.ingredientId, quantity },
    );
  }
  return clean;
}

// Keeps only well-formed entries, so a hand-edited file can't break the app.
// `raw` is undefined when the file doesn't exist, which is an empty recipe
// book. A file that exists but isn't shaped like { recipes: [...] } is
// rejected instead, the same as invalid JSON, so it's never overwritten.
function normalize(raw) {
  if (raw === undefined) return [];
  if (!isPlainObject(raw) || !Array.isArray(raw.recipes)) {
    throw new Error('recipes.json must be an object with a "recipes" array.');
  }
  return raw.recipes
    .filter((entry) => typeof entry?.id === "string" && typeof entry.name === "string")
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      archived: entry.archived === true,
      ingredients: normalizeIngredients(entry.ingredients),
    }));
}

export function createRecipes({ dataDir, enqueue, ingredients }) {
  const file = dataPath(dataDir, "recipes.json");

  // Every recipe as stored, with its ingredients checked by shape only.
  async function readAll() {
    return normalize(await readJson(file));
  }

  // The IDs of the measures of each ingredient in the catalog.
  async function knownMeasures() {
    return new Map(
      (await ingredients.list()).map((ingredient) => [
        ingredient.id,
        new Set(ingredient.measures.map((measure) => measure.id)),
      ]),
    );
  }

  // Whether the catalog `known` has the entry's ingredient and, if it has one,
  // its measure.
  function isKnown(known, entry) {
    const measureIds = known.get(entry.ingredientId);
    return (
      measureIds !== undefined && (entry.measureId === undefined || measureIds.has(entry.measureId))
    );
  }

  // A copy of `recipe` without the ingredients that `known` doesn't have, or
  // whose measure it doesn't have.
  function withKnownIngredients(recipe, known) {
    return { ...recipe, ingredients: recipe.ingredients.filter((entry) => isKnown(known, entry)) };
  }

  // Throws if any entry's ingredient or measure isn't in `known`. Called
  // inside the queue, with `known` read there, so no catalog write runs
  // between this check and the save.
  function checkIngredientsExist(known, entries) {
    const unknown = entries.find((entry) => !known.has(entry.ingredientId));
    if (unknown) throw new ValidationError(`Unknown ingredient: ${unknown.ingredientId}`);
    const unknownMeasure = entries.find((entry) => !isKnown(known, entry));
    if (unknownMeasure) throw new ValidationError(`Unknown measure: ${unknownMeasure.measureId}`);
  }

  function conflict(recipe) {
    return new NameConflictError(
      `A recipe named "${recipe.name}" already exists.`,
      "recipe",
      recipe,
    );
  }

  /**
   * Every recipe, archived ones included, from A to Z, without the
   * ingredients that the catalog doesn't have. Never waits for the queue.
   * Reads the recipes before the catalog: ingredients are never deleted, so
   * this order can't drop an ingredient that a concurrent write just added.
   */
  async function list() {
    const all = await readAll();
    const known = await knownMeasures();
    return all.map((recipe) => withKnownIngredients(recipe, known)).sort(byNameKey);
  }

  /**
   * The IDs of every recipe, archived ones included. Doesn't read the
   * ingredient catalog, and never waits for the queue.
   */
  async function ids() {
    return (await readAll()).map((recipe) => recipe.id);
  }

  async function create(fields) {
    const valid = validNewRecipe(fields);
    return enqueue(async () => {
      const all = await readAll();
      const holder = holderOf(all, valid.name);
      if (holder) throw conflict(holder);
      checkIngredientsExist(await knownMeasures(), valid.ingredients);
      const recipe = {
        id: randomUUID(),
        name: valid.name,
        archived: false,
        ingredients: valid.ingredients,
      };
      await writeJson(file, { recipes: [...all, recipe] });
      return recipe;
    });
  }

  async function update(id, changes) {
    const valid = validChanges(changes);
    return enqueue(async () => {
      const all = await readAll();
      const recipe = all.find((entry) => entry.id === id);
      if (!recipe) throw new NotFoundError(`Unknown recipe: ${id}`);
      if (valid.name !== undefined) {
        const holder = holderOf(all, valid.name, id);
        if (holder) throw conflict(holder);
      }
      const known = await knownMeasures();
      if (valid.ingredients !== undefined) checkIngredientsExist(known, valid.ingredients);
      Object.assign(recipe, valid);
      await writeJson(file, { recipes: all });
      // The file keeps what the catalog doesn't have, but the reply matches list().
      return withKnownIngredients(recipe, known);
    });
  }

  /**
   * What the recipes, active and archived, use of the ingredient: `inUnit` is
   * whether any line has it in its unit, and `measureIds` holds the IDs of
   * its measures that any line uses. Never waits for the queue.
   */
  async function usageOf(ingredientId) {
    let inUnit = false;
    const measureIds = new Set();
    for (const recipe of await readAll()) {
      for (const entry of recipe.ingredients) {
        if (entry.ingredientId !== ingredientId) continue;
        if (entry.measureId === undefined) inUnit = true;
        else measureIds.add(entry.measureId);
      }
    }
    return { inUnit, measureIds };
  }

  /**
   * Points every line of the ingredient that is in its unit to the measure, in
   * every recipe, and writes the file once if any line changed. Returns how
   * many lines changed. Doesn't enqueue: the caller is already inside the
   * queue, and waiting for it here would never finish.
   */
  async function moveUnitLinesToMeasure(ingredientId, measureId) {
    const all = await readAll();
    let changed = 0;
    for (const recipe of all) {
      recipe.ingredients = recipe.ingredients.map((entry) => {
        if (entry.ingredientId !== ingredientId || entry.measureId !== undefined) return entry;
        changed += 1;
        return { ingredientId, measureId, quantity: entry.quantity };
      });
    }
    if (changed > 0) await writeJson(file, { recipes: all });
    return changed;
  }

  return { create, ids, list, moveUnitLinesToMeasure, update, usageOf };
}
