// The recipe editor on a phone: a sheet that fills the screen, a keyboard for
// the name, and a keyboard with a decimal separator for a quantity.

import { expect, test } from "./fixtures.js";
import { expectNoSidewaysScroll } from "./layout.js";
import { expectDecimalKeyboard, expectKeyboardOpen, expectNoZoomOnFocus } from "./phone.js";
import { editorOf, ingredientSearchOf, nameOf, quantityOf, savedRecipe } from "./recipes.js";

/** Opens the recipe book from the tab bar, and waits until it has loaded. */
async function openBook(page) {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Sections" })
    .getByRole("link", { name: "Recipes" })
    .tap();
  await expect(page.getByRole("button", { name: "Edit Gnocchi carbonara" })).toBeVisible();
}

/** Taps + in the toolbar, and returns the editor of the new recipe. */
async function openNewRecipe(page) {
  await page.getByRole("button", { name: "New recipe" }).tap();
  const editor = editorOf(page, "New recipe");
  await expect(editor).toBeVisible();
  return editor;
}

test("opens the new recipe editor full screen with the keyboard for the name", async ({ page }) => {
  await openBook(page);

  const editor = await openNewRecipe(page);

  // The editor rises into place, so wait for the box it ends with.
  const { width, height } = page.viewportSize();
  await expect
    .poll(async () => {
      const box = await editor.boundingBox();
      return { x: box.x, width: box.width, bottom: box.y + box.height };
    })
    .toEqual({ x: 0, width, bottom: height });
  const box = await editor.boundingBox();
  expect(box.height, "height").toBeGreaterThanOrEqual(height - 100);
  await expectKeyboardOpen(nameOf(editor));
  await expectNoZoomOnFocus(nameOf(editor));
  await expect.poll(() => page.evaluate(() => window.visualViewport.scale)).toBe(1);
  await expectNoSidewaysScroll(page);
});

test("offers digits and a decimal separator for a quantity and accepts a comma", async ({
  app,
  page,
}) => {
  await openBook(page);
  const editor = await openNewRecipe(page);
  await nameOf(editor).fill("Tortilla");
  await ingredientSearchOf(editor).fill("eg");
  await editor.getByRole("option", { name: "Egg (pcs)" }).tap();
  const quantity = quantityOf(editor, "Egg");

  await quantity.tap();

  await expectDecimalKeyboard(quantity);
  await quantity.fill("0,25");
  await editor.getByRole("button", { name: "Done" }).tap();

  await expect(editor).toBeHidden();
  const saved = await savedRecipe(app, "Tortilla");
  expect(saved.ingredients).toEqual([{ ingredientId: app.ingredients.Egg.id, quantity: 0.25 }]);
});
