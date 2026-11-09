// The dates of the week, the today marker, and what happens to it when the
// day changes.

import { CURRENT_RANGE, CURRENT_WEEK, NEXT_RANGE, NEXT_WEEK } from "./catalog.js";
import { GREEN, GREEN_BAND, NO_COLOR, WHITE } from "./colors.js";
import { expect, test } from "./fixtures.js";
import { dayHeader, expectWeek } from "./meal-plan.js";
import { switchAway } from "./page-visibility.js";

// The grid column of Wednesday: the time column comes first, and Monday is the
// second.
const WEDNESDAY_COLUMN = "3";

const DAY_IDS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const THURSDAY = "2026-09-24T10:00:00+02:00";
const NEXT_MONDAY = "2026-09-28T10:00:00+02:00";

/** The name and the number of `day`'s header in the grid, such as `MON` and `21`. */
function headerPartsOf(page, day) {
  const header = dayHeader(page, day);
  return { name: header.locator("span").first(), number: header.locator("span").nth(1) };
}

function dayBarButton(page, name) {
  return page.getByRole("navigation", { name: "Day" }).getByRole("button", { name });
}

/** Checks that only `today` has the marked name and number in the header, or no day when null. */
async function expectMarkedHeader(page, today) {
  for (const day of DAY_IDS) {
    const { name, number } = headerPartsOf(page, day);
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
  const header = await dayHeader(page, day).boundingBox();
  // The slot of the last meal, which has no role of its own.
  const last = await page
    .getByRole("main")
    .locator(`[data-day="${day}"][data-meal="dinner"]`)
    .boundingBox();
  return { height: last.y + last.height - header.y, width: header.width };
}

test.describe("today marker", () => {
  test("marks the name and the number of today in the header", async ({ page }) => {
    await page.goto("/");
    await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);

    // The stylesheet writes the names in capitals.
    await expect(headerPartsOf(page, "wed").name).toHaveText("WED", { useInnerText: true });
    await expectMarkedHeader(page, "wed");
  });

  test("shades the whole column of today", async ({ page }) => {
    await page.goto("/");
    await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);

    await expect.poll(async () => (await band(page)).background).toBe(GREEN_BAND);
    const shading = await band(page);
    expect(shading.column, "the shading starts in Wednesday's column, after the time column").toBe(
      WEDNESDAY_COLUMN,
    );
    const column = await columnOf(page, "wed");
    expect(
      shading.height,
      `the shading must be at least ${column.height}px tall, from the top of the header to the bottom of the last slot`,
    ).toBeGreaterThanOrEqual(column.height);
    expect(
      shading.width,
      `the shading must be at least ${column.width}px wide, the width of the column`,
    ).toBeGreaterThanOrEqual(column.width);
  });

  test("keeps the slots of today clickable through the shading", async ({ page }) => {
    await page.goto("/");
    await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);
    const slot = page.getByRole("button", { name: "Wednesday, Lunch: empty" });

    // The element at the center of the slot, or null if it's the slot or one
    // of its parts. A shading in front of the slot would be the answer.
    const covering = await slot.evaluate((element) => {
      element.scrollIntoView({ block: "center" });
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      if (hit !== null && element.contains(hit)) return null;
      return hit === null ? "nothing" : `${hit.tagName.toLowerCase()}.${hit.className}`;
    });
    expect(covering, "the element at the center of the slot, which must be the slot").toBeNull();

    await slot.click();

    await expect(page.getByRole("dialog", { name: "Lunch" })).toBeVisible();
  });

  test("marks no day in another week", async ({ page }) => {
    await page.goto("/");
    await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);
    await expectMarkedHeader(page, "wed");

    await page.getByRole("button", { name: "Next week" }).click();

    await expectWeek(page, NEXT_WEEK, NEXT_RANGE);
    await expectMarkedHeader(page, null);
    expect((await band(page)).background).toBe(NO_COLOR);
  });

  test("marks the new day when the date changes", async ({ page }) => {
    await page.goto("/");
    await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);
    await expectMarkedHeader(page, "wed");

    await page.clock.setSystemTime(new Date(THURSDAY));
    await switchAway(page);

    await expectMarkedHeader(page, "thu");
    await expect.poll(async () => (await band(page)).column).toBe("4");
    expect((await band(page)).background).toBe(GREEN_BAND);
  });
});

test.describe("day bar", () => {
  test("selects the new day with Today when the window is narrow", async ({ page }) => {
    await page.goto("/");
    await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);
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
});

test.describe("week navigation", () => {
  test("goes to the new current week with Today after the week ends", async ({ page }) => {
    await page.goto("/");
    await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);
    await page.clock.setSystemTime(new Date(NEXT_MONDAY));

    await page.getByRole("button", { name: "Today" }).click();

    await expectWeek(page, NEXT_WEEK, NEXT_RANGE);
    await expect(page).toHaveURL(/#2026-09-28$/);
    await expectMarkedHeader(page, "mon");
  });
});
