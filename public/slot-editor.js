// The slot editor: a modal dialog that edits a copy of a slot's menu. It
// follows the app's interaction rules:
// - Done confirms: it hands the edited menu back. Nothing else saves.
// - Cancel, Escape, and Android's Back discard the copy.
// - Clicking the backdrop closes the editor only when the copy has no
//   changes, so a stray click never throws work away.

import { createCombobox } from "./combobox.js";
import { createButton, createElement, onBackdropClick } from "./dom.js";
import {
  addableRecipes,
  addItem,
  copyMenu,
  MAX_ITEMS,
  MAX_SERVINGS,
  MIN_SERVINGS,
  removeItem,
  sameMenu,
  stepServings,
} from "./menus.js";

export function createSlotEditor(dialog) {
  const title = dialog.querySelector(".dialog-title");
  const itemList = dialog.querySelector(".menu-items");
  const search = dialog.querySelector(".option-search");
  const doneButton = dialog.querySelector(".done");

  /** The open editing session, or null: { original, copy, recipes, names, opener, onDone }. */
  let session = null;

  const combobox = createCombobox({
    input: search,
    list: dialog.querySelector(".options"),
    noMatch: dialog.querySelector(".no-match"),
    idPrefix: "recipe-option",
    matches: (query) => addableRecipes(session.recipes, session.copy, query),
    label: (recipe) => recipe.name,
    onPick: (recipe) => add(recipe.id),
    isDisabled: () => isFull(),
  });

  function nameOf(recipeId) {
    return session.names.get(recipeId) ?? "Unknown recipe";
  }

  function isFull() {
    return session.copy.items.length >= MAX_ITEMS;
  }

  function open({ title: text, menu, recipes, opener, onDone }) {
    session = {
      original: copyMenu(menu),
      copy: copyMenu(menu),
      recipes,
      names: new Map(recipes.map((recipe) => [recipe.id, recipe.name])),
      opener,
      onDone,
    };
    title.textContent = text;
    renderItems();
    combobox.reset();
    dialog.showModal();
    // The title, not a field: on a phone, focusing a field opens the keyboard.
    title.focus();
  }

  function isOpen() {
    return session !== null;
  }

  function hasChanges() {
    return session !== null && !sameMenu(session.copy, session.original);
  }

  // Closes the editor and returns focus to the slot. Only Done passes `save`.
  function close(save) {
    if (session === null) return;
    const { copy, opener, onDone } = session;
    session = null;
    if (dialog.open) dialog.close();
    if (save) onDone(copy);
    opener.focus();
  }

  function itemRow(item) {
    const name = nameOf(item.recipeId);
    const row = createElement("li", "menu-item");
    const servings = createElement("span", "servings", String(item.servings));
    servings.setAttribute("aria-live", "polite");
    const decrease = createButton("−", `Decrease servings of ${name}`, "step");
    const increase = createButton("+", `Increase servings of ${name}`, "step");
    const remove = createButton("Remove", `Remove ${name}`, "remove");
    decrease.disabled = item.servings <= MIN_SERVINGS;
    increase.disabled = item.servings >= MAX_SERVINGS;
    decrease.addEventListener("click", () => step(item.recipeId, -1, row));
    increase.addEventListener("click", () => step(item.recipeId, 1, row));
    remove.addEventListener("click", () => {
      const index = session.copy.items.findIndex((entry) => entry.recipeId === item.recipeId);
      session.copy = removeItem(session.copy, item.recipeId);
      renderItems();
      combobox.render();
      focusRemoved(index);
    });
    row.append(createElement("span", "recipe-name", name), decrease, servings, increase, remove);
    return row;
  }

  // Updates the row in place, so the pressed button keeps focus.
  function step(recipeId, steps, row) {
    session.copy = stepServings(session.copy, recipeId, steps);
    const { servings } = session.copy.items.find((item) => item.recipeId === recipeId);
    const [decrease, increase] = row.querySelectorAll(".step");
    row.querySelector(".servings").textContent = String(servings);
    decrease.disabled = servings <= MIN_SERVINGS;
    increase.disabled = servings >= MAX_SERVINGS;
    // A disabled button loses focus: move it to the other one.
    if (steps < 0 && decrease.disabled) increase.focus();
    if (steps > 0 && increase.disabled) decrease.focus();
  }

  // After Remove takes a row out of the list, focus the Remove button of the
  // row now in its place, else of the previous row, else the editor title.
  // Focusing the search field instead would open the keyboard on a phone.
  function focusRemoved(index) {
    const row = itemList.children[Math.min(index, itemList.children.length - 1)];
    (row?.querySelector(".remove") ?? title).focus();
  }

  function renderItems() {
    itemList.replaceChildren(...session.copy.items.map(itemRow));
    search.disabled = isFull();
    search.placeholder = isFull() ? `A menu holds up to ${MAX_ITEMS} recipes.` : "";
  }

  function add(recipeId) {
    session.copy = addItem(session.copy, recipeId);
    renderItems();
    combobox.reset();
    (search.disabled ? doneButton : search).focus();
  }

  dialog.querySelector(".cancel").addEventListener("click", () => close(false));
  doneButton.addEventListener("click", () => close(true));
  // Escape and Android's Back close the dialog: that discards the copy.
  dialog.addEventListener("close", () => close(false));
  onBackdropClick(dialog, () => {
    if (!hasChanges()) close(false);
  });
  // Enter confirms the innermost edit. On the title (focused when the editor
  // opens) or the dialog itself, that's Done; buttons and the search field
  // handle their own Enter.
  dialog.addEventListener("keydown", (event) => {
    if (event.isComposing || event.key !== "Enter") return;
    if (event.target === title || event.target === dialog) {
      event.preventDefault();
      close(true);
    }
  });

  return { hasChanges, isOpen, open };
}
