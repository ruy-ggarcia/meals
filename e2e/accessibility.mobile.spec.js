// Accessibility on a phone: what screen readers read in the day bar, and
// axe on every page and dialog in both appearances.

import { defineAxeTests } from "./accessibility.js";
import { expect, test } from "./fixtures.js";

const DAYS = [
  "Monday, September 21",
  "Tuesday, September 22",
  "Wednesday, September 23",
  "Thursday, September 24",
  "Friday, September 25",
  "Saturday, September 26",
  "Sunday, September 27",
];

/*
 * What axe still finds, per state and appearance. Each line is a rule, the
 * element that breaks it (its tag and classes), and how many elements break
 * it. A test fails when axe finds something else, and when it no longer
 * finds something listed here, so a fix has to remove its line.
 *
 * - `color-contrast`: in the light appearance, the green name of the current
 *   page in the tab bar (contrast 4.42 on the bar, and 4.5 is the minimum),
 *   and the red `Leave Without Saving` (4.21 on the gray sheet). On the
 *   meal plan and the alert, an iPhone doesn't report them, because axe
 *   can't read the background behind the glass of the bar and the alert.
 * - `label-content-name-mismatch`: the accessible name of a slot (`Monday,
 *   Breakfast: empty`), of a day (`Monday, September 21`), and of a row
 *   (`Edit Egg`) doesn't contain the visible text (`Add`, `M`, `21`, `Egg`,
 *   and the details). A voice control user who says the text they see
 *   doesn't reach the control.
 */
const SIDEBAR = "color-contrast span.page-name ×1";
const MEAL_PLAN = [
  "label-content-name-mismatch button ×7",
  "label-content-name-mismatch button.slot-menu ×5",
];
const KNOWN = {
  "the meal plan": { light: [SIDEBAR, ...MEAL_PLAN], dark: MEAL_PLAN },
  "the alert about an unsaved meal": { light: ["color-contrast button.leave ×1"] },
  "the recipe book": {
    light: [SIDEBAR, "label-content-name-mismatch button.entry ×7"],
    dark: ["label-content-name-mismatch button.entry ×7"],
  },
  "the ingredient catalog": {
    light: [SIDEBAR, "label-content-name-mismatch button.entry ×4"],
    dark: ["label-content-name-mismatch button.entry ×4"],
  },
};

/**
 * What axe finds on the `project`, which is `pixel` or `iphone`, the names of
 * the phone projects in `playwright.config.js`.
 */
function knownFor(project) {
  if (project !== "iphone") return KNOWN;
  return {
    ...KNOWN,
    "the meal plan": { light: MEAL_PLAN, dark: MEAL_PLAN },
    "the alert about an unsaved meal": {},
  };
}

test("reads each day button as its weekday and date", async ({ page }) => {
  await page.goto("/");
  const dayBar = page.getByRole("navigation", { name: "Day" });
  const buttons = dayBar.getByRole("button");
  await expect(buttons).toHaveCount(DAYS.length);

  for (const [index, name] of DAYS.entries()) {
    await expect(buttons.nth(index)).toHaveAccessibleName(name);
  }
  await expect(dayBar.getByRole("button", { name: "Wednesday, September 23" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await dayBar.getByRole("button", { name: "Monday, September 21" }).click();

  await expect(dayBar.getByRole("button", { name: "Monday, September 21" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(dayBar.getByRole("button", { name: "Wednesday, September 23" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

defineAxeTests("a phone", knownFor);
