// What the specs of the slot editor share: how to find its parts, and how to
// wait until it has handled a close that the browser starts.

export const LONG_NAME = "Supercalifragilisticexpialidocious-casserole-with-a-very-long-name";

/** The editor of a lunch slot. */
export function editorOf(page) {
  return page.getByRole("dialog", { name: "Lunch" });
}

/** The search field of `editor`. */
export function searchOf(editor) {
  return editor.getByRole("combobox", { name: "Add recipe" });
}

/**
 * Starts to listen for the next time the editor closes, and returns a
 * function that waits until it has. Escape and Android's Back hide the dialog
 * first, and the browser tells the page afterward, so the editor hides
 * before the app has handled the close. The returned function waits for the
 * app: its listener is the second one, so it runs after the app's.
 */
export async function watchClose(page) {
  await page.evaluate(() => {
    window.editorClosed = new Promise((resolve) => {
      document.getElementById("slot-editor").addEventListener("close", () => resolve(), {
        once: true,
      });
    });
  });
  return () => page.evaluate(() => window.editorClosed);
}
