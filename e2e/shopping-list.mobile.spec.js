// The shopping list on a phone: a sheet that fills the screen and scrolls
// inside, with lines that fit the width.

import { CURRENT_WEEK } from "./catalog.js";
import { expect, test } from "./fixtures.js";
import { giveOnionMeasures, useMediumOnions } from "./ingredients.js";
import { expectInsideViewport, expectNoSidewaysScroll } from "./layout.js";
import { expectFillsScreen } from "./phone.js";

const FILLERS = 29;

/** Adds `FILLERS` ingredients in `g` that sort after `Onion`, and returns them. */
async function createFillers(app) {
  const fillers = [];
  for (let number = 1; number <= FILLERS; number++) {
    fillers.push(
      await app.api.createIngredient({
        name: `Spice ${String(number).padStart(2, "0")}`,
        unit: "g",
      }),
    );
  }
  return fillers;
}

/**
 * Plans a week with many ingredients: `Gnocchi carbonara` holds `Onion` as
 * 220 g and the fillers, and `Russian salad` holds 2 `medium` `Onion`. Both
 * go to Wednesday's lunch, the salad with 2 servings.
 */
async function planManyIngredients(app) {
  const onion = await giveOnionMeasures(app);
  await useMediumOnions(app, onion);
  const fillers = await createFillers(app);
  const gnocchi = app.recipes["Gnocchi carbonara"];
  await app.api.updateRecipe(gnocchi.id, {
    ingredients: [
      { ingredientId: onion.id, quantity: 220 },
      ...fillers.map((filler) => ({ ingredientId: filler.id, quantity: 5 })),
    ],
  });
  await app.api.saveSlot(CURRENT_WEEK, "wed", "lunch", [
    { recipeId: app.recipes["Russian salad"].id, servings: 2 },
    { recipeId: gnocchi.id, servings: 1 },
  ]);
}

/** Opens the shopping list of the week that `planManyIngredients` planned, and returns its sheet. */
async function openShoppingList(page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Wednesday, Lunch:/ })).toBeVisible();

  await page.getByRole("button", { name: "Shopping list" }).tap();

  const dialog = page.getByRole("dialog", { name: "Shopping list" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("shopping list", () => {
  test("fills the screen below the status bar", async ({ app, page }) => {
    await planManyIngredients(app);
    const dialog = await openShoppingList(page);

    await expectFillsScreen(dialog);
    await expectNoSidewaysScroll(page);
  });

  test("scrolls its list inside the sheet", async ({ app, page }) => {
    await planManyIngredients(app);
    const dialog = await openShoppingList(page);
    const list = dialog.getByRole("list", { name: "Ingredients to buy" });
    const lines = list.getByRole("listitem");
    await expect(lines).toHaveCount(FILLERS + 1);
    // The list sits directly in the part of the sheet that scrolls.
    const scroller = list.locator("xpath=..");
    const before = await scroller.evaluate((element) => ({
      scrolls: element.scrollHeight > element.clientHeight,
      // A touch scrolls it only if the sheet lets it scroll.
      touchScrolls: ["auto", "scroll"].includes(getComputedStyle(element).overflowY),
      top: element.scrollTop,
    }));
    expect(before, "the content is taller than the sheet").toEqual({
      scrolls: true,
      touchScrolls: true,
      top: 0,
    });
    const last = lines.last();
    const lastBox = await last.boundingBox();
    expect(
      lastBox.y + lastBox.height,
      `the bottom edge of the last line must be below ${page.viewportSize().height}px, the viewport height, so the list needs to scroll`,
    ).toBeGreaterThan(page.viewportSize().height);

    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });

    await expect(last).toHaveText("Spice 29 5 g", { useInnerText: true });
    await expectInsideViewport(last);
    expect(await scroller.evaluate((element) => element.scrollTop), "scrolled").toBeGreaterThan(0);
    await expectNoSidewaysScroll(page);
  });

  test("keeps the breakdown line inside the sheet width", async ({ app, page }) => {
    await planManyIngredients(app);
    const dialog = await openShoppingList(page);
    const onion = dialog
      .getByRole("list", { name: "Ingredients to buy" })
      .getByRole("listitem")
      .first();

    await expect(onion).toHaveText("Onion 820 g (220 g, 4 medium)", { useInnerText: true });
    await expectInsideViewport(onion);
    const sheet = await dialog.boundingBox();
    const onionBox = await onion.boundingBox();
    expect(onionBox.x, "left edge").toBeGreaterThanOrEqual(sheet.x);
    expect(onionBox.x + onionBox.width, "right edge").toBeLessThanOrEqual(sheet.x + sheet.width);
  });
});
