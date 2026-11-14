// The tools that the assistant's language model calls. Read tools return the
// data as stored with the pending changes laid over it, each marked
// `pending: true`. Proposal tools stage pending changes and never write a
// file: the data changes only when the user applies them. `runTool` runs one
// call and never throws for a bad call.

import { ConflictError, NameConflictError, NotFoundError, ValidationError } from "../errors.js";
import { silentLogger } from "../logger.js";
import { byNameKey } from "../names.js";
import { measureIdsByIngredient, withKnownIngredients } from "../recipes.js";
import { isPlainObject } from "../shapes.js";
import { isWeekId, normalizeWeek } from "../weeks.js";
import { nextState, slotName, stage, targetOf, weeksOf, withdraw } from "./pending.js";

/** @typedef {import("./pending.js").PendingChange} PendingChange */
/** @typedef {import("./pending.js").Proposal} Proposal */

const LIMITS = `Limits: servings are a multiple of 0.5 from 0.5 to 99. A quantity or an amount is a number from 0.01 to 10000 with at most two decimals. A menu holds at most 20 menu items, each recipe once. The units are g, ml, and pcs. A week is identified by its Monday as YYYY-MM-DD. The days are mon, tue, wed, thu, fri, sat, and sun. The meals are breakfast, snack_am, lunch, snack_pm, and dinner.`;

const NOT_SAVED =
  "This proposal is not saved until the user applies it, so never tell the user that it's saved. A later proposal for the same target replaces this one.";

const MEASURES = {
  type: "array",
  description:
    "Named amounts in the ingredient's unit, such as medium or handful. A measure to keep has its id. A new one has only name and amount. The list replaces the current one, and an id that you leave out removes that measure.",
  items: {
    type: "object",
    properties: {
      id: { type: "string", description: "The id of a measure that the ingredient already has." },
      name: {
        type: "string",
        description: "The name of the measure, unique within the ingredient.",
      },
      amount: { type: "number", description: "How much of the unit one of this measure is." },
    },
    required: ["name", "amount"],
    additionalProperties: false,
  },
};

const RECIPE_LINES = {
  type: "array",
  description:
    "The ingredient lines of one serving, at most 50, each ingredient once. The list replaces the current one.",
  items: {
    type: "object",
    properties: {
      ingredientId: { type: "string", description: "The id of an active ingredient." },
      measureId: {
        type: "string",
        description: "The id of one of the ingredient's measures. Leave it out to use the unit.",
      },
      quantity: {
        type: "number",
        description: "How much one serving needs, in the unit or in the measure.",
      },
    },
    required: ["ingredientId", "quantity"],
    additionalProperties: false,
  },
};

const NO_ARGUMENTS = { type: "object", properties: {}, additionalProperties: false };

/**
 * The tools, sorted by name, as the model sees them.
 * @type {{ name: string, description: string, parameters: any }[]}
 */
export const TOOLS = [
  {
    name: "list_ingredients",
    description:
      "Lists the ingredient catalog, active and archived, from A to Z, with the id, name, unit, measures, and archived flag of each ingredient. Entries that have a pending change are marked pending: true and show the data as it would be saved. Call it before you propose a recipe or an ingredient, to use the ids that exist.",
    parameters: NO_ARGUMENTS,
  },
  {
    name: "list_recipes",
    description:
      "Lists the recipe book, active and archived, from A to Z, with the id, name, ingredient lines, and archived flag of each recipe. Entries that have a pending change are marked pending: true and show the data as it would be saved. Call it before you propose a menu, so you prefer active recipes that exist.",
    parameters: NO_ARGUMENTS,
  },
  {
    name: "propose_ingredient",
    description: `Proposes an ingredient to create, change, archive, or restore. Without id, it creates an ingredient and needs name and unit. With the id of an ingredient, stored or pending, it changes that ingredient with the fields that you send. To archive or restore, send only id and archived. The unit of an existing ingredient can't change, so don't send another unit for it. It returns the target, the id, and the ingredient as it would be saved. ${NOT_SAVED} ${LIMITS}`,
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The id of the ingredient to change. Leave it out to create one.",
        },
        name: { type: "string", description: "The name, unique among all ingredients." },
        unit: {
          type: "string",
          enum: ["g", "ml", "pcs"],
          description: "The unit, for a new ingredient.",
        },
        measures: MEASURES,
        archived: { type: "boolean", description: "true to archive, false to restore." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "propose_menus",
    description: `Proposes the menus of one or more slots. A menu replaces everything that the slot holds, and a slot that you don't name keeps its menu. Send an empty items list to empty a slot. Use the id of a recipe, stored or pending. All the menus are proposed, or none: if one is invalid, the error names its slot and nothing is proposed. ${NOT_SAVED} ${LIMITS}`,
    parameters: {
      type: "object",
      properties: {
        menus: {
          type: "array",
          description: "The menus to propose.",
          items: {
            type: "object",
            properties: {
              week: { type: "string", description: "The Monday of the week, as YYYY-MM-DD." },
              day: { type: "string", enum: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] },
              meal: {
                type: "string",
                enum: ["breakfast", "snack_am", "lunch", "snack_pm", "dinner"],
              },
              items: {
                type: "array",
                description: "The menu items, at most 20, each recipe once.",
                items: {
                  type: "object",
                  properties: {
                    recipeId: { type: "string" },
                    servings: { type: "number", description: "A multiple of 0.5 from 0.5 to 99." },
                  },
                  required: ["recipeId", "servings"],
                  additionalProperties: false,
                },
              },
            },
            required: ["week", "day", "meal", "items"],
            additionalProperties: false,
          },
        },
      },
      required: ["menus"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_recipe",
    description: `Proposes a recipe to create, change, archive, or restore. Without id, it creates a recipe and needs name. With the id of a recipe, stored or pending, it changes that recipe with the fields that you send. To archive or restore, send only id and archived. A quantity is what one serving needs. Its ingredients must exist in the catalog, stored or pending. It returns the target, the id, and the recipe as it would be saved. ${NOT_SAVED} ${LIMITS}`,
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The id of the recipe to change. Leave it out to create one.",
        },
        name: { type: "string", description: "The name, unique among all recipes." },
        ingredients: RECIPE_LINES,
        archived: { type: "boolean", description: "true to archive, false to restore." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "read_week",
    description:
      "Reads the menus of one week: every day and every meal, each with its menu items as recipe ids and servings. Slots that have a pending change are marked pending: true and show the menu as it would be saved. A week that nobody planned has empty menus.",
    parameters: {
      type: "object",
      properties: {
        week: { type: "string", description: "The Monday of the week, as YYYY-MM-DD." },
      },
      required: ["week"],
      additionalProperties: false,
    },
  },
  {
    name: "withdraw_pending_change",
    description:
      "Removes one pending change, so it never gets saved. It fails when other pending changes depend on it, for example a pending recipe that uses a pending ingredient: withdraw those first. The target comes from the output of a proposal, as ingredient:<id>, recipe:<id>, or menu:<week>/<day>/<meal>.",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", description: "The target of the pending change." },
      },
      required: ["target"],
      additionalProperties: false,
    },
  },
];

/** @typedef {import("../logger.js").Logger} Logger */
/** @typedef {{ stores: any, pending: PendingChange[], logger?: Logger }} Context */

// The errors that a bad call or a rule of the stores throws. Anything else is
// a disk fault or a bug: it goes to the log, never to the model.
const EXPECTED_ERRORS = [ConflictError, NameConflictError, NotFoundError, ValidationError];

function isExpected(error) {
  return EXPECTED_ERRORS.some((type) => error instanceof type);
}
/** @typedef {{ output: any, isError: boolean, pending: PendingChange[] }} ToolResult */

// The keys that each tool takes. A key that a tool doesn't take is an error,
// so a mistyped field never goes missing without a word.
const KEYS = {
  list_ingredients: [],
  list_recipes: [],
  propose_ingredient: ["archived", "id", "measures", "name", "unit"],
  propose_menus: ["menus"],
  propose_recipe: ["archived", "id", "ingredients", "name"],
  read_week: ["week"],
  withdraw_pending_change: ["target"],
};

const MENU_KEYS = ["day", "items", "meal", "week"];

function fail(message, pending) {
  return { output: { error: message }, isError: true, pending };
}

// Throws when `value` isn't a plain object whose keys are all in `keys`.
function checkKeys(value, keys, where) {
  if (!isPlainObject(value)) throw new ValidationError(`${where} must be an object.`);
  const unknown = Object.keys(value).find((key) => !keys.includes(key));
  if (unknown !== undefined) {
    throw new ValidationError(
      `${where} has no "${unknown}". It takes: ${keys.join(", ") || "nothing"}.`,
    );
  }
}

// The weeks to load: those that the pending changes and `extra` name.
function weeksToLoad(pending, extra = []) {
  return [...new Set([...weeksOf(pending), ...extra])];
}

// The data with the pending changes applied, and the targets that have one.
async function loadNext(stores, pending, extraWeeks = []) {
  const state = await stores.read(weeksToLoad(pending, extraWeeks));
  return { next: nextState(state, pending).state, pendingTargets: new Set(pending.map(targetOf)) };
}

function marked(entry, isPending) {
  return isPending ? { ...entry, pending: true } : entry;
}

async function listIngredients({ stores, pending }) {
  const { next, pendingTargets } = await loadNext(stores, pending);
  const ingredients = [...next.ingredients]
    .sort(byNameKey)
    .map((entry) => marked(entry, pendingTargets.has(`ingredient:${entry.id}`)));
  return { ingredients };
}

// A recipe as the API lists it: without the ingredients that the catalog doesn't have.
function shapedRecipes(next) {
  const known = measureIdsByIngredient(next.ingredients);
  return next.recipes.map((recipe) => withKnownIngredients(recipe, known)).sort(byNameKey);
}

async function listRecipes({ stores, pending }) {
  const { next, pendingTargets } = await loadNext(stores, pending);
  const recipes = shapedRecipes(next).map((entry) =>
    marked(entry, pendingTargets.has(`recipe:${entry.id}`)),
  );
  return { recipes };
}

async function readWeek({ stores, pending }, { week }) {
  if (!isWeekId(week)) {
    throw new ValidationError(`"${week}" isn't a week: use the Monday of the week as YYYY-MM-DD.`);
  }
  const { next, pendingTargets } = await loadNext(stores, pending, [week]);
  const normalized = normalizeWeek(
    next.weeks[week],
    new Set(next.recipes.map((entry) => entry.id)),
  );
  const days = Object.fromEntries(
    Object.entries(normalized).map(([day, meals]) => [
      day,
      Object.fromEntries(
        Object.entries(meals).map(([meal, menu]) => [
          meal,
          marked(menu, pendingTargets.has(`menu:${week}/${day}/${meal}`)),
        ]),
      ),
    ]),
  );
  return { week, days };
}

// The fields of `input` that the model sent, without its `id`.
function fieldsOf(input) {
  const { id: _, ...fields } = input;
  return fields;
}

// What the proposal of `kind` stages: a create with the fields, or a change
// of the entry `id`. The fields of a pending create merge with the ones sent,
// because staging a pending create replaces it, and a model that renames it
// sends only the name.
function proposalOf(kind, input, pending) {
  const sent = fieldsOf(input);
  if (input.id === undefined) return { kind, fields: sent };
  const create = pending.find(
    (change) => change.kind === kind && change.id === input.id && change.action === "create",
  );
  if (create) return { kind, id: input.id, fields: { ...create.fields, ...sent } };
  return { kind, id: input.id, changes: sent };
}

async function proposeEntry(kind, { stores, pending }, input) {
  const proposal = proposalOf(kind, input, pending);
  const state = await stores.read(weeksToLoad(pending));
  const { changes, change } = stage(state, pending, proposal);
  const after = nextState(state, changes).state;
  const entry = (kind === "ingredient" ? after.ingredients : shapedRecipes(after)).find(
    (candidate) => candidate.id === change.id,
  );
  return { pending: changes, output: { target: targetOf(change), id: change.id, [kind]: entry } };
}

async function proposeMenus({ stores, pending }, { menus }) {
  if (!Array.isArray(menus) || menus.length === 0) {
    throw new ValidationError('"menus" must be a list of at least one menu.');
  }
  for (const [index, menu] of menus.entries()) checkKeys(menu, MENU_KEYS, `menus[${index}]`);
  const state = await stores.read(
    weeksToLoad(pending, menus.map((menu) => menu.week).filter(isWeekId)),
  );
  let changes = pending;
  const targets = [];
  for (const menu of menus) {
    try {
      const staged = stage(state, changes, { kind: "menu", ...menu });
      changes = staged.changes;
      targets.push(targetOf(staged.change));
    } catch (error) {
      if (!isExpected(error)) throw error;
      const name = slotName(menu.day, menu.meal) ?? `${menu.week}/${menu.day}/${menu.meal}`;
      throw new ValidationError(`${name} (week of ${menu.week}): ${error.message}`);
    }
  }
  return { pending: changes, output: { targets } };
}

async function withdrawChange({ stores, pending }, { target }) {
  if (typeof target !== "string") throw new ValidationError('"target" must be a string.');
  const state = await stores.read(weeksToLoad(pending));
  return { pending: withdraw(state, pending, target), output: { target } };
}

/**
 * Runs one call of a tool. Never throws: an unknown tool, a malformed input,
 * a rule that a proposal breaks, or a store error gives `isError: true`, an
 * output of `{ error }`, and the pending list as it was. A proposal's
 * `pending` is the new list; a read tool returns the list that it got. Any
 * other error, such as a disk fault or a bug, is logged through
 * `context.logger`, which defaults to a silent one, and the model gets "The
 * tool failed." only.
 * @param {string} name
 * @param {unknown} input
 * @param {Context} context
 * @returns {Promise<ToolResult>}
 */
export async function runTool(name, input, context) {
  const { pending, logger = silentLogger } = context;
  try {
    if (!Object.hasOwn(KEYS, name)) throw new ValidationError(`Unknown tool: ${name}`);
    checkKeys(input, KEYS[name], "The input");
    const args = /** @type {any} */ (input);
    switch (name) {
      case "list_ingredients":
        return { output: await listIngredients(context), isError: false, pending };
      case "list_recipes":
        return { output: await listRecipes(context), isError: false, pending };
      case "read_week":
        return { output: await readWeek(context, args), isError: false, pending };
      case "propose_ingredient":
        return { ...(await proposeEntry("ingredient", context, args)), isError: false };
      case "propose_recipe":
        return { ...(await proposeEntry("recipe", context, args)), isError: false };
      case "propose_menus":
        return { ...(await proposeMenus(context, args)), isError: false };
      default:
        return { ...(await withdrawChange(context, args)), isError: false };
    }
  } catch (error) {
    if (isExpected(error)) return fail(error.message, pending);
    logger.error("assistant tool failed", { tool: name, error: error?.stack ?? String(error) });
    return fail("The tool failed.", pending);
  }
}
