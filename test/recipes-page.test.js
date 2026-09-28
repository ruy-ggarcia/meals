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

async function openRecipesPage(recipes = [], ingredients = [ONION]) {
  server = fakeFetch();
  page = await loadPage({ html: "recipes.html", script: "recipes.js", fetch: server.fetch });
  ({ document, window } = page);
  await tick();
  server.requestFor("GET", "/api/recipes").respond(200, { recipes });
  server.requestFor("GET", "/api/ingredients").respond(200, { ingredients });
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

  document.getElementById("new-recipe").click();

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

  newRecipe.click();
  editorDialog().querySelector(".cancel").click();

  assert.equal(editorDialog().open, false);
  assertFocus(document, newRecipe);
  assert.equal(server.requestFor("POST", "/api/recipes"), undefined);
});

test("Edit opens the recipe with its ingredients, and a save updates its row", async () => {
  await openRecipesPage([recipe("1", "Soup", false, WITH_ONION)]);

  buttonLabeled("Edit Soup").click();

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

  buttonLabeled("Edit Green salad").click();
  setValue(document.getElementById("recipe-name"), "Soup");
  editorDialog().querySelector(".done").click();
  await respondTo("PATCH", "/api/recipes/1", 200, recipe("1", "Soup", false, WITH_ONION));

  assert.deepEqual(activeNames(), []);
  assertFocus(document, searchField());
});

test("Cancel after Edit returns focus to the recipe's Edit button", async () => {
  await openRecipesPage([recipe("1", "Soup", false, WITH_ONION)]);

  buttonLabeled("Edit Soup").click();
  editorDialog().querySelector(".cancel").click();

  assert.equal(editorDialog().open, false);
  assertFocus(document, buttonLabeled("Edit Soup"));
});

test("Escape after Edit returns focus to the recipe's Edit button", async () => {
  await openRecipesPage([recipe("1", "Soup", false, WITH_ONION)]);

  buttonLabeled("Edit Soup").click();
  editorDialog().close(); // what Escape does to a modal dialog

  assertFocus(document, buttonLabeled("Edit Soup"));
});

test("archived recipes have Edit and Restore", async () => {
  await openRecipesPage([recipe("1", "Café", true)]);

  assert.ok(buttonLabeled("Edit Café"));
  assert.ok(buttonLabeled("Restore Café"));
  assert.equal(buttonLabeled("Archive Café"), null);
});

test("a recipe without ingredients shows a warning icon, and one with ingredients doesn't", async () => {
  await openRecipesPage([recipe("1", "Coffee"), recipe("2", "Soup", false, WITH_ONION)]);

  const icon = rowById("1").querySelector(".warning-icon");
  assert.equal(icon.getAttribute("role"), "img");
  assert.equal(icon.getAttribute("aria-label"), "No ingredients");
  assert.equal(icon.title, "No ingredients");
  assert.equal(rowById("2").querySelector(".warning-icon"), null);
});

test("saving ingredients for a recipe removes its warning icon", async () => {
  await openRecipesPage([recipe("1", "Soup")]);

  buttonLabeled("Edit Soup").click();
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

  document.getElementById("new-recipe").click();
  assert.equal(dispatchBeforeUnload().defaultPrevented, false);
  setValue(document.getElementById("recipe-name"), "Pie");
  assert.equal(dispatchBeforeUnload().defaultPrevented, true);
  editorDialog().querySelector(".cancel").click();
  assert.equal(dispatchBeforeUnload().defaultPrevented, false);
});

test("Archive and Restore move a recipe between the lists", async () => {
  await openRecipesPage([recipe("1", "Omelette"), recipe("2", "Café", true)]);

  buttonLabeled("Archive Omelette").click();
  await respondTo("PATCH", "/api/recipes/1", 200, recipe("1", "Omelette", true));
  assert.deepEqual(activeNames(), []);
  assert.deepEqual(archivedNames(), ["Café", "Omelette"]);

  buttonLabeled("Restore Café").click();
  await respondTo("PATCH", "/api/recipes/2", 200, recipe("2", "Café", false));
  assert.deepEqual(activeNames(), ["Café"]);
  assert.deepEqual(archivedNames(), ["Omelette"]);
});

test("a failed archive shows its message and leaves the recipe in place", async () => {
  await openRecipesPage([recipe("1", "Omelette")]);

  buttonLabeled("Archive Omelette").click();
  await waitFor(() => server.requestFor("PATCH", "/api/recipes/1") !== undefined);
  server.requestFor("PATCH", "/api/recipes/1").fail();
  await tick();

  assert.equal(
    rowById("1").querySelector(".row-message").textContent,
    "Couldn't archive the recipe. Try again.",
  );
  assert.deepEqual(activeNames(), ["Omelette"]);
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

  buttonLabeled("Archive Omelette").click();
  await respondTo("PATCH", "/api/recipes/1", 200, recipe("1", "Omelette", true));

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
