import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { formatTotal, lineAmount, lineParts, shoppingList } from "../public/shopping-list.js";

function ingredient(id, name, unit, archived = false, measures = []) {
  return { id, name, unit, measures, archived };
}

function recipe(id, name, ingredients = [], archived = false) {
  return {
    id,
    name,
    archived,
    ingredients: ingredients.map(([ingredientId, quantity, measureId]) =>
      measureId === undefined ? { ingredientId, quantity } : { ingredientId, quantity, measureId },
    ),
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

const WEEK_RECIPES = [
  recipe("omelette", "Omelette", [
    ["egg", 2],
    ["onion", 50],
  ]),
  recipe("soup", "Onion soup", [
    ["onion", 150],
    ["milk", 100],
  ]),
];
const WEEK_SLOTS = [
  slot("mon", "lunch", ["omelette", 2]),
  slot("tue", "dinner", ["soup", 1.5]),
  slot("wed", "lunch", ["omelette", 1]),
  slot("wed", "dinner"),
];

const BARE_RECIPES = [
  recipe("coffee", "Coffee"),
  recipe("burrito", "Burrito"),
  recipe("omelette", "Omelette", [["egg", 2]]),
];
const BARE_SLOTS = [
  slot("mon", "breakfast", ["coffee", 2]),
  slot("tue", "breakfast", ["coffee", 1], ["omelette", 1]),
  slot("thu", "dinner", ["burrito", 3]),
];

const MEDIUM = { id: "medium", name: "medium", amount: 150 };
const LARGE = { id: "large", name: "large", amount: 250 };
const SIZED_ONION = ingredient("onion", "Onion", "g", false, [MEDIUM, LARGE]);

describe("shoppingList", () => {
  test("sums quantity × servings per ingredient", () => {
    const list = shoppingList(WEEK_SLOTS, WEEK_RECIPES, CATALOG);

    const byName = [...list.lines].sort((a, b) => a.name.localeCompare(b.name));
    assert.deepEqual(byName, [
      { ingredientId: "egg", name: "Egg", unit: "pcs", total: 6, breakdown: [] },
      { ingredientId: "milk", name: "Milk", unit: "ml", total: 150, breakdown: [] },
      { ingredientId: "onion", name: "Onion", unit: "g", total: 375, breakdown: [] },
    ]);
    assert.deepEqual(list.recipesWithoutIngredients, []);
  });

  test("lists the ingredients from A to Z", () => {
    // The catalog lists Onion, Rice, Egg, and Milk, so its order isn't A to Z.
    const { lines } = shoppingList(WEEK_SLOTS, WEEK_RECIPES, CATALOG);

    assert.deepEqual(
      lines.map((line) => line.name),
      ["Egg", "Milk", "Onion"],
    );
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

    assert.deepEqual(lines, [
      { ingredientId: "egg", name: "Egg", unit: "pcs", total: 1, breakdown: [] },
    ]);
  });

  test("keeps the total exact where floating point rounds up too far", () => {
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

    // Floating point gives 3.0000000000000004, 7.000000000000001, and
    // 55.00000000000001, which round up to 4, 8, and 56. See the test of the
    // arithmetic in quantities.test.js.
    assert.deepEqual(
      lines.map((line) => [line.name, line.total]),
      [
        ["Egg", 3], // 0.1 + 2.7 + 0.2
        ["Milk", 7], // 0.56 × 12.5
        ["Rice", 55], // 4.4 × 12.5
      ],
    );
  });

  test("counts archived recipes and ingredients", () => {
    const catalog = [ingredient("saffron", "Saffron", "g", true)];
    const recipes = [recipe("paella", "Paella", [["saffron", 0.5]], true)];

    const { lines } = shoppingList([slot("sun", "lunch", ["paella", 4])], recipes, catalog);

    assert.deepEqual(lines, [
      { ingredientId: "saffron", name: "Saffron", unit: "g", total: 2, breakdown: [] },
    ]);
  });

  test("lists each recipe without ingredients once", () => {
    const { recipesWithoutIngredients } = shoppingList(BARE_SLOTS, BARE_RECIPES, CATALOG);

    assert.deepEqual(recipesWithoutIngredients.map((entry) => entry.recipeId).sort(), [
      "burrito",
      "coffee",
    ]);
  });

  test("sorts recipes without ingredients A to Z, with slots in plan order", () => {
    const { recipesWithoutIngredients } = shoppingList(BARE_SLOTS, BARE_RECIPES, CATALOG);

    assert.deepEqual(recipesWithoutIngredients, [
      { recipeId: "burrito", name: "Burrito", slots: [{ day: "thu", meal: "dinner" }] },
      {
        recipeId: "coffee",
        name: "Coffee",
        slots: [
          { day: "mon", meal: "breakfast" },
          { day: "tue", meal: "breakfast" },
        ],
      },
    ]);
  });

  test("sums the ingredients of the recipes that have some", () => {
    const { lines } = shoppingList(BARE_SLOTS, BARE_RECIPES, CATALOG);

    assert.deepEqual(lines, [
      { ingredientId: "egg", name: "Egg", unit: "pcs", total: 2, breakdown: [] },
    ]);
  });

  test("skips menu items whose recipe is unknown", () => {
    const recipes = [recipe("soup", "Soup", [["onion", 100]])];
    const slots = [slot("mon", "lunch", ["soup", 1], ["unknown", 2])];

    assert.deepEqual(shoppingList(slots, recipes, CATALOG), {
      lines: [{ ingredientId: "onion", name: "Onion", unit: "g", total: 100, breakdown: [] }],
      recipesWithoutIngredients: [],
    });
  });

  test("skips recipe lines whose ingredient is unknown", () => {
    const recipes = [
      recipe("soup", "Soup", [
        ["onion", 100],
        ["gone", 5],
      ]),
    ];

    const { lines } = shoppingList([slot("mon", "lunch", ["soup", 1])], recipes, CATALOG);

    assert.deepEqual(lines, [
      { ingredientId: "onion", name: "Onion", unit: "g", total: 100, breakdown: [] },
    ]);
  });

  test("counts a recipe with only unknown lines as without ingredients", () => {
    const recipes = [recipe("ghost", "Ghost", [["gone", 1]])];

    const list = shoppingList([slot("mon", "lunch", ["ghost", 1])], recipes, CATALOG);

    assert.deepEqual(list.recipesWithoutIngredients, [
      { recipeId: "ghost", name: "Ghost", slots: [{ day: "mon", meal: "lunch" }] },
    ]);
  });

  test("returns an empty list for an empty week", () => {
    assert.deepEqual(shoppingList([slot("mon", "lunch")], [], CATALOG), {
      lines: [],
      recipesWithoutIngredients: [],
    });
  });

  test("converts measures to the unit and sums them", () => {
    const recipes = [
      recipe("soup", "Soup", [
        ["onion", 300],
        ["onion", 3, "medium"],
        ["onion", 1.5, "large"],
      ]),
    ];

    const { lines } = shoppingList([slot("mon", "lunch", ["soup", 1])], recipes, [SIZED_ONION]);

    assert.deepEqual(lines, [
      {
        ingredientId: "onion",
        name: "Onion",
        unit: "g",
        total: 1125,
        breakdown: [
          { measureId: null, name: "g", quantity: 300 },
          { measureId: "medium", name: "medium", quantity: 3 },
          { measureId: "large", name: "large", quantity: 1.5 },
        ],
      },
    ]);
  });

  test("returns an empty breakdown for a week without measure lines", () => {
    const recipes = [recipe("soup", "Soup", [["onion", 300]])];

    const { lines } = shoppingList([slot("mon", "lunch", ["soup", 1])], recipes, [SIZED_ONION]);

    assert.deepEqual(lines[0].breakdown, []);
  });

  test("starts a breakdown without a unit part with the first measure", () => {
    const recipes = [
      recipe("soup", "Soup", [
        ["onion", 1, "large"],
        ["onion", 2, "medium"],
      ]),
    ];

    const { lines } = shoppingList([slot("mon", "lunch", ["soup", 2])], recipes, [SIZED_ONION]);

    assert.deepEqual(lines[0].breakdown, [
      { measureId: "medium", name: "medium", quantity: 4 },
      { measureId: "large", name: "large", quantity: 2 },
    ]);
    assert.equal(lines[0].total, 1100);
  });

  test("gives measure quantities with decimals for half servings", () => {
    const recipes = [recipe("soup", "Soup", [["onion", 0.25, "medium"]])];

    const { lines } = shoppingList([slot("mon", "lunch", ["soup", 0.5])], recipes, [SIZED_ONION]);

    // 0.25 × 0.5 servings = 0.125 medium, which shows as 0.13, and
    // 0.125 × 150 g = 18.75 g, which rounds up to 19 g.
    assert.deepEqual(lines[0].breakdown, [{ measureId: "medium", name: "medium", quantity: 0.13 }]);
    assert.equal(lines[0].total, 19);
  });

  test("skips a line whose measure isn't in the catalog", () => {
    const recipes = [
      recipe("soup", "Soup", [
        ["onion", 2, "gone"],
        ["onion", 1, "medium"],
      ]),
    ];

    const { lines } = shoppingList([slot("mon", "lunch", ["soup", 1])], recipes, [SIZED_ONION]);

    assert.equal(lines[0].total, 150);
    assert.deepEqual(lines[0].breakdown, [{ measureId: "medium", name: "medium", quantity: 1 }]);
  });

  test("rounds the unit part of a breakdown up to a whole number", () => {
    const recipes = [
      recipe("soup", "Soup", [
        ["onion", 0.5],
        ["onion", 1, "medium"],
      ]),
    ];

    const { lines } = shoppingList([slot("mon", "lunch", ["soup", 1])], recipes, [SIZED_ONION]);

    assert.deepEqual(lines[0].breakdown, [
      { measureId: null, name: "g", quantity: 1 },
      { measureId: "medium", name: "medium", quantity: 1 },
    ]);
    assert.equal(lines[0].total, 151);
  });

  test("sums an ingredient in pcs with measures in pcs", () => {
    const box = { id: "box", name: "box", amount: 100 };
    const catalog = [ingredient("egg", "Egg", "pcs", false, [box])];
    const recipes = [
      recipe("omelette", "Omelette", [["egg", 2]]),
      recipe("cake", "Cake", [["egg", 5, "box"]]),
    ];
    const slots = [slot("mon", "lunch", ["omelette", 1]), slot("sat", "dinner", ["cake", 2])];

    const { lines } = shoppingList(slots, recipes, catalog);

    assert.deepEqual(lines, [
      {
        ingredientId: "egg",
        name: "Egg",
        unit: "pcs",
        total: 1002,
        breakdown: [
          { measureId: null, name: "pcs", quantity: 2 },
          { measureId: "box", name: "box", quantity: 10 },
        ],
      },
    ]);
  });

  test("sums one measure over two menu items", () => {
    const recipes = [
      recipe("soup", "Soup", [["onion", 1, "medium"]]),
      recipe("stew", "Stew", [["onion", 0.5, "medium"]]),
    ];
    const slots = [slot("mon", "lunch", ["soup", 2]), slot("tue", "dinner", ["stew", 1.5])];

    const { lines } = shoppingList(slots, recipes, [SIZED_ONION]);

    assert.deepEqual(lines[0].breakdown, [{ measureId: "medium", name: "medium", quantity: 2.75 }]);
    assert.equal(lines[0].total, 413);
  });

  test("sums a decimal measure amount exactly", () => {
    const decimal = ingredient("salt", "Salt", "g", false, [
      { id: "pinch", name: "pinch", amount: 4.4 },
    ]);
    const recipes = [recipe("soup", "Soup", [["salt", 1, "pinch"]])];

    const { lines } = shoppingList([slot("mon", "lunch", ["soup", 12.5])], recipes, [decimal]);

    // 12.5 pinches × 4.4 g = 55 g, where floating point gives 55.00000000000001.
    assert.equal(lines[0].total, 55);
    assert.deepEqual(lines[0].breakdown, [{ measureId: "pinch", name: "pinch", quantity: 12.5 }]);
  });
});

describe("formatTotal", () => {
  test("shows g and ml below 1000 and kg and l from 1000", () => {
    assert.equal(formatTotal(999, "g"), "999 g");
    assert.equal(formatTotal(1000, "g"), "1 kg");
    assert.equal(formatTotal(1300, "g"), "1.3 kg");
    assert.equal(formatTotal(1320, "g"), "1.4 kg");
    assert.equal(formatTotal(1001, "ml"), "1.1 l");
    assert.equal(formatTotal(5, "pcs"), "5 pcs");
    assert.equal(formatTotal(2000, "pcs"), "2000 pcs");
  });
});

describe("lineParts", () => {
  test("returns the total, and the breakdown in parentheses", () => {
    assert.deepEqual(
      lineParts({
        unit: "g",
        total: 1125,
        breakdown: [
          { measureId: null, name: "g", quantity: 300 },
          { measureId: "medium", name: "medium", quantity: 3 },
        ],
      }),
      { total: "1.2 kg", breakdown: "(300 g, 3 medium)" },
    );
  });

  test("returns an empty breakdown when there is none", () => {
    assert.deepEqual(lineParts({ unit: "g", total: 1400, breakdown: [] }), {
      total: "1.4 kg",
      breakdown: "",
    });
  });
});

describe("lineAmount", () => {
  test("shows the total and the breakdown in parentheses", () => {
    assert.equal(
      lineAmount({
        unit: "g",
        total: 1125,
        breakdown: [
          { measureId: null, name: "g", quantity: 300 },
          { measureId: "medium", name: "medium", quantity: 3 },
          { measureId: "large", name: "large", quantity: 1.5 },
        ],
      }),
      "1.2 kg (300 g, 3 medium, 1.5 large)",
      "a breakdown of the unit and two measures",
    );
    assert.equal(
      lineAmount({
        unit: "ml",
        total: 57,
        breakdown: [
          { measureId: null, name: "ml", quantity: 15 },
          { measureId: "dash", name: "dash", quantity: 2 },
          { measureId: "g", name: "g", quantity: 20 },
        ],
      }),
      "57 ml (15 ml, 2 dash, 20 g)",
      "a breakdown in ml with a measure in g",
    );
    assert.equal(lineAmount({ unit: "g", total: 1400, breakdown: [] }), "1.4 kg", "no breakdown");
    assert.equal(
      lineAmount({
        unit: "g",
        total: 1400,
        breakdown: [{ measureId: null, name: "g", quantity: 1320 }],
      }),
      "1.4 kg (1.4 kg)",
      "a breakdown that repeats the total",
    );
  });
});
