// Recipe book page. Depends ONLY on the HTTP API (/api/recipes and
// /api/ingredients); never import from server/. Adding and editing a recipe
// happen in the recipe editor, and the list logic lives in catalog-list.js.

import { createCatalogList } from "./catalog-list.js";
import { createWarningIcon, withLoadState } from "./dom.js";
import { getJson } from "./http.js";
import { createRecipeEditor } from "./recipe-editor.js";
import { setUpShell, showCounts } from "./shell.js";

const loadError = document.getElementById("load-error");
const retryLoadButton = document.getElementById("retry-load");
const book = document.getElementById("recipe-book");
const editor = createRecipeEditor(document.getElementById("recipe-editor"));

/** The ingredient catalog as last loaded, for the editor. */
let ingredients = [];

const list = createCatalogList({
  elements: {
    search: document.getElementById("search"),
    emptyMessage: document.getElementById("empty-book"),
    noMatches: document.getElementById("no-matches"),
    activeList: document.getElementById("active-recipes"),
    archived: document.getElementById("archived"),
    archivedCount: document.getElementById("archived-count"),
    archivedList: document.getElementById("archived-recipes"),
    newButton: document.getElementById("new-recipe"),
    retryButton: retryLoadButton,
  },
  noun: "recipe",
  url: (id) => `/api/recipes/${encodeURIComponent(id)}`,
  // The names of its ingredients, or a warning that it has none.
  details: (recipe) =>
    recipe.ingredients.length === 0
      ? [createWarningIcon(), "No ingredients · not in shopping list"]
      : [
          recipe.ingredients
            .map(({ ingredientId }) => ingredients.find(({ id }) => id === ingredientId)?.name)
            .filter(Boolean)
            .join(", "),
        ],
  onChange: (recipes) => showCounts({ recipes }),
  // The editor gets the catalog from the reload, with the current units.
  reload: load,
  open: (recipe, focus) => editor.open({ recipe, ingredients, ...focus }),
});

// Loads the recipes and the catalog, and shows them. Resolves to true when
// the load succeeds.
function load() {
  return withLoadState({
    loadError,
    retryButton: retryLoadButton,
    content: [book],
    errorMessage: "Couldn't load the recipes:",
    run: async () => {
      const [recipeBook, catalog] = await Promise.all([
        getJson("/api/recipes"),
        getJson("/api/ingredients"),
      ]);
      ingredients = catalog.ingredients;
      showCounts({ ingredients });
      list.setEntries(recipeBook.recipes);
    },
  });
}

setUpShell();
retryLoadButton.addEventListener("click", load);
// Unconfirmed changes in the editor would be lost: ask before leaving.
window.addEventListener("beforeunload", (event) => {
  if (editor.hasChanges()) event.preventDefault();
});

load();
