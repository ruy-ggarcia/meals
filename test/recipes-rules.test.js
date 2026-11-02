import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  checkIngredientsExist,
  isKnown,
  measureIdsByIngredient,
  moveLines,
  normalize,
  normalizeIngredients,
  usageIn,
  validChanges,
  validIngredients,
  validNewRecipe,
  withKnownIngredients,
} from "../server/recipes.js";

const wrongShape =
  'ingredients[0] must have "ingredientId" and "quantity", and optionally "measureId".';
const wrongQuantity =
  "ingredients[0].quantity must be from 0.01 to 10000, with at most two decimals.";

function line(ingredientId, quantity) {
  return { ingredientId, quantity };
}

function lineInMeasure(ingredientId, measureId, quantity) {
  return { ingredientId, measureId, quantity };
}

/** The error that the rule throws: a ValidationError with this exact message. */
function invalid(message) {
  return { name: "ValidationError", message };
}

describe("validIngredients", () => {
  test("rejects ingredients that aren't an array", () => {
    for (const ingredients of ["Onion", null, {}, undefined, 7]) {
      assert.throws(
        () => validIngredients(ingredients),
        invalid('"ingredients" must be an array.'),
        String(ingredients),
      );
    }
  });

  test("rejects more than 50 ingredients", () => {
    const tooMany = Array.from({ length: 51 }, (_, index) => line(`ingredient-${index}`, 1));

    assert.throws(
      () => validIngredients(tooMany),
      invalid("A recipe holds at most 50 ingredients."),
    );
  });

  test("rejects an ingredient with missing or extra keys", () => {
    const lines = [
      null,
      "Onion",
      [],
      {},
      { ingredientId: "onion" },
      { quantity: 1 },
      { ...line("onion", 1), note: "chopped" },
      { ...lineInMeasure("onion", "medium", 1), note: "chopped" },
      { ingredientId: "onion", measureId: "medium" },
    ];
    for (const entry of lines) {
      assert.throws(() => validIngredients([entry]), invalid(wrongShape), JSON.stringify(entry));
    }
  });

  test("rejects an ingredientId that isn't a string", () => {
    assert.throws(
      () => validIngredients([line(42, 1)]),
      invalid("ingredients[0].ingredientId must be a string."),
    );
  });

  test("rejects a repeated ingredient", () => {
    assert.throws(
      () => validIngredients([line("onion", 1), line("onion", 2)]),
      invalid("ingredients[1] repeats ingredient onion."),
    );
  });

  test("rejects a repeated ingredient in two different measures", () => {
    assert.throws(
      () =>
        validIngredients([lineInMeasure("onion", "medium", 1), lineInMeasure("onion", "small", 1)]),
      invalid("ingredients[1] repeats ingredient onion."),
    );
  });

  test("rejects a quantity outside 0.01 to 10000 or with three decimals", () => {
    const quantities = [
      0,
      0.001,
      0.005,
      0.125,
      1.255,
      10000.01,
      -1,
      "1",
      Number.NaN,
      Number.POSITIVE_INFINITY,
      null,
    ];
    for (const quantity of quantities) {
      assert.throws(
        () => validIngredients([line("onion", quantity)]),
        invalid(wrongQuantity),
        String(quantity),
      );
    }
  });

  test("rejects a measureId that isn't a string", () => {
    for (const measureId of [5, null]) {
      assert.throws(
        () => validIngredients([lineInMeasure("onion", measureId, 1)]),
        invalid("ingredients[0].measureId must be a string."),
        String(measureId),
      );
    }
  });

  test("accepts no ingredients, and returns an empty array", () => {
    assert.deepEqual(validIngredients([]), []);
  });

  test("accepts the limits: 50 ingredients, 0.01, and 10000", () => {
    const list = Array.from({ length: 50 }, (_, index) =>
      line(`ingredient-${index}`, index === 0 ? 0.01 : 10000),
    );

    assert.deepEqual(validIngredients(list), list);
  });

  test("rounds each quantity to two decimals", () => {
    const [clean] = validIngredients([line("onion", 0.1 * 3)]); // 0.30000000000000004

    assert.deepEqual(clean, line("onion", 0.3));
  });

  test("keeps measureId in a measure, and omits it in the unit", () => {
    const list = [lineInMeasure("onion", "medium", 2), line("egg", 1)];

    const clean = validIngredients(list);

    assert.deepEqual(clean, list);
    assert.equal("measureId" in clean[1], false);
    assert.notEqual(clean[0], list[0]);
  });
});

describe("validNewRecipe", () => {
  test("rejects fields that aren't a name with optional ingredients", () => {
    const fields = [
      undefined,
      null,
      "Soup",
      [],
      { name: "Soup", archived: false },
      { color: "red" },
    ];
    for (const value of fields) {
      assert.throws(
        () => validNewRecipe(value),
        invalid('Send "name" and, optionally, "ingredients".'),
        JSON.stringify(value),
      );
    }
  });

  test("rejects an invalid name", () => {
    assert.throws(() => validNewRecipe({ name: " " }), invalid("The name can't be empty."));
    assert.throws(() => validNewRecipe({}), invalid('"name" must be a string.'));
  });

  test("rejects invalid ingredients", () => {
    for (const ingredients of ["Onion", null, {}, 7]) {
      assert.throws(
        () => validNewRecipe({ name: "Soup", ingredients }),
        invalid('"ingredients" must be an array.'),
        String(ingredients),
      );
    }
  });

  test("returns the cleaned name and no ingredients by default", () => {
    assert.deepEqual(validNewRecipe({ name: "  Gnocchi   carbonara " }), {
      name: "Gnocchi carbonara",
      ingredients: [],
    });
  });

  test("returns the clean ingredients", () => {
    assert.deepEqual(validNewRecipe({ name: "Soup", ingredients: [line("onion", 0.1 * 3)] }), {
      name: "Soup",
      ingredients: [line("onion", 0.3)],
    });
  });
});

describe("validChanges", () => {
  test("rejects changes that aren't a name, ingredients, or archived alone", () => {
    const changes = [
      undefined,
      null,
      "Soup",
      [],
      {},
      { color: "red" },
      { name: "Stew", color: "red" },
      { name: "Stew", archived: true },
      { archived: true, ingredients: [] },
    ];
    for (const value of changes) {
      assert.throws(
        () => validChanges(value),
        invalid('Send "name", "ingredients", or both, or "archived" alone.'),
        JSON.stringify(value),
      );
    }
  });

  test("rejects archived that isn't true or false", () => {
    for (const archived of ["yes", null, 1]) {
      assert.throws(
        () => validChanges({ archived }),
        invalid('"archived" must be true or false.'),
        String(archived),
      );
    }
  });

  test("rejects an invalid name", () => {
    assert.throws(() => validChanges({ name: "" }), invalid("The name can't be empty."));
    assert.throws(() => validChanges({ name: 42 }), invalid('"name" must be a string.'));
  });

  test("rejects invalid ingredients", () => {
    assert.throws(
      () => validChanges({ ingredients: null }),
      invalid('"ingredients" must be an array.'),
    );
  });

  test("accepts archived alone", () => {
    assert.deepEqual(validChanges({ archived: true }), { archived: true });
    assert.deepEqual(validChanges({ archived: false }), { archived: false });
  });

  test("accepts a name, ingredients, or both, and returns only the fields sent", () => {
    assert.deepEqual(validChanges({ name: " Tomato  soup " }), { name: "Tomato soup" });
    assert.deepEqual(validChanges({ ingredients: [] }), { ingredients: [] });
    assert.deepEqual(validChanges({ name: "Soup", ingredients: [line("onion", 1)] }), {
      name: "Soup",
      ingredients: [line("onion", 1)],
    });
  });
});

describe("normalizeIngredients", () => {
  test("returns no ingredients when the value isn't an array", () => {
    for (const raw of [undefined, null, "Onion", {}, 7]) {
      assert.deepEqual(normalizeIngredients(raw), [], String(raw));
    }
  });

  test("keeps only the ingredients that validIngredients accepts", () => {
    const raw = [
      line("onion", 100),
      line("onion", 7), // repeated -> dropped
      line("bad", 1.255), // three decimals -> dropped
      line(42, 1), // ingredientId not a string -> dropped
      lineInMeasure("leek", 5, 2), // measureId not a string -> dropped
      lineInMeasure("garlic", null, 3), // measureId not a string -> dropped
      { ingredientId: "salt" }, // no quantity -> dropped
      "Salt",
      null,
      lineInMeasure("egg", "large", 2),
      { ...line("milk", 0.1 * 3), note: "cold" }, // kept without the extra key, rounded
    ];

    const clean = normalizeIngredients(raw);

    assert.deepEqual(clean, [
      line("onion", 100),
      lineInMeasure("egg", "large", 2),
      line("milk", 0.3),
    ]);
    assert.deepEqual(validIngredients(clean), clean);
  });

  test("keeps at most 50 ingredients", () => {
    const raw = Array.from({ length: 55 }, (_, index) => line(`ingredient-${index}`, 1));

    assert.deepEqual(normalizeIngredients(raw), raw.slice(0, 50));
  });
});

describe("normalize", () => {
  test("returns no recipes when there is no file", () => {
    assert.deepEqual(normalize(undefined), []);
  });

  test("rejects data that isn't an object with a recipes array", () => {
    const wrong = [
      [{ id: "a", name: "Soup", archived: false }],
      { recipes: "Soup" },
      null,
      "Soup",
      7,
    ];
    for (const raw of wrong) {
      assert.throws(
        () => normalize(raw),
        { message: 'recipes.json must be an object with a "recipes" array.' },
        JSON.stringify(raw),
      );
    }
  });

  test("skips the entries without a string id and name", () => {
    const raw = {
      recipes: [
        { id: "a", name: "Soup", archived: true },
        { id: 3, name: "Bad ID" },
        { id: "c" },
        { id: "d", name: 4 },
        null,
        "Tea",
      ],
    };

    assert.deepEqual(normalize(raw), [{ id: "a", name: "Soup", archived: true, ingredients: [] }]);
  });

  test("reads archived as false unless it is true", () => {
    const raw = {
      recipes: [
        { id: "a", name: "Soup" },
        { id: "b", name: "Salad", archived: "yes" },
        { id: "c", name: "Tea", archived: true },
      ],
    };

    assert.deepEqual(
      normalize(raw).map((recipe) => recipe.archived),
      [false, false, true],
    );
  });

  test("normalizes the ingredients, and reads a missing list as empty", () => {
    const raw = {
      recipes: [
        { id: "a", name: "Soup", ingredients: [line("onion", 100), line("onion", 7), "Salt"] },
        { id: "b", name: "Tea" },
      ],
    };

    assert.deepEqual(normalize(raw), [
      { id: "a", name: "Soup", archived: false, ingredients: [line("onion", 100)] },
      { id: "b", name: "Tea", archived: false, ingredients: [] },
    ]);
  });
});

describe("measureIdsByIngredient", () => {
  test("maps each ingredient to the IDs of its measures", () => {
    const list = [
      { id: "onion", measures: [{ id: "medium" }, { id: "small" }] },
      { id: "egg", measures: [] },
    ];

    assert.deepEqual(
      measureIdsByIngredient(list),
      new Map([
        ["onion", new Set(["medium", "small"])],
        ["egg", new Set()],
      ]),
    );
  });

  test("maps an empty catalog to an empty map", () => {
    assert.deepEqual(measureIdsByIngredient([]), new Map());
  });
});

describe("isKnown", () => {
  const known = new Map([
    ["onion", new Set(["medium"])],
    ["egg", new Set()],
  ]);

  test("accepts an ingredient in its unit when the catalog has it", () => {
    assert.equal(isKnown(known, line("egg", 1)), true);
  });

  test("accepts a measure that the ingredient has", () => {
    assert.equal(isKnown(known, lineInMeasure("onion", "medium", 1)), true);
  });

  test("rejects an unknown ingredient", () => {
    assert.equal(isKnown(known, line("gone", 1)), false);
  });

  test("rejects a measure that its ingredient doesn't have", () => {
    assert.equal(isKnown(known, lineInMeasure("onion", "gone", 1)), false);
    assert.equal(isKnown(known, lineInMeasure("egg", "medium", 1)), false);
  });
});

describe("withKnownIngredients", () => {
  const known = new Map([["onion", new Set(["medium"])]]);

  test("drops an ingredient or measure that the catalog doesn't have", () => {
    const recipe = {
      id: "a",
      name: "Soup",
      archived: false,
      ingredients: [
        line("onion", 1),
        line("gone", 2),
        lineInMeasure("onion", "medium", 3),
        lineInMeasure("onion", "gone", 4),
      ],
    };

    const shown = withKnownIngredients(recipe, known);

    assert.deepEqual(shown, {
      ...recipe,
      ingredients: [line("onion", 1), lineInMeasure("onion", "medium", 3)],
    });
    assert.equal(recipe.ingredients.length, 4);
  });
});

describe("checkIngredientsExist", () => {
  const known = new Map([["onion", new Set(["medium"])]]);

  test("accepts ingredients and measures that the catalog has", () => {
    assert.doesNotThrow(() =>
      checkIngredientsExist(known, [line("onion", 1), lineInMeasure("onion", "medium", 2)]),
    );
  });

  test("rejects an ingredient that isn't in the catalog", () => {
    assert.throws(
      () => checkIngredientsExist(known, [line("onion", 1), line("gone", 1)]),
      invalid("Unknown ingredient: gone"),
    );
  });

  test("rejects a measure that its ingredient doesn't have", () => {
    assert.throws(
      () => checkIngredientsExist(known, [lineInMeasure("onion", "gone", 1)]),
      invalid("Unknown measure: gone"),
    );
  });

  test("reports an unknown ingredient before an unknown measure", () => {
    assert.throws(
      () => checkIngredientsExist(known, [lineInMeasure("onion", "gone", 1), line("leek", 1)]),
      invalid("Unknown ingredient: leek"),
    );
  });
});

describe("usageIn", () => {
  const recipes = [
    { ingredients: [lineInMeasure("onion", "medium", 1), line("egg", 2)] },
    { ingredients: [lineInMeasure("onion", "small", 1)] },
    { ingredients: [] },
  ];

  test("reports the measures of the ingredient that any recipe uses", () => {
    assert.deepEqual(usageIn(recipes, "onion"), {
      inUnit: false,
      measureIds: new Set(["medium", "small"]),
    });
  });

  test("reports an ingredient in its unit", () => {
    assert.deepEqual(usageIn(recipes, "egg"), { inUnit: true, measureIds: new Set() });
  });

  test("reports no usage of an ingredient that no recipe has", () => {
    assert.deepEqual(usageIn(recipes, "leek"), { inUnit: false, measureIds: new Set() });
    assert.deepEqual(usageIn([], "onion"), { inUnit: false, measureIds: new Set() });
  });
});

describe("moveLines", () => {
  function recipesWithLines() {
    return [
      { ingredients: [line("onion", 100), line("egg", 2)] },
      { ingredients: [line("onion", 50), lineInMeasure("onion", "small", 1)] },
      { ingredients: [] },
    ];
  }

  test("moves an ingredient in its unit to the measure, in every recipe", () => {
    const all = recipesWithLines();

    moveLines(all, "onion", "medium");

    assert.deepEqual(all, [
      { ingredients: [lineInMeasure("onion", "medium", 100), line("egg", 2)] },
      {
        ingredients: [lineInMeasure("onion", "medium", 50), lineInMeasure("onion", "small", 1)],
      },
      { ingredients: [] },
    ]);
  });

  test("returns how many ingredients moved", () => {
    assert.equal(moveLines(recipesWithLines(), "onion", "medium"), 2);
    assert.equal(moveLines(recipesWithLines(), "leek", "medium"), 0);
  });

  test("changes nothing the second time", () => {
    const all = recipesWithLines();
    moveLines(all, "onion", "medium");

    assert.equal(moveLines(all, "onion", "medium"), 0);
  });
});
