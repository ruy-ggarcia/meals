// Assertions about where things are on the screen. They read the boxes the
// browser lays out, so they catch what a user sees: a page that scrolls
// sideways, or a control that is cut off.

import { expect } from "@playwright/test";

/** Checks that the page is no wider than the viewport, so it can't scroll sideways. */
export async function expectNoSidewaysScroll(page) {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        body: document.body.scrollWidth - document.documentElement.clientWidth,
      })),
    )
    .toEqual({ document: 0, body: 0 });
}

/** Checks that the whole box of `locator` is inside the viewport. */
export async function expectInsideViewport(locator) {
  const { width, height } = locator.page().viewportSize();
  const box = await locator.boundingBox();
  expect(box, "the element has a box").not.toBeNull();
  expect(box.x, "left edge").toBeGreaterThanOrEqual(0);
  expect(box.y, "top edge").toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, "right edge").toBeLessThanOrEqual(width);
  expect(box.y + box.height, "bottom edge").toBeLessThanOrEqual(height);
}

/** Checks that the bottom of `upper` is at or above the top of `lower`. */
export async function expectAbove(upper, lower) {
  const upperBox = await upper.boundingBox();
  const lowerBox = await lower.boundingBox();
  expect(upperBox, "the upper element has a box").not.toBeNull();
  expect(lowerBox, "the lower element has a box").not.toBeNull();
  expect(upperBox.y + upperBox.height).toBeLessThanOrEqual(lowerBox.y);
}
