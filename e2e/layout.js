// Assertions about where things are on the screen. They read the boxes the
// browser lays out, so they catch what a user sees: a page that scrolls
// sideways, or a control that is cut off.

import { expect } from "@playwright/test";

/** Checks that the page is no wider than the viewport, so it can't scroll sideways. */
export async function expectNoSidewaysScroll(page) {
  await expect
    .poll(
      () =>
        page.evaluate(() => ({
          document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          body: document.body.scrollWidth - document.documentElement.clientWidth,
        })),
      {
        message:
          "scrollWidth minus clientWidth of the document and of the body must be 0, or the page scrolls sideways",
      },
    )
    .toEqual({ document: 0, body: 0 });
}

/** Checks that the whole box of `locator` is inside the viewport. */
export async function expectInsideViewport(locator) {
  const { width, height } = locator.page().viewportSize();
  const box = await locator.boundingBox();
  expect(box, `${locator} has a box`).not.toBeNull();
  expect(
    box.x,
    `${locator}: left edge (x) must be at least 0, the left of the viewport`,
  ).toBeGreaterThanOrEqual(0);
  expect(
    box.y,
    `${locator}: top edge (y) must be at least 0, the top of the viewport`,
  ).toBeGreaterThanOrEqual(0);
  expect(
    box.x + box.width,
    `${locator}: right edge (x + width) must be at most ${width}px, the viewport width`,
  ).toBeLessThanOrEqual(width);
  expect(
    box.y + box.height,
    `${locator}: bottom edge (y + height) must be at most ${height}px, the viewport height`,
  ).toBeLessThanOrEqual(height);
}

/** Checks that the bottom of `upper` is at or above the top of `lower`. */
export async function expectAbove(upper, lower) {
  const upperBox = await upper.boundingBox();
  const lowerBox = await lower.boundingBox();
  expect(upperBox, `${upper} has a box`).not.toBeNull();
  expect(lowerBox, `${lower} has a box`).not.toBeNull();
  expect(
    upperBox.y + upperBox.height,
    `${upper}: bottom edge (y + height) must be at most ${lowerBox.y}px, the top edge of ${lower}`,
  ).toBeLessThanOrEqual(lowerBox.y);
}
