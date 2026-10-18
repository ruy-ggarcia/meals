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

// A conversion { from, to } and optionally { measureName }: `from` of the old
// unit equal `to` of the new unit. The measure name stays as sent, because
// only the recipes tell whether it's needed.
function validConversion(conversion) {
  const shape = isPlainObject(conversion) ? Object.keys(conversion).sort().join() : "";
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

// A PATCH body: any non-empty combination of name, unit, measures, and
// conversion, or { archived } alone. A conversion needs a unit and can't go
// with measures. The measures stay as sent, because their IDs are checked
// against the stored ingredient inside the queue.
function validChanges(changes) {
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
function convertedAmount(measure, factor, unit, hint) {
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
function missingConversion(ingredient, measures) {
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
function unitMeasure(ingredient, measureName) {
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
 * recipes use. `moveUnitLinesToMeasure(id, measureId)` points every recipe
 * line of the ingredient in its unit to the measure. The store calls both
 * only inside the queue, so no recipe write runs between the check and the
 * save.
 */
export function createIngredients({ dataDir, enqueue, moveUnitLinesToMeasure, usageOf }) {
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
      const { conversion, ...fields } = valid;
      if (fields.unit === undefined || fields.unit === ingredient.unit) {
        if (conversion) throw new ValidationError('Send "conversion" with a new "unit".');
      } else {
        const { inUnit } = await usageOf(id);
        const needed = inUnit || ingredient.measures.length > 0;
        if (needed && !conversion) throw missingConversion(ingredient, fields.measures);
        if (!needed && conversion) {
          throw new ValidationError(
            `"${ingredient.name}" has no measures and no recipe uses its unit, so it needs no "conversion".`,
          );
        }
        if (conversion) return changeUnit(all, ingredient, fields, conversion, inUnit);
      }
      Object.assign(ingredient, fields);
      await writeJson(file, { ingredients: all });
      return ingredient;
    });
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
  async function changeUnit(all, ingredient, fields, { from, to, measureName }, inUnit) {
    const { target, added } = inUnit
      ? unitMeasure(ingredient, measureName)
      : { target: undefined, added: false };
    const factor = to / from;
    const hint = `To change the unit, first change the recipes that use "${ingredient.name}" in ${ingredient.unit} to a measure.`;
    const measures = [...ingredient.measures, ...(added ? [target] : [])].map((measure) => ({
      ...measure,
      amount: convertedAmount(measure, factor, fields.unit, measure === target ? hint : undefined),
    }));
    if (added) {
      ingredient.measures.push(target);
      await writeJson(file, { ingredients: all });
    }
    if (target) await moveUnitLinesToMeasure(ingredient.id, target.id);
    Object.assign(ingredient, fields, { measures });
    await writeJson(file, { ingredients: all });
    return ingredient;
  }

  return { create, list, update };
}
