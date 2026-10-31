// The shopping list dialog: a read-only modal dialog with the shopping list
// of the displayed week. Close, Escape, Android's Back, and a click on the
// backdrop close it.

import { createElement, createWarningIcon, onBackdropClick } from "./dom.js";
import { lineParts } from "./shopping-list.js";

export function createShoppingDialog(dialog) {
  const title = dialog.querySelector(".dialog-title");
  const subtitle = dialog.querySelector(".sheet-subtitle");
  const summary = dialog.querySelector(".shopping-summary");
  const emptyWeek = dialog.querySelector(".empty-week");
  const lines = dialog.querySelector(".shopping-lines");
  const notIncluded = dialog.querySelector(".not-included");
  const notIncludedRecipes = dialog.querySelector(".not-included-recipes");
  dialog.querySelector(".not-included-title").prepend(createWarningIcon());

  /** The control that opened the dialog, or null while it's closed. */
  let opener = null;

  // The total, and under it the breakdown by measure, if any.
  function line(entry) {
    const { total, breakdown } = lineParts(entry);
    const amount = createElement("span", "line-amount");
    amount.append(createElement("span", "line-total", total));
    if (breakdown !== "") amount.append(" ", createElement("span", "line-breakdown", breakdown));
    const item = createElement("li", "shopping-line");
    item.append(createElement("span", "line-name", entry.name), amount);
    return item;
  }

  /**
   * Shows `list`, the result of shoppingList(), under `title` and `subtitle`.
   * `isEmpty` tells that the week has no menu items, and
   * `slotLabel({ day, meal })` names a slot, such as "Mon dinner".
   */
  function open({ title: text, subtitle: subtitleText, list, isEmpty, slotLabel, opener: from }) {
    opener = from;
    title.textContent = text;
    subtitle.textContent = subtitleText;
    const count = list.lines.length;
    summary.textContent = `${count} ${count === 1 ? "ingredient" : "ingredients"} · from A to Z · totals rounded up`;
    summary.hidden = count === 0;
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
