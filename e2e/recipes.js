// What the specs of the recipe book share: how to find its parts, and the
// recipe that its tests start from.

/** The recipe editor, titled `New recipe` for a new recipe and `Edit recipe` for an existing one. */
export function editorOf(page, title) {
  return page.getByRole("dialog", { name: title });
}

/** The Name field of `editor`. */
export function nameOf(editor) {
  return editor.getByRole("textbox", { name: "Name", exact: true });
}

/** The Add ingredient field of `editor`. */
export function ingredientSearchOf(editor) {
  return editor.getByRole("combobox", { name: "Add ingredient" });
}

/** The quantity field of the row of `ingredient` in `editor`. */
export function quantityOf(editor, ingredient) {
  return editor.getByRole("textbox", { name: `Quantity of ${ingredient} per serving` });
}

/** The row button that opens the recipe called `name`. */
export function rowOf(page, name) {
  return page.getByRole("button", { name: `Edit ${name}`, exact: true });
}

/** The list of the active recipes. */
export function activeListOf(page) {
  return page.getByRole("list", { name: "Recipes", exact: true });
}

/** The list under Archived, which shows once you open the section. */
export function archivedListOf(page) {
  return page.getByRole("list", { name: "Archived recipes", exact: true });
}

/**
 * The heading of the Archived section. A `summary` has no role that
 * Playwright can find, so its tag finds it.
 */
export function archivedHeadingOf(page) {
  return page.locator("summary").filter({ hasText: "Archived" });
}

/** Opens the Archived section, and returns its list. */
export async function openArchived(page) {
  await archivedHeadingOf(page).click();
  const list = archivedListOf(page);
  await list.waitFor();
  return list;
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
