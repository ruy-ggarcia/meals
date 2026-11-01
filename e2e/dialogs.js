// How the specs answer the question that a browser asks before a page
// unloads, such as before a reload that would lose changes.

/** Dismisses each native question of the browser, and collects the kinds of the questions. */
export function answerQuestions(page) {
  const kinds = [];
  page.on("dialog", async (dialog) => {
    kinds.push(dialog.type());
    await dialog.dismiss();
  });
  return kinds;
}

/**
 * Starts a reload of `page`, and doesn't wait for it. A reload that the
 * question of the browser cancels never finishes.
 */
export async function reloadAndAsk(page) {
  await page.evaluate(() => {
    setTimeout(() => location.reload());
  });
}
