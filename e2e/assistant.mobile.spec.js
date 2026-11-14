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
    // A browser has no home indicator, so give the page the inset of an iPhone.
    await page.evaluate((bottom) => {
      document.documentElement.style.setProperty("--safe-bottom", `${bottom}px`);
    }, SAFE_BOTTOM);

    await openAssistant(page);

    const limit = page.viewportSize().height - SAFE_BOTTOM;
    await expect
      .poll(
        async () => {
          const box = await messageField(page).boundingBox();
          return box.y + box.height <= limit;
        },
        {
          message: `the bottom edge of the message field must be at most ${limit}px = the viewport height - the ${SAFE_BOTTOM}px inset of the home indicator`,
        },
      )
      .toBe(true);
  });
});
