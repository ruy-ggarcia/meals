// The dates of the week, the today marker, and what happens to it when the
// day changes.

import { CURRENT_WEEK, NEXT_WEEK } from "./catalog.js";
import { expect, test } from "./fixtures.js";
import { switchAway } from "./page-visibility.js";

// The colors of the stylesheet, as the browser computes them.
const GREEN = "rgb(46, 125, 50)";
const GREEN_BAND = "rgba(46, 125, 50, 0.12)";
const NO_COLOR = "rgba(0, 0, 0, 0)";
const WHITE = "rgb(255, 255, 255)";

const DAY_NAMES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const DAY_IDS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const NEXT_WEEK_NUMBERS = ["28", "29", "30", "1", "2", "3", "4"];

const THURSDAY = "2026-09-24T10:00:00+02:00";
const NEXT_MONDAY = "2026-09-28T10:00:00+02:00";

/**
 * The header of `day`'s column in the grid. It has no role or name. In the
 * grid, only a header has a day and no meal.
 */
function headerOf(page, day) {
  return page.getByRole("main").locator(`[data-day="${day}"]:not([data-meal])`);
}

/** The name and the number of `day`'s header in the grid, such as `MON` and `21`. */
function dayHeader(page, day) {
  const header = headerOf(page, day);
  return { name: header.locator("span").first(), number: header.locator("span").nth(1) };
}

function dayBarButton(page, name) {
  return page.getByRole("navigation", { name: "Day" }).getByRole("button", { name });
}

/** Waits for the grid to show `week`, whose Monday falls on `monday`. */
async function expectWeekLoaded(page, week, monday) {
  await expect(page).toHaveURL(new RegExp(`#${week}$`));
  await expect(page.getByRole("heading", { level: 1 })).not.toBeEmpty();
  await expect(dayHeader(page, "mon").number).toHaveText(String(monday));
}

/** Checks that only `today` has the marked name and number in the header, or no day when null. */
async function expectMarkedHeader(page, today) {
  for (const day of DAY_IDS) {
    const { name, number } = dayHeader(page, day);
    if (day === today) {
      await expect(name).toHaveCSS("color", GREEN);
      await expect(number).toHaveCSS("background-color", GREEN);
      await expect(number).toHaveCSS("color", WHITE);
    } else {
      await expect(name).not.toHaveCSS("color", GREEN);
      await expect(number).toHaveCSS("background-color", NO_COLOR);
    }
  }
}

/** The shading behind today's column: the computed style of the grid's `::before`. */
function band(page) {
  return page.getByRole("main").evaluate((grid) => {
    const style = getComputedStyle(grid, "::before");
    return {
      background: style.backgroundColor,
      column: style.gridColumnStart,
      height: Number.parseFloat(style.height),
      width: Number.parseFloat(style.width),
    };
  });
}

/** Where the column of `day` starts and ends: from its header to its last slot. */
async function columnOf(page, day) {
  const header = await headerOf(page, day).boundingBox();
  // The slot of the last meal, which has no role of its own.
  const last = await page
    .getByRole("main")
    .locator(`[data-day="${day}"][data-meal="dinner"]`)
    .boundingBox();
  return { height: last.y + last.height - header.y, width: header.width };
}

test("marks today in the current week", async ({ page }) => {
  await page.goto("/");
  await expectWeekLoaded(page, CURRENT_WEEK, 21);

  for (const [index, day] of DAY_IDS.entries()) {
    const { name, number } = dayHeader(page, day);
    await expect(name).toHaveText(DAY_NAMES[index], { useInnerText: true });
    await expect(number).toHaveText(String(21 + index));
  }
  await expectMarkedHeader(page, "wed");
  await expect.poll(async () => (await band(page)).background).toBe(GREEN_BAND);
  const shading = await band(page);
  expect(shading.column).toBe("3");
  const column = await columnOf(page, "wed");
  // The shading covers the whole column, and stays behind its slots, which
  // still take a click.
  expect(shading.height).toBeGreaterThanOrEqual(column.height);
  expect(shading.width).toBeGreaterThanOrEqual(column.width);
  await page.getByRole("button", { name: "Wednesday, Lunch: empty" }).click();
  await expect(page.getByRole("dialog", { name: "Lunch" })).toBeVisible();
});

test("marks no day in another week", async ({ page }) => {
  await page.goto("/");
  await expectWeekLoaded(page, CURRENT_WEEK, 21);
  await expectMarkedHeader(page, "wed");

  await page.getByRole("button", { name: "Next week" }).click();

  await expectWeekLoaded(page, NEXT_WEEK, 28);
  for (const [index, day] of DAY_IDS.entries()) {
    await expect(dayHeader(page, day).number).toHaveText(NEXT_WEEK_NUMBERS[index]);
  }
  await expectMarkedHeader(page, null);
  expect((await band(page)).background).toBe(NO_COLOR);
});

test("moves the today marker when the day changes", async ({ page }) => {
  await page.goto("/");
  await expectWeekLoaded(page, CURRENT_WEEK, 21);
  await expectMarkedHeader(page, "wed");

  await page.clock.setSystemTime(new Date(THURSDAY));
  await switchAway(page);

  await expectMarkedHeader(page, "thu");
  await expect.poll(async () => (await band(page)).column).toBe("4");
  expect((await band(page)).background).toBe(GREEN_BAND);
});

test("selects the new day with Today on a narrow window", async ({ page }) => {
  await page.goto("/");
  await expectWeekLoaded(page, CURRENT_WEEK, 21);
  await page.setViewportSize({ width: 600, height: 720 });
  await expect(dayBarButton(page, "Wednesday, September 23")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.clock.setSystemTime(new Date(THURSDAY));
  await switchAway(page);

  await page.getByRole("button", { name: "Today" }).click();

  await expect(dayBarButton(page, "Thursday, September 24")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(dayBarButton(page, "Wednesday, September 23")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.getByRole("heading", { level: 2, name: "Thursday" })).toBeVisible();
  await expect(page.getByText("September 24, 2026 · Today", { exact: true })).toBeVisible();
  await expect(
    dayBarButton(page, "Thursday, September 24").getByText("T", { exact: true }),
  ).toHaveCSS("color", GREEN);
});

test("shows the next week with Today after the week changes", async ({ page }) => {
  await page.goto("/");
  await expectWeekLoaded(page, CURRENT_WEEK, 21);
  await page.clock.setSystemTime(new Date(NEXT_MONDAY));

  await page.getByRole("button", { name: "Today" }).click();

  await expectWeekLoaded(page, NEXT_WEEK, 28);
  await expect(page).toHaveURL(/#2026-09-28$/);
  await expectMarkedHeader(page, "mon");
});
