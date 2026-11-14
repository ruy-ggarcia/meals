// The assistant on a phone: the button beside the tab bar, the window as a
// sheet over the dimmed page, the focus when it opens, the message field, and
// the day that a week link shows.

import {
  ask,
  assistantButton,
  assistantWindow,
  messageField,
  openAssistant,
  pendingCard,
  proposeMenus,
} from "./assistant.js";
import { CURRENT_RANGE, CURRENT_WEEK, NEXT_RANGE, NEXT_WEEK } from "./catalog.js";
import { expect, test } from "./fixtures.js";
import { openCatalog } from "./ingredients.js";
import {
  expectAfterOnLine,
  expectCenteredOnScreen,
  expectClearOf,
  expectInsideViewport,
} from "./layout.js";
import { expectWeek } from "./meal-plan.js";
import { sectionsOf, TAB_BAR_SCREENS } from "./navigation.js";
import { expectFillsScreen, expectNoZoomOnFocus, zoomText } from "./phone.js";
import { openBook } from "./recipes.js";

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

/**
 * Checks that a tap at the center of `locator`, a control of the page behind
 * the open sheet, lands on the sheet or on the dimmed page, not on the
 * control.
 */
async function expectCoveredBySheet(locator) {
  const target = await locator.evaluate((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    const hit = document.elementFromPoint(x + width / 2, y + height / 2);
    if (hit === null) return "nothing";
    if (hit.closest(".assistant-window, .assistant-backdrop") !== null) return "the sheet";
    return hit.outerHTML.slice(0, 80);
  });
  expect(target, `a tap at the center of ${locator} must land on the sheet`).toBe("the sheet");
}

// The pages of the app, and how to open each one and find its rows.
const PAGES = [
  {
    name: "meal plan",
    open: openMealPlan,
    rows: (page) => page.getByRole("main").getByRole("button"),
  },
  {
    name: "recipe book",
    open: openBook,
    rows: (page) => page.getByRole("button", { name: /^Edit / }),
  },
  {
    name: "ingredient catalog",
    open: openCatalog,
    rows: (page) => page.getByRole("button", { name: /^Edit / }),
  },
];

const NEXT_REPLY = "Here's Friday's dinner and Saturday's lunch next week.";

test.describe("assistant", () => {
  test.use({ assistant: { script: [] } });

  test.describe(() => {
    test.use({
      assistant: {
        script: [
          proposeMenus(NEXT_WEEK, [
            ["sat", "lunch", { Omelette: 1 }],
            ["fri", "dinner", { Omelette: 2 }],
          ]),
          { text: NEXT_REPLY },
        ],
      },
    });

    test("shows the first changed day of the week of a link after Apply", async ({ page }) => {
      await openMealPlan(page);
      const chat = await ask(
        page,
        "Plan Friday's dinner and Saturday's lunch next week.",
        NEXT_REPLY,
      );
      await pendingCard(page).getByRole("button", { name: "Apply" }).click();

      await chat.getByRole("link", { name: "Show the week of Sep 28" }).click();

      await expectWeek(page, NEXT_WEEK, NEXT_RANGE);
      await expect(page.locator("#day-heading .day-title")).toHaveText("Friday");
    });
  });

  // With the assistant on, the button sits 20 px from the right edge, on the
  // line of the tab bar, with 8 px of space before it. The tab bar stays
  // centered while they fit beside it, and narrower, it moves left, down to
  // 20 px from the left edge, and then narrows.
  for (const viewport of TAB_BAR_SCREENS) {
    const size = ` at ${viewport.width}×${viewport.height}`;

    test.describe(() => {
      test.use({ viewport });

      test(`places the button on the line of the tab bar, after it${size}`, async ({ page }) => {
        await openMealPlan(page);

        await expect(assistantButton(page)).toBeVisible();

        await expectAfterOnLine(sectionsOf(page), assistantButton(page));
      });

      test(`keeps the tab bar and the button inside the screen${size}`, async ({ page }) => {
        await openMealPlan(page);

        await expect(assistantButton(page)).toBeVisible();

        await expectInsideViewport(sectionsOf(page));
        await expectInsideViewport(assistantButton(page));
      });

      test(`places the button 20 px from the right edge${size}`, async ({ page }) => {
        await openMealPlan(page);
        await expect(assistantButton(page)).toBeVisible();

        const button = await assistantButton(page).boundingBox();

        expect(
          viewport.width - (button.x + button.width),
          "the space between the button's right edge and the screen's must be 20px",
        ).toBeCloseTo(20, 0);
      });

      test(`keeps every tab at least 44 px wide and tall${size}`, async ({ page }) => {
        await openMealPlan(page);
        await expect(assistantButton(page)).toBeVisible();

        const sizes = await sectionsOf(page)
          .getByRole("link")
          .evaluateAll((links) =>
            links.map((link) => {
              const { width, height } = link.getBoundingClientRect();
              return { name: link.textContent.trim(), width, height };
            }),
          );
        expect(sizes, "the three tabs").toHaveLength(3);
        for (const { name, width, height } of sizes) {
          expect(
            width,
            `the width of the tab ${name} must be at least 44px`,
          ).toBeGreaterThanOrEqual(44);
          expect(
            height,
            `the height of the tab ${name} must be at least 44px`,
          ).toBeGreaterThanOrEqual(44);
        }
      });

      for (const { name, open, rows } of PAGES) {
        test(`keeps the end of the ${name} clear of the button${size}`, async ({ page }) => {
          await open(page);
          await expect(assistantButton(page)).toBeVisible();

          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

          await expectClearOf(rows(page), assistantButton(page));
        });
      }
    });
  }

  test.describe(() => {
    test.use({ viewport: { width: 600, height: 900 } });

    test("centers the tab bar beside the button at 600×900", async ({ page }) => {
      await openMealPlan(page);

      await expect(assistantButton(page)).toBeVisible();

      expectCenteredOnScreen(page, await sectionsOf(page).boundingBox());
    });
  });

  // An iPhone 15: 393 px, less 20 px on each side, the 56 px button, and the
  // 8 px of space before it.
  test.describe(() => {
    test.use({ viewport: { width: 393, height: 659 } });

    test("narrows the tab bar only as much as the button needs at 393×659", async ({ page }) => {
      await openMealPlan(page);

      await expect(assistantButton(page)).toBeVisible();

      const { width } = await sectionsOf(page).boundingBox();
      expect(width, "the width of the tab bar must be 289px").toBeCloseTo(289, 0);
    });

    // The server marks the page, so the tab bar has its place before
    // assistant.js knows whether the assistant is on.
    test("places the tab bar before the page checks the assistant at 393×659", async ({ page }) => {
      const check = Promise.withResolvers();
      await page.route(
        (url) => url.pathname === "/api/assistant",
        (route) => check.resolve(route),
      );
      await openMealPlan(page);
      const held = await check.promise;
      await expect(assistantButton(page)).toHaveCount(0);
      const before = await sectionsOf(page).boundingBox();

      await held.continue();

      await expect(assistantButton(page)).toBeVisible();
      expect(before, "the tab bar before the check").toEqual(await sectionsOf(page).boundingBox());
    });
  });

  // The layout depends only on whether the assistant is on, not on the size
  // of the text of the tabs.
  test("keeps the tab bar and the button apart at a 200% text size", async ({ page }) => {
    await openMealPlan(page);
    await expect(assistantButton(page)).toBeVisible();

    await zoomText(sectionsOf(page), 2);

    await expectClearOf(sectionsOf(page).getByRole("link"), assistantButton(page));
  });

  test("keeps the tab bar in place while the window opens and collapses", async ({ page }) => {
    await openMealPlan(page);
    await expect(assistantButton(page)).toBeVisible();
    const before = await sectionsOf(page).boundingBox();

    const chat = await openAssistant(page);
    await expectFillsScreen(chat);
    expect(await sectionsOf(page).boundingBox(), "the tab bar under the open sheet").toEqual(
      before,
    );
    await chat.getByRole("button", { name: "Collapse" }).click();

    await expect(assistantButton(page)).toBeVisible();
    expect(await sectionsOf(page).boundingBox(), "the tab bar after Collapse").toEqual(before);
  });

  test("opens the window as a sheet that fills the screen", async ({ page }) => {
    await openMealPlan(page);

    const chat = await openAssistant(page);

    await expectFillsScreen(chat);
  });

  test("covers the toolbar and the tab bar with the sheet", async ({ page }) => {
    await openMealPlan(page);

    const chat = await openAssistant(page);
    await expectFillsScreen(chat);

    await expectCoveredBySheet(page.locator("#today"));
    await expectCoveredBySheet(page.locator("#shopping-list"));
    await expectCoveredBySheet(page.locator('.page-link[href="/recipes.html"]'));
  });

  test("collapses the sheet with a tap on the dimmed page", async ({ page }) => {
    await openMealPlan(page);
    const chat = await openAssistant(page);
    await expectFillsScreen(chat);
    const box = await chat.boundingBox();

    // Above the sheet, where the dimmed page shows.
    await page.touchscreen.tap(box.x + box.width / 2, box.y / 2);

    await expect(assistantWindow(page)).toBeHidden();
  });

  // A phone has no precise pointer: the window opens without the on-screen
  // keyboard, which opens only with a tap on the message field.
  test("focuses the title when the sheet opens", async ({ page }) => {
    await openMealPlan(page);

    const chat = await openAssistant(page);

    await expect(chat.getByRole("heading", { name: "Assistant" })).toBeFocused();
  });

  test("focuses the message field with a tap on it", async ({ page }) => {
    await openMealPlan(page);
    const chat = await openAssistant(page);
    await expect(chat.getByRole("heading", { name: "Assistant" })).toBeFocused();

    await messageField(page).tap();

    await expect(messageField(page)).toBeFocused();
  });

  test("keeps the message field at a size that doesn't zoom the page", async ({ page }) => {
    await openMealPlan(page);
    await openAssistant(page);

    await messageField(page).tap();

    await expectNoZoomOnFocus(messageField(page));
  });

  test("focuses the message field with a tap at the top of its pill", async ({ page }) => {
    await openMealPlan(page);
    const chat = await openAssistant(page);
    await expectFillsScreen(chat);
    await chat.getByRole("button", { name: "New conversation" }).focus();
    const pill = await chat.locator(".message-row").boundingBox();
    const field = await messageField(page).boundingBox();

    // Above the field's line, 4 px inside the pill's top edge.
    await page.touchscreen.tap(field.x + field.width / 2, pill.y + 4);

    await expect(messageField(page)).toBeFocused();
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
