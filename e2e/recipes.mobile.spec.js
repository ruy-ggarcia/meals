// The recipe editor on a phone: a sheet that fills the screen, a keyboard for
// the name, and a keyboard with a decimal separator for a quantity.

import { expect, test } from "./fixtures.js";
import { expectNoSidewaysScroll } from "./layout.js";
import { pageLink } from "./navigation.js";
import {
  expectDecimalKeyboard,
  expectFillsScreen,
  expectKeyboardOpen,
  expectNoZoomOnFocus,
} from "./phone.js";
import { editorOf, ingredientSearchOf, nameOf, quantityOf } from "./recipes.js";

/** Opens the recipe book from the tab bar, and waits until it has loaded. */
async function openBook(page) {
  await page.goto("/");
  await pageLink(page, "Recipes").tap();
  await expect(page.getByRole("button", { name: "Edit Gnocchi carbonara" })).toBeVisible();
}

/** Taps + in the toolbar, and returns the editor of the new recipe. */
async function openNewRecipe(page) {
  await page.getByRole("button", { name: "New recipe" }).tap();
  const editor = editorOf(page, "New recipe");
  await expect(editor).toBeVisible();
  return editor;
}

test.describe("recipe editor", () => {
  test("fills the screen below the status bar", async ({ page }) => {
    await openBook(page);

    const editor = await openNewRecipe(page);

    await expectFillsScreen(editor);
    await expectNoSidewaysScroll(page);
  });

  test("opens the keyboard on Name without zooming", async ({ page }) => {
    await openBook(page);

    const editor = await openNewRecipe(page);

    await expectKeyboardOpen(nameOf(editor));
    await expectNoZoomOnFocus(nameOf(editor));
  });

  test("offers digits and a decimal separator for a quantity", async ({ page }) => {
    await openBook(page);
    const editor = await openNewRecipe(page);
    await ingredientSearchOf(editor).fill("eg");
    await editor.getByRole("option", { name: "Egg (pcs)" }).tap();
    const quantity = quantityOf(editor, "Egg");

    await quantity.tap();

    await expectDecimalKeyboard(quantity);
  });
});
