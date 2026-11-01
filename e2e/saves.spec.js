// Saves on a desktop: what a slot shows when its save fails, and the question
// before you leave a week with such a slot.

import { CURRENT_RANGE, CURRENT_WEEK, NEXT_RANGE, NEXT_WEEK } from "./catalog.js";
import { RED, RED_FILL } from "./colors.js";
import { expect, test } from "./fixtures.js";
import { expectFocusTrapped } from "./keyboard.js";
import {
  dayHeader,
  expectWeek,
  holdSaves,
  leaveAlert,
  loadError,
  nextWeekButton,
  previousWeekButton,
  RETRY,
  slotButton,
} from "./meal-plan.js";

// The app gives up on a request after 5 seconds, a real timer that the fake
// clock doesn't control. The wait adds the usual 15 seconds of an assertion.
const AFTER_TIMEOUT = { timeout: 20_000 };

/** Opens the app on the current week, and waits until the week has loaded. */
async function openApp(page) {
  await page.goto("/");
  await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);
  await expect(slotButton(page, "Monday", "Lunch")).toBeVisible();
}

/** Opens the slot of `day` and `meal`, adds `recipe`, and clicks Done. */
async function addToSlot(page, day, meal, recipe) {
  await slotButton(page, day, meal).click();
  const editor = page.getByRole("dialog", { name: meal });
  await editor.getByRole("option", { name: recipe }).click();
  await editor.getByRole("button", { name: "Done" }).click();
  await expect(editor).toBeHidden();
}

/** A menu item of one serving of `name`, as the API saves it. */
function itemOf(app, name) {
  return { recipeId: app.recipes[name].id, servings: 1 };
}

/** Reads the items that the server saved for a slot. */
async function savedItems(app, week, day, meal) {
  return (await app.api.week(week))[day][meal].items;
}

/** Stops the server, adds Lentil soup to Monday's lunch, and waits for its Retry. */
async function failMondayLunch(network, page) {
  await network.down();
  await addToSlot(page, "Monday", "Lunch", "Lentil soup");
  await expect(page.getByRole("button", { name: RETRY })).toBeVisible();
}

/**
 * Stops the server, adds Lentil soup to Tuesday's dinner, which has an
 * omelette, and leaves the week without saving it.
 */
async function leaveWithoutSaving(app, network, page) {
  await app.api.saveSlot(CURRENT_WEEK, "tue", "dinner", [itemOf(app, "Omelette")]);
  await openApp(page);
  await network.down();
  await addToSlot(page, "Tuesday", "Dinner", "Lentil soup");
  await expect(page.getByRole("button", { name: RETRY })).toBeVisible();
  await nextWeekButton(page).click();
  await leaveAlert(page).getByRole("button", { name: "Leave Without Saving" }).click();
}

/** The announcement that the app makes once the server confirmed a slot. */
function savedAnnouncement(page, text) {
  return page.locator("#save-announcement").filter({ hasText: text });
}

test.describe("slot saves", () => {
  test("saves a slot when you change weeks right after Done", async ({ app, page }) => {
    await openApp(page);
    // Holds the save, so the week changes while it's running.
    const held = await holdSaves(page);
    await addToSlot(page, "Monday", "Lunch", "Lentil soup");
    await expect.poll(held.started).toBe(true);

    await nextWeekButton(page).click();
    held.release();

    await expectWeek(page, NEXT_WEEK, NEXT_RANGE);
    await expect(dayHeader(page, "mon")).toHaveText("Mon28");
    expect(await savedItems(app, CURRENT_WEEK, "mon", "lunch")).toEqual([
      itemOf(app, "Lentil soup"),
    ]);

    await previousWeekButton(page).click();

    await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);
    await expect(
      page.getByRole("button", { name: "Monday, Lunch: Lentil soup × 1" }),
    ).toBeVisible();
  });

  test("rings a slot whose save failed", async ({ network, page }) => {
    await openApp(page);
    await network.down();

    await addToSlot(page, "Monday", "Lunch", "Lentil soup");

    const slot = page.getByRole("button", { name: "Monday, Lunch: Lentil soup × 1" });
    await expect(slot).toBeVisible();
    await expect(slot).toHaveCSS("box-shadow", RED);
  });

  test("offers Retry for a slot whose save failed", async ({ network, page }) => {
    await openApp(page);
    await network.down();

    await addToSlot(page, "Monday", "Lunch", "Lentil soup");

    await expect(page.getByRole("button", { name: RETRY })).toBeVisible();
  });

  test("shows a red dot on the day of a slot whose save failed", async ({ network, page }) => {
    await openApp(page);
    await network.down();

    await addToSlot(page, "Monday", "Lunch", "Lentil soup");

    const failedDot = dayHeader(page, "mon").getByTitle("A meal this day wasn't saved");
    await expect(failedDot).toBeVisible();
    await expect(failedDot).toHaveCSS("background-color", RED_FILL);
    await expect(dayHeader(page, "tue").getByTitle("A meal this day wasn't saved")).toBeHidden();
  });

  test("asks before you leave a week with a slot that wasn't saved", async ({ network, page }) => {
    await openApp(page);
    await failMondayLunch(network, page);

    await nextWeekButton(page).click();

    const alert = leaveAlert(page);
    await expect(alert).toBeVisible();
    await expect(alert).toHaveAccessibleDescription(
      "Monday lunch couldn't be saved. If you leave this week, it goes back to its last saved menu.",
    );
    await expect(alert.getByRole("button", { name: "Stay" })).toBeFocused();
  });

  test("saves the slot with Retry after the server is back", async ({ app, network, page }) => {
    await openApp(page);
    await failMondayLunch(network, page);
    await network.up();

    await page.getByRole("button", { name: RETRY }).click();

    await expect
      .poll(() => savedItems(app, CURRENT_WEEK, "mon", "lunch"))
      .toEqual([itemOf(app, "Lentil soup")]);
    await expect(page.getByRole("button", { name: RETRY })).toHaveCount(0);
  });

  test("changes weeks without asking after Retry saved the slot", async ({ network, page }) => {
    await openApp(page);
    await failMondayLunch(network, page);
    await network.up();
    await page.getByRole("button", { name: RETRY }).click();
    await expect(savedAnnouncement(page, "Saved Monday lunch")).toHaveCount(1);

    await nextWeekButton(page).click();

    await expectWeek(page, NEXT_WEEK, NEXT_RANGE);
    await expect(dayHeader(page, "mon")).toHaveText("Mon28");
    await expect(leaveAlert(page)).toBeHidden();
  });

  test("keeps the discarded change out of the week you left", async ({ app, network, page }) => {
    await leaveWithoutSaving(app, network, page);
    await expect(loadError(page)).toBeVisible();
    await network.up();

    await loadError(page).getByRole("button", { name: "Retry" }).click();

    await expect(loadError(page)).toBeHidden();
    await expectWeek(page, NEXT_WEEK, NEXT_RANGE);
    await expect(dayHeader(page, "mon")).toHaveText("Mon28");
    await expect(leaveAlert(page)).toBeHidden();

    await previousWeekButton(page).click();

    await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);
    await expect(page.getByRole("button", { name: "Tuesday, Dinner: Omelette × 1" })).toBeVisible();
    expect(await savedItems(app, CURRENT_WEEK, "tue", "dinner")).toEqual([itemOf(app, "Omelette")]);
  });

  test("saves two failed slots with the toolbar's Retry", async ({ app, network, page }) => {
    await openApp(page);
    await network.down();
    await addToSlot(page, "Monday", "Lunch", "Lentil soup");
    await addToSlot(page, "Tuesday", "Dinner", "Omelette");
    const retryAll = page.getByRole("banner").getByRole("button", { name: "2 not saved · Retry" });
    await expect(retryAll).toBeVisible();
    await network.up();

    await retryAll.click();

    await expect(
      page.getByRole("banner").getByText("All changes saved", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: RETRY })).toHaveCount(0);
    const week = await app.api.week(CURRENT_WEEK);
    expect(week.mon.lunch.items).toEqual([itemOf(app, "Lentil soup")]);
    expect(week.tue.dinner.items).toEqual([itemOf(app, "Omelette")]);
  });

  test("keeps the focus inside the question", async ({ network, page }) => {
    await openApp(page);
    await failMondayLunch(network, page);
    await nextWeekButton(page).click();
    const alert = leaveAlert(page);
    await expect(alert.getByRole("button", { name: "Stay" })).toBeFocused();

    await expectFocusTrapped(page, alert, {
      names: ["Leave Without Saving", "Stay"],
      presses: 5,
      exact: true,
    });
  });

  test("keeps the week when Escape closes the question", async ({ network, page }) => {
    await openApp(page);
    await failMondayLunch(network, page);
    await nextWeekButton(page).click();
    const alert = leaveAlert(page);
    await expect(alert).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(alert).toBeHidden();
    await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);
    await expect(page.getByRole("button", { name: RETRY })).toBeVisible();
  });

  test.describe("stalled save", () => {
    // The app gives up on a save after 5 seconds of real time.
    test.use({ requestTimeout: "real" });

    test("asks before you leave after a save stalls", async ({ network, page }) => {
      await openApp(page);
      await network.stall();
      await addToSlot(page, "Monday", "Lunch", "Lentil soup");

      await nextWeekButton(page).click();

      await expect(page.getByRole("button", { name: RETRY })).toBeVisible(AFTER_TIMEOUT);
      await expect(leaveAlert(page)).toBeVisible();
    });
  });
});
