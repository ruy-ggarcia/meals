// What the specs of the recipe book share: how to open it and its editor, how
// to find its parts, and the recipe that its tests start from.

import { expect } from "./fixtures.js";
import {
  archivedHeadingOf,
  archivedListOf as archivedList,
  editorOf,
  nameOf,
  openArchivedList,
  rowOf,
} from "./lists.js";

export { archivedHeadingOf, editorOf, nameOf, rowOf };

/** Opens the recipe book, and waits until it has loaded. */
export async function openBook(page) {
  await page.goto("/recipes.html");
  await expect(rowOf(page, "Gnocchi carbonara")).toBeVisible();
}

/** Opens the editor of the recipe called `name`. */
export async function openRecipe(page, name) {
  await rowOf(page, name).click();
  const editor = editorOf(page, "Edit recipe");
  await expect(editor).toBeVisible();
  return editor;
}

/** Opens the editor of a new recipe. */
export async function openNewRecipe(page) {
  await page.getByRole("button", { name: "New recipe" }).click();
  const editor = editorOf(page, "New recipe");
  await expect(editor).toBeVisible();
  return editor;
}

/** The Add ingredient field of `editor`. */
export function ingredientSearchOf(editor) {
  return editor.getByRole("combobox", { name: "Add ingredient" });
}

/** The quantity field of the row of `ingredient` in `editor`. */
export function quantityOf(editor, ingredient) {
  return editor.getByRole("textbox", { name: `Quantity of ${ingredient} per serving` });
}

/** The list of the active recipes. */
export function activeListOf(page) {
  return page.getByRole("list", { name: "Recipes", exact: true });
}

/** The list under Archived, which shows once you open the section. */
export function archivedListOf(page) {
  return archivedList(page, "Archived recipes");
}

/** Opens the Archived section, and returns its list. */
export function openArchived(page) {
  return openArchivedList(page, "Archived recipes");
}

/** Reads the recipe called `name` as the server saved it. */
export async function savedRecipe(app, name) {
  const { recipes } = await app.api.recipes();
  return recipes.find((recipe) => recipe.name === name);
}

/** Adds `Tortilla`, with `Egg` at `1.25`, the recipe that a save of the recipe book leaves. */
export function createTortilla(app) {
  return app.api.createRecipe({
    name: "Tortilla",
    ingredients: [{ ingredientId: app.ingredients.Egg.id, quantity: 1.25 }],
  });
}
