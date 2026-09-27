// Recipe book page. Depends ONLY on the HTTP API (/api/recipes and
// /api/ingredients); never import from server/. Adding and editing a recipe
// happen in the recipe editor, and the list logic lives in catalog-list.js.

import { createCatalogList } from "./catalog-list.js";
import { createWarningIcon, withLoadState } from "./dom.js";
import { getJson } from "./http.js";
import { createRecipeEditor } from "./recipe-editor.js";

const loadError = document.getElementById("load-error");
const retryLoadButton = document.getElementById("retry-load");
const book = document.getElementById("recipe-book");
const newRecipeButton = document.getElementById("new-recipe");
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
  },
  noun: "recipe",
  url: (id) => `/api/recipes/${encodeURIComponent(id)}`,
  details: (recipe) =>
    recipe.ingredients.length === 0 ? [createWarningIcon("No ingredients")] : [],
  onEdit: openEditor,
});

// Opens the editor on `recipe`, or on a new recipe when it's undefined.
function openEditor(recipe) {
  list.resetMessages();
  editor.open({
    recipe,
    ingredients,
    // By ID: the rows re-render, which replaces the Edit button that was clicked.
    restoreFocus: () => (recipe ? list.focusEdit(recipe.id) : newRecipeButton.focus()),
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
    content: [book],
    errorMessage: "Couldn't load the recipes:",
    run: async () => {
      const [recipeBook, catalog] = await Promise.all([
        getJson("/api/recipes"),
        getJson("/api/ingredients"),
      ]);
      ingredients = catalog.ingredients;
      list.setEntries(recipeBook.recipes);
    },
  });
}

newRecipeButton.addEventListener("click", () => openEditor());
retryLoadButton.addEventListener("click", load);
// Unconfirmed changes in the editor would be lost: ask before leaving.
window.addEventListener("beforeunload", (event) => {
  if (editor.hasChanges()) event.preventDefault();
});

load();
