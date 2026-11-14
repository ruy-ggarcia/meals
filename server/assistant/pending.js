// Pending changes: what the assistant proposes and nothing saves until you
// apply it. Each target, an ingredient, a recipe, or a slot, has at most one
// pending change. The functions here are pure: they compute the data that the
// changes would save from the data as stored, and never read or write a file.

import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { ConflictError, NameConflictError, NotFoundError, ValidationError } from "../errors.js";
import { withIngredientChanges, withNewIngredient } from "../ingredients.js";
import { measureIdsByIngredient, usageIn, withNewRecipe, withRecipeChanges } from "../recipes.js";
import { isPlainObject } from "../shapes.js";
import { isSlot, withSlot } from "../weeks.js";

/**
 * A change that the assistant proposes, one of these:
 * - `{ kind: "ingredient" | "recipe", action: "create", id, fields }`
 * - `{ kind: "ingredient" | "recipe", action: "update", id, changes, base }`
 * - `{ kind: "menu", week, day, meal, items, base }`
 *
 * `id` of a create is the ID that the entry gets when applied. `base` is the
 * stored target when the change was staged: the ingredient, the recipe, or
 * the slot's items.
 * @typedef {object} PendingChange
 * @property {string} kind
 * @property {string} [action]
 * @property {any} [base]
 * @property {any} [changes]
 * @property {string} [day]
 * @property {any} [fields]
 * @property {string} [id]
 * @property {any[]} [items]
 * @property {string} [meal]
 * @property {string} [week]
 */

/**
 * A change as the assistant proposes it: an ingredient or a recipe, without
 * `id` to create one, or a menu. `kind` is `ingredient`, `menu`, or `recipe`.
 * @typedef {object} Proposal
 * @property {string} kind
 * @property {any} [changes]
 * @property {string} [day]
 * @property {any} [fields]
 * @property {string} [id]
 * @property {any[]} [items]
 * @property {string} [meal]
 * @property {string} [week]
 */

/**
 * @typedef {object} Problem
 * @property {string} target
 * @property {string} message
 */

/** @typedef {import("../stores.js").State} State */

// The errors that a rule of the stores throws. Anything else is a bug.
const STORE_ERRORS = [ConflictError, NameConflictError, NotFoundError, ValidationError];

// How the user interface names a slot, as in "Tuesday dinner".
const DAY_NAMES = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};
const MEAL_NAMES = {
  breakfast: "breakfast",
  snack_am: "morning snack",
  lunch: "lunch",
  snack_pm: "afternoon snack",
  dinner: "dinner",
};

/**
 * The key of the change's target: `ingredient:<id>`, `recipe:<id>`, or
 * `menu:<week>/<day>/<meal>`.
 * @param {PendingChange} change
 * @returns {string}
 */
export function targetOf(change) {
  if (change.kind === "menu") return `menu:${change.week}/${change.day}/${change.meal}`;
  return `${change.kind}:${change.id}`;
}

/**
 * How the user interface names the slot of `day` and `meal`, such as
 * "Tuesday dinner", or `undefined` when either is unknown.
 * @param {string} day
 * @param {string} meal
 * @returns {string | undefined}
 */
export function slotName(day, meal) {
  if (!Object.hasOwn(DAY_NAMES, day) || !Object.hasOwn(MEAL_NAMES, meal)) return undefined;
  return `${DAY_NAMES[day]} ${MEAL_NAMES[meal]}`;
}

function isStoreError(error) {
  return STORE_ERRORS.some((type) => error instanceof type);
}

// The stored items of the slot, or an empty list when the slot is missing.
// A week that nobody planned is still in `state.weeks`, so a missing one means
// that the caller didn't load it: reading it as empty would let Apply report
// a week as saved without writing it.
function storedItems(state, week, day, meal) {
  if (state.weeks[week] === undefined) throw new RangeError(`Week ${week} isn't loaded.`);
  return state.weeks[week][day]?.[meal]?.items ?? [];
}

// Throws when the target of an update, one of `stored`, changed after the
// change was staged, so applying it never overwrites an edit that the
// assistant didn't see. An unknown target is left to the store's rules.
function checkBase(stored, change) {
  const entry = stored.find((candidate) => candidate.id === change.id);
  if (entry && !isDeepStrictEqual(entry, change.base)) {
    throw new ConflictError(`${entry.name} changed after the assistant proposed this.`);
  }
}

/**
 * Applies `body`, the fields or changes of an ingredient, through `apply`,
 * which takes them as the API does and returns `{ all, ingredient }`. The API
 * gives new measures their IDs, but a pending measure already has the ID that
 * it got when staged, so a pending recipe can use it. Every measure ID that
 * `existing` doesn't hold is such an ID: it's left out of what `apply` checks
 * and put back on the result, which keeps the order of the measures.
 */
function withStagedMeasureIds(body, existing, apply) {
  if (!isPlainObject(body) || !Array.isArray(body.measures)) return apply(body).all;
  const stagedIds = body.measures.map((entry) =>
    isPlainObject(entry) && typeof entry.id === "string" && !existing.has(entry.id)
      ? entry.id
      : undefined,
  );
  const seen = new Set();
  stagedIds.forEach((id, index) => {
    if (id === undefined) return;
    if (seen.has(id)) throw new ValidationError(`measures[${index}] repeats measure ${id}.`);
    seen.add(id);
  });
  const measures = body.measures.map((entry, index) => {
    if (stagedIds[index] === undefined) return entry;
    const { id: _, ...rest } = entry;
    return rest;
  });
  const { all, ingredient } = apply({ ...body, measures });
  const changed = {
    ...ingredient,
    measures: ingredient.measures.map((measure, index) =>
      stagedIds[index] === undefined ? measure : { ...measure, id: stagedIds[index] },
    ),
  };
  return all.map((entry) => (entry === ingredient ? changed : entry));
}

// The catalog `all` with the ingredient change. `state` is the data as
// stored: its recipes tell which measures are in use, because ingredients
// apply before the pending recipe changes.
function applyIngredient(state, all, change) {
  if (change.action === "create") {
    return withStagedMeasureIds(change.fields, new Set(), (body) =>
      withNewIngredient(all, body, change.id),
    );
  }
  checkBase(state.ingredients, change);
  const stored = all.find((entry) => entry.id === change.id);
  const existing = new Set((stored?.measures ?? []).map((measure) => measure.id));
  return withStagedMeasureIds(change.changes, existing, (body) =>
    withIngredientChanges(all, change.id, body, usageIn(state.recipes, change.id)),
  );
}

// The recipe book `all` with the recipe change, checked against `known`, the
// measures of the next catalog.
function applyRecipe(state, all, known, change) {
  if (change.action === "create") return withNewRecipe(all, change.fields, known, change.id).all;
  checkBase(state.recipes, change);
  return withRecipeChanges(all, change.id, change.changes, known).all;
}

// The weeks `weeks` with the menu of the change, whose recipes must be in
// `recipeIds`.
function applyMenu(state, weeks, recipeIds, change) {
  const { week, day, meal } = change;
  if (!isDeepStrictEqual(storedItems(state, week, day, meal), change.base)) {
    throw new ConflictError(`${slotName(day, meal)} changed after the assistant proposed this.`);
  }
  return { ...weeks, [week]: withSlot(weeks[week], day, meal, change.items, recipeIds) };
}

/**
 * nextState, with the error of each change that fails instead of a message.
 * @param {State} state
 * @param {PendingChange[]} changes
 */
function compute(state, changes) {
  /** @type {{ target: string, error: Error }[]} */
  const failures = [];
  // Runs `apply` on each change of `kind`, in list order, and returns the
  // last value that it gives, starting from `value`.
  function applyAll(kind, value, apply) {
    let current = value;
    for (const change of changes) {
      if (change.kind !== kind) continue;
      try {
        current = apply(current, change);
      } catch (error) {
        if (!isStoreError(error)) throw error;
        failures.push({ target: targetOf(change), error });
      }
    }
    return current;
  }
  const ingredients = applyAll("ingredient", state.ingredients, (all, change) =>
    applyIngredient(state, all, change),
  );
  const known = measureIdsByIngredient(ingredients);
  const recipes = applyAll("recipe", state.recipes, (all, change) =>
    applyRecipe(state, all, known, change),
  );
  const recipeIds = new Set(recipes.map((recipe) => recipe.id));
  const weeks = applyAll("menu", state.weeks, (all, change) =>
    applyMenu(state, all, recipeIds, change),
  );
  return { state: { ingredients, recipes, weeks }, failures };
}

/**
 * The data that the changes would save, from `state`, the data as stored. It
 * applies the ingredients, then the recipes, and then the menus, each in list
 * order. A change that breaks a rule of the stores, or whose target changed
 * after it was staged, becomes a problem and is skipped. Never changes its
 * arguments, and a list or a week that no change touches stays the same
 * object.
 * @param {State} state
 * @param {PendingChange[]} changes
 * @returns {{ state: State, problems: Problem[] }}
 */
export function nextState(state, changes) {
  const { state: next, failures } = compute(state, changes);
  return {
    state: next,
    problems: failures.map(({ target, error }) => ({ target, message: error.message })),
  };
}

// The IDs of the measures of `body`, the fields or changes of a pending
// ingredient.
function measureIdsOf(body) {
  if (!isPlainObject(body) || !Array.isArray(body.measures)) return [];
  return body.measures.filter(isPlainObject).map((measure) => measure.id);
}

// `body`, the fields or changes of an ingredient proposal, with an ID for each
// new measure. Any other ID must be in `known`.
function withMeasureIds(body, known) {
  if (!isPlainObject(body) || !Array.isArray(body.measures)) return body;
  const measures = body.measures.map((entry, index) => {
    if (!isPlainObject(entry)) return entry;
    if (!("id" in entry)) return { id: randomUUID(), ...entry };
    if (!known.has(entry.id)) {
      throw new ValidationError(`measures[${index}].id isn't a measure of this ingredient.`);
    }
    return entry;
  });
  return { ...body, measures };
}

/**
 * The pending change of `proposal`.
 * @param {State} state
 * @param {PendingChange[]} changes
 * @param {Proposal} proposal
 * @returns {PendingChange}
 */
function changeOf(state, changes, proposal) {
  const { kind } = proposal;
  if (kind === "menu") {
    const { week, day, meal, items } = proposal;
    if (!isSlot(week, day, meal)) throw new ValidationError(`Unknown slot: ${week}/${day}/${meal}`);
    return { kind, week, day, meal, items, base: storedItems(state, week, day, meal) };
  }
  if (kind !== "ingredient" && kind !== "recipe") throw new RangeError(`Unknown kind: ${kind}`);
  const withIds = (body, known) => (kind === "ingredient" ? withMeasureIds(body, known) : body);
  const { id } = proposal;
  if (id === undefined) {
    return {
      kind,
      action: "create",
      id: randomUUID(),
      fields: withIds(proposal.fields, new Set()),
    };
  }
  const pending = changes.find((change) => change.kind === kind && change.id === id);
  if (pending?.action === "create") {
    const known = new Set(measureIdsOf(pending.fields));
    return { kind, action: "create", id, fields: withIds(proposal.fields, known) };
  }
  const stored = (kind === "ingredient" ? state.ingredients : state.recipes).find(
    (entry) => entry.id === id,
  );
  if (!stored) throw new NotFoundError(`Unknown ${kind}: ${id}`);
  const known = new Set([
    ...(stored.measures ?? []).map((measure) => measure.id),
    ...(pending?.action === "update" ? measureIdsOf(pending.changes) : []),
  ]);
  return { kind, action: "update", id, changes: withIds(proposal.changes, known), base: stored };
}

/**
 * Adds the change of `proposal` to `changes`, in place of the change of the
 * same target if there's one. Without `id`, an ingredient or a recipe is a
 * create with a new ID. With the ID of a pending create, it replaces that
 * create. With the ID of a stored entry, it's an update. A new measure of an
 * ingredient gets its ID here too. Throws the error of the new change when
 * it breaks a rule against `state` and the other changes, whose own problems
 * don't stop it.
 * @param {State} state
 * @param {PendingChange[]} changes
 * @param {Proposal} proposal
 * @returns {{ changes: PendingChange[], change: PendingChange }}
 */
export function stage(state, changes, proposal) {
  const change = changeOf(state, changes, proposal);
  const target = targetOf(change);
  const index = changes.findIndex((candidate) => targetOf(candidate) === target);
  const next = index === -1 ? [...changes, change] : changes.with(index, change);
  const failure = compute(state, next).failures.find((candidate) => candidate.target === target);
  if (failure) throw failure.error;
  return { changes: next, change };
}

/**
 * `changes` without the change of `target`. Throws a ConflictError when that
 * gives another change a problem that it didn't have.
 * @param {State} state
 * @param {PendingChange[]} changes
 * @param {string} target
 * @returns {PendingChange[]}
 */
export function withdraw(state, changes, target) {
  const index = changes.findIndex((change) => targetOf(change) === target);
  if (index === -1) throw new NotFoundError(`Unknown pending change: ${target}`);
  const remaining = changes.toSpliced(index, 1);
  const key = (problem) => `${problem.target}\n${problem.message}`;
  const before = new Set(nextState(state, changes).problems.map(key));
  if (nextState(state, remaining).problems.some((problem) => !before.has(key(problem)))) {
    throw new ConflictError("Other pending changes depend on this one. Withdraw them first.");
  }
  return remaining;
}

/**
 * The weeks that the menus of `changes` name, each once, from the earliest.
 * @param {PendingChange[]} changes
 * @returns {string[]}
 */
export function weeksOf(changes) {
  const weeks = changes.flatMap((change) => (change.kind === "menu" ? [change.week] : []));
  return [...new Set(weeks)].sort();
}

// What an update does: archive, restore, or any other change.
function actionOf(change) {
  if (change.action === "create") return "create";
  if (isDeepStrictEqual(change.changes, { archived: true })) return "archive";
  if (isDeepStrictEqual(change.changes, { archived: false })) return "restore";
  return "change";
}

/**
 * What a page shows of each pending change, in list order:
 * - `{ target, kind: "menu", week, day, meal, items: [{ name, servings }], problem? }`
 * - `{ target, kind: "recipe", action, name, ingredients: [{ name, quantity, unit }], problem? }`
 * - `{ target, kind: "ingredient", action, name, unit, measures: [{ name, amount }], problem? }`
 *
 * `action` is `create`, `change`, `archive`, or `restore`, and `problem` is
 * the message of the change's problem in `problems`. Names come from the
 * next state, so they include pending entries. A change that the next state
 * skips shows what it proposes instead.
 * @param {State} state
 * @param {PendingChange[]} changes
 * @param {Problem[]} problems
 * @returns {any[]}
 */
export function describe(state, changes, problems) {
  const { state: next, failures } = compute(state, changes);
  const failed = new Set(failures.map((failure) => failure.target));
  const ingredients = new Map(next.ingredients.map((entry) => [entry.id, entry]));
  const recipes = new Map(next.recipes.map((entry) => [entry.id, entry]));
  for (const change of changes) {
    if (change.kind === "menu" || !failed.has(targetOf(change))) continue;
    const proposed =
      change.action === "create"
        ? { id: change.id, ...change.fields }
        : { ...change.base, ...change.changes };
    (change.kind === "ingredient" ? ingredients : recipes).set(change.id, proposed);
  }

  function lineOf(line) {
    const ingredient = ingredients.get(line.ingredientId);
    const measure = ingredient?.measures?.find((candidate) => candidate.id === line.measureId);
    return {
      name: ingredient?.name ?? line.ingredientId,
      quantity: line.quantity,
      unit: line.measureId === undefined ? ingredient?.unit : (measure?.name ?? line.measureId),
    };
  }

  function viewOf(change) {
    const target = targetOf(change);
    if (change.kind === "menu") {
      const { week, day, meal } = change;
      const items = change.items.map((item) => ({
        name: recipes.get(item.recipeId)?.name ?? item.recipeId,
        servings: item.servings,
      }));
      return { target, kind: "menu", week, day, meal, items };
    }
    const action = actionOf(change);
    if (change.kind === "recipe") {
      const recipe = recipes.get(change.id);
      const lines = (recipe.ingredients ?? []).map(lineOf);
      return { target, kind: "recipe", action, name: recipe.name, ingredients: lines };
    }
    const ingredient = ingredients.get(change.id);
    const measures = (ingredient.measures ?? []).map(({ name, amount }) => ({ name, amount }));
    return {
      target,
      kind: "ingredient",
      action,
      name: ingredient.name,
      unit: ingredient.unit,
      measures,
    };
  }

  return changes.map((change) => {
    const view = viewOf(change);
    const problem = problems.find((candidate) => candidate.target === view.target);
    return problem ? { ...view, problem: problem.message } : view;
  });
}
