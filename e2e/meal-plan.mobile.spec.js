// The meal plan on a phone: the day bar, the week buttons, the bars that stay
// in place, and the Home Screen.

import { CURRENT_RANGE, CURRENT_WEEK, NEXT_WEEK } from "./catalog.js";
import { expect, test } from "./fixtures.js";
import { expectAbove, expectInsideViewport, expectNoSidewaysScroll } from "./layout.js";
import { sectionsOf } from "./navigation.js";
import { expectNoDoubleTapZoom } from "./phone.js";

const MEALS = ["Breakfast", "Morning snack", "Lunch", "Afternoon snack", "Dinner"];

const CURRENT = {
  week: CURRENT_WEEK,
  range: "Sep 21 – 27",
  longRange: CURRENT_RANGE,
  monday: "Monday, September 21",
};
// The taps on Next week in the test of fast taps.
const TAPS = 5;
// The insets of an iPhone, which a browser without a notch doesn't have, in
// pixels: the status bar above the toolbar, and the home indicator below the
// tab bar.
const SAFE_TOP = 47;
const SAFE_BOTTOM = 34;
// The home indicator sits in the lower part of the bottom inset, so the
// floating tab bar overlaps this much of the inset by design.
const TAB_BAR_OVERLAP = 10;

/** The week `count` weeks after `week`, such as `2026-09-28` one week after `2026-09-21`. */
function weeksAfter(week, count) {
  const monday = new Date(`${week}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() + 7 * count);
  return monday.toISOString().slice(0, 10);
}

// The week that the fast taps end on, and the week before it. The texts are
// what the page shows for them.
const LAST = {
  week: weeksAfter(CURRENT_WEEK, TAPS),
  range: "Oct 26 – Nov 1",
  longRange: "Oct 26 – Nov 1, 2026",
  monday: "Monday, October 26",
};
const BEFORE_LAST = {
  week: weeksAfter(CURRENT_WEEK, TAPS - 1),
  range: "Oct 19 – 25",
  longRange: "Oct 19 – 25, 2026",
  monday: "Monday, October 19",
};

function dayBar(page) {
  return page.getByRole("navigation", { name: "Day" });
}

function toolbar(page) {
  return page.getByRole("banner");
}

/** The short range between the week buttons, which only a phone shows. */
function shortRange(page, text) {
  return page.getByRole("navigation", { name: "Week" }).getByText(text, { exact: true });
}

/** The distance from the bottom of `locator` to the bottom of the viewport. */
async function gapBelow(locator) {
  const box = await locator.boundingBox();
  expect(box, `the box of ${locator}`).not.toBeNull();
  return locator.page().viewportSize().height - (box.y + box.height);
}

/** Checks that the address, the ranges, and the day bar all show one week. */
async function expectPhoneWeek(page, { week, range, longRange, monday }) {
  await expect(page).toHaveURL(new RegExp(`#${week}$`));
  await expect(shortRange(page, range)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(longRange);
  await expect(dayBar(page).getByRole("button", { name: monday })).toBeVisible();
}

/** Checks that `name` is the selected day of the day bar. */
async function expectSelectedDay(page, name, weekday) {
  await expect(dayBar(page).getByRole("button", { name })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(weekday);
}

test.describe("meal plan", () => {
  test("shows the current week with today selected", async ({ page }) => {
    await page.goto("/");

    await expectPhoneWeek(page, CURRENT);
    await expectSelectedDay(page, "Wednesday, September 23", "Wednesday");
    await expect(page.getByText("September 23, 2026 · Today", { exact: true })).toBeVisible();
  });

  test("puts each meal label above its card", async ({ page }) => {
    await page.goto("/");

    for (const meal of MEALS) {
      const name = page
        .getByRole("main")
        .getByText(meal, { exact: true })
        .filter({ visible: true });
      const card = page.getByRole("button", { name: new RegExp(`^Wednesday, ${meal}:`) });
      await expect(name).toBeVisible();
      await expect(card).toBeVisible();
      await expectAbove(name, card);
    }
  });

  test("shows Add in each card", async ({ page }) => {
    await page.goto("/");

    for (const meal of MEALS) {
      const card = page.getByRole("button", { name: new RegExp(`^Wednesday, ${meal}:`) });
      await expect(card.getByText("Add", { exact: true }), `${meal} card`).toBeVisible();
    }
  });

  test("shows the menu of a slot in its card", async ({ app, page }) => {
    await app.api.saveSlot(CURRENT_WEEK, "wed", "lunch", [
      { recipeId: app.recipes["Lentil soup"].id, servings: 2 },
    ]);
    await page.goto("/");

    const card = page.getByRole("button", { name: "Wednesday, Lunch: Lentil soup × 2" });
    await expect(card.getByText("Lentil soup")).toBeVisible();
    await expect(card.getByText("×2")).toBeVisible();
  });
});

test.describe("week navigation", () => {
  test("keeps the selected day when the week changes", async ({ page }) => {
    await page.goto("/");
    await dayBar(page).getByRole("button", { name: "Thursday, September 24" }).tap();
    await expectSelectedDay(page, "Thursday, September 24", "Thursday");

    await page.getByRole("button", { name: "Next week" }).tap();

    await expect(page).toHaveURL(new RegExp(`#${NEXT_WEEK}$`));
    await expectSelectedDay(page, "Thursday, October 1", "Thursday");
    await expect(page.getByText("October 1, 2026", { exact: true })).toBeVisible();
  });

  test("goes back to today with Today", async ({ page }) => {
    await page.goto("/");
    await dayBar(page).getByRole("button", { name: "Thursday, September 24" }).tap();
    await page.getByRole("button", { name: "Next week" }).tap();
    await expect(page).toHaveURL(new RegExp(`#${NEXT_WEEK}$`));

    await page.getByRole("button", { name: "Today" }).tap();

    await expectPhoneWeek(page, CURRENT);
    await expectSelectedDay(page, "Wednesday, September 23", "Wednesday");
    await expect(page.getByText("September 23, 2026 · Today", { exact: true })).toBeVisible();
  });

  test("fits the range of a week that spans two years", async ({ page }) => {
    await page.goto("/#2026-12-28");

    const range = shortRange(page, "Dec 28 – Jan 3");
    await expect(range).toBeVisible();
    const previous = await page.getByRole("button", { name: "Previous week" }).boundingBox();
    const next = await page.getByRole("button", { name: "Next week" }).boundingBox();
    const box = await range.boundingBox();
    expect(
      box.x,
      `the left edge of the range must be at least ${previous.x + previous.width}px, the right edge of Previous week`,
    ).toBeGreaterThanOrEqual(previous.x + previous.width);
    expect(
      box.x + box.width,
      `the right edge of the range must be at most ${next.x}px, the left edge of Next week`,
    ).toBeLessThanOrEqual(next.x);
    await expectInsideViewport(page.getByRole("button", { name: "Next week" }));
    await expectInsideViewport(page.getByRole("button", { name: "Today" }));
    await expectNoSidewaysScroll(page);
  });

  test("changes weeks on fast taps", async ({ page }) => {
    await page.goto("/");
    await expectPhoneWeek(page, CURRENT);
    const next = page.getByRole("button", { name: "Next week" });
    const previous = page.getByRole("button", { name: "Previous week" });

    for (let tap = 0; tap < TAPS; tap += 1) await next.tap();

    await expectPhoneWeek(page, LAST);
    await previous.tap();
    await expectPhoneWeek(page, BEFORE_LAST);
    await next.tap();
    await expectPhoneWeek(page, LAST);
  });

  test("keeps the week buttons from zooming on a double tap", async ({ page }) => {
    await page.goto("/");

    await expectNoDoubleTapZoom(page.getByRole("button", { name: "Next week" }));
    await expectNoDoubleTapZoom(page.getByRole("button", { name: "Previous week" }));
  });
});

test.describe("tab bar", () => {
  test("shows the three sections inside the screen", async ({ page }) => {
    await page.goto("/");

    for (const name of ["Meal plan", "Recipes", "Ingredients"]) {
      await expect(sectionsOf(page).getByRole("link", { name, exact: true })).toBeVisible();
    }
    await expectInsideViewport(sectionsOf(page));
  });

  test("keeps the toolbar and the tab bar in place while the page scrolls", async ({
    app,
    page,
  }) => {
    const items = [
      { recipeId: app.recipes["Lentil soup"].id, servings: 1 },
      { recipeId: app.recipes.Omelette.id, servings: 1 },
      { recipeId: app.recipes["Green salad"].id, servings: 1 },
    ];
    for (const meal of ["breakfast", "snack_am", "lunch", "snack_pm", "dinner"]) {
      await app.api.saveSlot(CURRENT_WEEK, "wed", meal, items);
    }
    await page.goto("/");
    await expectPhoneWeek(page, CURRENT);
    const firstMeal = page.getByRole("button", { name: /^Wednesday, Breakfast:/ });
    const lastMeal = page.getByRole("button", { name: /^Wednesday, Dinner:/ });
    const toolbarBox = await toolbar(page).boundingBox();
    const tabBarBox = await sectionsOf(page).boundingBox();
    const firstTop = (await firstMeal.boundingBox()).y;

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    expect(await toolbar(page).boundingBox()).toEqual(toolbarBox);
    expect(await sectionsOf(page).boundingBox()).toEqual(tabBarBox);
    expect((await firstMeal.boundingBox()).y).toBeLessThan(firstTop);
    await expectAbove(lastMeal, sectionsOf(page));
  });

  test("keeps the toolbar and tab bar clear of the notch and home indicator", async ({ page }) => {
    await page.goto("/");
    await expectPhoneWeek(page, CURRENT);

    // A browser has no notch, so give the page the insets of an iPhone.
    const gapBefore = await gapBelow(sectionsOf(page));
    await page.evaluate(
      ({ top, bottom }) => {
        document.documentElement.style.setProperty("--safe-top", `${top}px`);
        document.documentElement.style.setProperty("--safe-bottom", `${bottom}px`);
      },
      { top: SAFE_TOP, bottom: SAFE_BOTTOM },
    );
    // The content of the toolbar starts below the status bar.
    const contentTop = await toolbar(page).evaluate((element) => {
      const style = getComputedStyle(element);
      return (
        element.getBoundingClientRect().top +
        Number.parseFloat(style.borderTopWidth) +
        Number.parseFloat(style.paddingTop)
      );
    });
    expect(
      contentTop,
      `the top of the toolbar's content must be at least ${SAFE_TOP}px, the inset of the status bar`,
    ).toBeGreaterThanOrEqual(SAFE_TOP);
    for (const button of await toolbar(page).getByRole("button").all()) {
      expect(
        (await button.boundingBox()).y,
        `${button}: top edge must be at least ${SAFE_TOP}px, the inset of the status bar`,
      ).toBeGreaterThanOrEqual(SAFE_TOP);
    }
    expect(
      await gapBelow(sectionsOf(page)),
      `the gap below the tab bar must be more than ${gapBefore}px, the gap without the inset`,
    ).toBeGreaterThan(gapBefore);
    expect(
      await gapBelow(sectionsOf(page)),
      `the gap below the tab bar must be at least ${SAFE_BOTTOM - TAB_BAR_OVERLAP}px = the ${SAFE_BOTTOM}px inset of the home indicator - the ${TAB_BAR_OVERLAP}px that the tab bar overlaps`,
    ).toBeGreaterThanOrEqual(SAFE_BOTTOM - TAB_BAR_OVERLAP);
  });
});

test.describe("Home Screen", () => {
  test("serves the touch icon as a PNG", async ({ page }) => {
    await page.goto("/");

    const touchIconUrl = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
    const touchIcon = await page.request.get(new URL(touchIconUrl, page.url()).href);
    expect(touchIcon.ok(), `touch icon at ${touchIconUrl}`).toBe(true);
    expect(touchIcon.headers()["content-type"], `type of the touch icon at ${touchIconUrl}`).toBe(
      "image/png",
    );
  });

  test("declares viewport-fit=cover to use the whole screen", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
      "content",
      /viewport-fit=cover/,
    );
  });
});
