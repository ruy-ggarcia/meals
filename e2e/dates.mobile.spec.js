// The dates and the today marker in the day bar of a phone.

import { CURRENT_WEEK } from "./catalog.js";
import { expect, test } from "./fixtures.js";

// The colors of the stylesheet, as the browser computes them.
const BLACK = "rgb(0, 0, 0)";
const GRAY = "rgb(174, 174, 178)";
const GREEN = "rgb(46, 125, 50)";
const NO_COLOR = "rgba(0, 0, 0, 0)";
const PAGE_BACKGROUND = "rgb(242, 242, 247)";
const WHITE = "rgb(255, 255, 255)";

const LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
const DAY_NAMES = [
  "Monday, September 21",
  "Tuesday, September 22",
  "Wednesday, September 23",
  "Thursday, September 24",
  "Friday, September 25",
  "Saturday, September 26",
  "Sunday, September 27",
];

/**
 * The parts of the day bar button named `name`: its letter, its number, and
 * its dot, the only part that screen readers skip.
 */
function dayButton(page, name) {
  const button = page.getByRole("navigation", { name: "Day" }).getByRole("button", { name });
  return {
    button,
    letter: button.getByText(/^[MTWFS]$/),
    number: button.getByText(/^\d+$/),
    dot: button.locator('[aria-hidden="true"]'),
  };
}

test.beforeEach(async ({ app, page }) => {
  const lunch = [{ recipeId: app.recipes["Lentil soup"].id, servings: 1 }];
  await app.api.saveSlot(CURRENT_WEEK, "mon", "lunch", lunch);
  await app.api.saveSlot(CURRENT_WEEK, "fri", "dinner", lunch);
  await page.goto("/");
  await expect(page).toHaveURL(new RegExp(`#${CURRENT_WEEK}$`));
  await expect(dayButton(page, DAY_NAMES[2]).button).toHaveAttribute("aria-pressed", "true");
});

test("marks today in the day bar", async ({ page }) => {
  for (const [index, name] of DAY_NAMES.entries()) {
    const { letter, number, dot } = dayButton(page, name);
    await expect(letter).toHaveText(LETTERS[index]);
    await expect(number).toHaveText(String(21 + index));
    const [letterBox, numberBox] = [await letter.boundingBox(), await number.boundingBox()];
    expect(letterBox.y + letterBox.height).toBeLessThanOrEqual(numberBox.y);
    // Monday and Friday have menus.
    await expect(dot).toHaveCSS("background-color", index === 0 || index === 4 ? GRAY : NO_COLOR);
  }
  const today = dayButton(page, DAY_NAMES[2]);
  await expect(today.letter).toHaveCSS("color", GREEN);
  await expect(today.number).toHaveCSS("color", WHITE);
  await expect(today.number).toHaveCSS("background-color", GREEN);
  await expect(dayButton(page, DAY_NAMES[3]).letter).not.toHaveCSS("color", GREEN);
  await expect(dayButton(page, DAY_NAMES[3]).number).not.toHaveCSS("color", GREEN);
  await expect(dayButton(page, DAY_NAMES[3]).number).toHaveCSS("background-color", NO_COLOR);
  await expect(page.getByRole("heading", { level: 2 })).toHaveText("Wednesday");
  await expect(page.getByText("September 23, 2026 · Today", { exact: true })).toBeVisible();
});

test("marks the selected day apart from today", async ({ page }) => {
  await dayButton(page, DAY_NAMES[4]).button.click();

  const friday = dayButton(page, DAY_NAMES[4]);
  await expect(friday.button).toHaveAttribute("aria-pressed", "true");
  await expect(friday.number).toHaveCSS("background-color", BLACK);
  await expect(friday.number).toHaveCSS("color", PAGE_BACKGROUND);
  const today = dayButton(page, DAY_NAMES[2]);
  await expect(today.letter).toHaveCSS("color", GREEN);
  await expect(today.number).toHaveCSS("color", GREEN);
  await expect(today.number).toHaveCSS("background-color", NO_COLOR);
  await expect(page.getByRole("heading", { level: 2 })).toHaveText("Friday");
  await expect(page.getByText("September 25, 2026", { exact: true })).toBeVisible();
  await expect(page.getByText("· Today")).toBeHidden();
});
