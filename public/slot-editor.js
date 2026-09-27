// The slot editor: a modal dialog that edits a copy of a slot's menu. It
// follows the app's interaction rules:
// - Done confirms: it hands the edited menu back. Nothing else saves.
// - Cancel, Escape, and Android's Back discard the copy.
// - Clicking the backdrop closes the editor only when the copy has no
//   changes, so a stray click never throws work away.

import { createButton, createElement } from "./dom.js";
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
  const title = dialog.querySelector(".slot-editor-title");
  const itemList = dialog.querySelector(".menu-items");
  const search = dialog.querySelector(".recipe-search");
  const options = dialog.querySelector(".recipe-options");
  const noMatch = dialog.querySelector(".no-match");
  const doneButton = dialog.querySelector(".done");

  /** The open editing session, or null: { original, copy, recipes, names, opener, onDone }. */
  let session = null;
  /** The recipes the list offers, and the index of the highlighted one. */
  let matches = [];
  let highlighted = 0;
  /** Whether the pointer that is currently pressed went down on the dialog itself (the backdrop). */
  let pressedOnBackdrop = false;

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
    search.value = "";
    highlighted = 0;
    renderItems();
    renderOptions();
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
      renderOptions();
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

  function renderOptions() {
    matches = isFull() ? [] : addableRecipes(session.recipes, session.copy, search.value);
    highlighted = Math.min(highlighted, Math.max(matches.length - 1, 0));
    options.replaceChildren(
      ...matches.map((recipe, index) => {
        const option = createElement("li", "recipe-option", recipe.name);
        option.id = `recipe-option-${index}`;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(index === highlighted));
        option.addEventListener("click", () => add(recipe.id));
        return option;
      }),
    );
    options.hidden = matches.length === 0;
    noMatch.hidden = isFull() || matches.length > 0;
    search.setAttribute("aria-expanded", String(matches.length > 0));
    if (matches.length > 0) {
      search.setAttribute("aria-activedescendant", `recipe-option-${highlighted}`);
    } else {
      search.removeAttribute("aria-activedescendant");
    }
  }

  function highlight(index) {
    highlighted = index;
    renderOptions();
    options.children[index]?.scrollIntoView({ block: "nearest" });
  }

  function add(recipeId) {
    session.copy = addItem(session.copy, recipeId);
    search.value = "";
    highlighted = 0;
    renderItems();
    renderOptions();
    (search.disabled ? doneButton : search).focus();
  }

  search.addEventListener("input", () => {
    highlighted = 0;
    renderOptions();
  });

  search.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "ArrowDown" && matches.length > 0) {
      event.preventDefault();
      highlight((highlighted + 1) % matches.length);
    } else if (event.key === "ArrowUp" && matches.length > 0) {
      event.preventDefault();
      highlight((highlighted - 1 + matches.length) % matches.length);
    } else if (event.key === "Enter") {
      // Adds the highlighted recipe. It never confirms the editor.
      event.preventDefault();
      if (matches.length > 0) add(matches[highlighted].id);
    } else if (event.key === "Escape" && search.value !== "") {
      // The innermost edit is the search text: clear it and keep the editor
      // open. Canceling the keydown stops the dialog's close request.
      event.preventDefault();
      search.value = "";
      highlighted = 0;
      renderOptions();
    }
  });

  dialog.querySelector(".cancel").addEventListener("click", () => close(false));
  doneButton.addEventListener("click", () => close(true));
  // Escape and Android's Back close the dialog: that discards the copy.
  dialog.addEventListener("close", () => close(false));
  // The dialog has no padding, so a click whose target is the dialog itself
  // landed on the backdrop. A press that starts inside a field, such as Add
  // recipe, and is released after dragging over the backdrop also produces a
  // click whose target is the dialog, so require the press itself to have
  // started on the backdrop too.
  dialog.addEventListener("pointerdown", (event) => {
    pressedOnBackdrop = event.target === dialog;
  });
  dialog.addEventListener("click", (event) => {
    if (pressedOnBackdrop && event.target === dialog && !hasChanges()) close(false);
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
