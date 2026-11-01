// Saves on a desktop: what a slot shows when its save fails, and the questions
// before you leave a week, open another page, or close the tab with a slot
// that the server hasn't confirmed.

import { CURRENT_WEEK, NEXT_WEEK } from "./catalog.js";
import { expect, test } from "./fixtures.js";

const CURRENT_RANGE = "Sep 21 – 27, 2026";
const NEXT_RANGE = "Sep 28 – Oct 4, 2026";
// The colors of the stylesheet, as the browser computes them.
const RED = /rgb\(215, 0, 21\)/;
const RED_FILL = "rgb(255, 59, 48)";
// The name of the Retry button of a slot whose save failed.
const RETRY = "Couldn't save. Select to retry.";
// The app gives up on a request after 5 seconds, a real timer that the fake
// clock doesn't control. The wait adds the usual 15 seconds of an assertion.
const AFTER_TIMEOUT = { timeout: 20_000 };

function nextWeekButton(page) {
  return page.getByRole("button", { name: "Next week" });
}

function previousWeekButton(page) {
  return page.getByRole("button", { name: "Previous week" });
}

/** The button of the slot of `day` and `meal`, such as `Monday` and `Lunch`. */
function slotButton(page, day, meal) {
  return page.getByRole("button", { name: new RegExp(`^${day}, ${meal}:`) });
}

/** The question before you leave a week with slots that weren't saved, titled `title`. */
function leaveAlert(page, title = "1 meal wasn't saved") {
  return page.getByRole("alertdialog", { name: title });
}

/** The message that replaces the meal plan when a week can't load. */
function loadError(page) {
  return page.getByRole("alert").filter({ hasText: "Couldn't load the meal plan." });
}

/**
 * The header of `day`'s column in the grid, which shows its day of the month.
 * It has no role or name. In the grid, only a header has a day and no meal.
 */
function dayHeader(page, day) {
  return page.getByRole("main").locator(`[data-day="${day}"]:not([data-meal])`);
}

/** Checks that the address and the range show `week`. */
async function expectWeek(page, week, range) {
  await expect(page).toHaveURL(new RegExp(`#${week}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(range);
}

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

test("saves a slot when you change weeks right after Done", async ({ app, page }) => {
  await openApp(page);
  // Holds the save, so the week changes while it's running.
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let saving = false;
  await page.route("**/api/weeks/**", async (route) => {
    if (route.request().method() === "PUT") {
      saving = true;
      await held;
    }
    await route.fallback();
  });
  await addToSlot(page, "Monday", "Lunch", "Lentil soup");
  await expect.poll(() => saving).toBe(true);

  await nextWeekButton(page).click();
  release();

  await expectWeek(page, NEXT_WEEK, NEXT_RANGE);
  await expect(dayHeader(page, "mon")).toHaveText("Mon28");
  expect(await savedItems(app, CURRENT_WEEK, "mon", "lunch")).toEqual([itemOf(app, "Lentil soup")]);

  await previousWeekButton(page).click();

  await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);
  await expect(page.getByRole("button", { name: "Monday, Lunch: Lentil soup × 1" })).toBeVisible();
});

test("marks a slot whose save failed", async ({ network, page }) => {
  await openApp(page);
  await network.down();

  await addToSlot(page, "Monday", "Lunch", "Lentil soup");

  const slot = page.getByRole("button", { name: "Monday, Lunch: Lentil soup × 1" });
  await expect(slot).toBeVisible();
  await expect(page.getByRole("button", { name: RETRY })).toBeVisible();
  await expect(slot).toHaveCSS("box-shadow", RED);
  const failedDot = dayHeader(page, "mon").getByTitle("A meal this day wasn't saved");
  await expect(failedDot).toBeVisible();
  await expect(failedDot).toHaveCSS("background-color", RED_FILL);
  await expect(dayHeader(page, "tue").getByTitle("A meal this day wasn't saved")).toBeHidden();
  await expect(
    page.getByRole("banner").getByRole("button", { name: "1 not saved · Retry" }),
  ).toBeVisible();
});

test("opens the editor on the change that wasn't saved", async ({ app, network, page }) => {
  await app.api.saveSlot(CURRENT_WEEK, "mon", "lunch", [itemOf(app, "Omelette")]);
  await openApp(page);
  await failMondayLunch(network, page);

  await slotButton(page, "Monday", "Lunch").click();

  const editor = page.getByRole("dialog", { name: "Lunch" });
  await expect(editor.getByRole("listitem")).toHaveText([/^Omelette/, /^Lentil soup/]);

  await editor.getByRole("button", { name: "Cancel" }).click();

  await expect(editor).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Monday, Lunch: Omelette × 1, Lentil soup × 1" }),
  ).toBeVisible();
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

test("stays on the week with the change when you choose Stay", async ({ network, page }) => {
  await openApp(page);
  await failMondayLunch(network, page);
  await nextWeekButton(page).click();
  const alert = leaveAlert(page);

  await alert.getByRole("button", { name: "Stay" }).click();

  await expect(alert).toBeHidden();
  await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);
  await expect(page.getByRole("button", { name: "Monday, Lunch: Lentil soup × 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: RETRY })).toBeVisible();
});

test("saves the slot with Retry once the server is back", async ({ app, network, page }) => {
  await openApp(page);
  await failMondayLunch(network, page);
  await network.up();

  await page.getByRole("button", { name: RETRY }).click();

  await expect
    .poll(() => savedItems(app, CURRENT_WEEK, "mon", "lunch"))
    .toEqual([itemOf(app, "Lentil soup")]);
  await expect(page.getByRole("button", { name: RETRY })).toHaveCount(0);

  await nextWeekButton(page).click();

  await expectWeek(page, NEXT_WEEK, NEXT_RANGE);
  await expect(dayHeader(page, "mon")).toHaveText("Mon28");
  await expect(leaveAlert(page)).toBeHidden();
});

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

test("changes weeks when you choose Leave Without Saving", async ({ app, network, page }) => {
  await leaveWithoutSaving(app, network, page);

  await expect(leaveAlert(page)).toBeHidden();
  await expectWeek(page, NEXT_WEEK, NEXT_RANGE);
  await expect(loadError(page)).toBeVisible();
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

test("changes weeks without asking while the meal plan can't load", async ({ network, page }) => {
  await openApp(page);
  await network.down();

  await nextWeekButton(page).click();

  await expectWeek(page, NEXT_WEEK, NEXT_RANGE);
  await expect(loadError(page)).toBeVisible();

  await previousWeekButton(page).click();

  await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);
  await expect(loadError(page)).toBeVisible();
  await expect(leaveAlert(page)).toBeHidden();

  await nextWeekButton(page).click();

  await expectWeek(page, NEXT_WEEK, NEXT_RANGE);
  await expect(loadError(page)).toBeVisible();
  await expect(leaveAlert(page)).toBeHidden();

  await network.up();
  await loadError(page).getByRole("button", { name: "Retry" }).click();

  await expect(loadError(page)).toBeHidden();
  await expectWeek(page, NEXT_WEEK, NEXT_RANGE);
  await expect(dayHeader(page, "mon")).toHaveText("Mon28");
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

test("keeps the focus inside the question and closes it with Escape", async ({
  app,
  network,
  page,
}) => {
  await openApp(page);
  await failMondayLunch(network, page);
  await nextWeekButton(page).click();
  const alert = leaveAlert(page);
  await expect(alert.getByRole("button", { name: "Stay" })).toBeFocused();
  const visited = new Set();

  for (const key of ["Tab", "Shift+Tab"]) {
    for (let press = 1; press <= 5; press += 1) {
      await page.keyboard.press(key);
      const focus = await page.evaluate(() => {
        const active = document.activeElement;
        const alert = document.querySelector("dialog[open]");
        // The browser's own interface can hold the focus: no element has it.
        // On the way around, Firefox and Safari focus the alert itself.
        if (active === null || active === document.body || active === alert) {
          return { outside: false, name: null };
        }
        return { outside: !alert?.contains(active), name: active.textContent.trim() };
      });
      expect(focus.outside, `${key} ${press} focused ${focus.name}`).toBe(false);
      if (focus.name !== null) visited.add(focus.name);
    }
  }
  expect([...visited].sort()).toEqual(["Leave Without Saving", "Stay"]);

  await page.keyboard.press("Escape");

  await expect(alert).toBeHidden();
  await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);
  await expect(page.getByRole("button", { name: RETRY })).toBeVisible();

  await network.up();
  await page.getByRole("button", { name: RETRY }).click();

  await expect
    .poll(() => savedItems(app, CURRENT_WEEK, "mon", "lunch"))
    .toEqual([itemOf(app, "Lentil soup")]);
  await expect(page.getByRole("button", { name: RETRY })).toHaveCount(0);
});

test("gives up on a stalled save and asks before you leave", async ({ app, network, page }) => {
  await openApp(page);
  await network.stall();
  await addToSlot(page, "Monday", "Lunch", "Lentil soup");

  await nextWeekButton(page).click();

  await expect(page.getByRole("button", { name: RETRY })).toBeVisible(AFTER_TIMEOUT);
  const alert = leaveAlert(page);
  await expect(alert).toBeVisible();

  await alert.getByRole("button", { name: "Stay" }).click();

  await expect(alert).toBeHidden();
  await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);

  await network.up();
  await page.getByRole("button", { name: RETRY }).click();

  await expect
    .poll(() => savedItems(app, CURRENT_WEEK, "mon", "lunch"))
    .toEqual([itemOf(app, "Lentil soup")]);
  await expect(page.getByRole("button", { name: RETRY })).toHaveCount(0);
});

/** The link of the sidebar to the page named `name`, such as `Recipes`. */
function pageLink(page, name) {
  return page
    .getByRole("navigation", { name: "Sections" })
    .getByRole("link", { name: new RegExp(`^${name}`) });
}

/** The announcement that the app makes once the server confirmed a slot. */
function savedAnnouncement(page, text) {
  return page.locator("#save-announcement").filter({ hasText: text });
}

/**
 * Dismisses each native question of the browser, and collects the kinds of
 * the questions. `accept()` makes the following answers accept.
 */
function answerQuestions(page) {
  const kinds = [];
  let answer = "dismiss";
  page.on("dialog", async (dialog) => {
    kinds.push(dialog.type());
    await dialog[answer]();
  });
  return {
    kinds,
    accept: () => {
      answer = "accept";
    },
  };
}

/**
 * Holds each save of a slot without an answer until `release()`. `started()`
 * says whether a save reached the route.
 */
async function holdSaves(page) {
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

test("asks before the tab closes with a slot that wasn't saved", async ({ network, page }) => {
  await openApp(page);
  await failMondayLunch(network, page);
  const questions = answerQuestions(page);

  // Runs the page's unload handlers, so the browser asks before it closes.
  await page.close({ runBeforeUnload: true });

  await expect.poll(() => questions.kinds).toEqual(["beforeunload"]);
  expect(page.isClosed()).toBe(false);
  await expect(page.getByRole("button", { name: RETRY })).toBeVisible();

  questions.accept();
  await Promise.all([page.waitForEvent("close"), page.close({ runBeforeUnload: true })]);

  expect(questions.kinds).toEqual(["beforeunload", "beforeunload"]);
});

test("asks before the page reloads while a slot is still saving", async ({ app, page }) => {
  await openApp(page);
  const held = await holdSaves(page);
  await addToSlot(page, "Monday", "Lunch", "Lentil soup");
  await expect.poll(held.started).toBe(true);
  const questions = answerQuestions(page);

  // A reload that the prompt cancels never finishes, so don't wait for it.
  await page.evaluate(() => {
    setTimeout(() => location.reload());
  });

  await expect.poll(() => questions.kinds).toEqual(["beforeunload"]);
  await expect(page.getByRole("button", { name: "Monday, Lunch: Lentil soup × 1" })).toBeVisible();

  held.release();

  await expect(savedAnnouncement(page, "Saved Monday lunch")).toHaveCount(1);
  expect(await savedItems(app, CURRENT_WEEK, "mon", "lunch")).toEqual([itemOf(app, "Lentil soup")]);
});

test("closes the tab without asking when every slot is saved", async ({ page }) => {
  await openApp(page);
  await addToSlot(page, "Monday", "Lunch", "Lentil soup");
  await expect(savedAnnouncement(page, "Saved Monday lunch")).toHaveCount(1);
  const questions = answerQuestions(page);

  await Promise.all([page.waitForEvent("close"), page.close({ runBeforeUnload: true })]);

  expect(questions.kinds).toEqual([]);
});

test("asks before you open another page with a slot that wasn't saved", async ({
  app,
  network,
  page,
}) => {
  await openApp(page);
  await failMondayLunch(network, page);
  await network.up();
  const questions = answerQuestions(page);
  const alert = leaveAlert(page);

  await pageLink(page, "Recipes").click();

  await expect(alert).toBeVisible();
  await expect(alert).toHaveAccessibleDescription(
    "Monday lunch couldn't be saved. If you leave this page, it goes back to its last saved menu.",
  );
  await alert.getByRole("button", { name: "Stay" }).click();

  await expect(alert).toBeHidden();
  await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);
  expect(new URL(page.url()).pathname).toBe("/");
  await expect(page.getByRole("button", { name: RETRY })).toBeVisible();

  await pageLink(page, "Recipes").click();
  await alert.getByRole("button", { name: "Leave Without Saving" }).click();

  await expect(page).toHaveURL(/\/recipes\.html$/);
  expect(questions.kinds).toEqual([]);
  expect(await savedItems(app, CURRENT_WEEK, "mon", "lunch")).toEqual([]);
});

test("opens another page without asking when every slot is saved", async ({ page }) => {
  await openApp(page);
  await addToSlot(page, "Monday", "Lunch", "Lentil soup");
  await expect(savedAnnouncement(page, "Saved Monday lunch")).toHaveCount(1);
  const questions = answerQuestions(page);

  await pageLink(page, "Recipes").click();

  await expect(page).toHaveURL(/\/recipes\.html$/);
  expect(questions.kinds).toEqual([]);
});

test("waits for a running save, then opens another page without asking", async ({ app, page }) => {
  await openApp(page);
  const held = await holdSaves(page);
  await addToSlot(page, "Monday", "Lunch", "Lentil soup");
  await expect.poll(held.started).toBe(true);
  const questions = answerQuestions(page);

  await pageLink(page, "Recipes").click();

  // The week bar is disabled while the app waits for the save.
  await expect(nextWeekButton(page)).toBeDisabled();
  expect(new URL(page.url()).pathname).toBe("/");

  held.release();

  await expect(page).toHaveURL(/\/recipes\.html$/);
  expect(questions.kinds).toEqual([]);
  expect(await savedItems(app, CURRENT_WEEK, "mon", "lunch")).toEqual([itemOf(app, "Lentil soup")]);
});

test("opens another page in a new tab with Ctrl or Cmd without asking", async ({
  network,
  page,
}) => {
  await openApp(page);
  await failMondayLunch(network, page);
  await network.up();
  const questions = answerQuestions(page);

  const [other] = await Promise.all([
    page.context().waitForEvent("page"),
    pageLink(page, "Recipes").click({ modifiers: ["ControlOrMeta"] }),
  ]);

  await expect(other).toHaveURL(/\/recipes\.html$/);
  await expect(leaveAlert(page)).toBeHidden();
  expect(new URL(page.url()).pathname).toBe("/");
  await expect(page.getByRole("button", { name: RETRY })).toBeVisible();
  expect(questions.kinds).toEqual([]);
});
