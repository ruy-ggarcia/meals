// Tests for the recipe book page (public/recipes.js) against a real DOM,
// built from the real public/recipes.html. See test/dom-helpers.js for the
// harness and the DOM library choice. The recipe editor itself has its own
// tests in test/recipe-editor.test.js.

import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { assertFocus, fakeFetch, loadPage, tick, waitFor } from "./dom-helpers.js";

const ONION = { id: "onion", name: "Onion", unit: "g", archived: false };
const WITH_ONION = [{ ingredientId: "onion", quantity: 100 }];

function recipe(id, name, archived = false, ingredients = []) {
  return { id, name, archived, ingredients };
}

let page;
let server;
let document;
let window;
/** The recipes and the catalog that the page loaded with: { recipes, ingredients }. */
let served;

async function openRecipesPage(recipes = [], ingredients = [ONION]) {
  server = fakeFetch();
  page = await loadPage({ html: "recipes.html", script: "recipes.js", fetch: server.fetch });
  ({ document, window } = page);
  served = { recipes, ingredients };
  await tick();
  server.requestFor("GET", "/api/recipes").respond(200, { recipes });
  server.requestFor("GET", "/api/ingredients").respond(200, { ingredients });
  await tick();
}

// Waits for the reload that New and Edit send before the editor opens.
async function reloadRequests() {
  await waitFor(
    () => server.requests.filter((request) => request.url === "/api/recipes").length === 2,
  );
  return {
    recipes: server.requestFor("GET", "/api/recipes"),
    ingredients: server.requestFor("GET", "/api/ingredients"),
  };
}

// Clicks New or Edit, and answers the reload with `fresh`, or else with the
// data that the page loaded with.
async function clickAndReload(button, fresh = served) {
  button.click();
  const reload = await reloadRequests();
  reload.recipes.respond(200, { recipes: fresh.recipes });
  reload.ingredients.respond(200, { ingredients: fresh.ingredients });
  await tick();
}

function setValue(element, value) {
  element.value = value;
  element.dispatchEvent(new window.Event("input", { bubbles: true }));
}

function keydownOn(element, key) {
  const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  return event;
}

function pointerdownOn(element) {
  element.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }));
}

function searchField() {
  return document.getElementById("search");
}

function activeNames() {
  return [...document.querySelectorAll("#active-recipes .entry-name")].map((el) => el.textContent);
}

function archivedNames() {
  return [...document.querySelectorAll("#archived-recipes .entry-name")].map(
    (el) => el.textContent,
  );
}

function rowById(id) {
  return document.querySelector(`.catalog-row[data-id="${id}"]`);
}

function buttonLabeled(label) {
  return document.querySelector(`[aria-label="${label}"]`);
}

function editorDialog() {
  return document.getElementById("recipe-editor");
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

test("New recipe opens the editor, and the saved recipe appears in its sorted place with focus on Edit", async () => {
  await openRecipesPage([recipe("1", "Green salad", false, WITH_ONION)]);

  await clickAndReload(document.getElementById("new-recipe"));

  assert.equal(editorDialog().open, true);
  assert.equal(editorDialog().querySelector(".dialog-title").textContent, "New recipe");
  setValue(document.getElementById("recipe-name"), "Apple pie");
  editorDialog().querySelector(".done").click();
  await respondTo("POST", "/api/recipes", 201, recipe("2", "Apple pie"));

  assert.equal(editorDialog().open, false);
  assert.deepEqual(activeNames(), ["Apple pie", "Green salad"]);
  assertFocus(document, buttonLabeled("Edit Apple pie"));
});

test("Cancel in a new recipe returns focus to New recipe and sends nothing", async () => {
  await openRecipesPage();
  const newRecipe = document.getElementById("new-recipe");

  await clickAndReload(newRecipe);
  editorDialog().querySelector(".cancel").click();

  assert.equal(editorDialog().open, false);
  assertFocus(document, newRecipe);
  assert.equal(server.requestFor("POST", "/api/recipes"), undefined);
});

test("Edit opens the recipe with its ingredients, and a save updates its row", async () => {
  await openRecipesPage([recipe("1", "Soup", false, WITH_ONION)]);

  await clickAndReload(buttonLabeled("Edit Soup"));

  assert.equal(document.getElementById("recipe-name").value, "Soup");
  assert.equal(editorDialog().querySelector(".quantity-field").value, "100");
  setValue(document.getElementById("recipe-name"), "Onion soup");
  editorDialog().querySelector(".done").click();
  await respondTo("PATCH", "/api/recipes/1", 200, recipe("1", "Onion soup", false, WITH_ONION));

  assert.deepEqual(activeNames(), ["Onion soup"]);
  assertFocus(document, buttonLabeled("Edit Onion soup"));
});

test("a save whose recipe the search hides focuses Search", async () => {
  await openRecipesPage([recipe("1", "Green salad", false, WITH_ONION)]);
  setValue(searchField(), "sal");

  await clickAndReload(buttonLabeled("Edit Green salad"));
  setValue(document.getElementById("recipe-name"), "Soup");
  editorDialog().querySelector(".done").click();
  await respondTo("PATCH", "/api/recipes/1", 200, recipe("1", "Soup", false, WITH_ONION));

  assert.deepEqual(activeNames(), []);
  assertFocus(document, searchField());
});

test("Cancel after Edit returns focus to the recipe's Edit button", async () => {
  await openRecipesPage([recipe("1", "Soup", false, WITH_ONION)]);

  await clickAndReload(buttonLabeled("Edit Soup"));
  editorDialog().querySelector(".cancel").click();

  assert.equal(editorDialog().open, false);
  assertFocus(document, buttonLabeled("Edit Soup"));
});

test("Escape after Edit returns focus to the recipe's Edit button", async () => {
  await openRecipesPage([recipe("1", "Soup", false, WITH_ONION)]);

  await clickAndReload(buttonLabeled("Edit Soup"));
  editorDialog().close(); // what Escape does to a modal dialog

  assertFocus(document, buttonLabeled("Edit Soup"));
});

test("a backdrop click with no changes after Edit returns focus to the recipe's Edit button", async () => {
  await openRecipesPage([recipe("1", "Soup", false, WITH_ONION)]);

  await clickAndReload(buttonLabeled("Edit Soup"));
  pointerdownOn(editorDialog());
  editorDialog().click();

  assert.equal(editorDialog().open, false);
  assertFocus(document, buttonLabeled("Edit Soup"));
});

test("archived recipes have Edit and Restore", async () => {
  await openRecipesPage([recipe("1", "Café", true)]);

  assert.ok(buttonLabeled("Edit Café"));
  assert.ok(buttonLabeled("Restore Café"));
  assert.equal(buttonLabeled("Archive Café"), null);
});

test("each row shows the recipe's ingredients, or a warning when it has none", async () => {
  await openRecipesPage([recipe("1", "Coffee"), recipe("2", "Soup", false, WITH_ONION)]);

  const detail = (id) => rowById(id).querySelector(".entry-detail");
  assert.equal(detail("1").textContent.trim(), "No ingredients · not in shopping list");
  assert.ok(detail("1").querySelector(".warning-icon"));
  assert.equal(detail("2").textContent, "Onion");
  assert.equal(detail("2").querySelector(".warning-icon"), null);
  // A screen reader reads the detail after the row's name.
  assert.equal(buttonLabeled("Edit Coffee").getAttribute("aria-describedby"), detail("1").id);
});

test("saving ingredients for a recipe removes its warning icon", async () => {
  await openRecipesPage([recipe("1", "Soup")]);

  await clickAndReload(buttonLabeled("Edit Soup"));
  const search = editorDialog().querySelector(".option-search");
  setValue(search, "oni");
  keydownOn(search, "Enter");
  setValue(editorDialog().querySelector(".quantity-field"), "100");
  editorDialog().querySelector(".done").click();
  await respondTo("PATCH", "/api/recipes/1", 200, recipe("1", "Soup", false, WITH_ONION));

  assert.equal(rowById("1").querySelector(".warning-icon"), null);
});

test("beforeunload prevents leaving only while the editor has changes", async () => {
  await openRecipesPage();
  function dispatchBeforeUnload() {
    const event = new window.Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event;
  }

  await clickAndReload(document.getElementById("new-recipe"));
  assert.equal(dispatchBeforeUnload().defaultPrevented, false);
  setValue(document.getElementById("recipe-name"), "Pie");
  assert.equal(dispatchBeforeUnload().defaultPrevented, true);
  editorDialog().querySelector(".cancel").click();
  assert.equal(dispatchBeforeUnload().defaultPrevented, false);
});

// Opens the editor on the recipe named `name`, chooses Archive, and answers
// the request with the recipe, archived.
async function archiveWithEditor(id, name) {
  await clickAndReload(buttonLabeled(`Edit ${name}`));
  editorDialog().querySelector(".archive").click();
  await respondTo("PATCH", `/api/recipes/${id}`, 200, recipe(id, name, true));
}

test("Archive in the editor moves a recipe to Archived, and focus to the row in its place", async () => {
  await openRecipesPage([
    recipe("1", "Omelette"),
    recipe("2", "Pancakes"),
    recipe("3", "Café", true),
  ]);

  await archiveWithEditor("1", "Omelette");

  assert.deepEqual(server.requestFor("PATCH", "/api/recipes/1").body, { archived: true });
  assert.equal(editorDialog().open, false);
  assert.deepEqual(activeNames(), ["Pancakes"]);
  assert.deepEqual(archivedNames(), ["Café", "Omelette"]);
  assertFocus(document, buttonLabeled("Edit Pancakes"));
});

test("Restore moves a recipe back to the active list, and focus to the row in its place", async () => {
  await openRecipesPage([recipe("1", "Omelette", true), recipe("2", "Café", true)]);

  buttonLabeled("Restore Café").click();
  await respondTo("PATCH", "/api/recipes/2", 200, recipe("2", "Café", false));

  assert.deepEqual(server.requestFor("PATCH", "/api/recipes/2").body, { archived: false });
  assert.deepEqual(activeNames(), ["Café"]);
  assert.deepEqual(archivedNames(), ["Omelette"]);
  assertFocus(document, buttonLabeled("Restore Omelette"));
});

test("a failed restore shows its message and leaves the recipe in Archived", async () => {
  await openRecipesPage([recipe("1", "Omelette", true)]);

  buttonLabeled("Restore Omelette").click();
  await waitFor(() => server.requestFor("PATCH", "/api/recipes/1") !== undefined);
  server.requestFor("PATCH", "/api/recipes/1").fail();
  await tick();

  assert.equal(
    rowById("1").querySelector(".row-message").textContent,
    "Couldn't restore the recipe. Try again.",
  );
  assert.deepEqual(archivedNames(), ["Omelette"]);
});

test("the title and the sidebar count the active recipes, also after an archive", async () => {
  await openRecipesPage([recipe("1", "Omelette"), recipe("2", "Soup"), recipe("3", "Café", true)]);
  const counts = () =>
    [...document.querySelectorAll('[data-count="recipes"]')].map((count) => count.textContent);
  assert.deepEqual(counts(), ["2", "2"]);

  await archiveWithEditor("1", "Omelette");

  assert.deepEqual(counts(), ["1", "1"]);
});

test("shows the empty-book message when there are no recipes", async () => {
  await openRecipesPage([]);

  const empty = document.getElementById("empty-book");
  assert.equal(empty.hidden, false);
  assert.equal(empty.textContent, "No recipes yet. Add your first one with New recipe.");
});

test("search filters the active list to matches", async () => {
  await openRecipesPage([recipe("1", "Green salad"), recipe("2", "Lentil soup")]);
  assert.equal(document.getElementById("empty-book").hidden, true);
  assert.equal(document.getElementById("no-matches").hidden, true);

  setValue(searchField(), "sal");

  assert.deepEqual(activeNames(), ["Green salad"]);
});

test("search shows the no-match message when no active recipe matches", async () => {
  await openRecipesPage([recipe("1", "Green salad"), recipe("2", "Lentil soup")]);

  setValue(searchField(), "zzz");

  assert.deepEqual(activeNames(), []);
  assert.equal(document.getElementById("no-matches").hidden, false);
  assert.equal(document.getElementById("no-matches").textContent, 'No recipes match "zzz".');
});

test("a search that matches only an archived recipe still shows the no-match message", async () => {
  await openRecipesPage([recipe("1", "Omelette", true)]);

  setValue(searchField(), "omel");

  assert.deepEqual(activeNames(), []);
  assert.equal(document.getElementById("no-matches").hidden, false);
  assert.equal(document.getElementById("no-matches").textContent, 'No recipes match "omel".');
  assert.deepEqual(archivedNames(), ["Omelette"]); // stays in Archived
});

test("the Archived count reflects the archived recipes", async () => {
  await openRecipesPage([recipe("1", "Omelette"), recipe("2", "Café", true)]);

  assert.equal(document.getElementById("archived").hidden, false);
  assert.equal(document.getElementById("archived-count").textContent, "1");

  await archiveWithEditor("1", "Omelette");

  assert.equal(document.getElementById("archived-count").textContent, "2");
});

test("a search that doesn't match an archived recipe leaves the Archived count unchanged", async () => {
  await openRecipesPage([recipe("1", "Omelette"), recipe("2", "Café", true)]);
  assert.equal(document.getElementById("archived-count").textContent, "1");

  setValue(searchField(), "zzz");

  assert.equal(document.getElementById("archived-count").textContent, "1");
});

test("a failed load of the ingredient catalog shows the error, and Retry loads both again", async () => {
  server = fakeFetch();
  page = await loadPage({ html: "recipes.html", script: "recipes.js", fetch: server.fetch });
  ({ document, window } = page);
  await tick();
  server.requestFor("GET", "/api/recipes").respond(200, { recipes: [] });
  server.requestFor("GET", "/api/ingredients").fail();
  await tick();

  assert.equal(document.getElementById("load-error").hidden, false);
  assert.equal(document.getElementById("recipe-book").hidden, true);

  document.getElementById("retry-load").click();
  await waitFor(
    () => server.requests.filter((request) => request.url === "/api/ingredients").length === 2,
  );
  server.requests
    .filter((request) => request.url === "/api/recipes")[1]
    .respond(200, { recipes: [recipe("1", "Soup")] });
  server.requests
    .filter((request) => request.url === "/api/ingredients")[1]
    .respond(200, { ingredients: [] });
  await tick();

  assert.equal(document.getElementById("load-error").hidden, true);
  assert.deepEqual(activeNames(), ["Soup"]);
});

const CARROT_PCS = { id: "carrot", name: "Carrot", unit: "pcs", measures: [], archived: false };
const CARROT_G = {
  ...CARROT_PCS,
  unit: "g",
  measures: [{ id: "piece", name: "pcs", amount: 120 }],
};

test("Edit opens the editor with the recipe and the catalog from a reload, not from the first load", async () => {
  await openRecipesPage(
    [recipe("1", "Soup", false, [{ ingredientId: "carrot", quantity: 2 }])],
    [CARROT_PCS],
  );
  // Meanwhile, another device converted Carrot to g, and added a recipe.
  const soup = recipe("1", "Soup", false, [
    { ingredientId: "carrot", quantity: 2, measureId: "piece" },
  ]);

  await clickAndReload(buttonLabeled("Edit Soup"), {
    recipes: [soup, recipe("2", "Stew", false, WITH_ONION)],
    ingredients: [CARROT_G, ONION],
  });

  assert.equal(editorDialog().open, true);
  assert.equal(editorDialog().querySelector(".quantity-field").value, "2");
  const measure = editorDialog().querySelector(".measure-field");
  assert.equal(measure.value, "piece");
  assert.equal(measure.selectedOptions[0].textContent, "pcs (120 g)");
  assert.deepEqual(activeNames(), ["Soup", "Stew"]);
});

test("New recipe offers the catalog from a reload", async () => {
  await openRecipesPage([], [ONION]);

  await clickAndReload(document.getElementById("new-recipe"), {
    recipes: [],
    ingredients: [CARROT_G, ONION],
  });
  setValue(editorDialog().querySelector(".option-search"), "car");

  assert.equal(editorDialog().open, true);
  assert.deepEqual(
    [...editorDialog().querySelectorAll(".options .option")].map((option) => option.textContent),
    ["Carrot (g)"],
  );
});

test("a failed reload shows the load error, focuses Retry, and doesn't open the editor", async () => {
  await openRecipesPage([recipe("1", "Soup", false, WITH_ONION)]);

  for (const button of [buttonLabeled("Edit Soup"), document.getElementById("new-recipe")]) {
    const count = server.requests.length;
    button.click();
    await waitFor(() => server.requests.length === count + 2);
    server.requestFor("GET", "/api/recipes").respond(200, { recipes: served.recipes });
    server.requestFor("GET", "/api/ingredients").fail();
    await tick();

    assert.equal(editorDialog().open, false);
    assert.equal(document.getElementById("load-error").hidden, false);
    assertFocus(document, document.getElementById("retry-load"));

    document.getElementById("retry-load").click();
    await waitFor(() => server.requests.length === count + 4);
    server.requestFor("GET", "/api/recipes").respond(200, { recipes: served.recipes });
    server.requestFor("GET", "/api/ingredients").respond(200, { ingredients: served.ingredients });
    await tick();
    assert.equal(document.getElementById("load-error").hidden, true);
  }
});

test("Edit on a recipe that the reload no longer has refreshes the list and doesn't open the editor", async () => {
  await openRecipesPage([recipe("1", "Soup", false, WITH_ONION)]);

  await clickAndReload(buttonLabeled("Edit Soup"), {
    recipes: [recipe("2", "Stew", false, WITH_ONION)],
    ingredients: [ONION],
  });

  assert.equal(editorDialog().open, false);
  assert.deepEqual(activeNames(), ["Stew"]);
  assertFocus(document, searchField());
});

test("a second click while the reload runs sends no second reload", async () => {
  await openRecipesPage([recipe("1", "Soup", false, WITH_ONION)]);

  buttonLabeled("Edit Soup").click();
  document.getElementById("new-recipe").click();
  const reload = await reloadRequests();
  reload.recipes.respond(200, { recipes: served.recipes });
  reload.ingredients.respond(200, { ingredients: served.ingredients });
  await tick();

  assert.equal(server.requests.length, 4);
  assert.equal(editorDialog().querySelector(".dialog-title").textContent, "Edit recipe");
});
