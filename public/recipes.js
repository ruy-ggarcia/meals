// Recipe book page. Depends ONLY on the HTTP API (/api/recipes); never import
// from server/. It follows the app's interaction rules: Enter or the confirm
// button confirms, Escape or Cancel discards, and leaving a field never
// discards changes.

import { createButton, createElement, withLoadState } from "./dom.js";
import { getJson, sendJson } from "./http.js";
import { conflictText, quoted } from "./messages.js";
import { filterRecipes, sortRecipes } from "./recipe-search.js";

const loadError = document.getElementById("load-error");
const retryLoadButton = document.getElementById("retry-load");
const book = document.getElementById("recipe-book");
const form = document.getElementById("new-recipe");
const nameField = document.getElementById("new-recipe-name");
const addButton = form.querySelector('button[type="submit"]');
const formMessage = document.getElementById("new-recipe-message");
const search = document.getElementById("search");
const emptyBook = document.getElementById("empty-book");
const noMatches = document.getElementById("no-matches");
const activeList = document.getElementById("active-recipes");
const archived = document.getElementById("archived");
const archivedCount = document.getElementById("archived-count");
const archivedList = document.getElementById("archived-recipes");

/** Every recipe, active and archived, as the server last confirmed. */
let recipes = [];
/** Rows in rename mode, by recipe ID: { value, message, busy }. They survive renders. */
const renaming = new Map();
/** Error messages under rows, by recipe ID. */
const rowMessages = new Map();
/** Recipe IDs with an archive or restore request running. */
const busy = new Set();
/** True while render() replaces rows, so focus changes it causes are ignored. */
let rendering = false;

function recipeUrl(id) {
  return `/api/recipes/${encodeURIComponent(id)}`;
}

function recipeById(id) {
  return recipes.find((recipe) => recipe.id === id);
}

// Replaces or adds `recipe` in the local list.
function remember(recipe) {
  recipes = [...recipes.filter((entry) => entry.id !== recipe.id), recipe];
}

function rowElement(id) {
  return book.querySelector(`.recipe-row[data-id="${CSS.escape(id)}"]`);
}

function button(text, label, onClick) {
  const element = createButton(text, label);
  element.addEventListener("click", onClick);
  return element;
}

// Clears every row message and re-renders, so a new request starts without
// a stale error from an earlier one.
function resetMessages() {
  rowMessages.clear();
  render();
}

// The control that started a request is disabled while the request runs, so
// its focus falls to <body>. Anything else means the user moved on, and a
// finished request must not steal focus back.
function focusIsFree() {
  return document.activeElement === null || document.activeElement === document.body;
}

// ---------- Rendering ----------

// render() rebuilds every row with replaceChildren, which would blur and
// detach a rename field the user is typing in. Captured here and restored
// below, so an unrelated render (a search keystroke, another row's request)
// doesn't lose focus or the caret position.
function captureRenameFocus() {
  const field = document.activeElement;
  if (!field?.classList?.contains("rename-field")) return null;
  const item = field.closest(".recipe-row");
  if (!item) return null;
  return { id: item.dataset.id, start: field.selectionStart, end: field.selectionEnd };
}

function restoreRenameFocus(focused) {
  if (!focused || !renaming.has(focused.id)) return;
  const field = rowElement(focused.id)?.querySelector(".rename-field");
  if (!field) return;
  field.focus();
  field.setSelectionRange(focused.start, focused.end);
}

function render() {
  rendering = true;
  const focused = captureRenameFocus();
  const query = search.value.trim();
  const matches = sortRecipes(filterRecipes(recipes, search.value));
  const activeMatches = matches.filter((recipe) => !recipe.archived);
  const archivedTotal = recipes.filter((recipe) => recipe.archived).length;
  activeList.replaceChildren(...activeMatches.map(row));
  archivedList.replaceChildren(...matches.filter((recipe) => recipe.archived).map(row));
  archivedCount.textContent = String(archivedTotal);
  archived.hidden = archivedTotal === 0;
  emptyBook.hidden = recipes.length > 0;
  // Depends on active matches only: an archived recipe that matches doesn't
  // hide the message, because it's as if it didn't exist for a new menu.
  noMatches.hidden = recipes.length === 0 || query === "" || activeMatches.length > 0;
  noMatches.textContent = `No recipes match ${quoted(query)}.`;
  restoreRenameFocus(focused);
  rendering = false;
}

function row(recipe) {
  const item = createElement("li", "recipe-row");
  item.dataset.id = recipe.id;
  const rename = renaming.get(recipe.id);
  if (rename) {
    item.append(...renameControls(recipe, rename, item));
  } else {
    const actions = createElement("span", "row-actions");
    if (recipe.archived) {
      actions.append(
        button("Restore", `Restore ${recipe.name}`, () => setArchived(recipe.id, false)),
      );
    } else {
      actions.append(
        button("Rename", `Rename ${recipe.name}`, () => startRename(recipe.id)),
        button("Archive", `Archive ${recipe.name}`, () => setArchived(recipe.id, true)),
      );
    }
    for (const control of actions.children) control.disabled = busy.has(recipe.id);
    item.append(createElement("span", "recipe-name", recipe.name), actions);
  }
  const message = rename?.message || rowMessages.get(recipe.id);
  if (message) item.append(createElement("p", "row-message", message));
  return item;
}

// ---------- Loading ----------

async function load() {
  await withLoadState({
    loadError,
    retryButton: retryLoadButton,
    content: [book],
    errorMessage: "Couldn't load the recipes:",
    run: async () => {
      recipes = (await getJson("/api/recipes")).recipes;
      render();
    },
  });
}

// ---------- Adding ----------

function showFormMessage(...content) {
  formMessage.replaceChildren(...content);
}

function setFormBusy(isBusy) {
  nameField.disabled = isBusy;
  addButton.disabled = isBusy;
  for (const control of formMessage.querySelectorAll("button")) control.disabled = isBusy;
}

async function addRecipe() {
  setFormBusy(true);
  showFormMessage();
  resetMessages();
  try {
    const { status, body } = await sendJson("POST", "/api/recipes", { name: nameField.value });
    if (status === 201) {
      remember(body);
      nameField.value = "";
      render();
    } else if (status === 409 && body.recipe?.archived) {
      const restore = button("Restore it", `Restore it: ${body.recipe.name}`, () =>
        restoreFromForm(body.recipe.id, body.recipe.name),
      );
      showFormMessage(`${conflictText(body.recipe)} `, restore);
    } else if (status === 409 && body.recipe) {
      showFormMessage(conflictText(body.recipe));
    } else if (status === 400 && typeof body.error === "string") {
      showFormMessage(body.error);
    } else {
      throw new Error(`HTTP ${status}`);
    }
  } catch (error) {
    console.error("Couldn't add the recipe:", error);
    showFormMessage("Couldn't add the recipe. Try again."); // the text stays in the field
  } finally {
    setFormBusy(false);
    if (focusIsFree()) nameField.focus();
  }
}

async function restoreFromForm(id, name) {
  setFormBusy(true);
  resetMessages();
  try {
    const { status, body } = await sendJson("PATCH", recipeUrl(id), { archived: false });
    if (status !== 200) throw new Error(`HTTP ${status}`);
    remember(body);
    nameField.value = "";
    showFormMessage();
    render();
  } catch (error) {
    console.error("Couldn't restore the recipe:", error);
    const retry = button("Restore it", `Restore it: ${name}`, () => restoreFromForm(id, name));
    showFormMessage("Couldn't restore the recipe. Try again. ", retry);
  } finally {
    setFormBusy(false);
    if (focusIsFree()) nameField.focus();
  }
}

// ---------- Renaming ----------

function renameControls(recipe, rename, item) {
  const field = createElement("input", "rename-field");
  field.type = "text";
  field.value = rename.value;
  field.disabled = rename.busy;
  field.setAttribute("aria-label", `New name for ${recipe.name}`);
  field.addEventListener("input", () => {
    rename.value = field.value;
  });
  field.addEventListener("keydown", (event) => {
    if (event.isComposing || event.key !== "Enter") return;
    event.preventDefault();
    saveRename(recipe.id);
  });
  // On the row, not just the field, so Escape cancels from the Save or
  // Cancel button too.
  item.addEventListener("keydown", (event) => {
    if (event.isComposing || event.key !== "Escape") return;
    event.preventDefault();
    cancelRename(recipe.id);
  });
  const save = button("Save", `Save the name of ${recipe.name}`, () => saveRename(recipe.id));
  const cancel = button("Cancel", `Cancel renaming ${recipe.name}`, () => cancelRename(recipe.id));
  save.disabled = rename.busy;
  cancel.disabled = rename.busy;
  // Leaving the row closes it only when the name has no changes. Moving to
  // Save or Cancel stays inside the row, so it isn't leaving.
  item.addEventListener("focusout", (event) => {
    if (rendering || !item.isConnected || rename.busy || item.contains(event.relatedTarget)) {
      return;
    }
    if (rename.value !== recipe.name) return;
    // Replace only this row instead of calling render(): render() rebuilds
    // every row with replaceChildren, which would detach the element the
    // pointer or Tab is about to focus, losing the click or the tab-in.
    renaming.delete(recipe.id);
    item.replaceWith(row(recipeById(recipe.id)));
  });
  return [field, save, cancel];
}

function startRename(id) {
  renaming.set(id, { value: recipeById(id).name, message: "", busy: false });
  resetMessages();
  const field = rowElement(id).querySelector(".rename-field");
  field.focus();
  field.select();
}

function cancelRename(id) {
  if (!renaming.delete(id)) return;
  render();
  rowElement(id)?.querySelector(".row-actions button")?.focus();
}

async function saveRename(id) {
  const rename = renaming.get(id);
  if (!rename || rename.busy) return;
  if (rename.value === recipeById(id).name) {
    cancelRename(id);
    return;
  }
  rename.busy = true;
  rename.message = "";
  resetMessages();
  let message = "Couldn't rename the recipe. Try again.";
  try {
    const { status, body } = await sendJson("PATCH", recipeUrl(id), { name: rename.value });
    if (status === 200) {
      remember(body);
      renaming.delete(id);
      render();
      if (focusIsFree()) rowElement(id)?.querySelector(".row-actions button")?.focus();
      return;
    }
    if (status === 409 && body.recipe) message = conflictText(body.recipe);
    else if (status === 400 && typeof body.error === "string") message = body.error;
  } catch (error) {
    console.error("Couldn't rename the recipe:", error);
  }
  rename.busy = false;
  rename.message = message; // the field stays open with the typed name
  render();
  if (focusIsFree()) rowElement(id)?.querySelector(".rename-field")?.focus();
}

// ---------- Archiving and restoring ----------

// After a row leaves a list, focus moves to the row now in its place, the one
// before it, or the search field.
function focusNeighbor(list, index) {
  const target = list.children[Math.min(index, list.children.length - 1)];
  (target?.querySelector(".row-actions button:last-child") ?? search).focus();
}

async function setArchived(id, archive) {
  const failure = archive
    ? "Couldn't archive the recipe. Try again."
    : "Couldn't restore the recipe. Try again.";
  const list = archive ? activeList : archivedList;
  const index = [...list.children].findIndex((element) => element.dataset.id === id);
  busy.add(id);
  resetMessages();
  try {
    const { status, body } = await sendJson("PATCH", recipeUrl(id), { archived: archive });
    if (status !== 200) throw new Error(`HTTP ${status}`);
    remember(body);
  } catch (error) {
    console.error(failure, error);
    rowMessages.set(id, failure);
  }
  busy.delete(id);
  render();
  if (!focusIsFree()) return;
  if (rowMessages.has(id)) rowElement(id)?.querySelector(".row-actions button:last-child")?.focus();
  else focusNeighbor(list, index);
}

// ---------- Events ----------

form.addEventListener("submit", (event) => {
  event.preventDefault();
  addRecipe();
});

nameField.addEventListener("keydown", (event) => {
  if (event.isComposing || event.key !== "Escape") return;
  nameField.value = "";
  showFormMessage();
});

search.addEventListener("input", render);
retryLoadButton.addEventListener("click", load);

load();
