// Accessibility on a desktop: the dark appearance, the keyboard, and what
// screen readers read. Real screen readers are out of scope, so the tests
// check what they read: roles, accessible names and descriptions, and the
// text of the live regions. axe checks every page and dialog in both
// appearances.

import { defineAxeTests, plan, STATES } from "./accessibility.js";
import { CURRENT_WEEK } from "./catalog.js";
import { expect, test } from "./fixtures.js";
import { editorOf, searchOf } from "./slot-editor.js";

const CURRENT_RANGE = "Sep 21 – 27, 2026";
const NEXT_RANGE = "Sep 28 – Oct 4, 2026";
// The weeks after the current one: the range, and the day of the month of Monday.
const WEEKS_AFTER = [
  ["Sep 28 – Oct 4, 2026", "Mon28"],
  ["Oct 5 – 11, 2026", "Mon5"],
  ["Oct 12 – 18, 2026", "Mon12"],
];
// The most Tab presses that a test spends to reach a control.
const MOST_TABS = 30;
// The colors of the stylesheet, as the browser computes them.
const PAGE = { light: "rgb(242, 242, 247)", dark: "rgb(0, 0, 0)" };
const SHEET = { light: "rgba(242, 242, 247, 0.94)", dark: "rgba(28, 28, 30, 0.94)" };
const TEXT = { light: "rgb(0, 0, 0)", dark: "rgb(255, 255, 255)" };

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
 *   text they see doesn't reach the control.
 */
const SLOTS = "label-content-name-mismatch button.slot-menu ×34";
const SIDEBAR = "color-contrast span.page-name ×1";
const KNOWN = {
  "the meal plan": { light: [SIDEBAR, SLOTS], dark: [SLOTS] },
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

/** The slot of `day` and `meal`, such as `Monday` and `Lunch`, whose menu is `menu`. */
function slotOf(page, day, meal, menu) {
  return page.getByRole("button", { name: `${day}, ${meal}: ${menu}`, exact: true });
}

/** The live region that says when a slot saves. */
function announcementOf(page) {
  return page.locator("#save-announcement");
}

/** The range of the week, a heading that screen readers read when it changes. */
function rangeOf(page) {
  return page.getByRole("heading", { level: 1 });
}

/** Presses Tab until `target` has the focus. */
async function tabTo(page, target) {
  for (let presses = 0; presses < MOST_TABS; presses++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`${MOST_TABS} Tab presses didn't reach the control`);
}

/** Gives Monday's lunch 2 servings of Green salad, and opens the meal plan. */
async function openWithSalad(app, page) {
  await app.api.saveSlot(CURRENT_WEEK, "mon", "lunch", [
    { recipeId: app.recipes["Green salad"].id, servings: 2 },
  ]);
  await page.goto("/");
  await expect(slotOf(page, "Monday", "Lunch", "Green salad × 2")).toBeVisible();
}

test("shows the next week on each Enter on Next week, and the focus stays there", async ({
  page,
}) => {
  await page.goto("/");
  await expect(rangeOf(page)).toHaveText(CURRENT_RANGE);
  const next = page.getByRole("button", { name: "Next week" });
  await tabTo(page, next);

  for (const [range, monday] of WEEKS_AFTER) {
    await page.keyboard.press("Enter");

    await expect(rangeOf(page)).toHaveText(range);
    // The grid shows the week once it has loaded. Until then, the buttons
    // ignore a press, and a disabled button keeps its focus for a moment.
    await expect(page.getByRole("main").locator('.day-header[data-day="mon"]')).toHaveText(monday);
    await expect(next).toBeFocused();
  }
});

test("keeps the focus on Retry when the load fails again", async ({ network, page }) => {
  await page.goto("/");
  await expect(rangeOf(page)).toHaveText(CURRENT_RANGE);
  await network.down();
  const next = page.getByRole("button", { name: "Next week" });
  await tabTo(page, next);

  await page.keyboard.press("Enter");

  const error = page.getByRole("alert").filter({ hasText: "Couldn't load the meal plan." });
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

test("names the week buttons and announces the new range", async ({ page }) => {
  await page.goto("/");
  const range = rangeOf(page);
  await expect(range).toHaveText(CURRENT_RANGE);
  await expect(range).toHaveAttribute("aria-live", "polite");
  const previous = page.getByRole("button", { name: "Previous week", exact: true });
  const next = page.getByRole("button", { name: "Next week", exact: true });
  const today = page.getByRole("button", { name: "Today", exact: true });
  await expect(previous).toHaveAccessibleName("Previous week");
  await expect(next).toHaveAccessibleName("Next week");
  await expect(today).toHaveAccessibleName("Today");

  await next.click();

  await expect(range).toHaveText(NEXT_RANGE);

  await previous.click();

  await expect(range).toHaveText(CURRENT_RANGE);

  await next.click();
  await expect(range).toHaveText(NEXT_RANGE);
  await today.click();

  await expect(range).toHaveText(CURRENT_RANGE);
});

test("reads a slot with its day, meal, and menu", async ({ app, page }) => {
  await openWithSalad(app, page);

  await expect(slotOf(page, "Monday", "Lunch", "Green salad × 2")).toHaveAccessibleName(
    "Monday, Lunch: Green salad × 2",
  );
  await expect(slotOf(page, "Monday", "Dinner", "empty")).toHaveAccessibleName(
    "Monday, Dinner: empty",
  );
  await expect(slotOf(page, "Tuesday", "Lunch", "empty")).toHaveAccessibleName(
    "Tuesday, Lunch: empty",
  );
});

test("announces the title of the editor of an empty slot", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Monday, Lunch: empty", exact: true }).click();

  await expect(editorOf(page)).toHaveAccessibleName("Lunch");
});

test("announces the editor, the stepper buttons, and the servings when they change", async ({
  app,
  page,
}) => {
  await openWithSalad(app, page);

  await slotOf(page, "Monday", "Lunch", "Green salad × 2").click();

  const editor = editorOf(page);
  await expect(editor).toHaveAccessibleName("Lunch");
  await expect(editor.getByRole("heading", { name: "Lunch" })).toBeVisible();
  const more = editor.getByRole("button", { name: "Increase servings of Green salad" });
  const less = editor.getByRole("button", { name: "Decrease servings of Green salad" });
  await expect(more).toHaveAccessibleName("Increase servings of Green salad");
  await expect(less).toHaveAccessibleName("Decrease servings of Green salad");
  const servings = editor.getByRole("listitem").getByText(/^\d+(\.5)?$/);
  await expect(servings).toHaveText("2");
  await expect(servings).toHaveAttribute("aria-live", "polite");

  await more.click();

  await expect(servings).toHaveText("2.5");

  await less.click();
  await less.click();

  await expect(servings).toHaveText("1.5");
});

test("announces the highlighted recipe while you move through the list", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Monday, Lunch: empty", exact: true }).click();
  const editor = editorOf(page);
  const search = searchOf(editor);
  await search.fill("salad");
  const green = editor.getByRole("option", { name: "Green salad" });
  const russian = editor.getByRole("option", { name: "Russian salad" });
  await expect(search).toHaveAttribute(
    "aria-activedescendant",
    (await green.getAttribute("id")) ?? "",
  );

  await search.press("ArrowDown");

  const highlighted = await russian.getAttribute("id");
  expect(highlighted, "the option has an ID").toBeTruthy();
  await expect(search).toHaveAttribute("aria-activedescendant", highlighted);
  await expect(russian).toHaveAttribute("aria-selected", "true");
  await expect(russian).toHaveAccessibleName("Russian salad");
  await expect(green).toHaveAttribute("aria-selected", "false");
});

test("announces that a slot is saving, saved, and then not saved", async ({
  app,
  network,
  page,
}) => {
  await page.goto("/");
  await expect(slotOf(page, "Monday", "Lunch", "empty")).toBeVisible();
  const announcement = announcementOf(page);
  await expect(announcement).toHaveAttribute("aria-live", "polite");
  // Holds the save, so the page stays in the saving state.
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/weeks/**", async (route) => {
    if (route.request().method() === "PUT") await held;
    await route.fallback();
  });

  await slotOf(page, "Monday", "Lunch", "empty").click();
  let editor = editorOf(page);
  await editor.getByRole("option", { name: "Lentil soup" }).click();
  await editor.getByRole("button", { name: "Done" }).click();

  await expect(announcement).toHaveText("Saving Monday lunch");

  release();

  await expect(announcement).toHaveText("Saved Monday lunch");
  expect((await app.api.week(CURRENT_WEEK)).mon.lunch.items).toHaveLength(1);

  await network.down();
  await slotOf(page, "Monday", "Lunch", "Lentil soup × 1").click();
  editor = editorOf(page);
  await editor.getByRole("option", { name: "Omelette" }).click();
  await editor.getByRole("button", { name: "Done" }).click();

  await expect(announcement).toHaveText("Couldn't save Monday lunch");
});

test("reads a recipe as Edit and its name, followed by its ingredients", async ({ app, page }) => {
  await app.api.updateRecipe(app.recipes["Russian salad"].id, {
    ingredients: [
      { ingredientId: app.ingredients.Egg.id, quantity: 1 },
      { ingredientId: app.ingredients.Onion.id, quantity: 100 },
    ],
  });
  await page.goto("/recipes.html");

  const omelette = page.getByRole("button", { name: "Edit Omelette", exact: true });
  await expect(omelette).toHaveAccessibleName("Edit Omelette");
  await expect(omelette).toHaveAccessibleDescription("No ingredients · not in shopping list");
  const salad = page.getByRole("button", { name: "Edit Russian salad", exact: true });
  await expect(salad).toHaveAccessibleName("Edit Russian salad");
  await expect(salad).toHaveAccessibleDescription("Egg, Onion");
});

// Each page and dialog changes its background and text color with the system.
test.describe("dark appearance", () => {
  for (const state of STATES) {
    test(`turns ${state.title} dark and light again with the system`, async ({
      app,
      network,
      page,
    }) => {
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
  }
});

defineAxeTests("a desktop", () => KNOWN);
