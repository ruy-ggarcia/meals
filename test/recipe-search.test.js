import assert from "node:assert/strict";
import { test } from "node:test";
import { filterRecipes, nameKey, sortRecipes } from "../public/recipe-search.js";
import { cleanName, nameKey as serverNameKey } from "../server/recipes.js";

function recipe(name, archived = false) {
  return { id: `id-${name}`, name, archived };
}

test("nameKey ignores case and accents, like the server", () => {
  assert.equal(nameKey("Café"), "cafe");
  assert.equal(nameKey("ÑOQUIS"), "noquis");
});

test("sortRecipes returns a new array from A to Z by name key", () => {
  const input = [recipe("omelette"), recipe("Ñoquis"), recipe("Café"), recipe("banana")];

  const sorted = sortRecipes(input);

  assert.deepEqual(
    sorted.map((entry) => entry.name),
    ["banana", "Café", "Ñoquis", "omelette"],
  );
  assert.equal(input[0].name, "omelette", "the input keeps its order");
});

test("filterRecipes matches part of the name, ignoring case, accents, and extra spaces", () => {
  const recipes = [recipe("Iced café"), recipe("Tea"), recipe("Café con leche")];

  assert.deepEqual(
    filterRecipes(recipes, "cafe").map((entry) => entry.name),
    ["Iced café", "Café con leche"],
  );
  assert.deepEqual(
    filterRecipes(recipes, "  CAFÉ   CON ").map((entry) => entry.name),
    ["Café con leche"],
  );
  assert.deepEqual(filterRecipes(recipes, "juice"), []);
});

test("filterRecipes with a blank query matches every recipe", () => {
  const recipes = [recipe("Tea"), recipe("Soup")];
  assert.deepEqual(filterRecipes(recipes, ""), recipes);
  assert.deepEqual(filterRecipes(recipes, "   "), recipes);
});

// The browser never imports from server/, so server/recipes.js#nameKey and
// public/recipe-search.js#nameKey are separate implementations of the same
// rule on purpose. This pins them to each other.
test("nameKey equals the server's nameKey for accented, cased, and emoji names", () => {
  for (const name of ["Café", "ÑOQUIS", "  Crème  brûlée ", "Ǆ", "🍲"]) {
    assert.equal(nameKey(name), serverNameKey(name), name);
  }
});

test("filterRecipes matches a name the server would store, for a query with extra spaces", () => {
  const stored = cleanName("  Crème   brûlée  \t");
  const recipe = { id: "id-creme-brulee", name: stored, archived: false };

  assert.deepEqual(filterRecipes([recipe], "  crème   brûlée  "), [recipe]);
});
