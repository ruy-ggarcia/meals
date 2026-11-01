// The ingredient catalog on a desktop: the list, the editor, units, measures,
// unit changes with conversions, measures in recipes, and what the page does
// when the server fails or another tab changes an ingredient.

import { expect, test } from "./fixtures.js";
import {
  addMeasureOf,
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
  savedIngredient,
  unitOf,
  useMediumOnions,
} from "./ingredients.js";
import {
  createTortilla,
  ingredientSearchOf,
  quantityOf,
  editorOf as recipeEditorOf,
  rowOf as recipeRowOf,
  savedRecipe,
} from "./recipes.js";

const AMOUNT_MESSAGE = "Enter an amount from 0.01 to 10000, with up to two decimals.";
const CONVERSION_MESSAGE = "Enter a number from 0.01 to 10000, with up to two decimals.";

/** The heading of the page, which shows the number of active ingredients. */
function titleOf(page) {
  return page.getByRole("heading", { level: 1 });
}

/** The list of the active ingredients. */
function activeListOf(page) {
  return page.getByRole("list", { name: "Ingredients", exact: true });
}

/** The message that replaces the catalog when it can't load. */
function loadError(page) {
  return page.getByRole("alert").filter({ hasText: "Couldn't load the ingredients." });
}

/** Checks that the active ingredients read `rows`, such as `Egg pcs`, in this order. */
async function expectActive(page, rows) {
  // The name and the details of a row sit in separate elements.
  await expect(activeListOf(page).getByRole("listitem")).toHaveText(
    rows.map(([name, details]) => new RegExp(`^${name}\\s*${details}$`)),
  );
}

/** Presses Tab until `target` has the focus, at most `most` times. */
async function tabTo(page, target, most) {
  for (let presses = 0; presses < most; presses += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target, `focused after ${most} Tab presses`).toBeFocused();
}

/** Opens the catalog, and waits until it has loaded. */
async function openCatalog(page) {
  await page.goto("/ingredients.html");
  await expect(rowOf(page, "Egg")).toBeVisible();
}

/** Opens the editor of the ingredient called `name`. */
async function openIngredient(page, name) {
  await rowOf(page, name).click();
  const editor = editorOf(page, "Edit ingredient");
  await expect(editor).toBeVisible();
  return editor;
}

/** Opens the editor of a new ingredient. */
async function openNewIngredient(page) {
  await page.getByRole("button", { name: "New ingredient" }).click();
  const editor = editorOf(page, "New ingredient");
  await expect(editor).toBeVisible();
  return editor;
}

/** Opens the Archived section, and returns its list. */
async function openArchived(page) {
  await page.locator("summary").filter({ hasText: "Archived" }).click();
  const list = page.getByRole("list", { name: "Archived ingredients", exact: true });
  await list.waitFor();
  return list;
}

/** Opens the recipe book, and waits until it has loaded. */
async function openBook(page) {
  await page.goto("/recipes.html");
  await expect(recipeRowOf(page, "Gnocchi carbonara")).toBeVisible();
}

/** Opens the editor of the recipe called `name`. */
async function openRecipe(page, name) {
  await recipeRowOf(page, name).click();
  const editor = recipeEditorOf(page, "Edit recipe");
  await expect(editor).toBeVisible();
  return editor;
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

test("lists the ingredients with their units and marks Ingredients in the sidebar", async ({
  page,
}) => {
  await page.goto("/");

  await page
    .getByRole("navigation", { name: "Sections" })
    .getByRole("link", { name: "Ingredients" })
    .click();

  await expect(page).toHaveURL(/\/ingredients\.html$/);
  await expect(titleOf(page)).toHaveText("Ingredients 4");
  await expect(
    page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: /^Ingredients/ }),
  ).toHaveAttribute("aria-current", "page");
  await expectActive(page, [
    ["Egg", "pcs"],
    ["Milk", "ml"],
    ["Onion", "g"],
    ["Rice", "g"],
  ]);
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

test("opens the editor of a new ingredient with the name focused and no unit chosen", async ({
  page,
}) => {
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

test("asks for a unit before it saves a new ingredient", async ({ app, page }) => {
  await openCatalog(page);
  const editor = await openNewIngredient(page);
  await nameOf(editor).fill("Flour");

  await clickDone(editor);

  await expect(editor.getByText("Choose a unit.")).toBeVisible();
  await expect(choiceOf(editor, "g")).toBeFocused();
  await expect(editor).toBeVisible();
  expect(await savedIngredient(app, "Flour")).toBeUndefined();
});

test("adds a measure row with the focus in its name and asks for the name on Done", async ({
  page,
}) => {
  await openCatalog(page);
  const editor = await openNewIngredient(page);
  await nameOf(editor).fill("Flour");
  await choiceOf(editor, "g").check();

  await addMeasureOf(editor).click();

  const row = measureRowsOf(editor).first();
  await expect(measureNameOf(row)).toBeFocused();
  await expect(row.getByText("g", { exact: true })).toBeVisible();
  const amount = await measureAmountOf(row).boundingBox();
  const unit = await row.getByText("g", { exact: true }).boundingBox();
  expect(unit.x, "g after the amount field").toBeGreaterThanOrEqual(amount.x + amount.width);

  await clickDone(editor);

  await expect(row.getByText("Enter a name.")).toBeVisible();
  await expect(measureNameOf(row)).toBeFocused();
  await expect(editor).toBeVisible();
});

test("rejects a measure amount of 0 until you correct it, and saves a decimal comma", async ({
  app,
  page,
}) => {
  await openCatalog(page);
  const editor = await openNewIngredient(page);
  await nameOf(editor).fill("Flour");
  await choiceOf(editor, "g").check();
  await addMeasureOf(editor).click();
  const row = measureRowsOf(editor).first();
  await measureNameOf(row).fill("cup");
  await measureAmountOf(row).fill("0");

  await clickDone(editor);

  const message = row.getByText(AMOUNT_MESSAGE);
  await expect(message).toBeVisible();
  await expect(measureAmountOf(row)).toBeFocused();
  await expect(editor).toBeVisible();

  await measureAmountOf(row).selectText();
  await measureAmountOf(row).pressSequentially("120,5");

  await expect(message).toBeHidden();
  await expect(measureAmountOf(row)).toBeFocused();

  await clickDone(editor);

  await expect(editor).toBeHidden();
  await expectActive(page, [
    ["Egg", "pcs"],
    ["Flour", "g · cup"],
    ["Milk", "ml"],
    ["Onion", "g"],
    ["Rice", "g"],
  ]);
  await expect(rowOf(page, "Flour")).toBeFocused();
  const saved = await savedIngredient(app, "Flour");
  expect(saved).toMatchObject({ unit: "g", measures: [{ name: "cup", amount: 120.5 }] });
});

test("refuses the name of another ingredient", async ({ app, page }) => {
  await openCatalog(page);
  const editor = await openNewIngredient(page);
  await nameOf(editor).fill("ONION");
  await choiceOf(editor, "pcs").check();

  await clickDone(editor);

  await expect(editor.getByText('"Onion" already exists.')).toBeVisible();
  await expect(editor).toBeVisible();

  await clickCancel(editor);

  await expect(editor).toBeHidden();
  expect((await app.api.ingredients()).ingredients).toHaveLength(4);
});

test("archives an ingredient, refuses its name for a new one, and restores it", async ({
  app,
  page,
}) => {
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

  const newEditor = await openNewIngredient(page);
  await nameOf(newEditor).fill("flour");
  await choiceOf(newEditor, "g").check();
  await clickDone(newEditor);

  await expect(
    newEditor.getByText('"Flour" is archived. To use it, restore it from Archived.'),
  ).toBeVisible();
  await expect(newEditor).toBeVisible();

  await clickCancel(newEditor);
  await page.getByRole("button", { name: "Restore Flour" }).click();

  await expect(archived).toBeHidden();
  await expectActive(page, [
    ["Egg", "pcs"],
    ["Flour", "g · cup"],
    ["Milk", "ml"],
    ["Onion", "g"],
    ["Rice", "g"],
  ]);
  expect(await savedIngredient(app, "Flour")).toMatchObject({ archived: false });
});

test("refuses a measure name that repeats another, and Remove moves the focus up", async ({
  app,
  page,
}) => {
  await openCatalog(page);
  const editor = await openIngredient(page, "Onion");
  const rows = measureRowsOf(editor);
  for (const [name, amount] of [
    ["medium", "150"],
    ["large", "250"],
    ["MEDIUM", "100"],
  ]) {
    await addMeasureOf(editor).click();
    const row = rows.last();
    await measureNameOf(row).fill(name);
    await measureAmountOf(row).fill(amount);
  }

  await clickDone(editor);

  await expect(rows.nth(2).getByText('"MEDIUM" is already a measure.')).toBeVisible();
  await expect(editor).toBeVisible();

  await removeOf(rows.nth(2)).click();

  await expect(rows).toHaveCount(2);
  await expect(removeOf(rows.nth(1))).toBeFocused();

  await clickDone(editor);

  await expect(editor).toBeHidden();
  await expectActive(page, [
    ["Egg", "pcs"],
    ["Milk", "ml"],
    ["Onion", "g · medium, large"],
    ["Rice", "g"],
  ]);
  expect((await savedIngredient(app, "Onion")).measures).toMatchObject([
    { name: "medium", amount: 150 },
    { name: "large", amount: 250 },
  ]);
});

test("offers the measures of an ingredient when you add it to a recipe", async ({ app, page }) => {
  await giveOnionMeasures(app);
  await openBook(page);
  const editor = await openRecipe(page, "Russian salad");

  await ingredientSearchOf(editor).fill("oni");

  const option = editor.getByRole("option", { name: "Onion (g)" });
  await expect(option).toBeVisible();

  await option.click();

  const measures = measureListOf(editor, "Onion");
  await expect(measures).toBeVisible();
  await expect(measures.locator("option:checked")).toHaveText("g");
  await expect(measures.locator("option")).toHaveText(["g", "medium (150 g)", "large (250 g)"]);
  // The list comes after the quantity.
  const quantity = await quantityOf(editor, "Onion").boundingBox();
  const list = await measures.boundingBox();
  expect(list.x, "measure list after the quantity").toBeGreaterThanOrEqual(
    quantity.x + quantity.width,
  );
});

test("saves a recipe with a measure of an ingredient and shows it again", async ({ app, page }) => {
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

test("keeps the title without a focus ring and locks the measure that a recipe uses", async ({
  app,
  page,
}) => {
  await useMediumOnions(app, await giveOnionMeasures(app));
  await openCatalog(page);

  const editor = await openIngredient(page, "Onion");

  const title = editor.getByRole("heading", { name: "Edit ingredient" });
  await expect(title).toBeFocused();
  await expect(title).toHaveCSS("outline-style", "none");
  const [medium, large] = [measureRowsOf(editor).nth(0), measureRowsOf(editor).nth(1)];
  await expect(removeOf(medium)).toBeDisabled();
  await expect(medium.getByText("Used in 1 recipe.")).toBeVisible();
  await expect(removeOf(large)).toBeEnabled();

  await clickCancel(editor);

  await expect(editor).toBeHidden();
});

test("shows a conversion row and read-only measures when you change the unit of Onion", async ({
  app,
  page,
}) => {
  await useMediumOnions(app, await giveOnionMeasures(app));
  await openCatalog(page);
  const editor = await openIngredient(page, "Onion");

  await choiceOf(editor, "pcs").check();

  const { from, to, measure } = conversionOf(editor);
  await expect(from).toHaveValue("1");
  await expect(to).toHaveValue("");
  // The line reads `1 g = [ ] pcs`.
  await expect(from.locator("..")).toHaveText(/^\s*g\s*=\s*pcs\s*$/);
  await expect(measure).toBeHidden();
  const rows = measureRowsOf(editor);
  for (const index of [0, 1]) {
    await expect(measureNameOf(rows.nth(index))).not.toBeEditable();
    await expect(measureAmountOf(rows.nth(index))).not.toBeEditable();
    await expect(removeOf(rows.nth(index))).toBeDisabled();
  }
  await expect(addMeasureOf(editor)).toBeDisabled();
});

test("previews the converted measures and drops the conversion when you choose the old unit", async ({
  app,
  page,
}) => {
  await useMediumOnions(app, await giveOnionMeasures(app));
  await openCatalog(page);
  const editor = await openIngredient(page, "Onion");
  await choiceOf(editor, "pcs").check();
  const { from, to } = conversionOf(editor);
  const rows = measureRowsOf(editor);

  await from.fill("150");
  await to.fill("1");

  await expect(from).toHaveValue("150");
  await expect(to).toHaveValue("1");
  await expect(from.locator("..")).toHaveText(/^\s*g\s*=\s*pcs\s*$/);
  await expect(measureAmountOf(rows.nth(0))).toHaveValue("1");
  await expect(measureAmountOf(rows.nth(1))).toHaveValue("1.67");

  await choiceOf(editor, "g").check();

  await expect(editor.getByRole("heading", { name: "Conversion" })).toBeHidden();
  await expect(measureAmountOf(rows.nth(0))).toHaveValue("150");
  await expect(measureAmountOf(rows.nth(1))).toHaveValue("250");

  await clickCancel(editor);

  await expect(editor).toBeHidden();
  expect(await savedIngredient(app, "Onion")).toMatchObject({ unit: "g" });
});

test("adds an ingredient that a recipe then holds in its unit without a measure list", async ({
  app,
  page,
}) => {
  await openCatalog(page);
  const editor = await openNewIngredient(page);
  await nameOf(editor).fill("Carrot");
  await choiceOf(editor, "pcs").check();

  await clickDone(editor);

  await expect(editor).toBeHidden();
  await expect(rowOf(page, "Carrot")).toContainText("pcs");
  await page
    .getByRole("navigation", { name: "Sections" })
    .getByRole("link", { name: "Recipes" })
    .click();
  await expect(recipeRowOf(page, "Gnocchi carbonara")).toBeVisible();
  const recipeEditor = await openRecipe(page, "Gnocchi carbonara");
  await ingredientSearchOf(recipeEditor).fill("car");
  await ingredientSearchOf(recipeEditor).press("Enter");
  await quantityOf(recipeEditor, "Carrot").fill("2");

  const row = recipeEditor.getByRole("listitem").filter({ hasText: "Carrot" });
  await expect(row.getByText("pcs", { exact: true })).toBeVisible();
  await expect(measureListOf(recipeEditor, "Carrot")).toHaveCount(0);

  await clickDone(recipeEditor);

  await expect(recipeEditor).toBeHidden();
  const carrot = await savedIngredient(app, "Carrot");
  expect((await savedRecipe(app, "Gnocchi carbonara")).ingredients).toEqual([
    { ingredientId: carrot.id, quantity: 2 },
  ]);
});

test("shows the conversion row with a measure field for an ingredient that another tab changes", async ({
  app,
  newPage,
  page,
}) => {
  await createCarrotInGnocchi(app);
  await openBook(page);
  const tabB = await newPage();
  await openCatalog(tabB);

  const editor = await openIngredient(tabB, "Carrot");
  await choiceOf(editor, "g").check();

  const { from, to, measure } = conversionOf(editor);
  await expect(from).toHaveValue("1");
  await expect(to).toHaveValue("");
  await expect(from.locator("..")).toHaveText(/^\s*pcs\s*=\s*g\s*$/);
  await expect(measure).toBeVisible();
  await expect(measure).toHaveValue("pcs");
  await expect(choiceOf(editor, "g")).toBeEnabled();
  await expect(choiceOf(editor, "ml")).toBeEnabled();
  await expect(choiceOf(editor, "pcs")).toBeEnabled();
  // The recipe book in tab A stays open.
  await expect(recipeRowOf(page, "Gnocchi carbonara")).toBeVisible();
});

test("asks for the second number of a conversion, and then saves the new unit", async ({
  app,
  newPage,
  page,
}) => {
  await createCarrotInGnocchi(app);
  await openBook(page);
  const tabB = await newPage();
  await openCatalog(tabB);
  const editor = await openIngredient(tabB, "Carrot");
  await choiceOf(editor, "g").check();
  const { to } = conversionOf(editor);

  await clickDone(editor);

  await expect(editor.getByText(CONVERSION_MESSAGE)).toBeVisible();
  await expect(to).toBeFocused();
  await expect(editor).toBeVisible();

  await to.fill("120");
  await clickDone(editor);

  await expect(editor).toBeHidden();
  await expect(rowOf(tabB, "Carrot")).toContainText("g · pcs");
  expect(await savedIngredient(app, "Carrot")).toMatchObject({
    unit: "g",
    measures: [{ name: "pcs", amount: 120 }],
  });
});

test("keeps the meaning of a recipe that a tab saved after the unit changed", async ({
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
  await expect(measureListOf(editor, "Carrot").locator("option:checked")).toHaveText("pcs (120 g)");

  await quantityOf(editor, "Carrot").fill("3");
  await clickDone(editor);

  await expect(editor).toBeHidden();
  const edited = await openRecipe(page, "Gnocchi carbonara");
  await expect(quantityOf(edited, "Carrot")).toHaveValue("3");
  await expect(measureListOf(edited, "Carrot").locator("option:checked")).toHaveText("pcs (120 g)");
  expect((await savedRecipe(app, "Gnocchi carbonara")).ingredients).toEqual([
    { ingredientId: carrot.id, measureId, quantity: 3 },
  ]);

  await quantityOf(edited, "Carrot").fill("2");
  await clickDone(edited);

  await expect(edited).toBeHidden();
  expect((await savedRecipe(app, "Gnocchi carbonara")).ingredients).toEqual([
    { ingredientId: carrot.id, measureId, quantity: 2 },
  ]);
});

test("names the measure that replaces the unit of an ingredient that a recipe holds in it", async ({
  app,
  page,
}) => {
  await createTortilla(app);
  await openCatalog(page);
  const editor = await openIngredient(page, "Egg");

  await choiceOf(editor, "g").check();

  const { from, measure } = conversionOf(editor);
  await expect(from.locator("..")).toHaveText(/^\s*pcs\s*=\s*g\s*$/);
  await expect(measure).toBeVisible();
  await expect(measure).toHaveValue("pcs");

  await clickCancel(editor);

  await expect(editor).toBeHidden();
  await expect(rowOf(page, "Egg")).toContainText("pcs");
  expect(await savedIngredient(app, "Egg")).toMatchObject({ unit: "pcs" });
});

test("changes the unit of an ingredient with no measures and no recipes without a conversion", async ({
  app,
  page,
}) => {
  await openCatalog(page);
  let editor = await openIngredient(page, "Milk");

  await choiceOf(editor, "g").check();

  await expect(editor.getByRole("heading", { name: "Conversion" })).toBeHidden();

  await clickDone(editor);

  await expect(editor).toBeHidden();
  await expect(rowOf(page, "Milk")).toContainText("g");
  expect(await savedIngredient(app, "Milk")).toMatchObject({ unit: "g" });

  editor = await openIngredient(page, "Milk");
  await choiceOf(editor, "ml").check();
  await clickDone(editor);

  await expect(editor).toBeHidden();
  await expect(rowOf(page, "Milk")).toContainText("ml");
  expect(await savedIngredient(app, "Milk")).toMatchObject({ unit: "ml" });
});

test("refuses a unit change that another tab made necessary until the page reloads", async ({
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

test("keeps the name and the unit when a save fails", async ({ app, network, page }) => {
  await openCatalog(page);
  const editor = await openNewIngredient(page);
  await nameOf(editor).fill("Flour");
  await choiceOf(editor, "g").check();
  await network.down();

  await clickDone(editor);

  await expect(editor.getByText("Couldn't save the ingredient. Try again.")).toBeVisible();
  await expect(nameOf(editor)).toHaveValue("Flour");
  await expect(choiceOf(editor, "g")).toBeChecked();
  await expect(editor).toBeVisible();
  expect(await savedIngredient(app, "Flour")).toBeUndefined();
});

test("shows the load error after a reload and loads again with Retry", async ({
  network,
  page,
}) => {
  await openCatalog(page);
  const editor = await openNewIngredient(page);
  await network.down();
  await clickCancel(editor);
  await expect(editor).toBeHidden();

  await page.reload();

  await expect(loadError(page)).toBeVisible();

  await network.up();
  await loadError(page).getByRole("button", { name: "Retry" }).click();

  await expect(loadError(page)).toBeHidden();
  await expectActive(page, [
    ["Egg", "pcs"],
    ["Milk", "ml"],
    ["Onion", "g"],
    ["Rice", "g"],
  ]);
});

test("moves the choice of the unit with the arrow keys and rings the focused choice", async ({
  app,
  page,
}) => {
  await giveOnionMeasures(app);
  await openCatalog(page);
  const editor = await openIngredient(page, "Onion");
  const choice = (unit) => unitOf(editor).getByText(unit, { exact: true });
  const expectRing = async (unit) => {
    await expect(choice(unit)).not.toHaveCSS("outline-style", "none");
    await expect
      .poll(() =>
        choice(unit).evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).outlineWidth),
        ),
      )
      .toBeGreaterThan(0);
  };

  await tabTo(page, choiceOf(editor, "g"), 5);

  await expect(choiceOf(editor, "g")).toBeFocused();
  await expectRing("g");
  await expect(choice("ml")).toHaveCSS("outline-style", "none");

  await page.keyboard.press("ArrowRight");

  await expect(choiceOf(editor, "ml")).toBeChecked();
  await expect(choiceOf(editor, "ml")).toBeFocused();
  await expect(choice("g")).toHaveCSS("outline-style", "none");

  await page.keyboard.press("ArrowRight");

  await expect(choiceOf(editor, "pcs")).toBeChecked();
  await expect(choiceOf(editor, "pcs")).toBeFocused();

  await clickCancel(editor);

  await expect(editor).toBeHidden();
  expect(await savedIngredient(app, "Onion")).toMatchObject({ unit: "g" });
});
