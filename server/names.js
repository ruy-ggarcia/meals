// Name rules shared by the recipe book and the ingredient catalog: cleanup,
// the name key, validation, and uniqueness.

import { ValidationError } from "./errors.js";

export const MAX_NAME_LENGTH = 100;

/** The name as stored: trimmed, with runs of whitespace collapsed to one space. */
export function cleanName(name) {
  return name.trim().replace(/\s+/g, " ");
}

/**
 * Decides uniqueness and order. It ignores case and accents, so "Café" and
 * "cafe" share a key. public/name-search.js has the same rule.
 */
export function nameKey(name) {
  return name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Compares two entries with a `name`, for sorting from A to Z by name key. */
export function byNameKey(a, b) {
  const keyA = nameKey(a.name);
  const keyB = nameKey(b.name);
  if (keyA < keyB) return -1;
  return keyA > keyB ? 1 : 0;
}

/** The cleaned name. Throws a ValidationError when it breaks a rule. */
export function validName(name) {
  if (typeof name !== "string") throw new ValidationError('"name" must be a string.');
  const clean = cleanName(name);
  if (clean === "") throw new ValidationError("The name can't be empty.");
  if (clean.length > MAX_NAME_LENGTH) {
    throw new ValidationError(`The name must be at most ${MAX_NAME_LENGTH} characters.`);
  }
  return clean;
}

/** The entry of `all`, other than `exceptId`, whose name key equals the key of `name`. */
export function holderOf(all, name, exceptId) {
  const key = nameKey(cleanName(name));
  return all.find((entry) => entry.id !== exceptId && nameKey(entry.name) === key);
}
