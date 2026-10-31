// DOM helpers shared by the pages.

import { parseQuantity } from "./quantities.js";

/**
 * A new element with an optional class and text. The text is set with
 * textContent, so recipe names never run as HTML.
 */
export function createElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A `<button type="button">` with an accessible name. Callers attach their own listener. */
export function createButton(text, label, className) {
  const button = createElement("button", className, text);
  button.type = "button";
  button.setAttribute("aria-label", label);
  return button;
}

/**
 * Marks `field` as invalid while it holds text that isn't a quantity or an
 * amount. An empty field isn't marked: Done says that it needs a number.
 */
export function markQuantity(field) {
  if (field.value.trim() !== "" && parseQuantity(field.value) === null) {
    field.setAttribute("aria-invalid", "true");
  } else {
    field.removeAttribute("aria-invalid");
  }
}

// Line icons, drawn with currentColor.
const ICONS = {
  chevron: '<path d="M9 5l7 7-7 7"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};

/** An icon of `ICONS`, which screen readers skip. */
export function createIcon(name, className = "icon") {
  const icon = createElement("span", className);
  // static markup, never user text
  icon.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
  return icon;
}

/** A `<button type="button">` that shows the icon `name` and has the accessible name `label`. */
export function createIconButton(name, label, className) {
  const button = createButton("", label, className);
  button.append(createIcon(name));
  return button;
}

/**
 * Calls `onClick` for a click on the backdrop of `dialog`, a <dialog> with no
 * padding, so that a click whose target is the dialog itself landed on the
 * backdrop. A press that starts inside a field and is released after
 * dragging over the backdrop also produces such a click, so the press must
 * have started on the backdrop too.
 */
export function onBackdropClick(dialog, onClick) {
  let pressedOnBackdrop = false;
  dialog.addEventListener("pointerdown", (event) => {
    pressedOnBackdrop = event.target === dialog;
  });
  dialog.addEventListener("click", (event) => {
    if (pressedOnBackdrop && event.target === dialog) onClick();
  });
}

/**
 * True when nothing has focus. The control that started a request is
 * disabled while the request runs, so its focus falls to <body>. Anything
 * else means the user moved on, and a finished request must not steal focus
 * back.
 */
export function focusIsFree() {
  return document.activeElement === null || document.activeElement === document.body;
}

// A triangle with an exclamation mark, drawn with currentColor.
const WARNING_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3.5L2.5 20h19L12 3.5z"/><path d="M12 10v4.5M12 17.5v.01"/></svg>';

/**
 * A warning icon. With a `label`, the icon has that accessible name and
 * tooltip. Without one, it's decorative, and screen readers skip it.
 */
export function createWarningIcon(label) {
  const icon = createElement("span", "warning-icon");
  icon.innerHTML = WARNING_ICON; // static markup, never user text
  if (label) {
    icon.setAttribute("role", "img");
    icon.setAttribute("aria-label", label);
    icon.title = label;
  }
  return icon;
}

/**
 * Runs `run()` as a load: hides `loadError` and disables `retryButton` while
 * it runs, then shows `content` on success or `loadError` on failure, logging
 * the error with `errorMessage`. Always re-enables `retryButton` at the end.
 * Resolves to true when the load succeeds, and to false when it fails.
 * The pages load this way on page load and again on Retry. The recipe book
 * and the ingredients page also reload this way before they open an editor.
 */
export async function withLoadState({ loadError, retryButton, content, run, errorMessage }) {
  loadError.hidden = true;
  retryButton.disabled = true;
  try {
    await run();
    for (const element of content) element.hidden = false;
    return true;
  } catch (error) {
    console.error(errorMessage, error);
    for (const element of content) element.hidden = true;
    loadError.hidden = false;
    return false;
  } finally {
    retryButton.disabled = false;
  }
}
