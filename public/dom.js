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
