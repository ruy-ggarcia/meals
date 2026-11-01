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

/**
 * Checks that the text of `locator` wraps onto more than one line, and that
 * its box stays inside the box of `container`, so a long word never widens it.
 */
export async function expectWrapsInside(locator, container) {
  const { lines, hiddenWidth } = await locator.evaluate((element) => {
    // A range over the text has a box for each line that the text fills.
    const range = document.createRange();
    range.selectNodeContents(element);
    const tops = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
    return {
      lines: tops.size,
      // A word that doesn't break overflows its box, and the box clips it.
      hiddenWidth: element.scrollWidth - element.clientWidth,
    };
  });
  expect(
    lines,
    `${locator}: number of lines must be more than 1, so a long word wraps`,
  ).toBeGreaterThan(1);
  expect(
    hiddenWidth,
    `${locator}: scroll width minus client width must be 0 or less, or part of the text is cut off`,
  ).toBeLessThanOrEqual(0);
  const box = await locator.boundingBox();
  const containerBox = await container.boundingBox();
  expect(box, `${locator} has a box`).not.toBeNull();
  expect(containerBox, `${container} has a box`).not.toBeNull();
  expect(
    box.x,
    `${locator}: left edge (x) must be at least ${containerBox.x}px, the left edge of ${container}`,
  ).toBeGreaterThanOrEqual(containerBox.x);
  expect(
    box.x + box.width,
    `${locator}: right edge (x + width) must be at most ${containerBox.x + containerBox.width}px, the right edge of ${container}`,
  ).toBeLessThanOrEqual(containerBox.x + containerBox.width);
}
