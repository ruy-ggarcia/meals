// Tests for the Ingredients page (public/ingredients.js) against a real DOM,
// built from the real public/ingredients.html. See test/dom-helpers.js for
// the harness and the DOM library choice. The list logic it shares with the
// recipe book is also covered by test/recipes-page.test.js.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { assertFocus, fakeFetch, openPage, tick, useQuietConsole, waitFor } from "./dom-helpers.js";

const quiet = useQuietConsole();

function ingredient(id, name, unit = "g", archived = false, measures = []) {
  return { id, name, unit, archived, measures };
}

function recipe(id, name, ingredientIds, archived = false) {
  return {
    id,
    name,
    archived,
    ingredients: ingredientIds.map((ingredientId) => ({ ingredientId, quantity: 1 })),
  };
}

let page;
let server;
let document;
let window;
/** The catalog and the recipes that the page loaded with: { ingredients, recipes }. */
let served;

async function openIngredientsPage(t, ingredients = [], recipes = []) {
  server = fakeFetch();
  page = await openPage(t, {
    html: "ingredients.html",
    script: "ingredients.js",
    fetch: server.fetch,
  });
  ({ document, window } = page);
  served = { ingredients, recipes };
  await tick();
  server.requestFor("GET", "/api/ingredients").respond(200, { ingredients });
  server.requestFor("GET", "/api/recipes").respond(200, { recipes });
  await tick();
}

function requestUrls() {
  return server.requests.map((request) => request.url).join(", ");
}

// Waits for the reload that New ingredient and Edit send before the editor
// opens.
async function reloadRequests() {
  await waitFor(
    () => server.requests.filter((request) => request.url === "/api/ingredients").length === 2,
    {
      message: () => `the page sent ${requestUrls()}, not a load and a reload of the ingredients`,
    },
  );
  return {
    ingredients: server.requestFor("GET", "/api/ingredients"),
    recipes: server.requestFor("GET", "/api/recipes"),
  };
}

// Clicks New ingredient or Edit, and answers the reload with `fresh`, or else
// with the data that the page loaded with.
async function clickAndReload(button, fresh = served) {
  button.click();
  const reload = await reloadRequests();
  reload.ingredients.respond(200, { ingredients: fresh.ingredients });
  reload.recipes.respond(200, { recipes: fresh.recipes });
  await tick();
}

function newButton() {
  return document.getElementById("new-ingredient");
}

function setValue(element, value) {
  element.value = value;
  element.dispatchEvent(new window.Event("input", { bubbles: true }));
}

// Checks the unit's radio button in the editor, as a click or an arrow key does.
function chooseUnit(value) {
  const radio = document.querySelector(`#ingredient-unit input[value="${value}"]`);
  radio.checked = true;
  radio.dispatchEvent(new window.Event("change", { bubbles: true }));
}

function pointerdownOn(element) {
  element.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }));
}

function activeRows() {
  return [...document.querySelectorAll("#active-ingredients .catalog-row")].map((row) => [
    row.querySelector(".entry-name").textContent,
    row.querySelector(".entry-detail").textContent,
  ]);
}

function activeNames() {
  return activeRows().map(([name]) => name);
}

function archivedNames() {
  return [...document.querySelectorAll("#archived-ingredients .entry-name")].map(
    (el) => el.textContent,
  );
}

function buttonLabeled(label) {
  return document.querySelector(`[aria-label="${label}"]`);
}

async function respondTo(method, url, status, body) {
  await waitFor(() => server.requestFor(method, url) !== undefined);
  server.requestFor(method, url).respond(status, body);
  await tick();
}

test("rows show each ingredient's name and unit from A to Z, and archived ones under Archived", async (t) => {
  await openIngredientsPage(t, [
    ingredient("1", "Onion"),
    ingredient("2", "Egg", "pcs"),
    ingredient("3", "Saffron", "g", true),
  ]);

  assert.deepEqual(activeRows(), [
    ["Egg", "pcs"],
    ["Onion", "g"],
  ]);
  assert.deepEqual(archivedNames(), ["Saffron"]);
});

test("a row shows the unit followed by the measure names", async (t) => {
  const measures = [
    { id: "m1", name: "medium", amount: 150 },
    { id: "m2", name: "large", amount: 250 },
  ];
  await openIngredientsPage(t, [ingredient("1", "Onion", "g", false, measures)]);

  assert.deepEqual(activeRows(), [["Onion", "g · medium, large"]]);
});

test("a measure used by two recipes, one archived, has Remove disabled with Used in 2 recipes.", async (t) => {
  const onion = ingredient("1", "Onion", "g", false, [{ id: "m1", name: "medium", amount: 150 }]);
  const line = { ingredientId: "1", quantity: 1, measureId: "m1" };
  await openIngredientsPage(
    t,
    [onion],
    [
      { id: "r1", name: "Soup", archived: false, ingredients: [line] },
      { id: "r2", name: "Stew", archived: true, ingredients: [line] },
    ],
  );

  await clickAndReload(buttonLabeled("Edit Onion"));

  const dialog = document.getElementById("ingredient-editor");
  assert.equal(dialog.querySelector(".measure-row .remove").disabled, true);
  assert.equal(dialog.querySelector(".measure-row .row-hint").textContent, "Used in 2 recipes.");
});

test("Cancel on a new ingredient returns focus to New ingredient", async (t) => {
  await openIngredientsPage(t);

  await clickAndReload(newButton());
  const dialog = document.getElementById("ingredient-editor");
  dialog.querySelector(".cancel").click();

  assert.equal(dialog.open, false);
  assertFocus(document, newButton());
});

test("Cancel after Edit returns focus to the ingredient's Edit button", async (t) => {
  await openIngredientsPage(t, [ingredient("1", "Onion")]);

  await clickAndReload(buttonLabeled("Edit Onion"));
  const dialog = document.getElementById("ingredient-editor");
  dialog.querySelector(".cancel").click();

  assert.equal(dialog.open, false);
  assertFocus(document, buttonLabeled("Edit Onion"));
});

test("Escape after Edit returns focus to the ingredient's Edit button", async (t) => {
  await openIngredientsPage(t, [ingredient("1", "Onion")]);

  await clickAndReload(buttonLabeled("Edit Onion"));
  document.getElementById("ingredient-editor").close(); // what Escape does to a modal dialog

  assertFocus(document, buttonLabeled("Edit Onion"));
});

test("a backdrop click with no changes after Edit returns focus to the ingredient's Edit button", async (t) => {
  await openIngredientsPage(t, [ingredient("1", "Onion")]);

  await clickAndReload(buttonLabeled("Edit Onion"));
  const dialog = document.getElementById("ingredient-editor");
  pointerdownOn(dialog);
  dialog.click();

  assert.equal(dialog.open, false);
  assertFocus(document, buttonLabeled("Edit Onion"));
});

test("Edit keeps Unit enabled for an ingredient that recipes use", async (t) => {
  await openIngredientsPage(t, [ingredient("1", "Onion")], [recipe("r1", "Soup", ["1"])]);

  await clickAndReload(buttonLabeled("Edit Onion"));

  assert.equal(document.getElementById("ingredient-unit").disabled, false);
});

// Opens the editor with New ingredient, names the ingredient Milk in ml, and
// answers the save. The catalog held Onion.
async function saveNewIngredient(t) {
  await openIngredientsPage(t, [ingredient("1", "Onion")]);
  await clickAndReload(newButton());
  setValue(document.getElementById("ingredient-name"), "Milk");
  chooseUnit("ml");
  editorDialog().querySelector(".done").click();
  await respondTo("POST", "/api/ingredients", 201, ingredient("2", "Milk", "ml"));
}

// Opens the editor with Edit on Onion, renames the ingredient Red onion, and
// answers the save.
async function saveEditedIngredient(t) {
  await openIngredientsPage(t, [ingredient("1", "Onion")]);
  await clickAndReload(buttonLabeled("Edit Onion"));
  setValue(document.getElementById("ingredient-name"), "Red onion");
  editorDialog().querySelector(".done").click();
  await respondTo("PATCH", "/api/ingredients/1", 200, ingredient("1", "Red onion"));
}

// Archives Onion in the editor, in a catalog where Salt follows it.
async function archiveOnion(t) {
  await openIngredientsPage(t, [ingredient("1", "Onion"), ingredient("2", "Salt")]);
  await clickAndReload(buttonLabeled("Edit Onion"));
  editorDialog().querySelector(".archive").click();
  await respondTo("PATCH", "/api/ingredients/1", 200, ingredient("1", "Onion", "g", true));
}

function counts() {
  return [...document.querySelectorAll('[data-count="ingredients"]')].map(
    (count) => count.textContent,
  );
}

// Opens the editor with Edit on Carrot, after another device converted Carrot
// to g and a recipe used the measure, so the reload and the first load differ.
async function editCarrotAfterConversion(t) {
  await openIngredientsPage(
    t,
    [ingredient("carrot", "Carrot", "pcs")],
    [recipe("r1", "Soup", ["carrot"])],
  );
  const piece = { id: "piece", name: "pcs", amount: 120 };
  const line = { ingredientId: "carrot", quantity: 1, measureId: "piece" };

  await clickAndReload(buttonLabeled("Edit Carrot"), {
    ingredients: [ingredient("carrot", "Carrot", "g", false, [piece])],
    recipes: [{ id: "r1", name: "Soup", archived: false, ingredients: [line] }],
  });
}

describe("ingredient catalog", () => {
  test("opens the editor titled New ingredient with New ingredient", async (t) => {
    await openIngredientsPage(t, [ingredient("1", "Onion")]);

    await clickAndReload(newButton());

    assert.equal(editorDialog().open, true);
    assert.equal(editorDialog().querySelector(".dialog-title").textContent, "New ingredient");
  });

  test("sends the name and the unit of a new ingredient with Done", async (t) => {
    await saveNewIngredient(t);

    assert.deepEqual(server.requestFor("POST", "/api/ingredients").body, {
      name: "Milk",
      unit: "ml",
    });
  });

  test("closes the editor after a new ingredient is saved", async (t) => {
    await saveNewIngredient(t);

    assert.equal(editorDialog().open, false);
  });

  test("shows a saved new ingredient in its sorted place", async (t) => {
    await saveNewIngredient(t);

    assert.deepEqual(activeNames(), ["Milk", "Onion"]);
  });

  test("focuses the Edit button of a saved new ingredient", async (t) => {
    await saveNewIngredient(t);

    assertFocus(document, buttonLabeled("Edit Milk"));
  });

  test("opens the editor with Edit", async (t) => {
    await openIngredientsPage(t, [ingredient("1", "Onion")]);

    await clickAndReload(buttonLabeled("Edit Onion"));

    assert.equal(editorDialog().open, true);
  });

  test("closes the editor after an edited ingredient is saved", async (t) => {
    await saveEditedIngredient(t);

    assert.equal(editorDialog().open, false);
  });

  test("updates the row of an edited ingredient after a save", async (t) => {
    await saveEditedIngredient(t);

    assert.deepEqual(activeNames(), ["Red onion"]);
  });

  test("focuses the Edit button of an edited ingredient after a save", async (t) => {
    await saveEditedIngredient(t);

    assertFocus(document, buttonLabeled("Edit Red onion"));
  });

  test("moves an ingredient to Archived with Archive in the editor", async (t) => {
    await archiveOnion(t);

    assert.deepEqual(server.requestFor("PATCH", "/api/ingredients/1").body, { archived: true });
    assert.deepEqual(activeNames(), ["Salt"]);
    assert.deepEqual(archivedNames(), ["Onion"]);
  });

  test("updates the counts after an ingredient is archived", async (t) => {
    await openIngredientsPage(t, [ingredient("1", "Onion"), ingredient("2", "Salt")]);
    assert.deepEqual(counts(), ["2", "2"]);

    await clickAndReload(buttonLabeled("Edit Onion"));
    editorDialog().querySelector(".archive").click();
    await respondTo("PATCH", "/api/ingredients/1", 200, ingredient("1", "Onion", "g", true));

    assert.deepEqual(counts(), ["1", "1"]);
  });

  test("focuses the row in the place of an archived ingredient", async (t) => {
    await archiveOnion(t);

    assertFocus(document, buttonLabeled("Edit Salt"));
  });

  test("shows a message for an empty catalog", async (t) => {
    await openIngredientsPage(t);

    assert.equal(
      document.getElementById("empty-catalog").textContent,
      "No ingredients yet. Add your first one with New ingredient.",
    );
    assert.equal(document.getElementById("empty-catalog").hidden, false);
  });

  test("shows a message for a search with no matches", async (t) => {
    await openIngredientsPage(t, [ingredient("1", "Onion")]);

    setValue(document.getElementById("search"), "zzz");

    assert.equal(document.getElementById("no-matches").textContent, 'No ingredients match "zzz".');
  });

  test("opens the editor with the ingredient of the reload, not the first", async (t) => {
    await editCarrotAfterConversion(t);

    assert.equal(editorDialog().open, true);
    assert.equal(document.querySelector("#ingredient-unit input:checked").value, "g");
    assert.equal(editorDialog().querySelector(".measure-name").value, "pcs");
    assert.equal(editorDialog().querySelector(".measure-amount").value, "120");
  });

  test("shows the usage of the reload in the editor", async (t) => {
    await editCarrotAfterConversion(t);

    assert.equal(editorDialog().querySelector(".measure-row .remove").disabled, true);
    assert.equal(
      editorDialog().querySelector(".measure-row .row-hint").textContent,
      "Used in 1 recipe.",
    );
  });

  test("refreshes the list with the ingredients of the reload", async (t) => {
    await editCarrotAfterConversion(t);

    assert.deepEqual(activeRows(), [["Carrot", "g · pcs"]]);
  });
});

test("a load failure shows the error, and Retry loads again", async (t) => {
  quiet.expect(1);
  server = fakeFetch();
  page = await openPage(t, {
    html: "ingredients.html",
    script: "ingredients.js",
    fetch: server.fetch,
  });
  ({ document, window } = page);
  await tick();
  server.requestFor("GET", "/api/ingredients").fail();
  server.requestFor("GET", "/api/recipes").respond(200, { recipes: [] });
  await tick();

  assert.equal(document.getElementById("load-error").hidden, false);
  assert.equal(document.getElementById("ingredient-catalog").hidden, true);

  document.getElementById("retry-load").click();
  await waitFor(
    () => server.requests.filter((request) => request.url === "/api/ingredients").length === 2,
  );
  server.requests
    .filter((request) => request.url === "/api/ingredients")[1]
    .respond(200, { ingredients: [ingredient("1", "Onion")] });
  server.requests
    .filter((request) => request.url === "/api/recipes")[1]
    .respond(200, { recipes: [] });
  await tick();

  assert.equal(document.getElementById("load-error").hidden, true);
  assert.deepEqual(activeNames(), ["Onion"]);
});

function editorDialog() {
  return document.getElementById("ingredient-editor");
}

test("New ingredient refreshes the list from a reload before it opens", async (t) => {
  await openIngredientsPage(t, [ingredient("1", "Onion")]);

  await clickAndReload(newButton(), {
    ingredients: [ingredient("1", "Onion"), ingredient("2", "Milk", "ml")],
    recipes: [],
  });

  assert.equal(editorDialog().open, true);
  assert.equal(editorDialog().querySelector(".dialog-title").textContent, "New ingredient");
  assert.deepEqual(activeNames(), ["Milk", "Onion"]);
});

test("a failed reload shows the load error, focuses Retry, and doesn't open the editor", async (t) => {
  quiet.expect(2);
  await openIngredientsPage(t, [ingredient("1", "Onion")]);

  for (const [name, button] of [
    ["Edit", buttonLabeled("Edit Onion")],
    ["New ingredient", newButton()],
  ]) {
    const count = server.requests.length;
    button.click();
    await waitFor(() => server.requests.length === count + 2, {
      message: () => `${name} sent two requests (the reload), but the page has ${requestUrls()}`,
    });
    server.requestFor("GET", "/api/ingredients").fail();
    server.requestFor("GET", "/api/recipes").respond(200, { recipes: served.recipes });
    await tick();

    assert.equal(editorDialog().open, false, `${name} doesn't open the editor`);
    assert.equal(document.getElementById("load-error").hidden, false, `${name} shows the error`);
    assertFocus(document, document.getElementById("retry-load"), `${name} focuses Retry`);

    document.getElementById("retry-load").click();
    await waitFor(() => server.requests.length === count + 4, {
      message: () => `Retry sent two more requests, but the page has ${requestUrls()}`,
    });
    server.requestFor("GET", "/api/ingredients").respond(200, { ingredients: served.ingredients });
    server.requestFor("GET", "/api/recipes").respond(200, { recipes: served.recipes });
    await tick();
    assert.equal(document.getElementById("load-error").hidden, true, `${name} then Retry`);
  }
});

test("Edit on an ingredient that the reload no longer has refreshes the list and doesn't open the editor", async (t) => {
  await openIngredientsPage(t, [ingredient("1", "Onion")]);

  await clickAndReload(buttonLabeled("Edit Onion"), {
    ingredients: [ingredient("2", "Milk", "ml")],
    recipes: [],
  });

  assert.equal(editorDialog().open, false);
  assert.deepEqual(activeNames(), ["Milk"]);
  assertFocus(document, document.getElementById("search"));
});

test("a second click while the reload runs sends no second reload", async (t) => {
  await openIngredientsPage(t, [ingredient("1", "Onion")]);

  buttonLabeled("Edit Onion").click();
  newButton().click();
  const reload = await reloadRequests();
  reload.ingredients.respond(200, { ingredients: served.ingredients });
  reload.recipes.respond(200, { recipes: served.recipes });
  await tick();

  assert.deepEqual(
    server.requests.map((request) => request.url),
    ["/api/ingredients", "/api/recipes", "/api/ingredients", "/api/recipes"],
    "the first load and one reload, each of the ingredients and the recipes",
  );
  assert.equal(editorDialog().querySelector(".dialog-title").textContent, "Edit ingredient");
});

test("a unit change on an ingredient that a recipe has in its unit saves that unit as a measure", async (t) => {
  await openIngredientsPage(
    t,
    [ingredient("carrot", "Carrot", "pcs")],
    [recipe("r1", "Soup", ["carrot"])],
  );
  await clickAndReload(buttonLabeled("Edit Carrot"));

  chooseUnit("g");

  const measureField = editorDialog().querySelector(".conversion-measure");
  assert.equal(measureField.hidden, false);
  assert.match(measureField.textContent, /Saved as measure/);
  assert.equal(editorDialog().querySelector(".conversion-measure-name").value, "pcs");

  setValue(editorDialog().querySelector(".conversion-to"), "120");
  editorDialog().querySelector(".done").click();
  await waitFor(() => server.requestFor("PATCH", "/api/ingredients/carrot") !== undefined);
  assert.deepEqual(server.requestFor("PATCH", "/api/ingredients/carrot").body, {
    unit: "g",
    conversion: { from: 1, to: 120, measureName: "pcs" },
  });
  const piece = { id: "piece", name: "pcs", amount: 120 };
  await respondTo(
    "PATCH",
    "/api/ingredients/carrot",
    200,
    ingredient("carrot", "Carrot", "g", false, [piece]),
  );

  assert.equal(editorDialog().open, false);
  assert.deepEqual(activeRows(), [["Carrot", "g · pcs"]]);
});

test("a unit change on an ingredient that recipes have only in a measure asks for no measure name", async (t) => {
  const medium = { id: "m1", name: "medium", amount: 150 };
  const line = { ingredientId: "onion", quantity: 1, measureId: "m1" };
  await openIngredientsPage(
    t,
    [ingredient("onion", "Onion", "g", false, [medium])],
    [{ id: "r1", name: "Soup", archived: false, ingredients: [line] }],
  );
  await clickAndReload(buttonLabeled("Edit Onion"));

  chooseUnit("pcs");

  assert.equal(editorDialog().querySelector(".conversion").hidden, false);
  assert.equal(editorDialog().querySelector(".conversion-measure").hidden, true);
});
