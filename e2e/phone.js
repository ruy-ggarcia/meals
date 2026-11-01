// Checks of what causes an effect only a phone shows. A headless browser
// can't zoom in or open a keyboard, so these assertions check the cause the
// phone reacts to: the size of the text of a field, the touch action of a
// button, the focused element, and the input mode.

import { expect } from "@playwright/test";

// How far below the status bar the top of a sheet may be, in pixels, and
// still count as reaching up to it.
const MAX_GAP_BELOW_STATUS_BAR = 20;

/**
 * Describes `element`, by default the focused element, if a phone shows a
 * keyboard for it: a text area, an element you can edit, or an input whose
 * type takes text. Otherwise returns null. Runs in the page.
 */
function describeTextField(element = document.activeElement) {
  if (!element) return null;
  const types = ["text", "search", "email", "number", "tel", "url", "password"];
  const takesText =
    element.isContentEditable ||
    element.tagName === "TEXTAREA" ||
    (element.tagName === "INPUT" && types.includes(element.type));
  if (!takesText) return null;
  const label =
    element.getAttribute("aria-label") ||
    element.labels?.[0]?.textContent ||
    element.placeholder ||
    element.name ||
    element.id ||
    "";
  return `${element.tagName.toLowerCase()} "${label.trim()}"`;
}

/** The inset of the status bar, which a browser without a notch reports as 0. */
function safeTopOf(page) {
  return page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.paddingTop = "var(--safe-top)";
    document.body.append(probe);
    const inset = Number.parseFloat(getComputedStyle(probe).paddingTop);
    probe.remove();
    return inset;
  });
}

/**
 * Checks that the sheet fills the screen once it has risen into place: it
 * spans the width, ends at the bottom edge, and reaches up to just below the
 * status bar.
 */
export async function expectFillsScreen(sheet) {
  const page = sheet.page();
  const { width, height } = page.viewportSize();
  await expect
    .poll(
      async () => {
        const box = await sheet.boundingBox();
        // The bottom may end a fraction of a pixel off the edge of the screen.
        return { x: box.x, width: box.width, bottom: Math.round(box.y + box.height) };
      },
      {
        message: `${sheet}: x must be 0, width ${width}px (the viewport width), and the rounded bottom edge ${height}px (the viewport height)`,
      },
    )
    .toEqual({ x: 0, width, bottom: height });
  const safeTop = await safeTopOf(page);
  const box = await sheet.boundingBox();
  expect(
    box.y,
    `${sheet}: top edge (y) must be at least ${safeTop}px, the inset of the status bar`,
  ).toBeGreaterThanOrEqual(safeTop);
  const minHeight = height - safeTop - MAX_GAP_BELOW_STATUS_BAR;
  expect(
    box.height,
    `${sheet}: height must be at least ${minHeight}px = viewport height ${height}px - status bar inset ${safeTop}px - ${MAX_GAP_BELOW_STATUS_BAR}px`,
  ).toBeGreaterThanOrEqual(minHeight);
}

/** Checks that focusing the field doesn't zoom Safari in, which it does under `16px`. */
export async function expectNoZoomOnFocus(locator) {
  const fontSize = await locator.evaluate((element) => getComputedStyle(element).fontSize);
  expect(
    Number.parseFloat(fontSize),
    `${locator}: font size must be at least 16px, or Safari zooms in on focus`,
  ).toBeGreaterThanOrEqual(16);
}

/** Checks that a double tap on the element doesn't zoom in. */
export async function expectNoDoubleTapZoom(locator) {
  await expect(locator).toHaveCSS("touch-action", "manipulation");
}

/** Checks that the focus isn't in a text field, so the keyboard is closed. */
export async function expectKeyboardClosed(page) {
  await expect
    .poll(() => page.evaluate(describeTextField), {
      message:
        "the focused element must not be a text field, or the phone opens the keyboard: received is the text field that has the focus",
    })
    .toBeNull();
}

/** Checks that the locator has the focus and is a text field, so the keyboard is open. */
export async function expectKeyboardOpen(locator) {
  await expect(locator).toBeFocused();
  expect(
    await locator.evaluate(describeTextField),
    `${locator} is a text field, so it opens the keyboard`,
  ).not.toBeNull();
}

/** Checks that the field asks for the keyboard with digits and a decimal separator. */
export async function expectDecimalKeyboard(locator) {
  await expect(locator).toHaveAttribute("inputmode", "decimal");
}
