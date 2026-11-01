// Week navigation: the week on screen, the week in the address, the history
// of the browser, and the sidebar.

import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { CURRENT_WEEK, NEXT_WEEK } from "./catalog.js";
import { expect, test } from "./fixtures.js";

const CURRENT_RANGE = "Sep 21 – 27, 2026";
const NEXT_RANGE = "Sep 28 – Oct 4, 2026";

/**
 * The header of `day`'s column in the grid, which shows its day of the month.
 * It has no role or name. In the grid, only a header has a day and no meal.
 */
function dayHeader(page, day) {
  return page.getByRole("main").locator(`[data-day="${day}"]:not([data-meal])`);
}

/** Checks that the address, the range, and the grid all show `week`. */
async function expectWeek(page, week, range) {
  await expect(page).toHaveURL(new RegExp(`#${week}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(range);
  await expect(dayHeader(page, "mon")).toHaveText(`Mon${Number(week.slice(8))}`);
}

function nextWeekButton(page) {
  return page.getByRole("button", { name: "Next week" });
}

function sidebarOf(page) {
  return page.getByRole("navigation", { name: "Sections" });
}

test("opens the current week when the address has no week", async ({ page }) => {
  await page.goto("/");

  await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);
});

test("steps to the next week and back", async ({ page }) => {
  await page.goto("/");
  await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);

  await nextWeekButton(page).click();
  await expectWeek(page, NEXT_WEEK, NEXT_RANGE);

  await page.getByRole("button", { name: "Previous week" }).click();
  await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);
});

test("keeps a menu in its own week", async ({ page }) => {
  await page.goto("/");
  await nextWeekButton(page).click();
  await expectWeek(page, NEXT_WEEK, NEXT_RANGE);

  await page.getByRole("button", { name: "Monday, Lunch: empty" }).click();
  const editor = page.getByRole("dialog", { name: "Lunch" });
  await editor.getByRole("combobox", { name: "Add recipe" }).fill("Lentil");
  await editor.getByRole("option", { name: "Lentil soup" }).click();
  await editor.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("button", { name: "Monday, Lunch: Lentil soup × 1" })).toBeVisible();

  await page.getByRole("button", { name: "Previous week" }).click();
  await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);
  await expect(page.getByRole("button", { name: "Monday, Lunch: empty" })).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("Lentil soup");

  await nextWeekButton(page).click();
  await expectWeek(page, NEXT_WEEK, NEXT_RANGE);
  const slot = page.getByRole("button", { name: /^Monday, Lunch:/ });
  await expect(slot).toContainText("Lentil soup");
  await expect(slot).toContainText("×1");
});

test("stays on the week in the address after a reload", async ({ page }) => {
  await page.goto("/");
  await nextWeekButton(page).click();
  await expectWeek(page, NEXT_WEEK, NEXT_RANGE);

  await page.reload();

  await expectWeek(page, NEXT_WEEK, NEXT_RANGE);
});

test("ends on the last week after fast week changes", async ({ app, page }) => {
  await app.api.saveSlot("2026-10-05", "mon", "lunch", [
    { recipeId: app.recipes["Lentil soup"].id, servings: 1 },
  ]);
  await page.goto("/");
  await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);
  // Notes the week of the grid each time the grid changes while it shows the
  // menu of Oct 5, so a menu that shows in another week for a moment counts.
  await page.getByRole("main").evaluate((grid) => {
    window.weeksWithTheMenu = [];
    new MutationObserver(() => {
      if (grid.textContent.includes("Lentil soup")) window.weeksWithTheMenu.push(grid.dataset.week);
    }).observe(grid, { attributes: true, characterData: true, childList: true, subtree: true });
  });

  // Hold each week response. Click again as soon as Next week takes a click,
  // and when it has to wait, deliver the held responses, the latest request
  // first. Week changes that overlapped would get their weeks out of order.
  const held = [];
  let onHeld = () => {};
  await page.route("**/api/weeks/**", async (route) => {
    held.push({ route, response: await route.fetch() });
    onHeld();
  });
  async function deliverLatestFirst() {
    for (const { route, response } of held.splice(0).reverse()) await route.fulfill({ response });
  }
  const next = nextWeekButton(page);
  for (let click = 0; click < 5; click += 1) {
    if (await next.isDisabled()) await deliverLatestFirst();
    const requested = new Promise((resolve) => {
      onHeld = resolve;
    });
    await next.click();
    await requested;
  }
  await deliverLatestFirst();

  await expectWeek(page, "2026-10-26", "Oct 26 – Nov 1, 2026");
  await expect(dayHeader(page, "sun")).toHaveText("Sun1");
  await expect(page.getByRole("button", { name: "Monday, Lunch: empty" })).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("Lentil soup");
  const weeks = await page.evaluate(() => window.weeksWithTheMenu);
  expect(
    weeks.filter((week) => week !== "2026-10-05"),
    "the other weeks that showed the menu of Oct 5",
  ).toEqual([]);
});

test("opens the week in the address", async ({ page }) => {
  await page.goto("/#2026-12-28");

  await expectWeek(page, "2026-12-28", "Dec 28, 2026 – Jan 3, 2027");
});

test("goes back to the current week with Today", async ({ page }) => {
  await page.goto("/#2026-12-28");
  await expectWeek(page, "2026-12-28", "Dec 28, 2026 – Jan 3, 2027");

  await page.getByRole("button", { name: "Today" }).click();

  await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);
});

test("adds no history entry when you change weeks", async ({ page }) => {
  await page.goto("about:blank");
  await page.goto("/");
  await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);
  await nextWeekButton(page).click();
  await expectWeek(page, NEXT_WEEK, NEXT_RANGE);
  await nextWeekButton(page).click();
  await expectWeek(page, "2026-10-05", "Oct 5 – 11, 2026");

  // A hash typed into the address adds an entry.
  await page.goto("/#2026-12-28");
  await expectWeek(page, "2026-12-28", "Dec 28, 2026 – Jan 3, 2027");
  await page.goBack();
  await expectWeek(page, "2026-10-05", "Oct 5 – 11, 2026");

  await page.goBack();

  await expect(page).toHaveURL("about:blank");
});

test("hides the sidebar and remembers it", async ({ page }) => {
  await page.goto("/");
  const sidebar = sidebarOf(page);
  await expect(sidebar.getByRole("link", { name: "Meal plan" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(sidebar.getByRole("link", { name: "Recipes" })).toHaveText(/^\s*Recipes\s*7\s*$/);
  await expect(sidebar.getByRole("link", { name: "Ingredients" })).toHaveText(
    /^\s*Ingredients\s*4\s*$/,
  );
  const grid = page.getByRole("main");
  const { width } = await grid.boundingBox();

  await page.getByRole("button", { name: "Hide sidebar" }).click();

  await expect(sidebar).toBeHidden();
  await expect.poll(async () => (await grid.boundingBox()).width).toBeGreaterThan(width);
  await page.reload();
  await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);
  await expect(sidebar).toBeHidden();
});

test("remembers a shown sidebar on a medium window", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await page.getByRole("button", { name: "Show sidebar" }).click();
  await expect(sidebarOf(page)).toBeVisible();

  await page.setViewportSize({ width: 800, height: page.viewportSize().height });
  await page.reload();

  await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);
  await expect(sidebarOf(page)).toBeVisible();
});

test("puts the displayed week back when the address has another week", async ({ page }) => {
  await page.goto("/");
  await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);

  for (const hash of ["#hello", "#2026-09-22", "#2026-02-30"]) {
    await page.goto(`/${hash}`);
    await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);
  }
});

test("opens the current week when the address has no valid week", async ({ page }) => {
  await page.goto("/#hello");

  await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);
});

test("starts each test with its own server and data", async ({ app, page }) => {
  expect(app.port).not.toBe(3000);
  expect(dirname(app.dataDir)).toBe(tmpdir());
  expect((await stat(app.dataDir)).isDirectory()).toBe(true);

  await page.goto("/");

  await expect(page).toHaveURL(`${app.url}/#${CURRENT_WEEK}`);
});
