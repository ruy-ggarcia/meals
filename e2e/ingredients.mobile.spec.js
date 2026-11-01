// The ingredient catalog on a phone: an editor that fills the screen, rows that
// fit the width, a keyboard with a decimal separator for an amount, and fields
// that don't zoom the page.

import { expect, test } from "./fixtures.js";
import {
  choiceOf,
  conversionOf,
  editorOf,
  giveOnionMeasures,
  measureAmountOf,
  measureNameOf,
  measureRowsOf,
  nameOf,
  removeOf,
  rowOf,
  useMediumOnions,
} from "./ingredients.js";
import { expectInsideViewport, expectNoSidewaysScroll } from "./layout.js";
import { pageLink } from "./navigation.js";
import {
  expectDecimalKeyboard,
  expectFillsScreen,
  expectKeyboardClosed,
  expectKeyboardOpen,
  expectNoZoomOnFocus,
} from "./phone.js";
import {
  createTortilla,
  quantityOf,
  editorOf as recipeEditorOf,
  rowOf as recipeRowOf,
} from "./recipes.js";

/** Taps the link to `name` in the tab bar, and waits until the page has loaded. */
async function openPage(page, name, firstRow) {
  await page.goto("/");
  await pageLink(page, name).tap();
  await expect(firstRow).toBeVisible();
}

/** Opens the catalog from the tab bar. */
function openCatalog(page) {
  return openPage(page, "Ingredients", rowOf(page, "Egg"));
}

/** Taps the row of the ingredient called `name`, and returns its editor. */
async function openIngredient(page, name) {
  await rowOf(page, name).tap();
  const editor = editorOf(page, "Edit ingredient");
  await expect(editor).toBeVisible();
  return editor;
}

/** Checks that each of `locators` is inside the viewport, scrolling the editor to it first. */
async function expectFit(...locators) {
  for (const locator of locators) {
    await locator.scrollIntoViewIfNeeded();
    await expectInsideViewport(locator);
  }
}

test.describe("ingredient editor", () => {
  test("fills the screen below the status bar", async ({ page }) => {
    await openCatalog(page);

    const editor = await openIngredient(page, "Onion");

    await expectFillsScreen(editor);
  });

  test("opens without the keyboard", async ({ page }) => {
    await openCatalog(page);

    await openIngredient(page, "Onion");

    await expectKeyboardClosed(page);
  });

  test("opens the keyboard when you tap Name", async ({ page }) => {
    await openCatalog(page);
    const editor = await openIngredient(page, "Onion");

    await nameOf(editor).tap();

    await expectKeyboardOpen(nameOf(editor));
  });

  test("fits the measure rows and the unit conversion to the width", async ({ app, page }) => {
    await giveOnionMeasures(app);
    await openCatalog(page);
    const onion = await openIngredient(page, "Onion");

    await choiceOf(onion, "pcs").tap();

    const rows = measureRowsOf(onion);
    await expect(rows).toHaveCount(2);
    for (const index of [0, 1]) {
      const row = rows.nth(index);
      await expectFit(removeOf(row), measureNameOf(row), measureAmountOf(row));
    }
    const { from, to } = conversionOf(onion);
    await expectFit(from, to);
    await expectNoSidewaysScroll(page);
  });

  test("fits the conversion row with Saved as measure to the width", async ({ app, page }) => {
    await createTortilla(app);
    await openCatalog(page);
    const egg = await openIngredient(page, "Egg");

    await choiceOf(egg, "g").tap();

    const eggConversion = conversionOf(egg);
    await expect(eggConversion.measure).toBeVisible();
    await expectFit(eggConversion.from, eggConversion.to, eggConversion.measure);
    await expectNoSidewaysScroll(page);
  });

  test("offers digits and a decimal separator for an amount", async ({ app, page }) => {
    await giveOnionMeasures(app);
    await openCatalog(page);
    const editor = await openIngredient(page, "Onion");
    const amount = measureAmountOf(measureRowsOf(editor).first());

    await amount.tap();

    await expectDecimalKeyboard(amount);

    // The fields of the conversion row ask for the same keyboard.
    await choiceOf(editor, "pcs").tap();
    await expectDecimalKeyboard(conversionOf(editor).from);
    await expectDecimalKeyboard(conversionOf(editor).to);
    await conversionOf(editor).from.tap();
    await expectKeyboardOpen(conversionOf(editor).from);
  });

  test("keeps every field at a size that doesn't zoom the page", async ({ app, page }) => {
    await useMediumOnions(app, await giveOnionMeasures(app));
    await createTortilla(app);
    await openCatalog(page);
    const onion = await openIngredient(page, "Onion");
    const row = measureRowsOf(onion).last();

    for (const field of [measureNameOf(row), measureAmountOf(row)]) {
      await field.tap();
      await expectNoZoomOnFocus(field);
    }
    await choiceOf(onion, "pcs").tap();
    for (const field of [conversionOf(onion).from, conversionOf(onion).to]) {
      await field.tap();
      await expectNoZoomOnFocus(field);
    }
    await onion.getByRole("button", { name: "Cancel" }).tap();
    await expect(onion).toBeHidden();
    const egg = await openIngredient(page, "Egg");
    await choiceOf(egg, "g").tap();
    await conversionOf(egg).measure.tap();
    await expectNoZoomOnFocus(conversionOf(egg).measure);

    await egg.getByRole("button", { name: "Cancel" }).tap();
    await expect(egg).toBeHidden();
    await openPage(page, "Recipes", recipeRowOf(page, "Russian salad"));
    await recipeRowOf(page, "Russian salad").tap();
    const recipe = recipeEditorOf(page, "Edit recipe");
    await expect(recipe).toBeVisible();

    await expectNoZoomOnFocus(recipe.getByRole("combobox", { name: "Measure of Onion" }));
  });
});

test.describe("recipe editor", () => {
  test("fits a measure list with a long label to the row", async ({ app, page }) => {
    await useMediumOnions(app, await giveOnionMeasures(app));
    await openPage(page, "Recipes", recipeRowOf(page, "Russian salad"));
    await recipeRowOf(page, "Russian salad").tap();
    const recipe = recipeEditorOf(page, "Edit recipe");
    await expect(recipe).toBeVisible();
    const measures = recipe.getByRole("combobox", { name: "Measure of Onion" });

    await measures.selectOption({ label: "large (250 g)" });

    await expect(measures.locator("option:checked")).toHaveText("large (250 g)");
    await expectFit(
      recipe.getByRole("button", { name: "Remove Onion" }),
      quantityOf(recipe, "Onion"),
      measures,
    );
    // The list comes after the quantity, and neither pushes the other off the row.
    const quantity = await quantityOf(recipe, "Onion").boundingBox();
    const list = await measures.boundingBox();
    expect(list.x, "measure list after the quantity").toBeGreaterThanOrEqual(
      quantity.x + quantity.width,
    );
    await expectNoSidewaysScroll(page);
  });
});
