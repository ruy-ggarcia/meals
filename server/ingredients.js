// The ingredient catalog: lists, creates, renames, archives, and restores
// ingredients, and changes their unit and measures. Names are unique by name
// key, across active and archived ingredients. Ingredients are never deleted,
// so a recipe never points to an ingredient that doesn't exist.

import { randomUUID } from "node:crypto";
import { ConflictError, NameConflictError, NotFoundError, ValidationError } from "./errors.js";
import { dataPath, readJson, writeJson } from "./files.js";
import { byNameKey, holderOf, nameKey, validName, validNameAt } from "./names.js";
import {
  cleanQuantity,
  MAX_QUANTITY,
  MIN_QUANTITY,
  requireQuantity,
  TOLERANCE,
} from "./quantities.js";
import { isPlainObject, shapeOf } from "./shapes.js";

export const UNITS = ["g", "ml", "pcs"];
export const MAX_MEASURES = 20;

export function validUnit(unit) {
  if (!UNITS.includes(unit)) {
    throw new ValidationError(`"unit" must be one of ${UNITS.join(", ")}.`);
  }
  return unit;
}

// The measures of a request, as clean { id, name, amount } entries. A new
// entry has only name and amount and gets a new ID. An entry with an id must
// have an ID in `existing`, the measures that the ingredient has now.
export function validMeasures(measures, existing) {
  if (!Array.isArray(measures)) throw new ValidationError('"measures" must be an array.');
  if (measures.length > MAX_MEASURES) {
    throw new ValidationError(`An ingredient holds at most ${MAX_MEASURES} measures.`);
  }
  const ids = new Set();
  const keys = new Set();
  return measures.map((entry, index) => {
    const where = `measures[${index}]`;
    const shape = shapeOf(entry);
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
export function validNewIngredient(fields) {
  const shape = shapeOf(fields);
  if (shape !== "name,unit" && shape !== "measures,name,unit") {
    throw new ValidationError('Send "name" and "unit", and optionally "measures".');
  }
  return {
    name: validName(fields.name),
    unit: validUnit(fields.unit),
    measures: "measures" in fields ? validMeasures(fields.measures, []) : [],
  };
}

// A conversion { from, to } and optionally { measureName }: `from` of the old
// unit equal `to` of the new unit. The measure name stays as sent, because
// only the recipes tell whether it's needed.
export function validConversion(conversion) {
  const shape = shapeOf(conversion);
  if (shape !== "from,to" && shape !== "from,measureName,to") {
    throw new ValidationError(
      '"conversion" must have "from" and "to", and optionally "measureName".',
    );
  }
  return {
    from: requireQuantity(conversion.from, "conversion.from"),
    to: requireQuantity(conversion.to, "conversion.to"),
    measureName: conversion.measureName,
  };
}

/**
 * @typedef {object} IngredientChanges
 * @property {boolean} [archived]
 * @property {{ from: any, measureName: any, to: any }} [conversion]
 * @property {any[]} [measures]
 * @property {string} [name]
 * @property {string} [unit]
 */

/**
 * A PATCH body: any non-empty combination of name, unit, measures, and
 * conversion, or { archived } alone. A conversion needs a unit and can't go
 * with measures. The measures stay as sent, because their IDs are checked
 * against the stored ingredient inside the queue.
 * @returns {IngredientChanges}
 */
export function validChanges(changes) {
  const keys = isPlainObject(changes) ? Object.keys(changes) : [];
  if (keys.length === 1 && keys[0] === "archived") {
    if (typeof changes.archived !== "boolean") {
      throw new ValidationError('"archived" must be true or false.');
    }
    return { archived: changes.archived };
  }
  if (
    keys.length === 0 ||
    keys.some((key) => !["conversion", "measures", "name", "unit"].includes(key))
  ) {
    throw new ValidationError(
      'Send "name", "unit", "measures", "conversion", or any combination, or "archived" alone.',
    );
  }
  /** @type {IngredientChanges} */
  const valid = {};
  if (keys.includes("name")) valid.name = validName(changes.name);
  if (keys.includes("unit")) valid.unit = validUnit(changes.unit);
  if (keys.includes("measures")) {
    if (!Array.isArray(changes.measures)) throw new ValidationError('"measures" must be an array.');
    valid.measures = changes.measures;
  }
  if (keys.includes("conversion")) {
    if (valid.unit === undefined) throw new ValidationError('Send "conversion" with a new "unit".');
    if (valid.measures !== undefined) {
      throw new ValidationError('Send "conversion" and "measures" in separate changes.');
    }
    valid.conversion = validConversion(changes.conversion);
  }
  return valid;
}

// The measure's amount times the factor, rounded to two decimals. The limits
// apply before rounding, with the tolerance of cleanQuantity for binary
// floating point, so 0.0067 is rejected and 0.009999999999999998 isn't. The
// message shows the amount with 4 significant digits, and `hint` after it.
export function convertedAmount(measure, factor, unit, hint) {
  const amount = measure.amount * factor;
  const hundredths = amount * 100;
  if (hundredths < MIN_QUANTITY * 100 - TOLERANCE || hundredths > MAX_QUANTITY * 100 + TOLERANCE) {
    const shown = Number(amount.toPrecision(4));
    throw new ValidationError(
      `"${measure.name}" would be ${shown} ${unit}, outside ${MIN_QUANTITY} to ${MAX_QUANTITY}.${hint ? ` ${hint}` : ""}`,
    );
  }
  return Math.round(hundredths) / 100;
}

// The error for a unit change that needs a conversion and has none.
// `measures`, if the body has them, are already valid. The editor sends
// edited measures with the unit that it shows, and never with a unit change
// once it knows of a measure. So measures that keep a stored one come from an
// editor that loaded the ingredient before its unit changed elsewhere, and a
// reload shows the conversion. Without one, the body changes the unit and
// replaces the measures at once, which takes two saves.
export function missingConversion(ingredient, measures) {
  const known = new Set(ingredient.measures.map((measure) => measure.id));
  if (measures !== undefined && !measures.some((measure) => known.has(measure.id))) {
    return new ValidationError(
      `To change the unit of "${ingredient.name}", save your measure changes first, and then change the unit.`,
    );
  }
  return new ValidationError(
    `"${ingredient.name}" has measures or recipes in ${ingredient.unit}. Reload the page to change its unit.`,
  );
}

// The measure that takes the recipe lines in the unit of the ingredient, for
// a conversion with `measureName`, as { target, added }. It's the measure with
// the name key of `measureName` and an amount of 1, which equals one old unit,
// or else a new measure with that name and an amount of 1, and then `added`
// is true.
export function unitMeasure(ingredient, measureName) {
  if (measureName === undefined) {
    throw new ValidationError(
      `A recipe has "${ingredient.name}" in ${ingredient.unit}, so send conversion.measureName to name the measure that replaces it.`,
    );
  }
  const name = validNameAt(measureName, "conversion.measureName");
  const target = ingredient.measures.find((measure) => nameKey(measure.name) === nameKey(name));
  if (target) {
    if (target.amount !== 1) {
      throw new ValidationError(
        `"${ingredient.name}" already has a measure named "${target.name}".`,
      );
    }
    return { target, added: false };
  }
  if (ingredient.measures.length >= MAX_MEASURES) {
    throw new ValidationError(
      `"${ingredient.name}" already has ${MAX_MEASURES} measures, so its unit can't become one.`,
    );
  }
  return { target: { id: randomUUID(), name, amount: 1 }, added: true };
}

// Keeps only the measures that a PATCH would accept, so a hand-edited file
// can't break the app. A missing `measures` is an empty list.
export function normalizeMeasures(raw) {
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
export function normalize(raw) {
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

// Whether `fields`, the changes without the conversion, give the ingredient a
// unit other than its current one.
export function changesUnit(ingredient, fields) {
  return fields.unit !== undefined && fields.unit !== ingredient.unit;
}

/**
 * The error for a change that breaks the rules of the unit, or undefined.
 * `conversion` is the validated conversion of the change, if it has one, and
 * `usage` is what the recipes use of the ingredient. The caller reads `usage`
 * only when the change gives the ingredient another unit, and passes undefined
 * otherwise. A `conversion` that this function accepts therefore comes with a
 * unit change, and with `usage`.
 */
export function unitChangeError(ingredient, fields, conversion, usage) {
  if (!changesUnit(ingredient, fields)) {
    return conversion ? new ValidationError('Send "conversion" with a new "unit".') : undefined;
  }
  const needed = usage.inUnit || ingredient.measures.length > 0;
  if (needed && !conversion) return missingConversion(ingredient, fields.measures);
  if (!needed && conversion) {
    return new ValidationError(
      `"${ingredient.name}" has no measures and no recipe uses its unit, so it needs no "conversion".`,
    );
  }
  return undefined;
}

// What a unit change writes, from the ingredient as stored: `measures`, every
// measure converted to the new unit `unit`, and, when `inUnit`, `target`, the
// measure that takes the recipe lines in the old unit, and whether it's
// `added` to the stored ones. Throws a ValidationError, before anything is
// written, when the measureName or a converted amount breaks a rule.
export function planUnitChange(ingredient, unit, { from, to, measureName }, inUnit) {
  const { target, added } = inUnit
    ? unitMeasure(ingredient, measureName)
    : { target: undefined, added: false };
  const factor = to / from;
  const hint = `To change the unit, first change the recipes that use "${ingredient.name}" in ${ingredient.unit} to a measure.`;
  const measures = [...ingredient.measures, ...(added ? [target] : [])].map((measure) => ({
    ...measure,
    amount: convertedAmount(measure, factor, unit, measure === target ? hint : undefined),
  }));
  return { added, measures, target };
}

// The stored measures that `measures`, the new list, leaves out.
export function removedMeasures(ingredient, measures) {
  const kept = new Set(measures.map((measure) => measure.id));
  return ingredient.measures.filter((measure) => !kept.has(measure.id));
}

// The first of the `removed` measures that the recipes use, given the IDs in
// `measureIds`, or undefined.
export function removedMeasureInUse(removed, measureIds) {
  return removed.find((measure) => measureIds.has(measure.id));
}

// The error for removing `measure` while recipes use it.
function measureInUse(measure) {
  return new ConflictError(
    `"${measure.name}" is used in recipes. To remove it, change those recipes first.`,
  );
}

// The error for a name that `ingredient`, another entry, already holds.
function nameConflict(ingredient) {
  return new NameConflictError(
    `An ingredient named "${ingredient.name}" already exists.`,
    "ingredient",
    ingredient,
  );
}

/**
 * The catalog `all` with a new ingredient, from `fields` as POST
 * /api/ingredients takes them, with the ID `id`. Returns `{ all, ingredient }`
 * and never changes its arguments.
 */
export function withNewIngredient(all, fields, id) {
  const valid = validNewIngredient(fields);
  const holder = holderOf(all, valid.name);
  if (holder) throw nameConflict(holder);
  const ingredient = {
    id,
    name: valid.name,
    unit: valid.unit,
    measures: valid.measures,
    archived: false,
  };
  return { all: [...all, ingredient], ingredient };
}

const UNIT_IN_EDITOR = "The unit of an ingredient changes in the ingredient editor.";

// The usage for a change that removes no measure, which doesn't need it.
const NO_USAGE = { inUnit: false, measureIds: new Set() };

/**
 * The catalog `all` with the changes to the ingredient `id`, from `changes`
 * as PATCH /api/ingredients/:id takes them. A unit change moves recipe lines
 * and needs the person to choose a conversion, so this function accepts
 * only the stored unit, which changes nothing, and no conversion. `usage` is
 * what the recipes use of the ingredient, `{ inUnit, measureIds }`. Returns
 * `{ all, ingredient }` and never changes its arguments.
 */
export function withIngredientChanges(all, id, changes, usage) {
  if (isPlainObject(changes) && "conversion" in changes) {
    throw new ValidationError(UNIT_IN_EDITOR);
  }
  const valid = validChanges(changes);
  const ingredient = all.find((entry) => entry.id === id);
  if (!ingredient) throw new NotFoundError(`Unknown ingredient: ${id}`);
  if (changesUnit(ingredient, valid)) throw new ValidationError(UNIT_IN_EDITOR);
  if (valid.name !== undefined) {
    const holder = holderOf(all, valid.name, id);
    if (holder) throw nameConflict(holder);
  }
  const changed = { ...ingredient, ...valid };
  if (valid.measures !== undefined) {
    changed.measures = validMeasures(valid.measures, ingredient.measures);
    const removed = removedMeasures(ingredient, changed.measures);
    const used = removedMeasureInUse(removed, usage.measureIds);
    if (used) throw measureInUse(used);
  }
  return {
    all: all.map((entry) => (entry === ingredient ? changed : entry)),
    ingredient: changed,
  };
}

/**
 * `usageOf(id)` resolves to what the recipes, active or archived, use of the
 * ingredient: `{ inUnit, measureIds }`, where `inUnit` tells whether a recipe
 * has it in its unit, and `measureIds` holds the IDs of its measures that
 * recipes use. `moveUnitLinesToMeasure(id, measureId)` points every recipe
 * line of the ingredient in its unit to the measure. The store calls both
 * only inside the queue, so no recipe write runs between the check and the
 * save.
 */
export function createIngredients({ dataDir, enqueue, moveUnitLinesToMeasure, usageOf }) {
  const file = dataPath(dataDir, "ingredients.json");

  /** Every ingredient as stored. Never waits for the queue. */
  async function readAll() {
    return normalize(await readJson(file));
  }

  /**
   * Writes the catalog `all`. Doesn't enqueue: the caller is already inside
   * the queue.
   */
  async function writeAll(all) {
    await writeJson(file, { ingredients: all });
  }

  /** Every ingredient, archived ones included, from A to Z. Never waits for the queue. */
  async function list() {
    return (await readAll()).sort(byNameKey);
  }

  // Throws a ConflictError when a recipe uses a measure of the ingredient that
  // `measures`, its new list, leaves out.
  async function checkRemovedMeasuresUnused(ingredient, measures) {
    const removed = removedMeasures(ingredient, measures);
    if (removed.length === 0) return;
    const { measureIds } = await usageOf(ingredient.id);
    const used = removedMeasureInUse(removed, measureIds);
    if (used) throw measureInUse(used);
  }

  // What the recipes use of the ingredient, for `measures`, the measures of a
  // change as sent. Reads the recipe book only when they leave out a stored
  // measure: any other change doesn't depend on the recipes, so it saves even
  // when the recipe book can't be read.
  async function usageForRemovals(ingredient, measures) {
    if (measures === undefined) return NO_USAGE;
    const removed = removedMeasures(ingredient, measures.filter(isPlainObject));
    return removed.length > 0 ? usageOf(ingredient.id) : NO_USAGE;
  }

  // The body is checked before the queue, so a bad request never waits for
  // it, and checked again inside it, against the data.
  async function create(fields) {
    validNewIngredient(fields);
    return enqueue(async () => {
      const next = withNewIngredient(await readAll(), fields, randomUUID());
      await writeAll(next.all);
      return next.ingredient;
    });
  }

  async function update(id, changes) {
    const valid = validChanges(changes);
    return enqueue(async () => {
      const all = await readAll();
      const ingredient = all.find((entry) => entry.id === id);
      if (!ingredient) throw new NotFoundError(`Unknown ingredient: ${id}`);
      if (valid.conversion !== undefined || changesUnit(ingredient, valid)) {
        return updateWithUnit(all, ingredient, valid);
      }
      const usage = await usageForRemovals(ingredient, valid.measures);
      const next = withIngredientChanges(all, id, changes, usage);
      await writeAll(next.all);
      return next.ingredient;
    });
  }

  // Applies `valid`, changes that give the ingredient, one of `all`, another
  // unit or have a conversion. Inside the queue.
  async function updateWithUnit(all, ingredient, valid) {
    if (valid.name !== undefined) {
      const holder = holderOf(all, valid.name, ingredient.id);
      if (holder) throw nameConflict(holder);
    }
    if (valid.measures !== undefined) {
      valid.measures = validMeasures(valid.measures, ingredient.measures);
      await checkRemovedMeasuresUnused(ingredient, valid.measures);
    }
    const { conversion, ...fields } = valid;
    const usage = changesUnit(ingredient, fields) ? await usageOf(ingredient.id) : undefined;
    const error = unitChangeError(ingredient, fields, conversion, usage);
    if (error) throw error;
    if (conversion) return changeUnit(all, ingredient, fields, conversion, usage.inUnit);
    Object.assign(ingredient, fields);
    await writeAll(all);
    return ingredient;
  }

  // Changes the unit of the ingredient, one of `all`, with the conversion, and
  // applies the other fields. When `inUnit`, the lines in the old unit move
  // to a measure. Every check runs before the first write. The writes follow
  // three steps, so that a failure after any of them leaves every recipe with
  // the same meaning: add the new measure with an amount of 1 in the old unit,
  // point the lines to it, and then convert every measure. A measure with the
  // name key of `measureName` and an amount of 1 already equals one old unit,
  // such as the one that a failed step 2 left, so it takes the lines instead
  // of a new one.
  async function changeUnit(all, ingredient, fields, conversion, inUnit) {
    const { added, measures, target } = planUnitChange(ingredient, fields.unit, conversion, inUnit);
    if (added) {
      ingredient.measures.push(target);
      await writeAll(all);
    }
    if (target) await moveUnitLinesToMeasure(ingredient.id, target.id);
    Object.assign(ingredient, fields, { measures });
    await writeAll(all);
    return ingredient;
  }

  return { create, list, readAll, update, writeAll };
}
