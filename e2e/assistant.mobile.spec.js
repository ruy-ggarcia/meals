// The assistant on a phone: the button above the tab bar, and the window as a
// sheet below the toolbar, with the message field clear of the home
// indicator.

import { assistantButton, messageField, openAssistant } from "./assistant.js";
import { CURRENT_RANGE, CURRENT_WEEK } from "./catalog.js";
import { expect, test } from "./fixtures.js";
import { expectAbove } from "./layout.js";
import { sectionsOf } from "./navigation.js";

// The inset of the home indicator of an iPhone, in pixels, which a browser
// without one doesn't have.
const SAFE_BOTTOM = 34;

/**
 * Gives the page a bottom inset of `bottom` pixels, as a phone with a home
 * indicator does. A browser has none.
 */
async function setSafeBottom(page, bottom) {
  await page.evaluate((value) => {
    document.documentElement.style.setProperty("--safe-bottom", `${value}px`);
  }, bottom);
}

/** The bottom edge of the message field, in pixels from the top of the viewport. */
async function fieldBottom(page) {
  const box = await messageField(page).boundingBox();
  return box.y + box.height;
}

/** Opens the meal plan, and waits until its grid shows. */
async function openMealPlan(page) {
  await page.goto(`/#${CURRENT_WEEK}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(CURRENT_RANGE);
  await expect(page.getByRole("button", { name: /^Wednesday, Lunch:/ })).toBeVisible();
}

test.describe("assistant", () => {
  test.use({ assistant: { script: [] } });

  test("places the button above the tab bar, with neither covering the other", async ({ page }) => {
    await openMealPlan(page);

    await expect(assistantButton(page)).toBeVisible();

    await expectAbove(assistantButton(page), sectionsOf(page));
  });

  test("opens the window as a sheet that leaves the toolbar visible", async ({ page }) => {
    await openMealPlan(page);

    const chat = await openAssistant(page);

    const { width, height } = page.viewportSize();
    // The sheet rises into place.
    await expect
      .poll(
        async () => {
          const box = await chat.boundingBox();
          return { x: box.x, width: box.width, bottom: Math.round(box.y + box.height) };
        },
        {
          message: `${chat}: x must be 0, width ${width}px (the viewport width), and the rounded bottom edge ${height}px (the viewport height)`,
        },
      )
      .toEqual({ x: 0, width, bottom: height });
    const toolbar = page.getByRole("banner");
    await expect(toolbar).toBeVisible();
    await expectAbove(toolbar, chat);
  });

  test("keeps the message field above the bottom safe area", async ({ page }) => {
    await openMealPlan(page);
    await setSafeBottom(page, 0);
    const chat = await openAssistant(page);
    const { height } = page.viewportSize();
    // The sheet rises into place.
    await expect
      .poll(async () => {
        const box = await chat.boundingBox();
        return Math.round(box.y + box.height);
      })
      .toBe(height);
    const before = await fieldBottom(page);

    await setSafeBottom(page, SAFE_BOTTOM);

    await expect
      .poll(async () => Math.abs(before - (await fieldBottom(page)) - SAFE_BOTTOM) <= 1, {
        message: `the bottom edge of the message field must rise by the ${SAFE_BOTTOM}px inset of the home indicator, within 1px, from ${before}px`,
      })
      .toBe(true);
  });
});
