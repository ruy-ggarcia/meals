// The recipe book on a desktop: the list of recipes, the recipe editor, archiving
// and restoring, what the meal plan shows for renamed and archived recipes, and
// what the page does when the server fails.

import { CURRENT_WEEK, NEXT_WEEK } from "./catalog.js";
import { expect, test } from "./fixtures.js";
import {
  activeListOf,
  archivedHeadingOf,
  archivedListOf,
  createTortilla,
  editorOf,
  ingredientSearchOf,
  nameOf,
  openArchived,
  quantityOf,
  rowOf,
  savedRecipe,
} from "./recipes.js";
import { LONG_NAME } from "./slot-editor.js";

const ALL_RECIPES = [
  "<b>Bold</b> soup",
  "Gnocchi carbonara",
  "Green salad",
  "Lentil soup",
  "Omelette",
  "Russian salad",
  LONG_NAME,
];
const QUANTITY_MESSAGE = "Enter a quantity from 0.01 to 10000, with up to two decimals.";
// The colors of the stylesheet, as the browser computes them.
const WARNING_TEXT = "rgb(168, 75, 0)";
const WARNING_ICON = "rgb(255, 149, 0)";
const RED = /rgb\(215, 0, 21\)/;

/** The heading of the page, which shows the number of active recipes. */
function titleOf(page) {
  return page.getByRole("heading", { level: 1 });
}

/** The link of the sidebar to the recipe book, which shows the number of active recipes. */
function sidebarLinkOf(page) {
  return page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: /^Recipes/ });
}

/** The message that replaces the recipe book when it can't load. */
function loadError(page) {
  return page.getByRole("alert").filter({ hasText: "Couldn't load the recipes." });
}

/** Checks that the active recipes are `names`, in this order. */
async function expectActive(page, names) {
  // Each row starts with its name, and shows its details after it.
  const starts = names.map((name) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  await expect(activeListOf(page).getByRole("listitem")).toHaveText(starts);
}

/** Opens the recipe book, and waits until it has loaded. */
async function openBook(page) {
  await page.goto("/recipes.html");
  await expect(rowOf(page, "Gnocchi carbonara")).toBeVisible();
}

/** Opens the editor of the recipe called `name`. */
async function openRecipe(page, name) {
  await rowOf(page, name).click();
  const editor = editorOf(page, "Edit recipe");
  await expect(editor).toBeVisible();
  return editor;
}

/** Opens the editor of a new recipe. */
async function openNewRecipe(page) {
  await page.getByRole("button", { name: "New recipe" }).click();
  const editor = editorOf(page, "New recipe");
  await expect(editor).toBeVisible();
  return editor;
}

/** Adds `Egg` to the recipe in `editor`, and returns its quantity field. */
async function addEgg(editor) {
  await ingredientSearchOf(editor).fill("eg");
  await ingredientSearchOf(editor).press("Enter");
  return quantityOf(editor, "Egg");
}

/** Clicks the dark area outside `editor`, halfway between the window's left edge and the editor. */
async function clickBackdrop(page, editor) {
  const box = await editor.boundingBox();
  expect(box.x, "space left of the editor").toBeGreaterThan(0);
  await page.mouse.click(box.x / 2, box.y + box.height / 2);
}

test("opens the recipe book from the sidebar", async ({ page }) => {
  await page.goto("/");

  await page
    .getByRole("navigation", { name: "Sections" })
    .getByRole("link", { name: "Recipes" })
    .click();

  await expect(page).toHaveURL(/\/recipes\.html$/);
  await expect(titleOf(page)).toHaveText("Recipes 7");
  await expect(sidebarLinkOf(page)).toHaveAttribute("aria-current", "page");
  await expectActive(page, ALL_RECIPES);
  await expect(archivedHeadingOf(page)).toBeHidden();
});

test("warns that a recipe without ingredients is not in the shopping list", async ({ page }) => {
  await openBook(page);
  const row = activeListOf(page).getByRole("listitem").filter({ hasText: "Omelette" });

  const detail = row.getByText("No ingredients · not in shopping list");
  await expect(detail).toBeVisible();
  await expect(detail).toHaveCSS("color", WARNING_TEXT);
  // The icon is decorative, with no role or name, so its class finds it.
  const icon = row.locator(".warning-icon");
  await expect(icon).toBeVisible();
  await expect(icon).toHaveCSS("color", WARNING_ICON);
  // The chevron sits at the right end of the row, after the text. It's
  // decorative too, so its class finds it.
  const chevron = await row.locator(".chevron").boundingBox();
  const text = await detail.boundingBox();
  const end = await rowOf(page, "Omelette").evaluate(
    (element) =>
      element.getBoundingClientRect().right -
      Number.parseFloat(getComputedStyle(element).paddingRight),
  );
  expect(chevron.x, "chevron after the text").toBeGreaterThan(text.x + text.width);
  expect(chevron.x + chevron.width, "chevron at the end of the row").toBeCloseTo(end, 0);
});

test("opens the editor of a new recipe with the name focused", async ({ page }) => {
  await openBook(page);

  const editor = await openNewRecipe(page);

  await expect(nameOf(editor)).toBeFocused();
  await expect(
    editor.getByText("No ingredients yet. You can save it, but the shopping list can't count it."),
  ).toBeVisible();
});

test("adds an ingredient with an empty quantity that has the focus", async ({ page }) => {
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
  await expectActive(page, [...ALL_RECIPES, "Tortilla"]);
  await expect(
    activeListOf(page).getByRole("listitem").filter({ hasText: "Tortilla" }),
  ).toContainText("Egg");
  await expect(rowOf(page, "Tortilla")).toBeFocused();
  const saved = await savedRecipe(app, "Tortilla");
  expect(saved.ingredients).toEqual([{ ingredientId: app.ingredients.Egg.id, quantity: 1.25 }]);
});

test("opens a saved recipe with its quantity and the focus on the title", async ({ app, page }) => {
  await createTortilla(app);
  await openBook(page);

  const editor = await openRecipe(page, "Tortilla");

  await expect(quantityOf(editor, "Egg")).toHaveValue("1.25");
  const title = editor.getByRole("heading", { name: "Edit recipe" });
  await expect(title).toBeFocused();
  await expect(title).toHaveCSS("outline-style", "none");
});

test("rejects a quantity with three decimals until you correct it", async ({ app, page }) => {
  await createTortilla(app);
  await openBook(page);
  const editor = await openRecipe(page, "Tortilla");
  const quantity = quantityOf(editor, "Egg");
  await quantity.fill("1.255");

  await editor.getByRole("button", { name: "Done" }).click();

  const message = editor.getByText(QUANTITY_MESSAGE);
  await expect(message).toBeVisible();
  await expect(quantity).toBeFocused();
  await expect(editor).toBeVisible();

  await quantity.selectText();
  await quantity.pressSequentially("1.3");

  await expect(message).toBeHidden();
  await expect(quantity).toBeFocused();
  await expect(editor).toBeVisible();
  expect((await savedRecipe(app, "Tortilla")).ingredients[0].quantity).toBe(1.25);
});

test("keeps the editor on a click outside it and discards the changes on Cancel", async ({
  app,
  page,
}) => {
  await createTortilla(app);
  await openBook(page);
  const editor = await openRecipe(page, "Tortilla");
  await quantityOf(editor, "Egg").fill("1.3");

  await clickBackdrop(page, editor);

  await expect(editor).toBeVisible();

  await editor.getByRole("button", { name: "Cancel" }).click();

  await expect(editor).toBeHidden();
  await expect(rowOf(page, "Tortilla")).toBeFocused();
  expect((await savedRecipe(app, "Tortilla")).ingredients[0].quantity).toBe(1.25);
});

test("renames a recipe and keeps the list sorted", async ({ app, page }) => {
  await openBook(page);
  const editor = await openRecipe(page, "Lentil soup");

  await nameOf(editor).fill("Red lentil soup");
  await nameOf(editor).press("Enter");

  await expect(editor).toBeHidden();
  await expectActive(page, [
    "<b>Bold</b> soup",
    "Gnocchi carbonara",
    "Green salad",
    "Omelette",
    "Red lentil soup",
    "Russian salad",
    LONG_NAME,
  ]);
  expect(await savedRecipe(app, "Red lentil soup")).toBeDefined();
});

test("shows the new name of a recipe in the meal plan", async ({ app, page }) => {
  await app.api.saveSlot(NEXT_WEEK, "mon", "lunch", [
    { recipeId: app.recipes["Lentil soup"].id, servings: 1 },
  ]);
  await app.api.updateRecipe(app.recipes["Lentil soup"].id, { name: "Red lentil soup" });

  await page.goto(`/#${NEXT_WEEK}`);

  await expect(
    page.getByRole("button", { name: "Monday, Lunch: Red lentil soup × 1" }),
  ).toBeVisible();
});

test("refuses the name of another recipe", async ({ app, page }) => {
  await openBook(page);
  const editor = await openRecipe(page, "Omelette");

  await nameOf(editor).fill("Green salad");
  await editor.getByRole("button", { name: "Done" }).click();

  await expect(editor.getByText('"Green salad" already exists.')).toBeVisible();
  await expect(editor).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(editor).toBeHidden();
  expect(await savedRecipe(app, "Omelette")).toBeDefined();
});

test("archives a recipe and refuses its name for a new one", async ({ app, page }) => {
  await openBook(page);
  const editor = await openRecipe(page, "Omelette");

  await editor.getByRole("button", { name: "Archive", exact: true }).click();

  await expect(editor).toBeHidden();
  await expectActive(
    page,
    ALL_RECIPES.filter((name) => name !== "Omelette"),
  );
  const archived = await openArchived(page);
  await expect(archived.getByRole("listitem")).toContainText(["Omelette"]);
  await expect(titleOf(page)).toHaveText("Recipes 6");
  await expect(sidebarLinkOf(page)).toHaveText(/Recipes\s*6/);
  expect((await savedRecipe(app, "Omelette")).archived).toBe(true);

  const newEditor = await openNewRecipe(page);
  await nameOf(newEditor).fill("Omelette");
  await newEditor.getByRole("button", { name: "Done" }).click();

  await expect(
    newEditor.getByText('"Omelette" is archived. To use it, restore it from Archived.'),
  ).toBeVisible();
  await expect(newEditor).toBeVisible();

  await newEditor.getByRole("button", { name: "Cancel" }).click();

  await expect(newEditor).toBeHidden();
});

test("asks before a reload loses the editor's changes", async ({ page }) => {
  await openBook(page);
  const editor = await openNewRecipe(page);
  await nameOf(editor).click();
  await nameOf(editor).pressSequentially("Tortilla");
  const kinds = [];
  page.on("dialog", async (dialog) => {
    kinds.push(dialog.type());
    await dialog.dismiss();
  });

  // A reload that the prompt cancels never finishes, so don't wait for it.
  await page.evaluate(() => {
    setTimeout(() => location.reload());
  });

  await expect.poll(() => kinds).toEqual(["beforeunload"]);
  await expect(editor).toBeVisible();
  await expect(nameOf(editor)).toHaveValue("Tortilla");

  await editor.getByRole("button", { name: "Cancel" }).click();

  await expect(editor).toBeHidden();
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
  await page
    .getByRole("navigation", { name: "Sections" })
    .getByRole("link", { name: "Meal plan" })
    .click();
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

test("shows why a save, an archive, and a restore failed", async ({ app, network, page }) => {
  await app.api.updateRecipe(app.recipes["Green salad"].id, { archived: true });
  await openBook(page);
  const editor = await openRecipe(page, "Lentil soup");
  await nameOf(editor).fill("Red lentil soup");
  await network.down();

  await editor.getByRole("button", { name: "Done" }).click();

  await expect(editor.getByText("Couldn't save the recipe. Try again.")).toBeVisible();
  await expect(nameOf(editor)).toHaveValue("Red lentil soup");

  await editor.getByRole("button", { name: "Archive", exact: true }).click();
  await page
    .getByRole("alertdialog", { name: "Archive without saving?" })
    .getByRole("button", { name: "Archive Without Saving" })
    .click();

  await expect(editor.getByText("Couldn't archive the recipe. Try again.")).toBeVisible();
  await expect(editor).toBeVisible();

  await editor.getByRole("button", { name: "Cancel" }).click();
  await expect(editor).toBeHidden();
  const archived = await openArchived(page);
  await page.getByRole("button", { name: "Restore Green salad" }).click();

  await expect(
    archived.getByRole("listitem").filter({ hasText: "Couldn't restore the recipe. Try again." }),
  ).toContainText("Green salad");
});

test("saves a recipe once the server is back", async ({ app, network, page }) => {
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

test("shows the load error and loads again with Retry", async ({ network, page }) => {
  await openBook(page);
  await network.down();

  await rowOf(page, "Lentil soup").click();

  await expect(loadError(page)).toBeVisible();
  const retry = loadError(page).getByRole("button", { name: "Retry" });
  await expect(retry).toBeFocused();
  await expect(editorOf(page, "Edit recipe")).toBeHidden();

  await page.reload();

  await expect(loadError(page)).toBeVisible();

  await network.up();
  await retry.click();

  await expect(loadError(page)).toBeHidden();
  await expectActive(page, ALL_RECIPES);
});

test("asks before archiving a recipe with unsaved changes", async ({ app, page }) => {
  await createTortilla(app);
  await openBook(page);
  const editor = await openRecipe(page, "Tortilla");
  await nameOf(editor).fill("Spanish omelette");

  await editor.getByRole("button", { name: "Archive", exact: true }).click();

  const alert = page.getByRole("alertdialog", { name: "Archive without saving?" });
  await expect(alert).toBeVisible();
  await expect(alert.getByRole("button", { name: "Keep Editing" })).toBeFocused();

  await alert.getByRole("button", { name: "Keep Editing" }).click();

  await expect(alert).toBeHidden();
  await expect(editor).toBeVisible();
  await expect(nameOf(editor)).toHaveValue("Spanish omelette");

  await editor.getByRole("button", { name: "Archive", exact: true }).click();
  await alert.getByRole("button", { name: "Archive Without Saving" }).click();

  await expect(editor).toBeHidden();
  const archived = await openArchived(page);
  await expect(archived.getByRole("listitem")).toContainText(["Tortilla"]);
  expect(await savedRecipe(app, "Tortilla")).toMatchObject({ archived: true });
  expect(await savedRecipe(app, "Spanish omelette")).toBeUndefined();

  await page.getByRole("button", { name: "Restore Tortilla" }).click();

  await expect(archivedListOf(page)).toBeHidden();
  await expectActive(page, [...ALL_RECIPES, "Tortilla"]);
  expect(await savedRecipe(app, "Tortilla")).toMatchObject({ archived: false });
});

test("flags a taken name and a bad quantity as you type", async ({ app, page }) => {
  await openBook(page);
  const editor = await openNewRecipe(page);

  await nameOf(editor).fill("russian SALAD");

  const taken = editor.getByText('"Russian salad" already exists.');
  await expect(taken).toBeVisible();

  const quantity = await addEgg(editor);
  await quantity.fill("abc");

  await expect(quantity).toHaveAttribute("aria-invalid", "true");
  await expect(quantity).toHaveCSS("box-shadow", RED);
  const done = editor.getByRole("button", { name: "Done" });
  await expect(done).toBeEnabled();

  await done.click();

  await expect(editor).toBeVisible();
  await expect(taken).toBeVisible();
  const row = editor.getByRole("listitem").filter({ hasText: "Egg" });
  await expect(row.getByText(QUANTITY_MESSAGE)).toBeVisible();

  await editor.getByRole("button", { name: "Cancel" }).click();

  await expect(editor).toBeHidden();
  expect(await savedRecipe(app, "russian SALAD")).toBeUndefined();
});

test("opens an archived recipe without Archive", async ({ app, page }) => {
  await app.api.updateRecipe(app.recipes.Omelette.id, { archived: true });
  await openBook(page);
  await openArchived(page);

  const editor = await openRecipe(page, "Omelette");

  await expect(editor.getByRole("button", { name: "Archive", exact: true })).toBeHidden();

  await editor.getByRole("button", { name: "Cancel" }).click();

  await expect(editor).toBeHidden();
  await expect(archivedListOf(page).getByRole("listitem")).toContainText(["Omelette"]);
});
