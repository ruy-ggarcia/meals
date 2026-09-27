import assert from "node:assert/strict";
import { test } from "node:test";
import { shoppingList } from "../public/shopping-list.js";

function ingredient(id, name, unit, archived = false) {
  return { id, name, unit, archived };
}

function recipe(id, name, ingredients = [], archived = false) {
  return {
    id,
    name,
    archived,
    ingredients: ingredients.map(([ingredientId, quantity]) => ({ ingredientId, quantity })),
  };
}

function slot(day, meal, ...items) {
  return {
    day,
    meal,
    menu: { items: items.map(([recipeId, servings]) => ({ recipeId, servings })) },
  };
}

const EGG = ingredient("egg", "Egg", "pcs");
const MILK = ingredient("milk", "Milk", "ml");
const ONION = ingredient("onion", "Onion", "g");
const RICE = ingredient("rice", "Rice", "g");
const CATALOG = [ONION, RICE, EGG, MILK];

test("sums quantity × servings per ingredient over every slot, from A to Z", () => {
  const recipes = [
    recipe("omelette", "Omelette", [
      ["egg", 2],
      ["onion", 50],
    ]),
    recipe("soup", "Onion soup", [
      ["onion", 150],
      ["milk", 100],
    ]),
  ];
  const slots = [
    slot("mon", "lunch", ["omelette", 2]),
    slot("tue", "dinner", ["soup", 1.5]),
    slot("wed", "lunch", ["omelette", 1]),
    slot("wed", "dinner"),
  ];

  assert.deepEqual(shoppingList(slots, recipes, CATALOG), {
    lines: [
      { ingredientId: "egg", name: "Egg", unit: "pcs", total: 6 },
      { ingredientId: "milk", name: "Milk", unit: "ml", total: 150 },
      { ingredientId: "onion", name: "Onion", unit: "g", total: 375 },
    ],
    recipesWithoutIngredients: [],
  });
});

test("rounds each total up to a whole number", () => {
  const recipes = [
    recipe("salad", "Salad", [
      ["onion", 12.5],
      ["egg", 0.3],
    ]),
  ];

  const { lines } = shoppingList([slot("mon", "lunch", ["salad", 1])], recipes, CATALOG);

  assert.deepEqual(
    lines.map((line) => [line.name, line.total]),
    [
      ["Egg", 1],
      ["Onion", 13],
    ],
  );
});

test("sums quantities with two decimals exactly", () => {
  const recipes = [recipe("tortilla", "Potato omelette", [["egg", 0.25]])];
  const slots = [
    slot("mon", "lunch", ["tortilla", 1]),
    slot("tue", "lunch", ["tortilla", 1]),
    slot("wed", "lunch", ["tortilla", 1]),
    slot("thu", "lunch", ["tortilla", 1]),
  ];

  const { lines } = shoppingList(slots, recipes, CATALOG);

  assert.deepEqual(lines, [{ ingredientId: "egg", name: "Egg", unit: "pcs", total: 1 }]);
});

test("totals stay exact where floating point would round up too far", () => {
  const recipes = [
    recipe("risotto", "Risotto", [["rice", 4.4]]),
    recipe("a", "A", [["egg", 0.1]]),
    recipe("b", "B", [["egg", 2.7]]),
    recipe("c", "C", [["egg", 0.2]]),
    recipe("custard", "Custard", [["milk", 0.56]]),
  ];
  const slots = [
    slot("mon", "lunch", ["risotto", 12.5]),
    slot("tue", "lunch", ["a", 1], ["b", 1], ["c", 1]),
    slot("wed", "dinner", ["custard", 12.5]),
  ];

  const { lines } = shoppingList(slots, recipes, CATALOG);

  assert.deepEqual(
    lines.map((line) => [line.name, line.total]),
    [
      ["Egg", 3],
      ["Milk", 7],
      ["Rice", 55],
    ],
  );
});

test("counts archived recipes and archived ingredients", () => {
  const catalog = [ingredient("saffron", "Saffron", "g", true)];
  const recipes = [recipe("paella", "Paella", [["saffron", 0.5]], true)];

  const { lines } = shoppingList([slot("sun", "lunch", ["paella", 4])], recipes, catalog);

  assert.deepEqual(lines, [{ ingredientId: "saffron", name: "Saffron", unit: "g", total: 2 }]);
});

test("lists each recipe without ingredients once, from A to Z, with its slots in order", () => {
  const recipes = [
    recipe("coffee", "Coffee"),
    recipe("burrito", "Burrito"),
    recipe("omelette", "Omelette", [["egg", 2]]),
  ];
  const slots = [
    slot("mon", "breakfast", ["coffee", 2]),
    slot("tue", "breakfast", ["coffee", 1], ["omelette", 1]),
    slot("thu", "dinner", ["burrito", 3]),
  ];

  assert.deepEqual(shoppingList(slots, recipes, CATALOG), {
    lines: [{ ingredientId: "egg", name: "Egg", unit: "pcs", total: 2 }],
    recipesWithoutIngredients: [
      { recipeId: "burrito", name: "Burrito", slots: [{ day: "thu", meal: "dinner" }] },
      {
        recipeId: "coffee",
        name: "Coffee",
        slots: [
          { day: "mon", meal: "breakfast" },
          { day: "tue", meal: "breakfast" },
        ],
      },
    ],
  });
});

test("skips unknown recipes and unknown ingredients, and a recipe left with none counts as without", () => {
  const recipes = [
    recipe("soup", "Soup", [
      ["onion", 100],
      ["gone", 5],
    ]),
    recipe("ghost", "Ghost", [["gone", 1]]),
  ];
  const slots = [slot("mon", "lunch", ["soup", 1], ["unknown", 2], ["ghost", 1])];

  assert.deepEqual(shoppingList(slots, recipes, CATALOG), {
    lines: [{ ingredientId: "onion", name: "Onion", unit: "g", total: 100 }],
    recipesWithoutIngredients: [
      { recipeId: "ghost", name: "Ghost", slots: [{ day: "mon", meal: "lunch" }] },
    ],
  });
});

test("an empty week has an empty shopping list", () => {
  assert.deepEqual(shoppingList([slot("mon", "lunch")], [], CATALOG), {
    lines: [],
    recipesWithoutIngredients: [],
  });
});
