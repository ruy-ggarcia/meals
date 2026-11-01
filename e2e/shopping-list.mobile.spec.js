// The shopping list on a phone: a sheet that rises from the bottom, fills the
// screen, and scrolls inside, with lines that fit the width.

import { CURRENT_WEEK } from "./catalog.js";
import { expect, test } from "./fixtures.js";
import { giveOnionMeasures, useMediumOnions } from "./ingredients.js";
import { expectInsideViewport, expectNoSidewaysScroll } from "./layout.js";

const FILLERS = 29;

/** The inset of the status bar, which a browser without a notch reports as 0. */
function safeTopOf(page) {
  return page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.paddingTop = "var(--safe-top)";
    document.body.append(probe);
    const inset = Number.parseFloat(getComputedStyle(probe).paddingTop);
    probe.remove();
    return inset;
  });
}

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

test("rises from the bottom, fills the screen, scrolls inside, and keeps a line with a breakdown in the list", async ({
  app,
  page,
}) => {
  await planManyIngredients(app);
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Wednesday, Lunch:/ })).toBeVisible();

  await page.getByRole("button", { name: "Shopping list" }).tap();

  const dialog = page.getByRole("dialog", { name: "Shopping list" });
  await expect(dialog).toBeVisible();
  // The sheet rises into place, so wait for the box it ends with.
  const { width, height } = page.viewportSize();
  await expect
    .poll(async () => {
      const box = await dialog.boundingBox();
      return { x: box.x, width: box.width, bottom: box.y + box.height };
    })
    .toEqual({ x: 0, width, bottom: height });
  // The sheet reaches up to just below the status bar.
  const safeTop = await safeTopOf(page);
  const sheetBox = await dialog.boundingBox();
  expect(sheetBox.y, "top edge").toBeGreaterThanOrEqual(safeTop);
  expect(sheetBox.height, "height").toBeGreaterThanOrEqual(height - safeTop - 20);
  await expectNoSidewaysScroll(page);

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
  expect(lastBox.y + lastBox.height, "the last line starts below the screen").toBeGreaterThan(
    height,
  );

  const onion = lines.first();
  await expect(onion).toHaveText("Onion 820 g (220 g, 4 medium)", { useInnerText: true });
  await expectInsideViewport(onion);
  const sheet = await dialog.boundingBox();
  const onionBox = await onion.boundingBox();
  expect(onionBox.x, "left edge").toBeGreaterThanOrEqual(sheet.x);
  expect(onionBox.x + onionBox.width, "right edge").toBeLessThanOrEqual(sheet.x + sheet.width);

  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });

  await expect(last).toHaveText("Spice 29 5 g", { useInnerText: true });
  await expectInsideViewport(last);
  expect(await scroller.evaluate((element) => element.scrollTop), "scrolled").toBeGreaterThan(0);
  await expectNoSidewaysScroll(page);
});
