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

/**
 * Checks that `locator` can be clicked where it is, without scrolling
 * anything: its whole box is inside the viewport and the box of
 * `container`, and a click at its center reaches it, so nothing covers or
 * clips it there.
 */
export async function expectClickableInside(locator, container) {
  await expectInsideViewport(locator);
  const box = await locator.boundingBox();
  const containerBox = await container.boundingBox();
  expect(containerBox, `${container} has a box`).not.toBeNull();
  expect(
    box.x,
    `${locator}: left edge (x) must be at least ${containerBox.x}px, the left edge of ${container}`,
  ).toBeGreaterThanOrEqual(containerBox.x);
  expect(
    box.x + box.width,
    `${locator}: right edge (x + width) must be at most ${containerBox.x + containerBox.width}px, the right edge of ${container}`,
  ).toBeLessThanOrEqual(containerBox.x + containerBox.width);
  expect(
    box.y,
    `${locator}: top edge (y) must be at least ${containerBox.y}px, the top edge of ${container}`,
  ).toBeGreaterThanOrEqual(containerBox.y);
  expect(
    box.y + box.height,
    `${locator}: bottom edge (y + height) must be at most ${containerBox.y + containerBox.height}px, the bottom edge of ${container}`,
  ).toBeLessThanOrEqual(containerBox.y + containerBox.height);
  const reached = await locator.evaluate((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    const target = document.elementFromPoint(x + width / 2, y + height / 2);
    return target !== null && element.contains(target);
  });
  expect(reached, `a click at the center of ${locator} must reach it`).toBe(true);
}

/**
 * Checks that no element of `locator` overflows sideways: the content of
 * each fits its width, and its box is inside `container` from left to right.
 */
export async function expectEachInsideSideways(locator, container) {
  const containerBox = await container.boundingBox();
  expect(containerBox, `${container} has a box`).not.toBeNull();
  const left = containerBox.x;
  const right = containerBox.x + containerBox.width;
  const outside = await locator.evaluateAll(
    (elements, edges) =>
      elements.flatMap((element, index) => {
        const box = element.getBoundingClientRect();
        const problems = [];
        if (element.scrollWidth > element.clientWidth) {
          problems.push(`content ${element.scrollWidth}px wide in ${element.clientWidth}px`);
        }
        if (box.left < edges.left || box.right > edges.right) {
          problems.push(`box from ${box.left}px to ${box.right}px`);
        }
        return problems.length === 0 ? [] : [`element ${index}: ${problems.join(", ")}`];
      }),
    { left, right },
  );
  expect(
    outside,
    `each element of ${locator} must fit its content and stay between ${left}px and ${right}px, the edges of ${container}`,
  ).toEqual([]);
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

/**
 * Checks that `trailing` sits on the line of `leading`, after it: its box is
 * right of the box of `leading`, and no taller than it from top to bottom.
 */
export async function expectAfterOnLine(leading, trailing) {
  const leadingBox = await leading.boundingBox();
  const trailingBox = await trailing.boundingBox();
  expect(leadingBox, `${leading} has a box`).not.toBeNull();
  expect(trailingBox, `${trailing} has a box`).not.toBeNull();
  expect(
    trailingBox.x,
    `${trailing}: left edge (x) must be at least ${leadingBox.x + leadingBox.width}px, the right edge of ${leading}`,
  ).toBeGreaterThanOrEqual(leadingBox.x + leadingBox.width);
  expect(
    trailingBox.y,
    `${trailing}: top edge (y) must be at least ${leadingBox.y}px, the top edge of ${leading}`,
  ).toBeGreaterThanOrEqual(leadingBox.y);
  expect(
    trailingBox.y + trailingBox.height,
    `${trailing}: bottom edge (y + height) must be at most ${leadingBox.y + leadingBox.height}px, the bottom edge of ${leading}`,
  ).toBeLessThanOrEqual(leadingBox.y + leadingBox.height);
}

/**
 * Waits until no element of `locator` overlaps the box of `cover`. The first
 * sample without an overlap passes, so wait for transitions to end first.
 */
export async function expectClearOf(locator, cover) {
  await expect
    .poll(
      async () => {
        const coverBox = await cover.boundingBox();
        if (coverBox === null) return [`${cover} has no box`];
        return locator.evaluateAll(
          (elements, edges) =>
            elements.flatMap((element, index) => {
              const box = element.getBoundingClientRect();
              const overlaps =
                box.width > 0 &&
                box.height > 0 &&
                box.left < edges.right &&
                box.right > edges.left &&
                box.top < edges.bottom &&
                box.bottom > edges.top;
              return overlaps
                ? [
                    `element ${index} (${element.textContent.trim().slice(0, 40)}): box from (${box.left}, ${box.top}) to (${box.right}, ${box.bottom})`,
                  ]
                : [];
            }),
          {
            left: coverBox.x,
            top: coverBox.y,
            right: coverBox.x + coverBox.width,
            bottom: coverBox.y + coverBox.height,
          },
        );
      },
      {
        message: `no element of ${locator} may overlap ${cover}: received are the elements that do`,
      },
    )
    .toEqual([]);
}

/**
 * Checks that the center of `box`, from its left edge `x` across its
 * `width`, is the center of the screen of `page`, within half a pixel.
 */
export function expectCenteredOnScreen(page, box) {
  const { width } = page.viewportSize();
  expect(
    box.x + box.width / 2,
    `the center of the box from ${box.x}px across ${box.width}px must be ${width / 2}px, the center of the screen`,
  ).toBeCloseTo(width / 2, 0);
}
