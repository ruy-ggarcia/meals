import assert from "node:assert/strict";
import { test } from "node:test";
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
      { ingredientId: "egg", name: "Egg", unit: "pcs", total: 6, breakdown: [] },
      { ingredientId: "milk", name: "Milk", unit: "ml", total: 150, breakdown: [] },
      { ingredientId: "onion", name: "Onion", unit: "g", total: 375, breakdown: [] },
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

  assert.deepEqual(lines, [
    { ingredientId: "egg", name: "Egg", unit: "pcs", total: 1, breakdown: [] },
  ]);
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

  assert.deepEqual(lines, [
    { ingredientId: "saffron", name: "Saffron", unit: "g", total: 2, breakdown: [] },
  ]);
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
    lines: [{ ingredientId: "egg", name: "Egg", unit: "pcs", total: 2, breakdown: [] }],
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
    lines: [{ ingredientId: "onion", name: "Onion", unit: "g", total: 100, breakdown: [] }],
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

const MEDIUM = { id: "medium", name: "medium", amount: 150 };
const LARGE = { id: "large", name: "large", amount: 250 };
const SIZED_ONION = ingredient("onion", "Onion", "g", false, [MEDIUM, LARGE]);

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

test("a week without measure lines has an empty breakdown", () => {
  const recipes = [recipe("soup", "Soup", [["onion", 300]])];

  const { lines } = shoppingList([slot("mon", "lunch", ["soup", 1])], recipes, [SIZED_ONION]);

  assert.deepEqual(lines[0].breakdown, []);
});

test("a breakdown without a unit part starts with the first measure", () => {
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

test("half servings give measure quantities with decimals", () => {
  const recipes = [recipe("soup", "Soup", [["onion", 0.25, "medium"]])];

  const { lines } = shoppingList([slot("mon", "lunch", ["soup", 0.5])], recipes, [SIZED_ONION]);

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

test("the unit part of a breakdown is rounded up to a whole number", () => {
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
  assert.equal(lineAmount(lines[0]), "151 g (1 g, 1 medium)");
});

test("an ingredient in pcs with measures sums in pcs and never changes unit", () => {
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
  assert.equal(lineAmount(lines[0]), "1002 pcs (2 pcs, 10 box)");
});

test("one measure sums over two menu items", () => {
  const recipes = [
    recipe("soup", "Soup", [["onion", 1, "medium"]]),
    recipe("stew", "Stew", [["onion", 0.5, "medium"]]),
  ];
  const slots = [slot("mon", "lunch", ["soup", 2]), slot("tue", "dinner", ["stew", 1.5])];

  const { lines } = shoppingList(slots, recipes, [SIZED_ONION]);

  assert.deepEqual(lines[0].breakdown, [{ measureId: "medium", name: "medium", quantity: 2.75 }]);
  assert.equal(lines[0].total, 413);
});

test("a decimal measure amount sums exactly", () => {
  const decimal = ingredient("salt", "Salt", "g", false, [
    { id: "pinch", name: "pinch", amount: 4.4 },
  ]);
  const recipes = [recipe("soup", "Soup", [["salt", 1, "pinch"]])];

  const { lines } = shoppingList([slot("mon", "lunch", ["soup", 12.5])], recipes, [decimal]);

  assert.equal(lines[0].total, 55);
  assert.deepEqual(lines[0].breakdown, [{ measureId: "pinch", name: "pinch", quantity: 12.5 }]);
});

test("formatTotal shows g and ml below 1000, and kg and l from 1000, rounded up to tenths", () => {
  assert.equal(formatTotal(999, "g"), "999 g");
  assert.equal(formatTotal(1000, "g"), "1 kg");
  assert.equal(formatTotal(1300, "g"), "1.3 kg");
  assert.equal(formatTotal(1320, "g"), "1.4 kg");
  assert.equal(formatTotal(1001, "ml"), "1.1 l");
  assert.equal(formatTotal(5, "pcs"), "5 pcs");
  assert.equal(formatTotal(2000, "pcs"), "2000 pcs");
});

test("lineParts returns the total, and the breakdown in parentheses or nothing", () => {
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
  assert.deepEqual(lineParts({ unit: "g", total: 1400, breakdown: [] }), {
    total: "1.4 kg",
    breakdown: "",
  });
});

test("lineAmount shows the total and the breakdown in parentheses", () => {
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
  );
  assert.equal(lineAmount({ unit: "g", total: 1400, breakdown: [] }), "1.4 kg");
  assert.equal(
    lineAmount({
      unit: "g",
      total: 1400,
      breakdown: [{ measureId: null, name: "g", quantity: 1320 }],
    }),
    "1.4 kg (1.4 kg)",
  );
});
