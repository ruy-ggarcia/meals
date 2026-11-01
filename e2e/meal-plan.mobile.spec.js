// The meal plan on a phone: the day bar, the week buttons, the bars that stay
// in place, and the Home Screen.

import { CURRENT_WEEK, NEXT_WEEK } from "./catalog.js";
import { expect, test } from "./fixtures.js";
import { expectAbove, expectInsideViewport, expectNoSidewaysScroll } from "./layout.js";
import { expectNoDoubleTapZoom } from "./phone.js";

const MEALS = ["Breakfast", "Morning snack", "Lunch", "Afternoon snack", "Dinner"];

const CURRENT = {
  week: CURRENT_WEEK,
  range: "Sep 21 – 27",
  longRange: "Sep 21 – 27, 2026",
  monday: "Monday, September 21",
};
const LAST = {
  week: "2026-10-26",
  range: "Oct 26 – Nov 1",
  longRange: "Oct 26 – Nov 1, 2026",
  monday: "Monday, October 26",
};
const BEFORE_LAST = {
  week: "2026-10-19",
  range: "Oct 19 – 25",
  longRange: "Oct 19 – 25, 2026",
  monday: "Monday, October 19",
};

function dayBar(page) {
  return page.getByRole("navigation", { name: "Day" });
}

function tabBar(page) {
  return page.getByRole("navigation", { name: "Sections" });
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
  return locator.page().viewportSize().height - (box.y + box.height);
}

/** Checks that the address, the ranges, and the day bar all show one week. */
async function expectWeek(page, { week, range, longRange, monday }) {
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

test("shows the current week with today selected", async ({ app, page }) => {
  await app.api.saveSlot(CURRENT_WEEK, "wed", "lunch", [
    { recipeId: app.recipes["Lentil soup"].id, servings: 2 },
  ]);
  await page.goto("/");

  await expectWeek(page, CURRENT);
  await expectSelectedDay(page, "Wednesday, September 23", "Wednesday");
  await expect(page.getByText("September 23, 2026 · Today", { exact: true })).toBeVisible();
  for (const meal of MEALS) {
    const name = page.getByRole("main").getByText(meal, { exact: true }).filter({ visible: true });
    const card = page.getByRole("button", { name: new RegExp(`^Wednesday, ${meal}:`) });
    await expect(name).toBeVisible();
    await expect(card).toBeVisible();
    await expect(card).toContainText("Add");
    await expectAbove(name, card);
  }
  const lunch = page.getByRole("button", { name: "Wednesday, Lunch: Lentil soup × 2" });
  await expect(lunch).toContainText("Lentil soup");
  await expect(lunch).toContainText("×2");
  for (const name of ["Meal plan", "Recipes", "Ingredients"]) {
    await expect(tabBar(page).getByRole("link", { name, exact: true })).toBeVisible();
  }
  await expectInsideViewport(tabBar(page));
});

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

  await expectWeek(page, CURRENT);
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
  expect(box.x).toBeGreaterThanOrEqual(previous.x + previous.width);
  expect(box.x + box.width).toBeLessThanOrEqual(next.x);
  await expectInsideViewport(page.getByRole("button", { name: "Next week" }));
  await expectInsideViewport(page.getByRole("button", { name: "Today" }));
  await expectNoSidewaysScroll(page);
});

test("changes weeks on fast taps without zooming", async ({ page }) => {
  await page.goto("/");
  await expectWeek(page, CURRENT);
  const next = page.getByRole("button", { name: "Next week" });
  const previous = page.getByRole("button", { name: "Previous week" });

  for (let tap = 0; tap < 5; tap += 1) await next.tap();

  await expectWeek(page, LAST);
  await expect.poll(() => page.evaluate(() => window.visualViewport.scale)).toBe(1);
  await previous.tap();
  await expectWeek(page, BEFORE_LAST);
  await next.tap();
  await expectWeek(page, LAST);
  await expectNoDoubleTapZoom(next);
  await expectNoDoubleTapZoom(previous);
});

test("keeps the toolbar and the tab bar in place while the page scrolls", async ({ app, page }) => {
  const items = [
    { recipeId: app.recipes["Lentil soup"].id, servings: 1 },
    { recipeId: app.recipes.Omelette.id, servings: 1 },
    { recipeId: app.recipes["Green salad"].id, servings: 1 },
  ];
  for (const meal of ["breakfast", "snack_am", "lunch", "snack_pm", "dinner"]) {
    await app.api.saveSlot(CURRENT_WEEK, "wed", meal, items);
  }
  await page.goto("/");
  await expectWeek(page, CURRENT);
  const firstMeal = page.getByRole("button", { name: /^Wednesday, Breakfast:/ });
  const lastMeal = page.getByRole("button", { name: /^Wednesday, Dinner:/ });
  const toolbarBox = await toolbar(page).boundingBox();
  const tabBarBox = await tabBar(page).boundingBox();
  const firstTop = (await firstMeal.boundingBox()).y;

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  expect(await toolbar(page).boundingBox()).toEqual(toolbarBox);
  expect(await tabBar(page).boundingBox()).toEqual(tabBarBox);
  expect((await firstMeal.boundingBox()).y).toBeLessThan(firstTop);
  await expectAbove(lastMeal, tabBar(page));
});

test("can be added to the Home Screen", async ({ page }) => {
  await page.goto("/");
  await expectWeek(page, CURRENT);

  const manifestUrl = await page.locator('link[rel="manifest"]').getAttribute("href");
  const manifest = await page.request.get(new URL(manifestUrl, page.url()).href);
  expect(manifest.ok()).toBe(true);
  const { name, display, icons } = await manifest.json();
  expect(name).toBe("Meals");
  expect(display).toBe("standalone");
  const touchIconUrl = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
  for (const href of [touchIconUrl, ...icons.map((icon) => icon.src)]) {
    const icon = await page.request.get(new URL(href, page.url()).href);
    expect(icon.ok(), href).toBe(true);
    expect(icon.headers()["content-type"], href).toBe("image/png");
  }
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    "content",
    /viewport-fit=cover/,
  );

  // A browser has no notch, so give the page the insets of an iPhone.
  const gapBefore = await gapBelow(tabBar(page));
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--safe-top", "47px");
    document.documentElement.style.setProperty("--safe-bottom", "34px");
  });
  for (const button of await toolbar(page).getByRole("button").all()) {
    expect((await button.boundingBox()).y).toBeGreaterThanOrEqual(47);
  }
  // The home indicator sits in the lower part of the 34px inset, so the
  // floating tab bar overlaps the top 10px of the inset by design.
  expect(await gapBelow(tabBar(page))).toBeGreaterThan(gapBefore);
  expect(await gapBelow(tabBar(page))).toBeGreaterThanOrEqual(34 - 10);
});
