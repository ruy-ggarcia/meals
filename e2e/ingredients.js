// What the specs of the ingredient catalog share: how to find its parts, and
// the ingredients that its tests start from.

/** The ingredient editor, titled `New ingredient` for a new ingredient and `Edit ingredient` for an existing one. */
export function editorOf(page, title) {
  return page.getByRole("dialog", { name: title });
}

/** The Name field of `editor`. */
export function nameOf(editor) {
  return editor.getByRole("textbox", { name: "Name", exact: true });
}

/** The row button that opens the ingredient called `name`. */
export function rowOf(page, name) {
  return page.getByRole("button", { name: `Edit ${name}`, exact: true });
}

/** The Unit control of `editor`. */
export function unitOf(editor) {
  return editor.getByRole("group", { name: "Unit" });
}

/** The choice `unit` (`g`, `ml`, or `pcs`) of the Unit control of `editor`. */
export function choiceOf(editor, unit) {
  return unitOf(editor).getByRole("radio", { name: unit, exact: true });
}

/** The Add measure button of `editor`. */
export function addMeasureOf(editor) {
  return editor.getByRole("button", { name: "Add measure" });
}

/** The measure rows of `editor`. */
export function measureRowsOf(editor) {
  return editor.getByRole("list", { name: "Measures" }).getByRole("listitem");
}

/** The name field of a measure `row`. */
export function measureNameOf(row) {
  return row.getByRole("textbox", { name: "Measure name" });
}

/** The amount field of a measure `row`. */
export function measureAmountOf(row) {
  return row.getByRole("textbox", { name: /^Amount of / });
}

/** The red button that removes a measure `row`. */
export function removeOf(row) {
  return row.getByRole("button", { name: /^Remove / });
}

/** The fields of the conversion row of `editor`, which shows when a unit change needs one. */
export function conversionOf(editor) {
  return {
    from: editor.getByRole("textbox", { name: "Amount in the old unit" }),
    to: editor.getByRole("textbox", { name: "Amount in the new unit" }),
    measure: editor.getByRole("textbox", { name: "Saved as measure" }),
  };
}

/** Reads the ingredient called `name` as the server saved it. */
export async function savedIngredient(app, name) {
  const { ingredients } = await app.api.ingredients();
  return ingredients.find((ingredient) => ingredient.name === name);
}

/** Gives `Onion` the measures `medium` (150) and `large` (250), and returns it. */
export function giveOnionMeasures(app) {
  return app.api.updateIngredient(app.ingredients.Onion.id, {
    measures: [
      { name: "medium", amount: 150 },
      { name: "large", amount: 250 },
    ],
  });
}

/** Adds `2` `medium` `Onion` to `Russian salad`, with `onion` as `giveOnionMeasures` returned it. */
export function useMediumOnions(app, onion) {
  return app.api.updateRecipe(app.recipes["Russian salad"].id, {
    ingredients: [{ ingredientId: onion.id, measureId: onion.measures[0].id, quantity: 2 }],
  });
}
