// What the specs of the meal plan share: how to find its parts, how to check
// the week on screen, and how to hold the saves of the slots.

import { expect } from "./fixtures.js";

/** The name of the Retry button of a slot whose save failed. */
export const RETRY = "Couldn't save. Select to retry.";

/**
 * The header of `day`'s column in the grid, which shows its day of the month.
 * It has no role or name. In the grid, only a header has a day and no meal.
 */
export function dayHeader(page, day) {
  return page.getByRole("main").locator(`[data-day="${day}"]:not([data-meal])`);
}

/** The button of the toolbar that shows the next week. */
export function nextWeekButton(page) {
  return page.getByRole("button", { name: "Next week" });
}

/** The button of the toolbar that shows the previous week. */
export function previousWeekButton(page) {
  return page.getByRole("button", { name: "Previous week" });
}

/** The button of the slot of `day` and `meal`, such as `Monday` and `Lunch`. */
export function slotButton(page, day, meal) {
  return page.getByRole("button", { name: new RegExp(`^${day}, ${meal}:`) });
}

/** The question before you leave a week with slots that weren't saved, titled `title`. */
export function leaveAlert(page, title = "1 meal wasn't saved") {
  return page.getByRole("alertdialog", { name: title });
}

/** The message that replaces the meal plan when a week can't load. */
export function loadError(page) {
  return page.getByRole("alert").filter({ hasText: "Couldn't load the meal plan." });
}

/** Checks that the address, the range, and the grid all show `week`, whose range reads `range`. */
export async function expectWeek(page, week, range) {
  await expect(page).toHaveURL(new RegExp(`#${week}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(range);
  await expect(dayHeader(page, "mon")).toHaveText(`Mon${Number(week.slice(8))}`);
}

/** Opens the app on `week`, and waits until the address, the range, and the grid show it. */
export async function openWeek(page, week, range) {
  await page.goto(`/#${week}`);
  await expectWeek(page, week, range);
}

/**
 * Holds each save of a slot without an answer until `release()`. `started()`
 * says whether a save reached the route.
 */
export async function holdSaves(page) {
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let started = false;
  await page.route("**/api/weeks/**", async (route) => {
    if (route.request().method() === "PUT") {
      started = true;
      await held;
    }
    // The page may be gone by now.
    await route.fallback().catch(() => {});
  });
  return { release, started: () => started };
}
