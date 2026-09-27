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
