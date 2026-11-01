// Hides and shows the page the way a browser does when you switch to another
// tab or app, so a test can trigger the app's `visibilitychange` handling.
// A headless browser has no other tab to switch to.

/** Makes the page report that it is hidden, and fires `visibilitychange`. */
export async function hidePage(page) {
  await page.evaluate(() => {
    // The real values are getters of Document.prototype. An own property of
    // the document hides them, and `showPage` deletes it again.
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

/** Makes the page report what the browser says again, and fires `visibilitychange`. */
export async function showPage(page) {
  await page.evaluate(() => {
    delete document.visibilityState;
    delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

/** Hides the page, and then shows it. */
export async function switchAway(page) {
  await hidePage(page);
  await showPage(page);
}
