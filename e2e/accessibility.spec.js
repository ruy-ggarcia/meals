// Accessibility on a desktop: the dark appearance, the keyboard, and what
// screen readers read. Real screen readers are out of scope, so the tests
// check what a browser computes for them, such as the accessible description
// of a row, and the text that changes in the live regions. axe checks every
// page and dialog in both appearances.

import { defineAxeTests, plan, STATES } from "./accessibility.js";
import { CURRENT_RANGE, CURRENT_WEEK, NEXT_RANGE } from "./catalog.js";
import { PAGE, SHEET, TEXT } from "./colors.js";
import { expect, test } from "./fixtures.js";
import { tabTo } from "./keyboard.js";
import { dayHeader, loadError, nextWeekButton } from "./meal-plan.js";
import { editorOf } from "./slot-editor.js";

// The weeks after the current one: the range, and the day of the month of Monday.
const WEEKS_AFTER = [
  ["Sep 28 – Oct 4, 2026", "Mon28"],
  ["Oct 5 – 11, 2026", "Mon5"],
  ["Oct 12 – 18, 2026", "Mon12"],
];

/*
 * What axe still finds, per state and appearance. Each line is a rule, the
 * element that breaks it (its tag and classes), and how many elements break
 * it. A test fails when axe finds something else, and when it no longer
 * finds something listed here, so a fix has to remove its line.
 *
 * - `color-contrast`: in the light appearance, the green name of the current
 *   page in the sidebar (contrast 4.2 on a green tint, and 4.5 is the
 *   minimum), and the red `Leave Without Saving` (4.21 on the gray sheet).
 * - `label-content-name-mismatch`: the accessible name of a slot (`Monday,
 *   Breakfast: empty`) and of a row (`Edit Egg`) doesn't contain the visible
 *   text (`Add`, `Egg`, and the details). A voice control user who says the
 *   text they see doesn't reach the control. The meal plan has 35 slots,
 *   7 days of 5 meals. Only Tuesday's dinner passes: its one recipe with 1
 *   serving reads the same in its name and on screen.
 */
const SLOTS = "label-content-name-mismatch button.slot-menu ×34";
const SIDEBAR = "color-contrast span.page-name ×1";
const KNOWN = {
  "meal plan": { light: [SIDEBAR, SLOTS], dark: [SLOTS] },
  "alert about an unsaved meal": { light: ["color-contrast button.leave ×1"] },
  "recipe book": {
    light: [SIDEBAR, "label-content-name-mismatch button.entry ×7"],
    dark: ["label-content-name-mismatch button.entry ×7"],
  },
  "ingredient catalog": {
    light: [SIDEBAR, "label-content-name-mismatch button.entry ×4"],
    dark: ["label-content-name-mismatch button.entry ×4"],
  },
};

/** The slot of `day` and `meal`, such as `Monday` and `Lunch`, whose menu is `menu`. */
function slotOf(page, day, meal, menu) {
  return page.getByRole("button", { name: `${day}, ${meal}: ${menu}`, exact: true });
}

/** The range of the week, a heading that screen readers read when it changes. */
function rangeOf(page) {
  return page.getByRole("heading", { level: 1 });
}

/** Gives Monday's lunch 2 servings of Green salad, and opens the meal plan. */
async function openWithSalad(app, page) {
  await app.api.saveSlot(CURRENT_WEEK, "mon", "lunch", [
    { recipeId: app.recipes["Green salad"].id, servings: 2 },
  ]);
  await page.goto("/");
  await expect(slotOf(page, "Monday", "Lunch", "Green salad × 2")).toBeVisible();
}

test.describe("week navigation", () => {
  test("keeps the focus on Next week while Enter steps through the weeks", async ({ page }) => {
    await page.goto("/");
    await expect(rangeOf(page)).toHaveText(CURRENT_RANGE);
    const next = nextWeekButton(page);
    await tabTo(page, next);

    for (const [range, monday] of WEEKS_AFTER) {
      await page.keyboard.press("Enter");

      await expect(rangeOf(page)).toHaveText(range);
      // The grid shows the week once it has loaded. Until then, the buttons
      // ignore a press, and a disabled button keeps its focus for a moment.
      await expect(dayHeader(page, "mon")).toHaveText(monday);
      await expect(next).toBeFocused();
    }
  });

  test("keeps the focus on Retry when the retried load fails again", async ({ network, page }) => {
    await page.goto("/");
    await expect(rangeOf(page)).toHaveText(CURRENT_RANGE);
    await network.down();
    const next = nextWeekButton(page);
    await tabTo(page, next);

    await page.keyboard.press("Enter");

    const error = loadError(page);
    await expect(error).toBeVisible();
    const retry = error.getByRole("button", { name: "Retry" });
    await tabTo(page, retry);
    const failed = page.waitForEvent("requestfailed", (request) =>
      request.url().includes("/api/weeks/"),
    );
    await page.keyboard.press("Enter");
    await failed;

    await expect(error).toBeVisible();
    await expect(retry).toBeFocused();
  });

  test("changes the range heading after Previous week, Next week, and Today", async ({ page }) => {
    await page.goto("/");
    const range = rangeOf(page);
    await expect(range).toHaveText(CURRENT_RANGE);
    const previous = page.getByRole("button", { name: "Previous week", exact: true });
    const next = page.getByRole("button", { name: "Next week", exact: true });
    const today = page.getByRole("button", { name: "Today", exact: true });

    await next.click();

    await expect(range).toHaveText(NEXT_RANGE);

    await previous.click();

    await expect(range).toHaveText(CURRENT_RANGE);

    await next.click();
    await expect(range).toHaveText(NEXT_RANGE);
    await today.click();

    await expect(range).toHaveText(CURRENT_RANGE);
  });
});

test.describe("slot editor", () => {
  test("changes the servings with the stepper buttons", async ({ app, page }) => {
    await openWithSalad(app, page);

    await slotOf(page, "Monday", "Lunch", "Green salad × 2").click();

    const editor = editorOf(page);
    const more = editor.getByRole("button", { name: "Increase servings of Green salad" });
    const less = editor.getByRole("button", { name: "Decrease servings of Green salad" });
    const servings = editor.getByRole("listitem").getByText(/^\d+(\.5)?$/);
    await expect(servings).toHaveText("2");

    await more.click();

    await expect(servings).toHaveText("2.5");

    await less.click();
    await less.click();

    await expect(servings).toHaveText("1.5");
  });
});

test.describe("recipe book", () => {
  test("gives each recipe an accessible description of its ingredients", async ({ app, page }) => {
    await app.api.updateRecipe(app.recipes["Russian salad"].id, {
      ingredients: [
        { ingredientId: app.ingredients.Egg.id, quantity: 1 },
        { ingredientId: app.ingredients.Onion.id, quantity: 100 },
      ],
    });
    await page.goto("/recipes.html");

    const omelette = page.getByRole("button", { name: "Edit Omelette", exact: true });
    await expect(omelette).toHaveAccessibleDescription("No ingredients · not in shopping list");
    const salad = page.getByRole("button", { name: "Edit Russian salad", exact: true });
    await expect(salad).toHaveAccessibleDescription("Egg, Onion");
  });
});

// Each page and dialog changes its background and text color with the system.
test.describe("appearance", () => {
  for (const state of STATES) {
    test.describe(state.title, () => {
      test("switches between light and dark with the system", async ({ app, network, page }) => {
        await plan(app);
        await page.emulateMedia({ colorScheme: "light" });
        await state.open({ app, network, page });
        const surface = state.role ? page.getByRole(state.role) : page.locator("body");
        const background = state.role ? SHEET : PAGE;
        await expect(surface).toHaveCSS("background-color", background.light);
        await expect(surface).toHaveCSS("color", TEXT.light);

        await page.emulateMedia({ colorScheme: "dark" });

        await expect(surface).toHaveCSS("background-color", background.dark);
        await expect(surface).toHaveCSS("color", TEXT.dark);

        await page.emulateMedia({ colorScheme: "light" });

        await expect(surface).toHaveCSS("background-color", background.light);
        await expect(surface).toHaveCSS("color", TEXT.light);
      });
    });
  }
});

defineAxeTests(() => KNOWN);
