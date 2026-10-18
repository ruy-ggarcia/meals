// Tests for the Ingredients page (public/ingredients.js) against a real DOM,
// built from the real public/ingredients.html. See test/dom-helpers.js for
// the harness and the DOM library choice. The list logic it shares with the
// recipe book is also covered by test/recipes-page.test.js.

import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { assertFocus, fakeFetch, loadPage, tick, waitFor } from "./dom-helpers.js";

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

async function openIngredientsPage(ingredients = [], recipes = []) {
  server = fakeFetch();
  page = await loadPage({
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

// Waits for the reload that New ingredient and Edit send before the editor
// opens.
async function reloadRequests() {
  await waitFor(
    () => server.requests.filter((request) => request.url === "/api/ingredients").length === 2,
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

function pointerdownOn(element) {
  element.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }));
}

function activeRows() {
  return [...document.querySelectorAll("#active-ingredients .catalog-row")].map((row) => [
    row.querySelector(".entry-name").textContent,
    row.querySelector(".entry-unit").textContent,
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

beforeEach(() => {
  mock.method(console, "error", () => {}); // some tests simulate a failed request on purpose
});

afterEach(async () => {
  await page.cleanup();
  mock.restoreAll();
});

test("rows show each ingredient's name and unit from A to Z, and archived ones under Archived", async () => {
  await openIngredientsPage([
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

test("a row shows the unit followed by the measure names", async () => {
  const measures = [
    { id: "m1", name: "medium", amount: 150 },
    { id: "m2", name: "large", amount: 250 },
  ];
  await openIngredientsPage([ingredient("1", "Onion", "g", false, measures)]);

  assert.deepEqual(activeRows(), [["Onion", "g · medium, large"]]);
});

test("a measure used by two recipes, one archived, has Remove disabled with Used in 2 recipes.", async () => {
  const onion = ingredient("1", "Onion", "g", false, [{ id: "m1", name: "medium", amount: 150 }]);
  const line = { ingredientId: "1", quantity: 1, measureId: "m1" };
  await openIngredientsPage(
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

test("New ingredient opens the editor, and a saved one appears in its sorted place with its Edit focused", async () => {
  await openIngredientsPage([ingredient("1", "Onion")]);

  await clickAndReload(newButton());
  const dialog = document.getElementById("ingredient-editor");
  assert.equal(dialog.open, true);
  assert.equal(dialog.querySelector(".dialog-title").textContent, "New ingredient");
  setValue(document.getElementById("ingredient-name"), "Milk");
  const unit = document.getElementById("ingredient-unit");
  unit.value = "ml";
  unit.dispatchEvent(new window.Event("change", { bubbles: true }));
  dialog.querySelector(".done").click();
  await waitFor(() => server.requestFor("POST", "/api/ingredients") !== undefined);
  assert.deepEqual(server.requestFor("POST", "/api/ingredients").body, {
    name: "Milk",
    unit: "ml",
  });
  await respondTo("POST", "/api/ingredients", 201, ingredient("2", "Milk", "ml"));

  assert.equal(dialog.open, false);
  assert.deepEqual(activeNames(), ["Milk", "Onion"]);
  assertFocus(document, buttonLabeled("Edit Milk"));
});

test("Cancel on a new ingredient returns focus to New ingredient", async () => {
  await openIngredientsPage();

  await clickAndReload(newButton());
  const dialog = document.getElementById("ingredient-editor");
  dialog.querySelector(".cancel").click();

  assert.equal(dialog.open, false);
  assertFocus(document, newButton());
});

test("Edit opens the editor, and a saved name updates the row and focuses its Edit button", async () => {
  await openIngredientsPage([ingredient("1", "Onion")]);

  await clickAndReload(buttonLabeled("Edit Onion"));
  const dialog = document.getElementById("ingredient-editor");
  assert.equal(dialog.open, true);
  setValue(document.getElementById("ingredient-name"), "Red onion");
  dialog.querySelector(".done").click();
  await respondTo("PATCH", "/api/ingredients/1", 200, ingredient("1", "Red onion"));

  assert.equal(dialog.open, false);
  assert.deepEqual(activeNames(), ["Red onion"]);
  assertFocus(document, buttonLabeled("Edit Red onion"));
});

test("Cancel after Edit returns focus to the ingredient's Edit button", async () => {
  await openIngredientsPage([ingredient("1", "Onion")]);

  await clickAndReload(buttonLabeled("Edit Onion"));
  const dialog = document.getElementById("ingredient-editor");
  dialog.querySelector(".cancel").click();

  assert.equal(dialog.open, false);
  assertFocus(document, buttonLabeled("Edit Onion"));
});

test("Escape after Edit returns focus to the ingredient's Edit button", async () => {
  await openIngredientsPage([ingredient("1", "Onion")]);

  await clickAndReload(buttonLabeled("Edit Onion"));
  document.getElementById("ingredient-editor").close(); // what Escape does to a modal dialog

  assertFocus(document, buttonLabeled("Edit Onion"));
});

test("a backdrop click with no changes after Edit returns focus to the ingredient's Edit button", async () => {
  await openIngredientsPage([ingredient("1", "Onion")]);

  await clickAndReload(buttonLabeled("Edit Onion"));
  const dialog = document.getElementById("ingredient-editor");
  pointerdownOn(dialog);
  dialog.click();

  assert.equal(dialog.open, false);
  assertFocus(document, buttonLabeled("Edit Onion"));
});

test("Edit keeps Unit enabled for an ingredient that recipes use", async () => {
  await openIngredientsPage([ingredient("1", "Onion")], [recipe("r1", "Soup", ["1"])]);

  await clickAndReload(buttonLabeled("Edit Onion"));

  assert.equal(document.getElementById("ingredient-unit").disabled, false);
});

test("Archive moves an ingredient to Archived", async () => {
  await openIngredientsPage([ingredient("1", "Onion")]);

  buttonLabeled("Archive Onion").click();
  await respondTo("PATCH", "/api/ingredients/1", 200, ingredient("1", "Onion", "g", true));

  assert.deepEqual(activeNames(), []);
  assert.deepEqual(archivedNames(), ["Onion"]);
});

test("the empty catalog and a search with no matches show their messages", async () => {
  await openIngredientsPage();
  assert.equal(
    document.getElementById("empty-catalog").textContent,
    "No ingredients yet. Add your first one with New ingredient.",
  );
  assert.equal(document.getElementById("empty-catalog").hidden, false);
  await page.cleanup();

  await openIngredientsPage([ingredient("1", "Onion")]);
  setValue(document.getElementById("search"), "zzz");
  assert.equal(document.getElementById("no-matches").textContent, 'No ingredients match "zzz".');
});

test("a load failure shows the error, and Retry loads again", async () => {
  server = fakeFetch();
  page = await loadPage({
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

test("Edit opens the editor with the ingredient and its usage from a reload, not from the first load", async () => {
  await openIngredientsPage(
    [ingredient("carrot", "Carrot", "pcs")],
    [recipe("r1", "Soup", ["carrot"])],
  );
  // Meanwhile, another device converted Carrot to g.
  const piece = { id: "piece", name: "pcs", amount: 120 };
  const line = { ingredientId: "carrot", quantity: 1, measureId: "piece" };

  await clickAndReload(buttonLabeled("Edit Carrot"), {
    ingredients: [ingredient("carrot", "Carrot", "g", false, [piece])],
    recipes: [{ id: "r1", name: "Soup", archived: false, ingredients: [line] }],
  });

  assert.equal(editorDialog().open, true);
  assert.equal(document.getElementById("ingredient-unit").value, "g");
  assert.equal(editorDialog().querySelector(".measure-name").value, "pcs");
  assert.equal(editorDialog().querySelector(".measure-amount").value, "120");
  assert.equal(editorDialog().querySelector(".measure-row .remove").disabled, true);
  assert.equal(
    editorDialog().querySelector(".measure-row .row-hint").textContent,
    "Used in 1 recipe.",
  );
  assert.deepEqual(activeRows(), [["Carrot", "g · pcs"]]);
});

test("New ingredient refreshes the list from a reload before it opens", async () => {
  await openIngredientsPage([ingredient("1", "Onion")]);

  await clickAndReload(newButton(), {
    ingredients: [ingredient("1", "Onion"), ingredient("2", "Milk", "ml")],
    recipes: [],
  });

  assert.equal(editorDialog().open, true);
  assert.equal(editorDialog().querySelector(".dialog-title").textContent, "New ingredient");
  assert.deepEqual(activeNames(), ["Milk", "Onion"]);
});

test("a failed reload shows the load error, focuses Retry, and doesn't open the editor", async () => {
  await openIngredientsPage([ingredient("1", "Onion")]);

  for (const button of [buttonLabeled("Edit Onion"), newButton()]) {
    const count = server.requests.length;
    button.click();
    await waitFor(() => server.requests.length === count + 2);
    server.requestFor("GET", "/api/ingredients").fail();
    server.requestFor("GET", "/api/recipes").respond(200, { recipes: served.recipes });
    await tick();

    assert.equal(editorDialog().open, false);
    assert.equal(document.getElementById("load-error").hidden, false);
    assertFocus(document, document.getElementById("retry-load"));

    document.getElementById("retry-load").click();
    await waitFor(() => server.requests.length === count + 4);
    server.requestFor("GET", "/api/ingredients").respond(200, { ingredients: served.ingredients });
    server.requestFor("GET", "/api/recipes").respond(200, { recipes: served.recipes });
    await tick();
    assert.equal(document.getElementById("load-error").hidden, true);
  }
});

test("Edit on an ingredient that the reload no longer has refreshes the list and doesn't open the editor", async () => {
  await openIngredientsPage([ingredient("1", "Onion")]);

  await clickAndReload(buttonLabeled("Edit Onion"), {
    ingredients: [ingredient("2", "Milk", "ml")],
    recipes: [],
  });

  assert.equal(editorDialog().open, false);
  assert.deepEqual(activeNames(), ["Milk"]);
  assertFocus(document, document.getElementById("search"));
});

test("a second click while the reload runs sends no second reload", async () => {
  await openIngredientsPage([ingredient("1", "Onion")]);

  buttonLabeled("Edit Onion").click();
  newButton().click();
  const reload = await reloadRequests();
  reload.ingredients.respond(200, { ingredients: served.ingredients });
  reload.recipes.respond(200, { recipes: served.recipes });
  await tick();

  assert.equal(server.requests.length, 4);
  assert.equal(editorDialog().querySelector(".dialog-title").textContent, "Edit ingredient");
});

function chooseUnit(value) {
  const unit = document.getElementById("ingredient-unit");
  unit.value = value;
  unit.dispatchEvent(new window.Event("change", { bubbles: true }));
}

test("a unit change on an ingredient that a recipe has in its unit saves that unit as a measure", async () => {
  await openIngredientsPage(
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

test("a unit change on an ingredient that recipes have only in a measure asks for no measure name", async () => {
  const medium = { id: "m1", name: "medium", amount: 150 };
  const line = { ingredientId: "onion", quantity: 1, measureId: "m1" };
  await openIngredientsPage(
    [ingredient("onion", "Onion", "g", false, [medium])],
    [{ id: "r1", name: "Soup", archived: false, ingredients: [line] }],
  );
  await clickAndReload(buttonLabeled("Edit Onion"));

  chooseUnit("pcs");

  assert.equal(editorDialog().querySelector(".conversion").hidden, false);
  assert.equal(editorDialog().querySelector(".conversion-measure").hidden, true);
});
