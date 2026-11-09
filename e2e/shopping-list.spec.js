// The shopping list on a desktop: the dialog on the meal plan that totals the
// ingredients of a week, what it does when you close it or change the week
// behind it, and how it counts measures.

import { CURRENT_RANGE, CURRENT_WEEK, NEXT_RANGE, NEXT_WEEK } from "./catalog.js";
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
import { nextWeekButton, openWeek, RETRY } from "./meal-plan.js";
import { pageLink } from "./navigation.js";
import { createTortilla } from "./recipes.js";

const NOT_INCLUDED = "Not included: these recipes have no ingredients.";

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

/** From the next week, changes the amount of the measure `medium` of `Onion` to `amount`, and shows the next week again. */
async function changeMediumTo(page, amount) {
  await pageLink(page, "Ingredients").click();
  await ingredientRowOf(page, "Onion").click();
  const editor = ingredientEditorOf(page, "Edit ingredient");
  await expect(editor).toBeVisible();
  await measureAmountOf(measureRowsOf(editor).first()).fill(amount);
  await editor.getByRole("button", { name: "Done" }).click();
  await expect(editor).toBeHidden();
  await pageLink(page, "Meal plan").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(CURRENT_RANGE);
  await nextWeekButton(page).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NEXT_RANGE);
}

test.describe("shopping list", () => {
  test("totals the ingredients of the week", async ({ app, page }) => {
    const tortilla = await createTortilla(app);
    await planRedLentilSoup(app);
    await planNextWeek(app, "tue", "lunch", [[tortilla, 2]]);
    await openNextWeek(page);

    const dialog = await openShoppingList(page);

    await expectLines(dialog, ["Egg 3 pcs"]);
  });

  test("lists the recipes without ingredients", async ({ app, page }) => {
    const tortilla = await createTortilla(app);
    await planRedLentilSoup(app);
    await planNextWeek(app, "tue", "lunch", [[tortilla, 2]]);
    await openNextWeek(page);

    const dialog = await openShoppingList(page);

    await expect(notIncludedOf(dialog).getByRole("listitem")).toHaveText([
      "Red lentil soup · Mon lunch",
    ]);
  });

  test("closes with Escape", async ({ app, page }) => {
    await planNextWeek(app, "tue", "lunch", [[await createTortilla(app), 2]]);
    await openNextWeek(page);
    const dialog = await openShoppingList(page);

    await page.keyboard.press("Escape");

    await expect(dialog).toBeHidden();
  });

  test("gives the focus back to its button after Escape", async ({ app, page }) => {
    await planNextWeek(app, "tue", "lunch", [[await createTortilla(app), 2]]);
    await openNextWeek(page);
    await openShoppingList(page);

    await page.keyboard.press("Escape");

    await expect(shoppingButton(page)).toBeFocused();
  });

  test("closes with a click outside", async ({ page }) => {
    await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);
    const dialog = await openShoppingList(page);
    const box = await dialog.boundingBox();
    expect(box.x, "space left of the dialog").toBeGreaterThan(0);

    // Halfway between the window's left edge and the dialog.
    await page.mouse.click(box.x / 2, box.y + box.height / 2);

    await expect(dialog).toBeHidden();
  });

  test("gives the focus back to its button after a click outside", async ({ page }) => {
    await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);
    const dialog = await openShoppingList(page);
    const box = await dialog.boundingBox();
    expect(box.x, "space left of the dialog").toBeGreaterThan(0);

    // Halfway between the window's left edge and the dialog.
    await page.mouse.click(box.x / 2, box.y + box.height / 2);

    await expect(shoppingButton(page)).toBeFocused();
  });

  test("counts a change whose save failed", async ({ app, network, page }) => {
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
  });

  test("puts the breakdown of a total under it", async ({ app, page }) => {
    await planOnionWeek(app);
    await openNextWeek(page);

    const dialog = await openShoppingList(page);

    await expectAbove(dialog.getByText("240 g", { exact: true }), dialog.getByText("(2 pcs)"));
    await expectAbove(
      dialog.getByText("1.1 kg", { exact: true }),
      dialog.getByText("(220 g, 4 medium, 1 large)"),
    );
  });

  test("uses the measure amount that you changed", async ({ app, page }) => {
    await planOnionWeek(app);
    await openNextWeek(page);
    await changeMediumTo(page, "257.5");

    const dialog = await openShoppingList(page);

    // 220 g + 4 × 257.5 g + 250 g = 1500 g.
    await expect(linesOf(dialog).filter({ hasText: "Onion" })).toHaveText(
      "Onion 1.5 kg (220 g, 4 medium, 1 large)",
      { useInnerText: true },
    );
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
});
