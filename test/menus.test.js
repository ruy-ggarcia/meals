import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addableRecipes,
  addItem,
  copyMenu,
  describeItem,
  emptyMenu,
  hasRecipe,
  MAX_ITEMS,
  MAX_SERVINGS,
  MIN_SERVINGS,
  removeItem,
  sameMenu,
  stepServings,
} from "../public/menus.js";

function menu(...entries) {
  return { items: entries.map(([recipeId, servings]) => ({ recipeId, servings })) };
}

test("the limits match the API", () => {
  assert.equal(MAX_ITEMS, 20);
  assert.equal(MIN_SERVINGS, 0.5);
  assert.equal(MAX_SERVINGS, 99);
});

test("emptyMenu has no menu items", () => {
  assert.deepEqual(emptyMenu(), { items: [] });
});

test("copyMenu returns a copy that shares nothing with the original", () => {
  const original = menu(["soup", 1]);
  const copy = copyMenu(original);

  copy.items[0].servings = 2;
  copy.items.push({ recipeId: "bread", servings: 1 });

  assert.deepEqual(original, menu(["soup", 1]));
});

test("sameMenu compares recipes, servings, and order", () => {
  assert.equal(sameMenu(menu(["soup", 1]), menu(["soup", 1])), true);
  assert.equal(sameMenu(emptyMenu(), emptyMenu()), true);
  assert.equal(sameMenu(menu(["soup", 1]), menu(["soup", 1.5])), false);
  assert.equal(sameMenu(menu(["soup", 1], ["bread", 1]), menu(["bread", 1], ["soup", 1])), false);
  assert.equal(sameMenu(menu(["soup", 1]), menu(["soup", 1], ["bread", 1])), false);
});

test("hasRecipe tells whether a recipe is in the menu", () => {
  assert.equal(hasRecipe(menu(["soup", 1]), "soup"), true);
  assert.equal(hasRecipe(menu(["soup", 1]), "bread"), false);
});

test("addItem appends the recipe at 1 serving without changing the original", () => {
  const original = menu(["soup", 2]);

  const result = addItem(original, "bread");

  assert.deepEqual(result, menu(["soup", 2], ["bread", 1]));
  assert.deepEqual(original, menu(["soup", 2]));
});

test("addItem ignores a recipe that is already in the menu", () => {
  const original = menu(["soup", 2]);
  assert.equal(addItem(original, "soup"), original);
});

test("addItem ignores a full menu", () => {
  const full = menu(...Array.from({ length: 20 }, (_, index) => [`r${index}`, 1]));
  assert.equal(addItem(full, "one-more"), full);
});

test("removeItem removes the recipe and keeps the order of the others", () => {
  const original = menu(["soup", 1], ["bread", 2], ["fruit", 1]);

  assert.deepEqual(removeItem(original, "bread"), menu(["soup", 1], ["fruit", 1]));
  assert.deepEqual(original, menu(["soup", 1], ["bread", 2], ["fruit", 1]));
});

test("stepServings moves one recipe by steps of 0.5", () => {
  const original = menu(["soup", 1], ["bread", 1]);

  assert.deepEqual(stepServings(original, "soup", 1), menu(["soup", 1.5], ["bread", 1]));
  assert.deepEqual(stepServings(original, "soup", -1), menu(["soup", 0.5], ["bread", 1]));
  assert.deepEqual(original, menu(["soup", 1], ["bread", 1]));
});

test("stepServings stays within 0.5 and 99", () => {
  assert.deepEqual(stepServings(menu(["soup", 0.5]), "soup", -1), menu(["soup", 0.5]));
  assert.deepEqual(stepServings(menu(["soup", 99]), "soup", 1), menu(["soup", 99]));
});

test("addableRecipes offers active recipes that aren't in the menu, matching the query, A to Z", () => {
  const recipes = [
    { id: "russian", name: "Russian salad", archived: false },
    { id: "green", name: "Green salad", archived: false },
    { id: "old", name: "Old salad", archived: true },
    { id: "soup", name: "Soup", archived: false },
    { id: "fruit", name: "Fruit salad", archived: false },
  ];
  const current = menu(["fruit", 1]);

  assert.deepEqual(
    addableRecipes(recipes, current, "SALAD").map((recipe) => recipe.id),
    ["green", "russian"],
  );
  assert.deepEqual(
    addableRecipes(recipes, current, "").map((recipe) => recipe.id),
    ["green", "russian", "soup"],
  );
});

test("describeItem shows the name and the servings", () => {
  assert.equal(describeItem("Gnocchi carbonara", 1.5), "Gnocchi carbonara × 1.5");
  assert.equal(describeItem("Soup", 2), "Soup × 2");
});
