// Saves on a phone: the day bar's mark of a slot that wasn't saved, the
// question before you leave its week, and the saves that the app sends again
// when you switch to another app.

import { CURRENT_WEEK } from "./catalog.js";
import { expect, test } from "./fixtures.js";
import { switchAway } from "./page-visibility.js";
import { expectKeyboardClosed } from "./phone.js";

const CURRENT_RANGE = "Sep 21 – 27, 2026";
// The colors of the stylesheet, as the browser computes them.
const GRAY = "rgb(174, 174, 178)";
const RED_FILL = "rgb(255, 59, 48)";
// The name of the Retry button of a slot whose save failed.
const RETRY = "Couldn't save. Select to retry.";
// The app gives up on a request after 5 seconds, a real timer that the fake
// clock doesn't control.
const AFTER_TIMEOUT = { timeout: 10_000 };

/** The day bar button named `name`, such as `Monday, September 21`, and its dot. */
function dayButton(page, name) {
  const button = page.getByRole("navigation", { name: "Day" }).getByRole("button", { name });
  return { button, dot: button.locator("span").last() };
}

/** The button of the slot of `day` and `meal`, such as `Monday` and `Lunch`. */
function slotButton(page, day, meal) {
  return page.getByRole("button", { name: new RegExp(`^${day}, ${meal}:`) });
}

function leaveAlert(page) {
  return page.getByRole("alertdialog", { name: "1 meal wasn't saved" });
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

/** Checks that the alert's center is the center of the viewport. */
async function expectCentered(locator) {
  const box = await locator.boundingBox();
  const { width, height } = locator.page().viewportSize();
  expect(Math.abs(box.x + box.width / 2 - width / 2), "horizontal offset").toBeLessThanOrEqual(1);
  expect(Math.abs(box.y + box.height / 2 - height / 2), "vertical offset").toBeLessThanOrEqual(1);
}

test("marks the day of a slot that wasn't saved and asks before you leave", async ({
  app,
  network,
  page,
}) => {
  await app.api.saveSlot(CURRENT_WEEK, "mon", "lunch", [itemOf(app, "Omelette")]);
  await openApp(page);
  const monday = dayButton(page, "Monday, September 21");
  await network.down();
  await monday.button.tap();
  await addToSlot(page, "Monday", "Lunch", "Lentil soup");
  await expect(page.getByRole("button", { name: RETRY })).toBeVisible();

  await dayButton(page, "Wednesday, September 23").button.tap();

  await expect(monday.dot).toHaveCSS("background-color", RED_FILL);

  await page.getByRole("button", { name: "Next week" }).tap();

  const alert = leaveAlert(page);
  await expect(alert).toBeVisible();
  await expectCentered(alert);
  await expect(alert.getByRole("button", { name: "Stay" })).toBeFocused();
  await expectKeyboardClosed(page);

  // In Chrome, the Back gesture of Android sends a modal dialog the same
  // cancel request that Escape sends.
  await page.keyboard.press("Escape");

  await expect(alert).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`#${CURRENT_WEEK}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(CURRENT_RANGE);
  await expect(retryAll(page)).toBeVisible();

  await page.getByRole("button", { name: "Next week" }).tap();
  await alert.getByRole("button", { name: "Stay" }).tap();

  await expect(alert).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`#${CURRENT_WEEK}$`));

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

test("gives up on a stalled save and asks before you leave", async ({ app, network, page }) => {
  await openApp(page);
  await network.stall();
  await addToSlot(page, "Wednesday", "Lunch", "Lentil soup");
  await switchAway(page);

  await page.getByRole("button", { name: "Next week" }).tap();

  await expect(page.getByRole("button", { name: RETRY })).toBeVisible(AFTER_TIMEOUT);
  const alert = leaveAlert(page);
  await expect(alert).toBeVisible();

  await alert.getByRole("button", { name: "Stay" }).tap();

  await expect(alert).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`#${CURRENT_WEEK}$`));

  await network.up();
  await page.getByRole("button", { name: RETRY }).tap();

  await expect.poll(() => savedItems(app, "wed", "lunch")).toEqual([itemOf(app, "Lentil soup")]);
  await expect(page.getByRole("button", { name: RETRY })).toHaveCount(0);
});
