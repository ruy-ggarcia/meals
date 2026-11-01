// The shopping list on a desktop: the dialog on the meal plan that totals the
// ingredients of a week, what it does when you close it or change the week
// behind it, and how it counts measures.

import { CURRENT_WEEK, NEXT_WEEK } from "./catalog.js";
import { expect, test } from "./fixtures.js";
import {
  giveOnionMeasures,
  editorOf as ingredientEditorOf,
  rowOf as ingredientRowOf,
  measureAmountOf,
  measureRowsOf,
  useMediumOnions,
} from "./ingredients.js";
import { expectAbove } from "./layout.js";
import {
  createTortilla,
  ingredientSearchOf,
  quantityOf,
  editorOf as recipeEditorOf,
  rowOf as recipeRowOf,
  savedRecipe,
} from "./recipes.js";

const CURRENT_RANGE = "Sep 21 – 27, 2026";
const NEXT_RANGE = "Sep 28 – Oct 4, 2026";
const SUMMARY = "1 ingredient · from A to Z · totals rounded up";
const NOT_INCLUDED = "Not included: these recipes have no ingredients.";
// The name of the Retry button of a slot whose save failed.
const RETRY = "Couldn't save. Select to retry.";

/** The button in the toolbar that opens the shopping list. */
function shoppingButton(page) {
  return page.getByRole("button", { name: "Shopping list" });
}

/** The shopping list dialog. */
function dialogOf(page) {
  return page.getByRole("dialog", { name: "Shopping list" });
}

/** The lines of the shopping list in `dialog`. */
function linesOf(dialog) {
  return dialog.getByRole("list", { name: "Ingredients to buy" }).getByRole("listitem");
}

/** The section of `dialog` that lists the recipes without ingredients. */
function notIncludedOf(dialog) {
  return dialog.getByRole("region", { name: NOT_INCLUDED });
}

/** Checks the lines of `dialog`, as the screen shows them: the name, the total, and the breakdown. */
async function expectLines(dialog, lines) {
  await expect(linesOf(dialog)).toHaveText(lines, { useInnerText: true });
}

/** Shows `week`, and waits until its range shows. */
async function openWeek(page, week, range) {
  await page.goto(`/#${week}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(range);
}

/** Shows the next week. */
function openNextWeek(page) {
  return openWeek(page, NEXT_WEEK, NEXT_RANGE);
}

/** Opens the shopping list, and returns its dialog. */
async function openShoppingList(page) {
  await shoppingButton(page).click();
  const dialog = dialogOf(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Gives the slot of `day` and `meal` in the next week the menu `items`, a list of `[recipe, servings]`. */
function planNextWeek(app, day, meal, items) {
  return app.api.saveSlot(
    NEXT_WEEK,
    day,
    meal,
    items.map(([recipe, servings]) => ({ recipeId: recipe.id, servings })),
  );
}

/** Renames `Lentil soup` to `Red lentil soup`, and plans one serving of it on Monday's lunch of the next week. */
async function planRedLentilSoup(app) {
  const soup = await app.api.updateRecipe(app.recipes["Lentil soup"].id, {
    name: "Red lentil soup",
  });
  await planNextWeek(app, "mon", "lunch", [[soup, 1]]);
  return soup;
}

/**
 * Leaves the next week with the menus that give the shopping list of
 * onions: `Tortilla` on Tuesday's lunch with 3 servings, and `Russian salad`
 * with 2 servings and `Gnocchi carbonara` with 1 on Wednesday's lunch, next
 * to `Red lentil soup` on Monday's lunch. `Onion` has the measures `medium`
 * and `large`. The recipes hold `Onion` as 220 g in the soup, 2 `medium` in
 * the salad, and 1 `large` in the gnocchi, which also holds 2 `Carrot`, an
 * ingredient in `g` that has the measure `pcs` of 120 g. Returns `Onion`.
 */
async function planOnionWeek(app) {
  const soup = await planRedLentilSoup(app);
  const tortilla = await createTortilla(app);
  const onion = await giveOnionMeasures(app);
  await useMediumOnions(app, onion);
  await app.api.updateRecipe(soup.id, { ingredients: [{ ingredientId: onion.id, quantity: 220 }] });
  const carrot = await app.api.createIngredient({ name: "Carrot", unit: "pcs" });
  const gnocchi = app.recipes["Gnocchi carbonara"];
  // A recipe in pcs makes the change to g ask for the measure that replaces it.
  await app.api.updateRecipe(gnocchi.id, {
    ingredients: [{ ingredientId: carrot.id, quantity: 2 }],
  });
  const converted = await app.api.updateIngredient(carrot.id, {
    unit: "g",
    conversion: { from: 1, to: 120, measureName: "pcs" },
  });
  await app.api.updateRecipe(gnocchi.id, {
    ingredients: [
      { ingredientId: converted.id, measureId: converted.measures[0].id, quantity: 2 },
      { ingredientId: onion.id, measureId: onion.measures[1].id, quantity: 1 },
    ],
  });
  await planNextWeek(app, "tue", "lunch", [[tortilla, 3]]);
  await planNextWeek(app, "wed", "lunch", [
    [app.recipes["Russian salad"], 2],
    [gnocchi, 1],
  ]);
  return onion;
}

/** Opens the page of `name` (`Ingredients` or `Recipes`) from the sidebar. */
async function openFromSidebar(page, name) {
  await page
    .getByRole("navigation", { name: "Sections" })
    .getByRole("link", { name: new RegExp(`^${name}`) })
    .click();
}

/** From the next week, changes the amount of the measure `medium` of `Onion` to `amount`, and shows the next week again. */
async function changeMediumTo(page, amount) {
  await openFromSidebar(page, "Ingredients");
  await ingredientRowOf(page, "Onion").click();
  const editor = ingredientEditorOf(page, "Edit ingredient");
  await expect(editor).toBeVisible();
  await measureAmountOf(measureRowsOf(editor).first()).fill(amount);
  await editor.getByRole("button", { name: "Done" }).click();
  await expect(editor).toBeHidden();
  await page
    .getByRole("navigation", { name: "Sections" })
    .getByRole("link", { name: "Meal plan" })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(CURRENT_RANGE);
  await page.getByRole("button", { name: "Next week" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NEXT_RANGE);
}

test("totals the ingredients of the week and lists the recipes without ingredients", async ({
  app,
  page,
}) => {
  const tortilla = await createTortilla(app);
  await planRedLentilSoup(app);
  await planNextWeek(app, "tue", "lunch", [[tortilla, 2]]);
  await openNextWeek(page);

  const dialog = await openShoppingList(page);

  await expect(dialog.getByRole("heading", { name: "Shopping list" })).toBeVisible();
  await expect(dialog.getByText(NEXT_RANGE, { exact: true })).toBeVisible();
  await expect(dialog.getByText(SUMMARY, { exact: true })).toBeVisible();
  await expectLines(dialog, ["Egg 3 pcs"]);
  const notIncluded = notIncludedOf(dialog);
  await expect(notIncluded).toBeVisible();
  await expect(notIncluded.getByText(NOT_INCLUDED, { exact: true })).toBeVisible();
  await expect(notIncluded.locator("svg")).toBeVisible();
  await expect(notIncluded.getByRole("listitem")).toHaveText(["Red lentil soup · Mon lunch"]);
});

test("closes the shopping list with Escape and gives the focus back to its button", async ({
  app,
  page,
}) => {
  await planNextWeek(app, "tue", "lunch", [[await createTortilla(app), 2]]);
  await openNextWeek(page);
  const dialog = await openShoppingList(page);

  await page.keyboard.press("Escape");

  await expect(dialog).toBeHidden();
  await expect(shoppingButton(page)).toBeFocused();
});

test("tells you to plan meals in a week with no menus, and closes when you click outside", async ({
  page,
}) => {
  await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);

  const dialog = await openShoppingList(page);

  await expect(dialog.getByText("Nothing to buy. Plan some meals first.")).toBeVisible();
  await expect(dialog.getByText(SUMMARY)).toBeHidden();
  await expect(dialog.getByRole("list", { name: "Ingredients to buy" })).toBeHidden();
  await expect(notIncludedOf(dialog)).toBeHidden();
  const box = await dialog.boundingBox();
  expect(box.x, "space left of the dialog").toBeGreaterThan(0);

  // Halfway between the window's left edge and the dialog.
  await page.mouse.click(box.x / 2, box.y + box.height / 2);

  await expect(dialog).toBeHidden();
  await expect(shoppingButton(page)).toBeFocused();
});

test("counts a change whose save failed, and saves it once the server is back", async ({
  app,
  network,
  page,
}) => {
  const tortilla = await createTortilla(app);
  await planNextWeek(app, "tue", "lunch", [[tortilla, 2]]);
  await openNextWeek(page);
  await network.down();
  await page.getByRole("button", { name: /^Tuesday, Lunch:/ }).click();
  const editor = page.getByRole("dialog", { name: "Lunch" });
  const more = editor.getByRole("button", { name: "Increase servings of Tortilla" });
  await more.click();
  await more.click();
  await editor.getByRole("button", { name: "Done" }).click();
  await expect(editor).toBeHidden();
  const retry = page.getByRole("button", { name: RETRY });
  await expect(retry).toBeVisible();

  const dialog = await openShoppingList(page);

  // 1.25 × 3 = 3.75, rounded up.
  await expectLines(dialog, ["Egg 4 pcs"]);

  await dialog.getByRole("button", { name: "Close" }).click();

  await expect(dialog).toBeHidden();
  await network.up();
  await retry.click();

  await expect
    .poll(async () => (await app.api.week(NEXT_WEEK)).tue.lunch.items)
    .toEqual([{ recipeId: tortilla.id, servings: 3 }]);
  await expect(retry).toHaveCount(0);
});

test("stays open on the same week when the address changes", async ({ app, page }) => {
  await planNextWeek(app, "tue", "lunch", [[await createTortilla(app), 2]]);
  await openNextWeek(page);
  const dialog = await openShoppingList(page);

  await page.evaluate((week) => {
    location.hash = `#${week}`;
  }, CURRENT_WEEK);

  await expect(page).toHaveURL(new RegExp(`#${NEXT_WEEK}$`));
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(NEXT_RANGE, { exact: true })).toBeVisible();
  await expectLines(dialog, ["Egg 3 pcs"]);

  await dialog.getByRole("button", { name: "Close" }).click();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NEXT_RANGE);
});

test("saves the onions of two recipes from the recipe book", async ({ app, page }) => {
  await app.api.updateRecipe(app.recipes["Lentil soup"].id, { name: "Red lentil soup" });
  const onion = await giveOnionMeasures(app);
  await page.goto("/recipes.html");
  await recipeRowOf(page, "Red lentil soup").click();
  const soup = recipeEditorOf(page, "Edit recipe");
  await ingredientSearchOf(soup).fill("oni");
  await soup.getByRole("option", { name: "Onion (g)" }).click();
  await quantityOf(soup, "Onion").fill("220");

  await soup.getByRole("button", { name: "Done" }).click();

  await expect(soup).toBeHidden();
  await recipeRowOf(page, "Gnocchi carbonara").click();
  const gnocchi = recipeEditorOf(page, "Edit recipe");
  await ingredientSearchOf(gnocchi).fill("oni");
  await gnocchi.getByRole("option", { name: "Onion (g)" }).click();
  await gnocchi
    .getByRole("combobox", { name: "Measure of Onion" })
    .selectOption({ label: "large (250 g)" });
  await quantityOf(gnocchi, "Onion").fill("1");

  await gnocchi.getByRole("button", { name: "Done" }).click();

  await expect(gnocchi).toBeHidden();
  expect((await savedRecipe(app, "Red lentil soup")).ingredients).toEqual([
    { ingredientId: onion.id, quantity: 220 },
  ]);
  expect((await savedRecipe(app, "Gnocchi carbonara")).ingredients).toEqual([
    { ingredientId: onion.id, measureId: onion.measures[1].id, quantity: 1 },
  ]);
});

test("totals measures with a breakdown and drops the section of recipes without ingredients", async ({
  app,
  page,
}) => {
  await planOnionWeek(app);
  await openNextWeek(page);

  const dialog = await openShoppingList(page);

  await expectLines(dialog, [
    "Carrot 240 g (2 pcs)",
    "Egg 4 pcs",
    "Onion 1.1 kg (220 g, 4 medium, 1 large)",
  ]);
  // The breakdown sits under the total.
  await expectAbove(dialog.getByText("240 g", { exact: true }), dialog.getByText("(2 pcs)"));
  await expectAbove(
    dialog.getByText("1.1 kg", { exact: true }),
    dialog.getByText("(220 g, 4 medium, 1 large)"),
  );
  await expect(notIncludedOf(dialog)).toBeHidden();
});

test("rounds a total in kilograms up to tenths after a measure changes", async ({ app, page }) => {
  await planOnionWeek(app);
  await openNextWeek(page);
  await changeMediumTo(page, "300");

  const dialog = await openShoppingList(page);

  // 220 g + 4 × 300 g + 250 g = 1670 g.
  await expect(linesOf(dialog).filter({ hasText: "Onion" })).toHaveText(
    "Onion 1.7 kg (220 g, 4 medium, 1 large)",
    { useInnerText: true },
  );
});

test("rounds a total in grams up to whole grams after a measure changes", async ({ app, page }) => {
  await planOnionWeek(app);
  await openNextWeek(page);
  await changeMediumTo(page, "132.5");

  let dialog = await openShoppingList(page);

  // 220 g + 4 × 132.5 g + 250 g = 1000 g.
  await expect(linesOf(dialog).filter({ hasText: "Onion" })).toHaveText(
    "Onion 1 kg (220 g, 4 medium, 1 large)",
    { useInnerText: true },
  );

  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await changeMediumTo(page, "132");

  dialog = await openShoppingList(page);

  // 220 g + 4 × 132 g + 250 g = 998 g.
  await expect(linesOf(dialog).filter({ hasText: "Onion" })).toHaveText(
    "Onion 998 g (220 g, 4 medium, 1 large)",
    { useInnerText: true },
  );
});
