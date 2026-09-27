// Menus: the content of a slot, as { items: [{ recipeId, servings }] }. These
// functions never change the menus they get: they return new ones, or the
// same menu when nothing changes. They never touch the DOM, so tests import
// this module directly in Node.js.

import { filterByName, sortByName } from "./name-search.js";

// The same limits the API enforces.
export const MAX_ITEMS = 20;
export const MIN_SERVINGS = 0.5;
export const MAX_SERVINGS = 99;
const SERVINGS_STEP = 0.5;

/** A copy that shares nothing with `menu`, so changing one never changes the other. */
export function copyMenu(menu) {
  return { items: menu.items.map((item) => ({ ...item })) };
}

/** True when both menus have the same recipes, servings, and order. */
export function sameMenu(a, b) {
  return (
    a.items.length === b.items.length &&
    a.items.every(
      (item, index) =>
        item.recipeId === b.items[index].recipeId && item.servings === b.items[index].servings,
    )
  );
}

export function hasRecipe(menu, recipeId) {
  return menu.items.some((item) => item.recipeId === recipeId);
}

/** Appends `recipeId` at 1 serving, unless it's already in the menu or the menu is full. */
export function addItem(menu, recipeId) {
  if (hasRecipe(menu, recipeId) || menu.items.length >= MAX_ITEMS) return menu;
  return { items: [...menu.items, { recipeId, servings: 1 }] };
}

export function removeItem(menu, recipeId) {
  return { items: menu.items.filter((item) => item.recipeId !== recipeId) };
}

/** Moves the servings of `recipeId` by `steps` steps of 0.5, within the limits. */
export function stepServings(menu, recipeId, steps) {
  return {
    items: menu.items.map((item) => {
      if (item.recipeId !== recipeId) return item;
      const servings = item.servings + steps * SERVINGS_STEP;
      return { ...item, servings: Math.min(MAX_SERVINGS, Math.max(MIN_SERVINGS, servings)) };
    }),
  };
}

/** The recipes the slot editor offers: active, not in `menu`, matching `query`, A to Z. */
export function addableRecipes(recipes, menu, query) {
  const offered = recipes.filter((recipe) => !recipe.archived && !hasRecipe(menu, recipe.id));
  return sortByName(filterByName(offered, query));
}

/** For example, "Gnocchi carbonara × 1.5". */
export function describeItem(name, servings) {
  return `${name} × ${servings}`;
}
