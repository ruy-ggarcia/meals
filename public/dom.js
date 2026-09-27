// DOM helpers shared by the pages.

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
 * Both the meal plan page and the recipe book page load this way, once each
 * on page load and again on Retry.
 */
export async function withLoadState({ loadError, retryButton, content, run, errorMessage }) {
  loadError.hidden = true;
  retryButton.disabled = true;
  try {
    await run();
    for (const element of content) element.hidden = false;
  } catch (error) {
    console.error(errorMessage, error);
    for (const element of content) element.hidden = true;
    loadError.hidden = false;
  } finally {
    retryButton.disabled = false;
  }
}
