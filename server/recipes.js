// The recipe book: lists, creates, renames, archives, and restores recipes.
// Names are unique by name key, across active and archived recipes. Recipes
// are never deleted, so a menu never points to a recipe that doesn't exist.

import { randomUUID } from "node:crypto";
import { NameConflictError, NotFoundError, ValidationError } from "./errors.js";
import { dataPath, readJson, writeJson } from "./files.js";

export const MAX_NAME_LENGTH = 100;

/** The name as stored: trimmed, with runs of whitespace collapsed to one space. */
export function cleanName(name) {
  return name.trim().replace(/\s+/g, " ");
}

/**
 * Decides uniqueness and order. It ignores case and accents, so "Café" and
 * "cafe" share a key. public/recipe-search.js has the same rule.
 */
export function nameKey(name) {
  return name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function byNameKey(a, b) {
  const keyA = nameKey(a.name);
  const keyB = nameKey(b.name);
  if (keyA < keyB) return -1;
  return keyA > keyB ? 1 : 0;
}

function validName(name) {
  if (typeof name !== "string") throw new ValidationError('"name" must be a string.');
  const clean = cleanName(name);
  if (clean === "") throw new ValidationError("The name can't be empty.");
  if (clean.length > MAX_NAME_LENGTH) {
    throw new ValidationError(`The name must be at most ${MAX_NAME_LENGTH} characters.`);
  }
  return clean;
}

// A PATCH body: exactly one of { name } or { archived }.
function validChanges(changes) {
  const isObject = changes !== null && typeof changes === "object" && !Array.isArray(changes);
  const keys = isObject ? Object.keys(changes) : [];
  if (keys.length !== 1 || (keys[0] !== "name" && keys[0] !== "archived")) {
    throw new ValidationError('Send exactly one of "name" or "archived".');
  }
  if (keys[0] === "name") return { name: validName(changes.name) };
  if (typeof changes.archived !== "boolean") {
    throw new ValidationError('"archived" must be true or false.');
  }
  return { archived: changes.archived };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
    .map((entry) => ({ id: entry.id, name: entry.name, archived: entry.archived === true }));
}

export function createRecipes({ dataDir, enqueue }) {
  const file = dataPath(dataDir, "recipes.json");

  async function readAll() {
    return normalize(await readJson(file));
  }

  // The recipe, other than `exceptId`, whose name key equals the key of `name`.
  function holderOf(all, name, exceptId) {
    const key = nameKey(name);
    return all.find((recipe) => recipe.id !== exceptId && nameKey(recipe.name) === key);
  }

  function conflict(recipe) {
    return new NameConflictError(`A recipe named "${recipe.name}" already exists.`, recipe);
  }

  /** Every recipe, archived ones included, from A to Z. Never waits for the queue. */
  async function list() {
    return (await readAll()).sort(byNameKey);
  }

  async function create(name) {
    const clean = validName(name);
    return enqueue(async () => {
      const all = await readAll();
      const holder = holderOf(all, clean);
      if (holder) throw conflict(holder);
      const recipe = { id: randomUUID(), name: clean, archived: false };
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
      Object.assign(recipe, valid);
      await writeJson(file, { recipes: all });
      return recipe;
    });
  }

  return { create, list, update };
}
