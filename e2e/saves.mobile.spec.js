// Saves on a phone: the day bar's mark of a slot that wasn't saved, the
// question before you leave its week or open another page, and the saves
// that the app sends again when you switch to another app.

import { CURRENT_RANGE, CURRENT_WEEK } from "./catalog.js";
import { GRAY, RED_FILL } from "./colors.js";
import { expect, test } from "./fixtures.js";
import { leaveAlert, RETRY, slotButton } from "./meal-plan.js";
import { pageLink } from "./navigation.js";
import { switchAway } from "./page-visibility.js";
import { expectKeyboardClosed } from "./phone.js";

/** The day bar button named `name`, such as `Monday, September 21`, and its dot. */
function dayButton(page, name) {
  const button = page.getByRole("navigation", { name: "Day" }).getByRole("button", { name });
  return { button, dot: button.locator("span").last() };
}

/** The save summary above the day bar, which only a phone shows. */
function retryAll(page) {
  return page.getByRole("button", { name: "1 not saved · Retry" }).filter({ visible: true });
}

/** Opens the app on the current week, and waits until the week has loaded. */
async function openApp(page) {
  await page.goto("/");
  await expect(page).toHaveURL(new RegExp(`#${CURRENT_WEEK}$`));
  await expect(slotButton(page, "Wednesday", "Lunch")).toBeVisible();
}

/** Taps the slot of `day` and `meal`, adds `recipe`, and taps Done. */
async function addToSlot(page, day, meal, recipe) {
  await slotButton(page, day, meal).tap();
  const editor = page.getByRole("dialog", { name: meal });
  await editor.getByRole("option", { name: recipe }).tap();
  await editor.getByRole("button", { name: "Done" }).tap();
  await expect(editor).toBeHidden();
}

/** A menu item of one serving of `name`, as the API saves it. */
function itemOf(app, name) {
  return { recipeId: app.recipes[name].id, servings: 1 };
}

/** Reads the items that the server saved for a slot of the current week. */
async function savedItems(app, day, meal) {
  return (await app.api.week(CURRENT_WEEK))[day][meal].items;
}

/** The most that the alert's center may be off the center of the viewport, in pixels. */
const CENTER_TOLERANCE = 1;

/** Checks that the alert's center is the center of the viewport. */
async function expectCentered(locator) {
  const box = await locator.boundingBox();
  const { width, height } = locator.page().viewportSize();
  expect(
    Math.abs(box.x + box.width / 2 - width / 2),
    `${locator}: the center must be within ${CENTER_TOLERANCE}px of the center of the viewport, horizontally`,
  ).toBeLessThanOrEqual(CENTER_TOLERANCE);
  expect(
    Math.abs(box.y + box.height / 2 - height / 2),
    `${locator}: the center must be within ${CENTER_TOLERANCE}px of the center of the viewport, vertically`,
  ).toBeLessThanOrEqual(CENTER_TOLERANCE);
}

/**
 * Gives Monday's lunch an omelette, stops the server, and adds Lentil soup to
 * it. Returns the day button of Monday once the slot shows its Retry.
 */
async function failMondayLunch(app, network, page) {
  await app.api.saveSlot(CURRENT_WEEK, "mon", "lunch", [itemOf(app, "Omelette")]);
  await openApp(page);
  const monday = dayButton(page, "Monday, September 21");
  await network.down();
  await monday.button.tap();
  await addToSlot(page, "Monday", "Lunch", "Lentil soup");
  await expect(page.getByRole("button", { name: RETRY })).toBeVisible();
  return monday;
}

/** Fails Monday's lunch and taps Next week, which asks before it leaves the week. */
async function askBeforeLeaving(app, network, page) {
  await failMondayLunch(app, network, page);
  await page.getByRole("button", { name: "Next week" }).tap();
  return leaveAlert(page);
}

test.describe("slot saves", () => {
  test("turns the day dot red when a save fails", async ({ app, network, page }) => {
    const monday = await failMondayLunch(app, network, page);

    await dayButton(page, "Wednesday, September 23").button.tap();

    await expect(monday.dot).toHaveCSS("background-color", RED_FILL);
  });

  test("centers the question on the screen", async ({ app, network, page }) => {
    const alert = await askBeforeLeaving(app, network, page);

    await expect(alert).toBeVisible();
    await expectCentered(alert);
  });

  test("focuses Stay in the question", async ({ app, network, page }) => {
    const alert = await askBeforeLeaving(app, network, page);

    await expect(alert.getByRole("button", { name: "Stay" })).toBeFocused();
  });

  test("keeps the keyboard closed when the question opens", async ({ app, network, page }) => {
    const alert = await askBeforeLeaving(app, network, page);

    await expect(alert).toBeVisible();
    await expectKeyboardClosed(page);
  });

  // In Chrome, the Back gesture of Android sends a modal dialog the same
  // cancel request that Escape sends.
  test("keeps the week when the Back gesture cancels the question", async ({
    app,
    network,
    page,
  }) => {
    const alert = await askBeforeLeaving(app, network, page);
    await expect(alert).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(alert).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`#${CURRENT_WEEK}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(CURRENT_RANGE);
    await expect(retryAll(page)).toBeVisible();
  });

  test("keeps the week and its change when you tap Stay", async ({ app, network, page }) => {
    const alert = await askBeforeLeaving(app, network, page);

    await alert.getByRole("button", { name: "Stay" }).tap();

    await expect(alert).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`#${CURRENT_WEEK}$`));
    await expect(retryAll(page)).toBeVisible();
  });

  test("turns the dot gray after the toolbar's Retry", async ({ app, network, page }) => {
    const monday = await failMondayLunch(app, network, page);
    await dayButton(page, "Wednesday, September 23").button.tap();
    await network.up();

    await retryAll(page).tap();

    await expect
      .poll(() => savedItems(app, "mon", "lunch"))
      .toEqual([itemOf(app, "Omelette"), itemOf(app, "Lentil soup")]);
    await expect(retryAll(page)).toHaveCount(0);
    await expect(monday.dot).toHaveCSS("background-color", GRAY);
  });

  test("saves a failed slot when you switch away and back", async ({ app, network, page }) => {
    await openApp(page);
    await network.down();
    await addToSlot(page, "Wednesday", "Lunch", "Lentil soup");
    await expect(page.getByRole("button", { name: RETRY })).toBeVisible();
    await network.up();

    await switchAway(page);

    await expect(page.getByRole("button", { name: RETRY })).toBeHidden();
    await expect.poll(() => savedItems(app, "wed", "lunch")).toEqual([itemOf(app, "Lentil soup")]);
    await expect(
      page.getByRole("button", { name: "Wednesday, Lunch: Lentil soup × 1" }),
    ).toBeVisible();
  });

  /** Fails Wednesday's lunch, brings the server back, and taps Recipes in the tab bar. */
  async function openRecipesWithUnsavedLunch(network, page) {
    await openApp(page);
    await network.down();
    await addToSlot(page, "Wednesday", "Lunch", "Lentil soup");
    await expect(page.getByRole("button", { name: RETRY })).toBeVisible();
    await network.up();
    await pageLink(page, "Recipes").tap();
  }

  test("asks before the tab bar opens a page with a slot that wasn't saved", async ({
    network,
    page,
  }) => {
    await openRecipesWithUnsavedLunch(network, page);

    const alert = leaveAlert(page);
    await expect(alert).toBeVisible();
    await expect(alert).toHaveAccessibleDescription(
      "Wednesday lunch couldn't be saved. If you leave this page, it goes back to its last saved menu.",
    );
  });

  test("opens the other page when you choose Leave Without Saving", async ({
    app,
    network,
    page,
  }) => {
    await openRecipesWithUnsavedLunch(network, page);

    await leaveAlert(page).getByRole("button", { name: "Leave Without Saving" }).tap();

    await expect(page).toHaveURL(/\/recipes\.html$/);
    expect(await savedItems(app, "wed", "lunch")).toEqual([]);
  });
});
