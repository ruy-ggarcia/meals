// Ingredient catalog page. Depends ONLY on the HTTP API (/api/ingredients and
// /api/recipes); never import from server/. It follows the app's interaction
// rules: Enter or the confirm button confirms, Escape or Cancel discards, and
// leaving a field never discards changes.

import { createCatalogList } from "./catalog-list.js";
import { withLoadState } from "./dom.js";
import { getJson } from "./http.js";
import { createIngredientEditor } from "./ingredient-editor.js";
import { setUpShell, showCounts } from "./shell.js";

const loadError = document.getElementById("load-error");
const retryLoadButton = document.getElementById("retry-load");
const catalog = document.getElementById("ingredient-catalog");
const editor = createIngredientEditor(document.getElementById("ingredient-editor"));

/**
 * How recipes, active and archived, use each ingredient, by ingredient ID:
 * { inUnit, measures }. `inUnit` tells whether any line is in the unit, and
 * `measures` counts the recipes per measure ID.
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
    newButton: document.getElementById("new-ingredient"),
    retryButton: retryLoadButton,
  },
  noun: "ingredient",
  url: ingredientUrl,
  // Its unit, then the names of its measures.
  details: (ingredient) => [
    ingredient.measures.length === 0
      ? ingredient.unit
      : `${ingredient.unit} · ${ingredient.measures.map((measure) => measure.name).join(", ")}`,
  ],
  onChange: (entries) => showCounts({ ingredients: entries }),
  // The editor shows the current usage, from the reload.
  reload: load,
  open: (ingredient, focus) =>
    editor.open({
      ingredient,
      usage: (ingredient && usage.get(ingredient.id)) ?? unused(),
      ...focus,
    }),
});

function unused() {
  return { inUnit: false, measures: new Map() };
}

// A recipe holds each ingredient at most once, so a line in a measure counts
// one recipe for that measure.
function countUsage(recipes) {
  const counts = new Map();
  for (const { ingredientId, measureId } of recipes.flatMap((recipe) => recipe.ingredients)) {
    if (!counts.has(ingredientId)) counts.set(ingredientId, unused());
    const counted = counts.get(ingredientId);
    if (measureId === undefined) counted.inUnit = true;
    else counted.measures.set(measureId, (counted.measures.get(measureId) ?? 0) + 1);
  }
  return counts;
}

// Loads the catalog and the recipes, and shows the catalog. Resolves to true
// when the load succeeds.
function load() {
  return withLoadState({
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
      showCounts({ recipes: recipeBook.recipes });
      list.setEntries(ingredientCatalog.ingredients);
    },
  });
}

// ---------- Events ----------

setUpShell();
retryLoadButton.addEventListener("click", load);
// Unconfirmed changes in the editor would be lost: ask before leaving.
window.addEventListener("beforeunload", (event) => {
  if (editor.hasChanges()) event.preventDefault();
});

load();
