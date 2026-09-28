// Ingredient catalog page. Depends ONLY on the HTTP API (/api/ingredients and
// /api/recipes); never import from server/. It follows the app's interaction
// rules: Enter or the confirm button confirms, Escape or Cancel discards, and
// leaving a field never discards changes.

import { createCatalogList } from "./catalog-list.js";
import { createButton, createElement, focusIsFree, withLoadState } from "./dom.js";
import { getJson, sendJson } from "./http.js";
import { createIngredientEditor } from "./ingredient-editor.js";
import { conflictText } from "./messages.js";

const loadError = document.getElementById("load-error");
const retryLoadButton = document.getElementById("retry-load");
const catalog = document.getElementById("ingredient-catalog");
const form = document.getElementById("new-ingredient");
const nameField = document.getElementById("new-ingredient-name");
const unitField = document.getElementById("new-ingredient-unit");
const addButton = form.querySelector('button[type="submit"]');
const formMessage = document.getElementById("new-ingredient-message");
const editor = createIngredientEditor(document.getElementById("ingredient-editor"));

/** How many recipes, active and archived, use each ingredient, by ingredient ID. */
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

function countUsage(recipes) {
  const counts = new Map();
  for (const recipe of recipes) {
    for (const { ingredientId } of recipe.ingredients) {
      counts.set(ingredientId, (counts.get(ingredientId) ?? 0) + 1);
    }
  }
  return counts;
}

function openEditor(ingredient) {
  list.resetMessages();
  editor.open({
    ingredient,
    usedIn: usage.get(ingredient.id) ?? 0,
    // By ID: the rows re-render, which replaces the Edit button that was clicked.
    restoreFocus: () => list.focusEdit(ingredient.id),
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

// ---------- Adding ----------

function showFormMessage(...content) {
  formMessage.replaceChildren(...content);
}

function setFormBusy(isBusy) {
  nameField.disabled = isBusy;
  unitField.disabled = isBusy;
  addButton.disabled = isBusy;
  for (const control of formMessage.querySelectorAll("button")) control.disabled = isBusy;
}

function clearForm() {
  nameField.value = "";
  unitField.value = "";
  showFormMessage();
}

function restoreButton(id, name) {
  const button = createButton("Restore it", `Restore it: ${name}`);
  button.addEventListener("click", () => restoreFromForm(id, name));
  return button;
}

async function addIngredient() {
  if (unitField.value === "") {
    showFormMessage("Choose a unit.");
    unitField.focus();
    return;
  }
  setFormBusy(true);
  showFormMessage();
  list.resetMessages();
  try {
    const { status, body } = await sendJson("POST", "/api/ingredients", {
      name: nameField.value,
      unit: unitField.value,
    });
    if (status === 201) {
      list.remember(body);
      clearForm();
    } else if (status === 409 && body.ingredient?.archived) {
      showFormMessage(
        `${conflictText(body.ingredient)} `,
        restoreButton(body.ingredient.id, body.ingredient.name),
      );
    } else if (status === 409 && body.ingredient) {
      showFormMessage(conflictText(body.ingredient));
    } else if (status === 400 && typeof body.error === "string") {
      showFormMessage(body.error);
    } else {
      throw new Error(`HTTP ${status}`);
    }
  } catch (error) {
    console.error("Couldn't add the ingredient:", error);
    showFormMessage("Couldn't add the ingredient. Try again."); // the text stays in the field
  } finally {
    setFormBusy(false);
    if (focusIsFree()) nameField.focus();
  }
}

async function restoreFromForm(id, name) {
  setFormBusy(true);
  list.resetMessages();
  try {
    const { status, body } = await sendJson("PATCH", ingredientUrl(id), { archived: false });
    if (status !== 200) throw new Error(`HTTP ${status}`);
    list.remember(body);
    clearForm();
  } catch (error) {
    console.error("Couldn't restore the ingredient:", error);
    showFormMessage("Couldn't restore the ingredient. Try again. ", restoreButton(id, name));
  } finally {
    setFormBusy(false);
    if (focusIsFree()) nameField.focus();
  }
}

// ---------- Events ----------

form.addEventListener("submit", (event) => {
  event.preventDefault();
  addIngredient();
});

nameField.addEventListener("keydown", (event) => {
  if (event.isComposing || event.key !== "Escape") return;
  nameField.value = "";
  showFormMessage();
});

retryLoadButton.addEventListener("click", load);
// Unconfirmed changes in the editor would be lost: ask before leaving.
window.addEventListener("beforeunload", (event) => {
  if (editor.hasChanges()) event.preventDefault();
});

load();
