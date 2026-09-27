// A combobox: a text field that filters a list of options, which you pick by
// clicking one, or with the arrow keys and Enter. Escape in the field clears
// its text first. Enter never confirms the dialog around it.

import { createElement } from "./dom.js";

/**
 * Wires `input` (the text field), `list` (its listbox), and `noMatch` (shown
 * when nothing matches). `matches(query)` returns the entries to offer,
 * `label(entry)` their text, and `onPick(entry)` runs when one is picked.
 * While `isDisabled()` is true, the list offers nothing and `noMatch` stays
 * hidden. `idPrefix` makes the option IDs unique in the page.
 *
 * Returns { render, reset }: render() rebuilds the list for the text in the
 * field, and reset() clears the text first.
 */
export function createCombobox({
  input,
  list,
  noMatch,
  idPrefix,
  matches,
  label,
  onPick,
  isDisabled,
}) {
  /** The entries the list offers, and the index of the highlighted one. */
  let entries = [];
  let highlighted = 0;

  function render() {
    entries = isDisabled() ? [] : matches(input.value);
    highlighted = Math.min(highlighted, Math.max(entries.length - 1, 0));
    list.replaceChildren(
      ...entries.map((entry, index) => {
        const option = createElement("li", "option", label(entry));
        option.id = `${idPrefix}-${index}`;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(index === highlighted));
        option.addEventListener("click", () => onPick(entry));
        return option;
      }),
    );
    list.hidden = entries.length === 0;
    noMatch.hidden = isDisabled() || entries.length > 0;
    input.setAttribute("aria-expanded", String(entries.length > 0));
    if (entries.length > 0) {
      input.setAttribute("aria-activedescendant", `${idPrefix}-${highlighted}`);
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function reset() {
    input.value = "";
    highlighted = 0;
    render();
  }

  function highlight(index) {
    highlighted = index;
    render();
    list.children[index]?.scrollIntoView({ block: "nearest" });
  }

  input.addEventListener("input", () => {
    highlighted = 0;
    render();
  });

  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "ArrowDown" && entries.length > 0) {
      event.preventDefault();
      highlight((highlighted + 1) % entries.length);
    } else if (event.key === "ArrowUp" && entries.length > 0) {
      event.preventDefault();
      highlight((highlighted - 1 + entries.length) % entries.length);
    } else if (event.key === "Enter") {
      // Picks the highlighted entry. It never confirms the dialog.
      event.preventDefault();
      if (entries.length > 0) onPick(entries[highlighted]);
    } else if (event.key === "Escape" && input.value !== "") {
      // The innermost edit is the text: clear it and keep the dialog open.
      // Canceling the keydown stops the dialog's close request.
      event.preventDefault();
      reset();
    }
  });

  return { render, reset };
}
