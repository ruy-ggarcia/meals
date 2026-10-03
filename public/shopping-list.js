// The shopping list of a week: for each ingredient, the sum of quantity ×
// servings over every menu item, rounded up. It never touches the DOM, so
// tests import this module directly in Node.js, and an export can reuse it.

import { sortByName } from "./name-search.js";
import { twoHundredths, wholeUnits } from "./quantities.js";

/**
 * `slots` lists the week's slots in day and meal order, as
 * { day, meal, menu }. Menu items whose recipe isn't in `recipes`, and recipe
 * ingredients that aren't in `ingredients`, are skipped.
 *
 * Returns { lines, recipesWithoutIngredients }, both from A to Z:
 * - lines: [{ ingredientId, name, unit, total }]
 * - recipesWithoutIngredients: [{ recipeId, name, slots: [{ day, meal }] }]
 */
export function shoppingList(slots, recipes, ingredients) {
  const recipesById = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const ingredientsById = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
  /** Two-hundredths of a unit, by ingredient ID. */
  const totals = new Map();
  /** Recipes without ingredients, by recipe ID. */
  const without = new Map();

  for (const { day, meal, menu } of slots) {
    for (const item of menu.items) {
      const recipe = recipesById.get(item.recipeId);
      if (!recipe) continue;
      const known = recipe.ingredients.filter((entry) => ingredientsById.has(entry.ingredientId));
      if (known.length === 0) {
        const entry = without.get(recipe.id) ?? {
          recipeId: recipe.id,
          name: recipe.name,
          slots: [],
        };
        entry.slots.push({ day, meal });
        without.set(recipe.id, entry);
        continue;
      }
      for (const { ingredientId, quantity } of known) {
        const total = (totals.get(ingredientId) ?? 0) + twoHundredths(quantity, item.servings);
        totals.set(ingredientId, total);
      }
    }
  }

  const lines = [...totals].map(([ingredientId, total]) => {
    const { name, unit } = ingredientsById.get(ingredientId);
    return { ingredientId, name, unit, total: wholeUnits(total) };
  });
  return { lines: sortByName(lines), recipesWithoutIngredients: sortByName([...without.values()]) };
}
