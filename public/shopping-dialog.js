// The shopping list dialog: a read-only modal dialog with the shopping list
// of the displayed week. Close, Escape, Android's Back, and a click on the
// backdrop close it.

import { createElement, createWarningIcon, onBackdropClick } from "./dom.js";

export function createShoppingDialog(dialog) {
  const title = dialog.querySelector(".dialog-title");
  const emptyWeek = dialog.querySelector(".empty-week");
  const lines = dialog.querySelector(".shopping-lines");
  const notIncluded = dialog.querySelector(".not-included");
  const notIncludedRecipes = dialog.querySelector(".not-included-recipes");
  dialog.querySelector(".not-included-title").prepend(createWarningIcon());

  /** The control that opened the dialog, or null while it's closed. */
  let opener = null;

  function line({ name, total, unit }) {
    const item = createElement("li", "shopping-line");
    item.append(
      createElement("span", "line-name", name),
      createElement("span", "line-amount", `${total} ${unit}`),
    );
    return item;
  }

  /**
   * Shows `list`, the result of shoppingList(). `isEmpty` tells that the week
   * has no menu items, and `slotLabel({ day, meal })` names a slot, such as
   * "Mon dinner".
   */
  function open({ title: text, list, isEmpty, slotLabel, opener: from }) {
    opener = from;
    title.textContent = text;
    emptyWeek.hidden = !isEmpty;
    lines.replaceChildren(...list.lines.map(line));
    lines.hidden = list.lines.length === 0;
    notIncludedRecipes.replaceChildren(
      ...list.recipesWithoutIngredients.map((recipe) =>
        createElement(
          "li",
          undefined,
          `${recipe.name} · ${recipe.slots.map(slotLabel).join(", ")}`,
        ),
      ),
    );
    notIncluded.hidden = list.recipesWithoutIngredients.length === 0;
    dialog.showModal();
    // The title, so a screen reader starts from the top of the list.
    title.focus();
  }

  function isOpen() {
    return opener !== null;
  }

  function close() {
    if (opener === null) return;
    const from = opener;
    opener = null;
    if (dialog.open) dialog.close();
    from.focus();
  }

  dialog.querySelector(".close-dialog").addEventListener("click", close);
  // Escape and Android's Back close the dialog.
  dialog.addEventListener("close", close);
  onBackdropClick(dialog, close);

  return { isOpen, open };
}
