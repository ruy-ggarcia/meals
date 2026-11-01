// The recipe book on a desktop: the list of recipes, the recipe editor, archiving
// and restoring, what the meal plan shows for an archived recipe, and what the
// page does when a save fails.

import { CURRENT_WEEK } from "./catalog.js";
import { RED, WARNING_ICON, WARNING_TEXT } from "./colors.js";
import { answerQuestions, reloadAndAsk } from "./dialogs.js";
import { expect, test } from "./fixtures.js";
import { pageLink } from "./navigation.js";
import {
  activeListOf,
  archivedHeadingOf,
  archivedListOf,
  createTortilla,
  ingredientSearchOf,
  nameOf,
  openArchived,
  openBook,
  openNewRecipe,
  openRecipe,
  quantityOf,
  rowOf,
  savedRecipe,
} from "./recipes.js";

/** The heading of the page. */
function titleOf(page) {
  return page.getByRole("heading", { level: 1 });
}

/** Adds `Egg` to the recipe in `editor`, and returns its quantity field. */
async function addEgg(editor) {
  await ingredientSearchOf(editor).fill("eg");
  await ingredientSearchOf(editor).press("Enter");
  return quantityOf(editor, "Egg");
}

test.describe("recipe book", () => {
  test("opens from the sidebar", async ({ page }) => {
    await page.goto("/");

    await pageLink(page, "Recipes").click();

    await expect(page).toHaveURL(/\/recipes\.html$/);
    await expect(titleOf(page)).toContainText("Recipes");
    await expect(archivedHeadingOf(page)).toBeHidden();
  });

  test("warns that a recipe without ingredients isn't in the shopping list", async ({ page }) => {
    await openBook(page);
    const row = activeListOf(page).getByRole("listitem").filter({ hasText: "Omelette" });

    const detail = row.getByText("No ingredients · not in shopping list");
    await expect(detail).toBeVisible();
    await expect(detail).toHaveCSS("color", WARNING_TEXT);
    // The icon is decorative, with no role or name, so its class finds it.
    const icon = row.locator(".warning-icon");
    await expect(icon).toBeVisible();
    await expect(icon).toHaveCSS("color", WARNING_ICON);
  });

  test("puts the chevron of a row after its text, at the end of the row", async ({ page }) => {
    await openBook(page);
    const row = activeListOf(page).getByRole("listitem").filter({ hasText: "Omelette" });
    const detail = row.getByText("No ingredients · not in shopping list");

    // The chevron is decorative too, so its class finds it.
    const chevron = await row.locator(".chevron").boundingBox();
    const text = await detail.boundingBox();
    const end = await rowOf(page, "Omelette").evaluate(
      (element) =>
        element.getBoundingClientRect().right -
        Number.parseFloat(getComputedStyle(element).paddingRight),
    );
    expect(
      chevron.x,
      `the left edge of the chevron must be after ${text.x + text.width}px, the right edge of the text`,
    ).toBeGreaterThan(text.x + text.width);
    expect(
      chevron.x + chevron.width,
      `the right edge of the chevron must be at ${end}px, the end of the content of the row`,
    ).toBeCloseTo(end, 0);
  });

  test("archives a recipe and restores it", async ({ app, page }) => {
    await openBook(page);
    const editor = await openRecipe(page, "Omelette");

    await editor.getByRole("button", { name: "Archive", exact: true }).click();

    await expect(editor).toBeHidden();
    const archived = await openArchived(page);
    await expect(archived.getByRole("listitem")).toContainText(["Omelette"]);
    expect((await savedRecipe(app, "Omelette")).archived).toBe(true);

    await page.getByRole("button", { name: "Restore Omelette" }).click();

    await expect(archivedListOf(page)).toBeHidden();
    await expect(rowOf(page, "Omelette")).toBeVisible();
    expect((await savedRecipe(app, "Omelette")).archived).toBe(false);
  });

  test("keeps an archived recipe in the meal plan", async ({ app, page }) => {
    await app.api.saveSlot(CURRENT_WEEK, "mon", "lunch", [
      { recipeId: app.recipes["Russian salad"].id, servings: 0.5 },
      { recipeId: app.recipes["Green salad"].id, servings: 2 },
    ]);
    await openBook(page);
    const editor = await openRecipe(page, "Green salad");

    await editor.getByRole("button", { name: "Archive", exact: true }).click();

    await expect(editor).toBeHidden();
    await pageLink(page, "Meal plan").click();
    const slot = page.getByRole("button", {
      name: "Monday, Lunch: Russian salad × 0.5, Green salad × 2",
    });
    await expect(slot).toBeVisible();

    await slot.click();
    const slotEditor = page.getByRole("dialog", { name: "Lunch" });
    await slotEditor.getByRole("button", { name: "Increase servings of Green salad" }).click();
    await slotEditor.getByRole("button", { name: "Done" }).click();

    await expect(slotEditor).toBeHidden();
    await expect(
      page.getByText("All changes saved", { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Couldn't save. Select to retry." })).toHaveCount(
      0,
    );
    const week = await app.api.week(CURRENT_WEEK);
    expect(week.mon.lunch.items).toEqual([
      { recipeId: app.recipes["Russian salad"].id, servings: 0.5 },
      { recipeId: app.recipes["Green salad"].id, servings: 2.5 },
    ]);
  });
});

test.describe("recipe editor", () => {
  test("opens a new recipe with Name focused", async ({ page }) => {
    await openBook(page);

    const editor = await openNewRecipe(page);

    await expect(nameOf(editor)).toBeFocused();
  });

  test("adds an ingredient with its empty quantity focused", async ({ page }) => {
    await openBook(page);
    const editor = await openNewRecipe(page);
    await nameOf(editor).fill("Tortilla");

    const quantity = await addEgg(editor);

    const row = editor.getByRole("listitem").filter({ hasText: "Egg" });
    await expect(row.getByText("Egg", { exact: true })).toBeVisible();
    await expect(row.getByText("pcs", { exact: true })).toBeVisible();
    await expect(quantity).toHaveValue("");
    await expect(quantity).toBeFocused();
  });

  test("saves a recipe with a decimal comma in its quantity", async ({ app, page }) => {
    await openBook(page);
    const editor = await openNewRecipe(page);
    await nameOf(editor).fill("Tortilla");
    const quantity = await addEgg(editor);

    await quantity.fill("1,25");
    await quantity.press("Enter");

    await expect(editor).toBeHidden();
    await expect(
      activeListOf(page).getByRole("listitem").filter({ hasText: "Tortilla" }),
    ).toContainText("Egg");
    await expect(rowOf(page, "Tortilla")).toBeFocused();
    const saved = await savedRecipe(app, "Tortilla");
    expect(saved.ingredients).toEqual([{ ingredientId: app.ingredients.Egg.id, quantity: 1.25 }]);
  });

  test("shows the quantity of a saved recipe", async ({ app, page }) => {
    await createTortilla(app);
    await openBook(page);

    const editor = await openRecipe(page, "Tortilla");

    await expect(quantityOf(editor, "Egg")).toHaveValue("1.25");
  });

  test("focuses the title of a saved recipe without a ring", async ({ app, page }) => {
    await createTortilla(app);
    await openBook(page);

    const editor = await openRecipe(page, "Tortilla");

    const title = editor.getByRole("heading", { name: "Edit recipe" });
    await expect(title).toBeFocused();
    await expect(title).toHaveCSS("outline-style", "none");
  });

  test("stays open with its changes when you click outside it", async ({ app, page }) => {
    await createTortilla(app);
    await openBook(page);
    const editor = await openRecipe(page, "Tortilla");
    await quantityOf(editor, "Egg").fill("1.3");
    const box = await editor.boundingBox();
    expect(box.x, "space left of the editor").toBeGreaterThan(0);

    // Halfway between the window's left edge and the editor.
    await page.mouse.click(box.x / 2, box.y + box.height / 2);

    await expect(editor).toBeVisible();
    await expect(quantityOf(editor, "Egg")).toHaveValue("1.3");
  });

  test("shows the server's error for a name that another tab archived", async ({
    app,
    consoleErrors,
    page,
  }) => {
    await openBook(page);
    const editor = await openNewRecipe(page);
    await nameOf(editor).fill("Flan");
    // The editor knows the recipes from when it opened, so it sends the save.
    const flan = await app.api.createRecipe({ name: "Flan" });
    await app.api.updateRecipe(flan.id, { archived: true });
    // The server answers this save with an error status, which the browser logs.
    consoleErrors.allowed = true;

    await editor.getByRole("button", { name: "Done" }).click();

    await expect(
      editor.getByText('"Flan" is archived. To use it, restore it from Archived.'),
    ).toBeVisible();
    await expect(editor).toBeVisible();
  });

  test("renames a recipe with Enter", async ({ app, page }) => {
    await openBook(page);
    const editor = await openRecipe(page, "Lentil soup");

    await nameOf(editor).fill("Red lentil soup");
    await nameOf(editor).press("Enter");

    await expect(editor).toBeHidden();
    await expect(rowOf(page, "Red lentil soup")).toBeVisible();
    expect(await savedRecipe(app, "Red lentil soup")).toBeDefined();
  });

  test("rings a quantity that isn't valid in red", async ({ page }) => {
    await openBook(page);
    const editor = await openNewRecipe(page);
    const quantity = await addEgg(editor);

    await quantity.fill("abc");

    await expect(quantity).toHaveCSS("box-shadow", RED);
  });

  test("asks before a reload loses its changes", async ({ page }) => {
    await openBook(page);
    const editor = await openNewRecipe(page);
    await nameOf(editor).click();
    await nameOf(editor).pressSequentially("Tortilla");
    const kinds = answerQuestions(page);

    await reloadAndAsk(page);

    await expect.poll(() => kinds).toEqual(["beforeunload"]);
    await expect(editor).toBeVisible();
    await expect(nameOf(editor)).toHaveValue("Tortilla");

    await editor.getByRole("button", { name: "Cancel" }).click();

    await expect(editor).toBeHidden();
  });

  test("saves a recipe after the server is back", async ({ app, network, page }) => {
    await openBook(page);
    const editor = await openRecipe(page, "Lentil soup");
    await nameOf(editor).fill("Red lentil soup");
    await network.down();
    await editor.getByRole("button", { name: "Done" }).click();
    await expect(editor.getByText("Couldn't save the recipe. Try again.")).toBeVisible();

    await network.up();
    await editor.getByRole("button", { name: "Done" }).click();

    await expect(editor).toBeHidden();
    await expect(rowOf(page, "Red lentil soup")).toBeVisible();
    expect(await savedRecipe(app, "Red lentil soup")).toBeDefined();
  });
});
