import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  describe as describeChanges,
  nextState,
  stage,
  targetOf,
  weeksOf,
  withdraw,
} from "../server/assistant/pending.js";
import { blankWeek, UUID_V4 } from "./backend-helpers.js";

const WEEK = "2026-11-16";
const NEXT_WEEK = "2026-11-23";

const onion = { id: "onion", name: "Onion", unit: "g", measures: [], archived: false };
const potato = {
  id: "potato",
  name: "Potato",
  unit: "g",
  measures: [{ id: "medium", name: "medium", amount: 150 }],
  archived: false,
};
const soup = { id: "soup", name: "Pumpkin Soup", archived: false, ingredients: [] };

/** A state with the stored entries, and the weeks by their ID. */
function stateOf({ ingredients = [], recipes = [], weeks = {} } = {}) {
  return { ingredients, recipes, weeks };
}

/** A blank week whose slot of `day` and `meal` holds `items`. */
function weekWith(day, meal, items) {
  const week = blankWeek();
  week[day][meal] = { items };
  return week;
}

/** The changes after staging each proposal in order, from no changes. */
function staged(state, ...proposals) {
  return proposals.reduce((changes, proposal) => stage(state, changes, proposal).changes, []);
}

describe("targetOf", () => {
  test("names an ingredient, a recipe, and a slot by their keys", () => {
    assert.equal(targetOf({ kind: "ingredient", action: "create", id: "a" }), "ingredient:a");
    assert.equal(targetOf({ kind: "recipe", action: "update", id: "b" }), "recipe:b");
    assert.equal(
      targetOf({ kind: "menu", week: WEEK, day: "tue", meal: "dinner" }),
      `menu:${WEEK}/tue/dinner`,
    );
  });
});

describe("stage", () => {
  test("stages a recipe that uses a pending ingredient and a pending measure", () => {
    const state = stateOf();
    const leek = stage(state, [], {
      kind: "ingredient",
      fields: { name: "Leek", unit: "g", measures: [{ name: "stalk", amount: 200 }] },
    });
    const ingredientId = leek.change.id;
    const measureId = leek.change.fields.measures[0].id;

    const { changes } = stage(state, leek.changes, {
      kind: "recipe",
      fields: { name: "Leek Soup", ingredients: [{ ingredientId, measureId, quantity: 1 }] },
    });

    const result = nextState(state, changes);
    assert.deepEqual(result.problems, []);
    assert.match(measureId, UUID_V4);
    assert.deepEqual(result.state.ingredients[0].measures, [
      { id: measureId, name: "stalk", amount: 200 },
    ]);
    assert.deepEqual(result.state.recipes[0].ingredients, [
      { ingredientId, measureId, quantity: 1 },
    ]);
  });

  test("stages a menu that holds a pending recipe", () => {
    const state = stateOf({ weeks: { [WEEK]: blankWeek() } });
    const recipe = stage(state, [], { kind: "recipe", fields: { name: "Leek Soup" } });
    const items = [{ recipeId: recipe.change.id, servings: 2 }];

    const { changes } = stage(state, recipe.changes, {
      kind: "menu",
      week: WEEK,
      day: "tue",
      meal: "dinner",
      items,
    });

    const result = nextState(state, changes);
    assert.deepEqual(result.problems, []);
    assert.deepEqual(result.state.weeks[WEEK].tue.dinner.items, items);
  });

  test("replaces the pending change of the same slot", () => {
    const state = stateOf({ recipes: [soup], weeks: { [WEEK]: blankWeek() } });
    const slot = { kind: "menu", week: WEEK, day: "tue", meal: "dinner" };

    const changes = staged(
      state,
      { ...slot, items: [{ recipeId: "soup", servings: 2 }] },
      { ...slot, items: [{ recipeId: "soup", servings: 4 }] },
    );

    assert.deepEqual(changes, [{ ...slot, items: [{ recipeId: "soup", servings: 4 }], base: [] }]);
  });

  test("replaces a pending create and keeps its ID", () => {
    const state = stateOf();
    const first = stage(state, [], { kind: "recipe", fields: { name: "Leek Soup" } });

    const second = stage(state, first.changes, {
      kind: "recipe",
      id: first.change.id,
      fields: { name: "Leek Cream" },
    });

    assert.deepEqual(second.changes, [
      { kind: "recipe", action: "create", id: first.change.id, fields: { name: "Leek Cream" } },
    ]);
  });

  test("keeps the measure IDs that a restaged ingredient sends", () => {
    const state = stateOf();
    const first = stage(state, [], {
      kind: "ingredient",
      fields: { name: "Leek", unit: "g", measures: [{ name: "stalk", amount: 200 }] },
    });
    const stalk = first.change.fields.measures[0];

    const second = stage(state, first.changes, {
      kind: "ingredient",
      id: first.change.id,
      fields: { name: "Leek", unit: "g", measures: [{ ...stalk, amount: 250 }] },
    });

    assert.deepEqual(second.change.fields.measures, [{ ...stalk, amount: 250 }]);
  });

  test("rejects a recipe whose name key matches a stored recipe", () => {
    const state = stateOf({ recipes: [soup] });

    assert.throws(() => stage(state, [], { kind: "recipe", fields: { name: "pumpkin soup" } }), {
      name: "NameConflictError",
      message: 'A recipe named "Pumpkin Soup" already exists.',
    });
  });

  test("rejects a recipe whose name key matches a pending recipe", () => {
    const state = stateOf();
    const changes = staged(state, { kind: "recipe", fields: { name: "Leek Soup" } });

    assert.throws(() => stage(state, changes, { kind: "recipe", fields: { name: "leek soup" } }), {
      name: "NameConflictError",
      message: 'A recipe named "Leek Soup" already exists.',
    });
  });

  test("rejects a change of unit", () => {
    const state = stateOf({ ingredients: [onion] });

    assert.throws(
      () => stage(state, [], { kind: "ingredient", id: "onion", changes: { unit: "pcs" } }),
      {
        name: "ValidationError",
        message: "The unit of an ingredient changes in the ingredient editor.",
      },
    );
  });

  test("rejects a menu with 21 items", () => {
    const recipes = Array.from({ length: 21 }, (_, index) => ({
      ...soup,
      id: `soup-${index}`,
      name: `Soup ${index}`,
    }));
    const state = stateOf({ recipes, weeks: { [WEEK]: blankWeek() } });
    const items = recipes.map((recipe) => ({ recipeId: recipe.id, servings: 1 }));

    assert.throws(
      () => stage(state, [], { kind: "menu", week: WEEK, day: "tue", meal: "dinner", items }),
      { name: "ValidationError", message: "A menu holds at most 20 menu items." },
    );
  });

  test("rejects a menu item with 0.25 servings", () => {
    const state = stateOf({ recipes: [soup], weeks: { [WEEK]: blankWeek() } });
    const items = [{ recipeId: "soup", servings: 0.25 }];

    assert.throws(
      () => stage(state, [], { kind: "menu", week: WEEK, day: "tue", meal: "dinner", items }),
      {
        name: "ValidationError",
        message: "items[0].servings must be a multiple of 0.5 from 0.5 to 99.",
      },
    );
  });

  test("rejects an ID that no entry or pending create has", () => {
    const state = stateOf({ recipes: [soup] });

    assert.throws(
      () => stage(state, [], { kind: "recipe", id: "stew", changes: { archived: true } }),
      { name: "NotFoundError", message: "Unknown recipe: stew" },
    );
  });

  test("rejects a measure ID that the ingredient doesn't have", () => {
    const state = stateOf({ ingredients: [potato] });
    const measures = [{ id: "large", name: "large", amount: 250 }];

    assert.throws(
      () => stage(state, [], { kind: "ingredient", id: "potato", changes: { measures } }),
      {
        name: "ValidationError",
        message: "measures[0].id isn't a measure of this ingredient.",
      },
    );
  });

  test("rejects a slot that doesn't exist", () => {
    const state = stateOf();

    assert.throws(
      () => stage(state, [], { kind: "menu", week: WEEK, day: "tue", meal: "brunch", items: [] }),
      { name: "ValidationError", message: `Unknown slot: ${WEEK}/tue/brunch` },
    );
  });

  test("rejects a menu item whose recipe is archived", () => {
    const archived = { ...soup, archived: true };
    const state = stateOf({ recipes: [archived], weeks: { [WEEK]: blankWeek() } });
    const items = [{ recipeId: "soup", servings: 2 }];

    assert.throws(
      () => stage(state, [], { kind: "menu", week: WEEK, day: "tue", meal: "dinner", items }),
      {
        name: "ValidationError",
        message: '"Pumpkin Soup" is archived. Restore it first, or choose an active recipe.',
      },
    );
  });

  test("keeps an archived recipe that the slot already holds", () => {
    const archived = { ...soup, archived: true };
    const items = [{ recipeId: "soup", servings: 2 }];
    const state = stateOf({
      recipes: [archived],
      weeks: { [WEEK]: weekWith("tue", "dinner", items) },
    });
    const servings = [{ recipeId: "soup", servings: 4 }];

    const { changes } = stage(state, [], {
      kind: "menu",
      week: WEEK,
      day: "tue",
      meal: "dinner",
      items: servings,
    });

    assert.deepEqual(changes[0].items, servings);
  });

  test("rejects a recipe line whose ingredient is archived", () => {
    const state = stateOf({ ingredients: [{ ...onion, archived: true }] });
    const ingredients = [{ ingredientId: "onion", quantity: 50 }];

    assert.throws(
      () => stage(state, [], { kind: "recipe", fields: { name: "Stew", ingredients } }),
      {
        name: "ValidationError",
        message: '"Onion" is archived. Restore it first, or choose an active ingredient.',
      },
    );
  });

  test("keeps an archived ingredient that the recipe already uses", () => {
    const stew = { ...soup, ingredients: [{ ingredientId: "onion", quantity: 50 }] };
    const state = stateOf({ ingredients: [{ ...onion, archived: true }], recipes: [stew] });
    const ingredients = [{ ingredientId: "onion", quantity: 80 }];

    const { changes } = stage(state, [], { kind: "recipe", id: "soup", changes: { ingredients } });

    assert.deepEqual(changes[0].changes, { ingredients });
  });

  test("stages a change while another target has a problem", () => {
    const state = stateOf({ recipes: [soup] });
    const changes = staged(state, {
      kind: "recipe",
      id: "soup",
      changes: { name: "Pumpkin Cream" },
    });
    const edited = stateOf({ recipes: [{ ...soup, name: "Pumpkin Velvet" }] });

    const result = stage(edited, changes, { kind: "recipe", fields: { name: "Leek Soup" } });

    assert.equal(result.changes.length, 2);
  });
});

describe("nextState", () => {
  test("reports a problem when the stored recipe changed after staging", () => {
    const changes = staged(stateOf({ recipes: [soup] }), {
      kind: "recipe",
      id: "soup",
      changes: { name: "Pumpkin Cream" },
    });
    const edited = stateOf({ recipes: [{ ...soup, name: "Pumpkin Velvet" }] });

    assert.deepEqual(nextState(edited, changes).problems, [
      {
        target: "recipe:soup",
        message: "Pumpkin Velvet changed after the assistant proposed this.",
      },
    ]);
  });

  test("reports a problem when the stored slot changed after staging", () => {
    const items = [{ recipeId: "soup", servings: 2 }];
    const changes = staged(stateOf({ recipes: [soup], weeks: { [WEEK]: blankWeek() } }), {
      kind: "menu",
      week: WEEK,
      day: "tue",
      meal: "dinner",
      items,
    });
    const edited = stateOf({
      recipes: [soup],
      weeks: { [WEEK]: weekWith("tue", "dinner", items) },
    });

    assert.deepEqual(nextState(edited, changes).problems, [
      {
        target: `menu:${WEEK}/tue/dinner`,
        message: "Tuesday dinner changed after the assistant proposed this.",
      },
    ]);
  });

  test("reports no problem when another slot of the week changed after staging", () => {
    const items = [{ recipeId: "soup", servings: 2 }];
    const changes = staged(stateOf({ recipes: [soup], weeks: { [WEEK]: blankWeek() } }), {
      kind: "menu",
      week: WEEK,
      day: "tue",
      meal: "dinner",
      items,
    });
    const edited = stateOf({ recipes: [soup], weeks: { [WEEK]: weekWith("wed", "lunch", items) } });

    assert.deepEqual(nextState(edited, changes).problems, []);
  });

  test("applies ingredients, then recipes, then menus, whatever the list order", () => {
    const items = [{ recipeId: "leek-soup", servings: 2 }];
    const changes = [
      { kind: "menu", week: WEEK, day: "tue", meal: "dinner", items, base: [] },
      {
        kind: "recipe",
        action: "create",
        id: "leek-soup",
        fields: { name: "Leek Soup", ingredients: [{ ingredientId: "leek", quantity: 1 }] },
      },
      { kind: "ingredient", action: "create", id: "leek", fields: { name: "Leek", unit: "pcs" } },
    ];

    const result = nextState(stateOf({ weeks: { [WEEK]: blankWeek() } }), changes);

    assert.deepEqual(result.problems, []);
    assert.deepEqual(result.state.weeks[WEEK].tue.dinner.items, items);
  });

  test("throws RangeError when a menu names a week that the state doesn't hold", () => {
    const changes = [{ kind: "menu", week: WEEK, day: "tue", meal: "dinner", items: [], base: [] }];

    assert.throws(() => nextState(stateOf(), changes), {
      name: "RangeError",
      message: `Week ${WEEK} isn't loaded.`,
    });
  });

  test("skips a change that breaks a rule and applies the rest", () => {
    const changes = [
      { kind: "recipe", action: "create", id: "stew", fields: { name: "Pumpkin Soup" } },
      { kind: "recipe", action: "create", id: "leek-soup", fields: { name: "Leek Soup" } },
    ];

    const result = nextState(stateOf({ recipes: [soup] }), changes);

    assert.deepEqual(result.problems, [
      { target: "recipe:stew", message: 'A recipe named "Pumpkin Soup" already exists.' },
    ]);
    assert.deepEqual(
      result.state.recipes.map((recipe) => recipe.id),
      ["soup", "leek-soup"],
    );
  });
});

describe("withdraw", () => {
  test("removes the pending change of the target", () => {
    const state = stateOf({ recipes: [soup] });
    const changes = staged(state, { kind: "recipe", id: "soup", changes: { archived: true } });

    assert.deepEqual(withdraw(state, changes, "recipe:soup"), []);
  });

  test("rejects a withdrawal that others depend on", () => {
    const state = stateOf();
    const leek = stage(state, [], { kind: "ingredient", fields: { name: "Leek", unit: "pcs" } });
    const { changes } = stage(state, leek.changes, {
      kind: "recipe",
      fields: { name: "Leek Soup", ingredients: [{ ingredientId: leek.change.id, quantity: 1 }] },
    });

    assert.throws(() => withdraw(state, changes, targetOf(leek.change)), {
      name: "ConflictError",
      message: "Other pending changes depend on this one. Withdraw them first.",
    });
  });

  test("rejects a target without a pending change", () => {
    assert.throws(() => withdraw(stateOf(), [], "recipe:soup"), {
      name: "NotFoundError",
      message: "Unknown pending change: recipe:soup",
    });
  });
});

describe("weeksOf", () => {
  test("lists each week that the menus name once, from the earliest", () => {
    const state = stateOf({
      recipes: [soup],
      weeks: { [WEEK]: blankWeek(), [NEXT_WEEK]: blankWeek() },
    });
    const items = [{ recipeId: "soup", servings: 1 }];
    const changes = staged(
      state,
      { kind: "menu", week: NEXT_WEEK, day: "mon", meal: "lunch", items },
      { kind: "recipe", id: "soup", changes: { name: "Squash Soup" } },
      { kind: "menu", week: WEEK, day: "tue", meal: "dinner", items },
      { kind: "menu", week: NEXT_WEEK, day: "wed", meal: "lunch", items },
    );

    assert.deepEqual(weeksOf(changes), [WEEK, NEXT_WEEK]);
  });
});

describe("describe", () => {
  test("describes a menu with the names of pending recipes", () => {
    const state = stateOf({ weeks: { [WEEK]: blankWeek() } });
    const recipe = stage(state, [], { kind: "recipe", fields: { name: "Leek Soup" } });
    const { changes } = stage(state, recipe.changes, {
      kind: "menu",
      week: WEEK,
      day: "tue",
      meal: "dinner",
      items: [{ recipeId: recipe.change.id, servings: 2 }],
    });

    assert.deepEqual(describeChanges(state, changes, [])[1], {
      target: `menu:${WEEK}/tue/dinner`,
      kind: "menu",
      week: WEEK,
      day: "tue",
      meal: "dinner",
      items: [{ name: "Leek Soup", servings: 2 }],
    });
  });

  test("describes a recipe line by its measure or the ingredient's unit", () => {
    const state = stateOf({ ingredients: [onion, potato] });
    const ingredients = [
      { ingredientId: "onion", quantity: 50 },
      { ingredientId: "potato", measureId: "medium", quantity: 2 },
    ];
    const changes = staged(state, { kind: "recipe", fields: { name: "Stew", ingredients } });

    assert.deepEqual(describeChanges(state, changes, []), [
      {
        target: targetOf(changes[0]),
        kind: "recipe",
        action: "create",
        name: "Stew",
        ingredients: [
          { name: "Onion", quantity: 50, unit: "g" },
          { name: "Potato", quantity: 2, unit: "medium" },
        ],
      },
    ]);
  });

  test("names the action of a change, an archive, and a restore", () => {
    const archived = { ...onion, id: "garlic", name: "Garlic", archived: true };
    const state = stateOf({ ingredients: [onion, potato, archived] });
    const changes = staged(
      state,
      { kind: "ingredient", id: "onion", changes: { name: "Red Onion" } },
      { kind: "ingredient", id: "potato", changes: { archived: true } },
      { kind: "ingredient", id: "garlic", changes: { archived: false } },
    );

    assert.deepEqual(
      describeChanges(state, changes, []).map((view) => [view.name, view.action]),
      [
        ["Red Onion", "change"],
        ["Potato", "archive"],
        ["Garlic", "restore"],
      ],
    );
  });

  test("describes an ingredient with its unit and measures", () => {
    const state = stateOf({ ingredients: [potato] });
    const changes = staged(state, {
      kind: "ingredient",
      id: "potato",
      changes: { archived: true },
    });

    assert.deepEqual(describeChanges(state, changes, []), [
      {
        target: "ingredient:potato",
        kind: "ingredient",
        action: "archive",
        name: "Potato",
        unit: "g",
        measures: [{ name: "medium", amount: 150 }],
      },
    ]);
  });

  test("shows the problem of a change", () => {
    const state = stateOf({ recipes: [soup] });
    const changes = staged(state, { kind: "recipe", id: "soup", changes: { archived: true } });
    const problems = [{ target: "recipe:soup", message: "Pumpkin Soup changed." }];

    assert.equal(describeChanges(state, changes, problems)[0].problem, "Pumpkin Soup changed.");
  });
});
