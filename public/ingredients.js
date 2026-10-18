// Ingredient catalog page. Depends ONLY on the HTTP API (/api/ingredients and
// /api/recipes); never import from server/. It follows the app's interaction
// rules: Enter or the confirm button confirms, Escape or Cancel discards, and
// leaving a field never discards changes.

import { createCatalogList } from "./catalog-list.js";
import { createElement, withLoadState } from "./dom.js";
import { getJson } from "./http.js";
import { createIngredientEditor } from "./ingredient-editor.js";

const loadError = document.getElementById("load-error");
const retryLoadButton = document.getElementById("retry-load");
const catalog = document.getElementById("ingredient-catalog");
const newIngredientButton = document.getElementById("new-ingredient");
const editor = createIngredientEditor(document.getElementById("ingredient-editor"));

/**
 * How recipes, active and archived, use each ingredient, by ingredient ID:
 * { recipes, inUnit, measures }. `recipes` counts the recipes, `inUnit` tells
 * whether any line is in the unit, and `measures` counts the recipes per
 * measure ID.
 */
let usage = new Map();

function ingredientUrl(id) {
  return `/api/ingredients/${encodeURIComponent(id)}`;
}

const list = createCatalogList({
  elements: {
    search: document.getElementById("search"),
    emptyMessage: document.getElementById("empty-catalog"),
    noMatches: document.getElementById("no-matches"),
    activeList: document.getElementById("active-ingredients"),
    archived: document.getElementById("archived"),
    archivedCount: document.getElementById("archived-count"),
    archivedList: document.getElementById("archived-ingredients"),
  },
  noun: "ingredient",
  url: ingredientUrl,
  details: (ingredient) => [createElement("span", "entry-unit", ingredient.unit)],
  onEdit: openEditor,
});

function unused() {
  return { recipes: 0, inUnit: false, measures: new Map() };
}

function countUsage(recipes) {
  const counts = new Map();
  for (const recipe of recipes) {
    const recipeMeasures = new Map(); // ingredient ID -> the measure IDs this recipe uses
    for (const { ingredientId, measureId } of recipe.ingredients) {
      if (!counts.has(ingredientId)) {
        counts.set(ingredientId, unused());
      }
      if (!recipeMeasures.has(ingredientId)) {
        recipeMeasures.set(ingredientId, new Set());
        counts.get(ingredientId).recipes += 1;
      }
      if (measureId === undefined) counts.get(ingredientId).inUnit = true;
      else recipeMeasures.get(ingredientId).add(measureId);
    }
    for (const [ingredientId, measureIds] of recipeMeasures) {
      const { measures } = counts.get(ingredientId);
      for (const id of measureIds) measures.set(id, (measures.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

// Opens the editor on `ingredient`, or on a new ingredient when it's undefined.
function openEditor(ingredient) {
  list.resetMessages();
  editor.open({
    ingredient,
    usage: (ingredient && usage.get(ingredient.id)) ?? unused(),
    // By ID: the rows re-render, which replaces the Edit button that was clicked.
    restoreFocus: () => (ingredient ? list.focusEdit(ingredient.id) : newIngredientButton.focus()),
    onSaved: (saved) => {
      list.remember(saved);
      list.focusEdit(saved.id);
    },
  });
}

async function load() {
  await withLoadState({
    loadError,
    retryButton: retryLoadButton,
    content: [catalog],
    errorMessage: "Couldn't load the ingredients:",
    run: async () => {
      const [ingredientCatalog, recipeBook] = await Promise.all([
        getJson("/api/ingredients"),
        getJson("/api/recipes"),
      ]);
      usage = countUsage(recipeBook.recipes);
      list.setEntries(ingredientCatalog.ingredients);
    },
  });
}

// ---------- Events ----------

newIngredientButton.addEventListener("click", () => openEditor());
retryLoadButton.addEventListener("click", load);
// Unconfirmed changes in the editor would be lost: ask before leaving.
window.addEventListener("beforeunload", (event) => {
  if (editor.hasChanges()) event.preventDefault();
});

load();
