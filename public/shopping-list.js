// The shopping list of a week: for each ingredient, the sum of quantity ×
// servings over every menu item, converted to the unit and rounded up. It
// never touches the DOM, so tests import this module directly in Node.js,
// and an export can reuse it.

import { sortByName } from "./name-search.js";
import { scaledAmount, wholeUnits } from "./quantities.js";

/**
 * `slots` lists the week's slots in day and meal order, as
 * { day, meal, menu }. Menu items whose recipe isn't in `recipes`, and recipe
 * ingredients that aren't in `ingredients`, are skipped.
 *
 * Returns { lines, recipesWithoutIngredients }, both from A to Z:
 * - lines: [{ ingredientId, name, unit, total, breakdown }], where total is
 *   in whole units, rounded up, and breakdown is [] when no line of the week
 *   uses a measure, or else [{ measureId, name, quantity }]: the part in the
 *   unit first (measureId null, name the unit, quantity in whole units
 *   rounded up), then the measures in the ingredient's order (quantity to
 *   two decimals). A line whose measure the ingredient doesn't have is
 *   skipped.
 * - recipesWithoutIngredients: [{ recipeId, name, slots: [{ day, meal }] }]
 */
export function shoppingList(slots, recipes, ingredients) {
  const recipesById = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const ingredientsById = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
  /**
   * By ingredient ID: `total` in 1/20000 of the unit, `unit` for the lines in
   * the unit, and `measured` for the lines in each measure, by measure ID, in
   * the same 1/20000 of the unit as `total`, as if each measure held 1.
   */
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
      for (const { ingredientId, quantity, measureId } of known) {
        const measure =
          measureId === undefined
            ? null
            : ingredientsById.get(ingredientId).measures.find(({ id }) => id === measureId);
        if (measure === undefined) continue;
        const entry = totals.get(ingredientId) ?? { total: 0, unit: 0, measured: new Map() };
        totals.set(ingredientId, entry);
        entry.total += scaledAmount(quantity, item.servings, measure?.amount);
        if (measure === null) {
          entry.unit += scaledAmount(quantity, item.servings);
        } else {
          const parts = scaledAmount(quantity, item.servings);
          entry.measured.set(measure.id, (entry.measured.get(measure.id) ?? 0) + parts);
        }
      }
    }
  }

  const lines = [...totals].map(([ingredientId, entry]) => {
    const { name, unit, measures } = ingredientsById.get(ingredientId);
    const breakdown = [];
    if (entry.measured.size > 0) {
      if (entry.unit > 0) {
        breakdown.push({ measureId: null, name: unit, quantity: wholeUnits(entry.unit) });
      }
      for (const measure of measures) {
        if (!entry.measured.has(measure.id)) continue;
        const quantity = Math.round(entry.measured.get(measure.id) / 200) / 100;
        breakdown.push({ measureId: measure.id, name: measure.name, quantity });
      }
    }
    return { ingredientId, name, unit, total: wholeUnits(entry.total), breakdown };
  });
  return { lines: sortByName(lines), recipesWithoutIngredients: sortByName([...without.values()]) };
}

/**
 * A total with its unit. From 1000 `g` or `ml` on it shows in `kg` or `l`,
 * rounded up to tenths so you never buy too little.
 */
export function formatTotal(total, unit) {
  if ((unit === "g" || unit === "ml") && total >= 1000) {
    return `${Math.ceil(total / 100) / 10} ${unit === "g" ? "kg" : "l"}`;
  }
  return `${total} ${unit}`;
}

/**
 * The texts of a line: its `total`, and its `breakdown` in parentheses, or ""
 * when no measure adds to it.
 */
export function lineParts({ unit, total, breakdown }) {
  const parts = breakdown.map((part) =>
    part.measureId === null
      ? formatTotal(part.quantity, part.name)
      : `${part.quantity} ${part.name}`,
  );
  return {
    total: formatTotal(total, unit),
    breakdown: parts.length === 0 ? "" : `(${parts.join(", ")})`,
  };
}

/** The text of a line: its total, and its breakdown in parentheses. */
export function lineAmount(line) {
  const { total, breakdown } = lineParts(line);
  return breakdown === "" ? total : `${total} ${breakdown}`;
}
