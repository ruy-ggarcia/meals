// Checks of what causes an effect only a phone shows. A headless browser
// can't zoom in or open a keyboard, so these assertions check the cause the
// phone reacts to: the size of the text of a field, the touch action of a
// button, the focused element, and the input mode.

import { expect } from "@playwright/test";

/**
 * Whether a phone shows a keyboard for `element`: a text area, an element you
 * can edit, or an input whose type takes text. Runs in the page.
 */
function isTextField(element) {
  if (!element) return false;
  if (element.isContentEditable || element.tagName === "TEXTAREA") return true;
  const types = ["text", "search", "email", "number", "tel", "url", "password"];
  return element.tagName === "INPUT" && types.includes(element.type);
}

/** Checks that focusing the field doesn't zoom Safari in, which it does under `16px`. */
export async function expectNoZoomOnFocus(locator) {
  const fontSize = await locator.evaluate((element) => getComputedStyle(element).fontSize);
  expect(Number.parseFloat(fontSize), `font size ${fontSize}`).toBeGreaterThanOrEqual(16);
}

/** Checks that a double tap on the element doesn't zoom in. */
export async function expectNoDoubleTapZoom(locator) {
  await expect(locator).toHaveCSS("touch-action", "manipulation");
}

/** Checks that the focus isn't in a text field, so the keyboard is closed. */
export async function expectKeyboardClosed(page) {
  await expect
    .poll(async () => {
      const focused = await page.evaluateHandle(() => document.activeElement);
      return focused.evaluate(isTextField);
    })
    .toBe(false);
}

/** Checks that the locator has the focus and is a text field, so the keyboard is open. */
export async function expectKeyboardOpen(locator) {
  await expect(locator).toBeFocused();
  expect(await locator.evaluate(isTextField), "the focused element is a text field").toBe(true);
}

/** Checks that the field asks for the keyboard with digits and a decimal separator. */
export async function expectDecimalKeyboard(locator) {
  await expect(locator).toHaveAttribute("inputmode", "decimal");
}
