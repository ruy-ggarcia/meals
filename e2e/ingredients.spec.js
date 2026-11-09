// The ingredient catalog on a desktop: the list, the editor, units, measures,
// unit changes with conversions, measures in recipes, and what the page does
// when another tab changes an ingredient.

import { expect, test } from "./fixtures.js";
import {
  addMeasureOf,
  choiceOf,
  conversionOf,
  giveOnionMeasures,
  measureAmountOf,
  measureNameOf,
  measureRowsOf,
  nameOf,
  openArchived,
  openCatalog,
  openIngredient,
  openNewIngredient,
  removeOf,
  rowOf,
  savedIngredient,
  unitOf,
  useMediumOnions,
} from "./ingredients.js";
import { tabTo } from "./keyboard.js";
import { pageLink } from "./navigation.js";
import { ingredientSearchOf, openBook, openRecipe, quantityOf, savedRecipe } from "./recipes.js";

/** The heading of the page. */
function titleOf(page) {
  return page.getByRole("heading", { level: 1 });
}

/** The label of the choice `unit` of the Unit control of `editor`, which shows the focus ring. */
function unitChoiceLabel(editor, unit) {
  return unitOf(editor).getByText(unit, { exact: true });
}

/** The list of measures of `ingredient` in the editor of a recipe. */
function measureListOf(editor, ingredient) {
  return editor.getByRole("combobox", { name: `Measure of ${ingredient}` });
}

/** Clicks Done in `editor`. */
function clickDone(editor) {
  return editor.getByRole("button", { name: "Done" }).click();
}

/** Clicks Cancel in `editor`. */
function clickCancel(editor) {
  return editor.getByRole("button", { name: "Cancel" }).click();
}

/** Adds `Carrot` in `pcs`, with `2` of it in `Gnocchi carbonara`, and returns it. */
async function createCarrotInGnocchi(app) {
  const carrot = await app.api.createIngredient({ name: "Carrot", unit: "pcs" });
  await app.api.updateRecipe(app.recipes["Gnocchi carbonara"].id, {
    ingredients: [{ ingredientId: carrot.id, quantity: 2 }],
  });
  return carrot;
}

/** In an editor of `Carrot`, chooses `g` and enters `120` as what one `pcs` is. */
async function convertCarrotTo120Grams(editor) {
  await choiceOf(editor, "g").check();
  await conversionOf(editor).to.fill("120");
  await clickDone(editor);
  await expect(editor).toBeHidden();
}

test.describe("ingredient catalog", () => {
  test("opens from the sidebar", async ({ page }) => {
    await page.goto("/");

    await pageLink(page, "Ingredients").click();

    await expect(page).toHaveURL(/\/ingredients\.html$/);
    await expect(titleOf(page)).toContainText("Ingredients");
  });

  test("shows the unit at the right end of the row, before the chevron", async ({ page }) => {
    await openCatalog(page);

    const row = rowOf(page, "Egg");
    const unit = await row.getByText("pcs", { exact: true }).boundingBox();
    // The chevron is decorative, with no role or name, so its class finds it.
    const chevron = await row.locator(".chevron").boundingBox();
    // Where the content of the row ends, and the space between its parts.
    const { end, gap } = await row.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        end: element.getBoundingClientRect().right - Number.parseFloat(style.paddingRight),
        gap: Number.parseFloat(style.columnGap),
      };
    });
    expect(chevron.x - (unit.x + unit.width), "unit right before the chevron").toBeCloseTo(gap, 0);
    expect(chevron.x + chevron.width, "chevron at the end of the row").toBeCloseTo(end, 0);
  });

  test("archives an ingredient and restores it", async ({ app, page }) => {
    await app.api.createIngredient({
      name: "Flour",
      unit: "g",
      measures: [{ name: "cup", amount: 120.5 }],
    });
    await openCatalog(page);
    const editor = await openIngredient(page, "Flour");

    await editor.getByRole("button", { name: "Archive", exact: true }).click();

    await expect(editor).toBeHidden();
    const archived = await openArchived(page);
    await expect(archived.getByRole("listitem")).toContainText(["Flour"]);
    expect(await savedIngredient(app, "Flour")).toMatchObject({ archived: true });

    await page.getByRole("button", { name: "Restore Flour" }).click();

    await expect(archived).toBeHidden();
    await expect(rowOf(page, "Flour")).toBeVisible();
    expect(await savedIngredient(app, "Flour")).toMatchObject({ archived: false });
  });
});

test.describe("ingredient editor", () => {
  test("opens a new ingredient empty, with Name focused", async ({ page }) => {
    await openCatalog(page);

    const editor = await openNewIngredient(page);

    await expect(nameOf(editor)).toBeFocused();
    for (const unit of ["g", "ml", "pcs"]) {
      await expect(choiceOf(editor, unit)).not.toBeChecked();
    }
    await expect(editor.getByRole("heading", { name: "Measures" })).toBeVisible();
    await expect(measureRowsOf(editor)).toHaveCount(0);
    await expect(addMeasureOf(editor)).toBeVisible();
  });

  test("stays open with its changes when you click outside it", async ({ page }) => {
    await openCatalog(page);
    const editor = await openIngredient(page, "Onion");
    await nameOf(editor).fill("Spring onion");
    const box = await editor.boundingBox();
    expect(box.x, "space left of the editor").toBeGreaterThan(0);

    // Halfway between the window's left edge and the editor.
    await page.mouse.click(box.x / 2, box.y + box.height / 2);

    await expect(editor).toBeVisible();
    await expect(nameOf(editor)).toHaveValue("Spring onion");
  });

  test("shows the server's error for a name that another tab archived", async ({
    app,
    consoleErrors,
    page,
  }) => {
    await openCatalog(page);
    const editor = await openNewIngredient(page);
    await nameOf(editor).fill("flour");
    await choiceOf(editor, "g").check();
    // The editor knows the ingredients from when it opened, so it sends the save.
    const flour = await app.api.createIngredient({ name: "Flour", unit: "g" });
    await app.api.updateIngredient(flour.id, { archived: true });
    // The server answers this save with an error status, which the browser logs.
    consoleErrors.allowed = true;

    await clickDone(editor);

    await expect(
      editor.getByText('"Flour" is archived. To use it, restore it from Archived.'),
    ).toBeVisible();
    await expect(editor).toBeVisible();
  });

  test("puts the unit after the amount field of a measure row", async ({ page }) => {
    await openCatalog(page);
    const editor = await openNewIngredient(page);
    await choiceOf(editor, "g").check();

    await addMeasureOf(editor).click();

    const row = measureRowsOf(editor).first();
    const amount = await measureAmountOf(row).boundingBox();
    const unit = await row.getByText("g", { exact: true }).boundingBox();
    expect(unit.x, "g after the amount field").toBeGreaterThanOrEqual(amount.x + amount.width);
  });

  test("saves a new ingredient with a measure", async ({ app, page }) => {
    await openCatalog(page);
    const editor = await openNewIngredient(page);
    await nameOf(editor).fill("Flour");
    await choiceOf(editor, "g").check();
    await addMeasureOf(editor).click();
    const row = measureRowsOf(editor).first();
    await measureNameOf(row).fill("cup");
    await measureAmountOf(row).fill("120,5");

    await clickDone(editor);

    await expect(editor).toBeHidden();
    await expect(rowOf(page, "Flour")).toContainText("g · cup");
    await expect(rowOf(page, "Flour")).toBeFocused();
    const saved = await savedIngredient(app, "Flour");
    expect(saved).toMatchObject({ unit: "g", measures: [{ name: "cup", amount: 120.5 }] });
  });

  test("saves the measures of an ingredient", async ({ app, page }) => {
    await openCatalog(page);
    const editor = await openIngredient(page, "Onion");
    const rows = measureRowsOf(editor);
    for (const [name, amount] of [
      ["medium", "150"],
      ["large", "250"],
    ]) {
      await addMeasureOf(editor).click();
      const row = rows.last();
      await measureNameOf(row).fill(name);
      await measureAmountOf(row).fill(amount);
    }

    await clickDone(editor);

    await expect(editor).toBeHidden();
    await expect(rowOf(page, "Onion")).toContainText("g · medium, large");
    expect((await savedIngredient(app, "Onion")).measures).toMatchObject([
      { name: "medium", amount: 150 },
      { name: "large", amount: 250 },
    ]);
  });

  test("converts the unit and keeps the old unit as a measure", async ({ app, page }) => {
    await createCarrotInGnocchi(app);
    await openCatalog(page);

    await convertCarrotTo120Grams(await openIngredient(page, "Carrot"));

    await expect(rowOf(page, "Carrot")).toContainText("g · pcs");
    expect(await savedIngredient(app, "Carrot")).toMatchObject({
      unit: "g",
      measures: [{ name: "pcs", amount: 120 }],
    });
  });

  test("focuses the title of a saved ingredient without a ring", async ({ page }) => {
    await openCatalog(page);

    const editor = await openIngredient(page, "Onion");

    const title = editor.getByRole("heading", { name: "Edit ingredient" });
    await expect(title).toBeFocused();
    await expect(title).toHaveCSS("outline-style", "none");
  });

  test("locks the measure that a recipe uses", async ({ app, page }) => {
    await useMediumOnions(app, await giveOnionMeasures(app));
    await openCatalog(page);

    const editor = await openIngredient(page, "Onion");

    const [medium, large] = [measureRowsOf(editor).nth(0), measureRowsOf(editor).nth(1)];
    await expect(removeOf(medium)).toBeDisabled();
    await expect(medium.getByText("Used in 1 recipe.")).toBeVisible();
    await expect(removeOf(large)).toBeEnabled();
  });

  test("moves the choice of the unit with the arrow keys", async ({ app, page }) => {
    await giveOnionMeasures(app);
    await openCatalog(page);
    const editor = await openIngredient(page, "Onion");
    await tabTo(page, choiceOf(editor, "g"), 5);

    await page.keyboard.press("ArrowRight");

    await expect(choiceOf(editor, "ml")).toBeChecked();
    await expect(choiceOf(editor, "ml")).toBeFocused();
    await expect(unitChoiceLabel(editor, "g")).toHaveCSS("outline-style", "none");

    await page.keyboard.press("ArrowRight");

    await expect(choiceOf(editor, "pcs")).toBeChecked();
    await expect(choiceOf(editor, "pcs")).toBeFocused();
  });

  test("rings the choice of the unit that Tab focuses", async ({ app, page }) => {
    await giveOnionMeasures(app);
    await openCatalog(page);
    const editor = await openIngredient(page, "Onion");

    await tabTo(page, choiceOf(editor, "g"), 5);

    await expect(choiceOf(editor, "g")).toBeFocused();
    await expect(unitChoiceLabel(editor, "g")).not.toHaveCSS("outline-style", "none");
    await expect
      .poll(() =>
        unitChoiceLabel(editor, "g").evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).outlineWidth),
        ),
      )
      .toBeGreaterThan(0);
    await expect(unitChoiceLabel(editor, "ml")).toHaveCSS("outline-style", "none");
  });

  test("changes the unit without a conversion when nothing uses it", async ({ app, page }) => {
    await openCatalog(page);
    const editor = await openIngredient(page, "Milk");

    await choiceOf(editor, "g").check();

    await expect(editor.getByRole("heading", { name: "Conversion" })).toBeHidden();

    await clickDone(editor);

    await expect(editor).toBeHidden();
    await expect(rowOf(page, "Milk")).toContainText("g");
    expect(await savedIngredient(app, "Milk")).toMatchObject({ unit: "g" });
  });

  test("refuses a unit change after another tab used the ingredient", async ({
    consoleErrors,
    app,
    newPage,
    page,
  }) => {
    await openCatalog(page);
    const editor = await openIngredient(page, "Milk");
    const tabB = await newPage();
    await openBook(tabB);
    const recipeEditor = await openRecipe(tabB, "Lentil soup");
    await ingredientSearchOf(recipeEditor).fill("mil");
    await ingredientSearchOf(recipeEditor).press("Enter");
    await quantityOf(recipeEditor, "Milk").fill("200");
    await clickDone(recipeEditor);
    await expect(recipeEditor).toBeHidden();
    // The server answers this save with an error status, which the browser logs.
    consoleErrors.allowed = true;

    await choiceOf(editor, "g").check();
    await clickDone(editor);

    await expect(
      editor.getByText('"Milk" has measures or recipes in ml. Reload the page to change its unit.'),
    ).toBeVisible();
    await expect(editor).toBeVisible();

    await clickCancel(editor);
    await expect(editor).toBeHidden();
    const again = await openIngredient(page, "Milk");
    await choiceOf(again, "g").check();

    const { measure } = conversionOf(again);
    await expect(measure).toBeVisible();
    await expect(measure).toHaveValue("ml");

    await clickCancel(again);

    await expect(again).toBeHidden();
    expect(await savedIngredient(app, "Milk")).toMatchObject({ unit: "ml" });
  });
});

test.describe("recipe editor", () => {
  test("keeps the measure of a recipe line after another tab changes the unit", async ({
    app,
    newPage,
    page,
  }) => {
    const carrot = await createCarrotInGnocchi(app);
    // Tab A loads before tab B changes the unit.
    await openBook(page);
    const tabB = await newPage();
    await openCatalog(tabB);
    await convertCarrotTo120Grams(await openIngredient(tabB, "Carrot"));
    const measureId = (await savedIngredient(app, "Carrot")).measures[0].id;

    const editor = await openRecipe(page, "Gnocchi carbonara");

    await expect(quantityOf(editor, "Carrot")).toHaveValue("2");
    await expect(measureListOf(editor, "Carrot").locator("option:checked")).toHaveText(
      "pcs (120 g)",
    );

    await quantityOf(editor, "Carrot").fill("3");
    await clickDone(editor);

    await expect(editor).toBeHidden();
    const edited = await openRecipe(page, "Gnocchi carbonara");
    await expect(quantityOf(edited, "Carrot")).toHaveValue("3");
    await expect(measureListOf(edited, "Carrot").locator("option:checked")).toHaveText(
      "pcs (120 g)",
    );
    expect((await savedRecipe(app, "Gnocchi carbonara")).ingredients).toEqual([
      { ingredientId: carrot.id, measureId, quantity: 3 },
    ]);
  });

  test("saves a recipe with a measure and shows it again", async ({ app, page }) => {
    const onion = await giveOnionMeasures(app);
    await openBook(page);
    const editor = await openRecipe(page, "Russian salad");
    await ingredientSearchOf(editor).fill("oni");
    await editor.getByRole("option", { name: "Onion (g)" }).click();
    await measureListOf(editor, "Onion").selectOption({ label: "medium (150 g)" });
    await quantityOf(editor, "Onion").fill("2");

    await clickDone(editor);

    await expect(editor).toBeHidden();
    const saved = await savedRecipe(app, "Russian salad");
    expect(saved.ingredients).toEqual([
      { ingredientId: onion.id, measureId: onion.measures[0].id, quantity: 2 },
    ]);

    const again = await openRecipe(page, "Russian salad");

    await expect(quantityOf(again, "Onion")).toHaveValue("2");
    await expect(measureListOf(again, "Onion").locator("option:checked")).toHaveText(
      "medium (150 g)",
    );

    await clickCancel(again);

    await expect(again).toBeHidden();
  });
});
