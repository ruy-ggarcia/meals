// Tests for the Ingredients page (public/ingredients.js) against a real DOM,
// built from the real public/ingredients.html. See test/dom-helpers.js for
// the harness and the DOM library choice. The list logic it shares with the
// recipe book is also covered by test/recipes-page.test.js.

import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { fakeFetch, loadPage, tick, waitFor } from "./dom-helpers.js";

function ingredient(id, name, unit = "g", archived = false) {
  return { id, name, unit, archived };
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

async function openIngredientsPage(ingredients = [], recipes = []) {
  server = fakeFetch();
  page = await loadPage({
    html: "ingredients.html",
    script: "ingredients.js",
    fetch: server.fetch,
  });
  ({ document, window } = page);
  await tick();
  server.requestFor("GET", "/api/ingredients").respond(200, { ingredients });
  server.requestFor("GET", "/api/recipes").respond(200, { recipes });
  await tick();
}

function nameField() {
  return document.getElementById("new-ingredient-name");
}

function unitField() {
  return document.getElementById("new-ingredient-unit");
}

function addButton() {
  return document.querySelector('#new-ingredient button[type="submit"]');
}

function formMessage() {
  return document.getElementById("new-ingredient-message");
}

function setValue(element, value) {
  element.value = value;
  element.dispatchEvent(new window.Event("input", { bubbles: true }));
}

function chooseUnit(unit) {
  unitField().value = unit;
  unitField().dispatchEvent(new window.Event("change", { bubbles: true }));
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

test("adding an ingredient sends the name and the unit, then clears both fields", async () => {
  await openIngredientsPage([ingredient("1", "Onion")]);
  setValue(nameField(), "Milk");
  chooseUnit("ml");

  addButton().click();
  await waitFor(() => server.requestFor("POST", "/api/ingredients") !== undefined);
  assert.deepEqual(server.requestFor("POST", "/api/ingredients").body, {
    name: "Milk",
    unit: "ml",
  });
  await respondTo("POST", "/api/ingredients", 201, ingredient("2", "Milk", "ml"));

  assert.deepEqual(activeNames(), ["Milk", "Onion"]);
  assert.equal(nameField().value, "");
  assert.equal(unitField().value, "");
  assert.equal(document.activeElement, nameField());
});

test("adding without a unit asks for one and sends nothing", async () => {
  await openIngredientsPage();
  setValue(nameField(), "Milk");

  addButton().click();
  await tick();

  assert.equal(formMessage().textContent, "Choose a unit.");
  assert.equal(document.activeElement, unitField());
  assert.equal(server.requestFor("POST", "/api/ingredients"), undefined);
});

test("adding a name that an active ingredient has shows the conflict", async () => {
  await openIngredientsPage([ingredient("1", "Onion")]);
  setValue(nameField(), "ONION");
  chooseUnit("pcs");

  addButton().click();
  await respondTo("POST", "/api/ingredients", 409, {
    error: 'An ingredient named "Onion" already exists.',
    ingredient: ingredient("1", "Onion"),
  });

  assert.equal(formMessage().textContent, '"Onion" already exists.');
});

test("adding a name that an archived ingredient has offers Restore it", async () => {
  await openIngredientsPage([ingredient("1", "Saffron", "g", true)]);
  setValue(nameField(), "saffron");
  chooseUnit("g");

  addButton().click();
  await respondTo("POST", "/api/ingredients", 409, {
    error: 'An ingredient named "Saffron" already exists.',
    ingredient: ingredient("1", "Saffron", "g", true),
  });
  assert.equal(formMessage().textContent, '"Saffron" is archived. Restore it');

  buttonLabeled("Restore it: Saffron").click();
  await respondTo("PATCH", "/api/ingredients/1", 200, ingredient("1", "Saffron"));

  assert.deepEqual(activeNames(), ["Saffron"]);
  assert.equal(nameField().value, "");
  assert.equal(formMessage().textContent, "");
});

test("a network error adding an ingredient keeps the typed name and unit", async () => {
  await openIngredientsPage();
  setValue(nameField(), "Milk");
  chooseUnit("ml");

  addButton().click();
  await waitFor(() => server.requestFor("POST", "/api/ingredients") !== undefined);
  server.requestFor("POST", "/api/ingredients").fail();
  await tick();

  assert.equal(formMessage().textContent, "Couldn't add the ingredient. Try again.");
  assert.equal(nameField().value, "Milk");
  assert.equal(unitField().value, "ml");
});

test("Escape clears New ingredient", async () => {
  await openIngredientsPage();
  setValue(nameField(), "Milk");

  nameField().dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );

  assert.equal(nameField().value, "");
});

test("Edit opens the editor, and a saved name updates the row and focuses its Edit button", async () => {
  await openIngredientsPage([ingredient("1", "Onion")]);

  buttonLabeled("Edit Onion").click();
  const dialog = document.getElementById("ingredient-editor");
  assert.equal(dialog.open, true);
  setValue(document.getElementById("ingredient-name"), "Red onion");
  dialog.querySelector(".done").click();
  await respondTo("PATCH", "/api/ingredients/1", 200, ingredient("1", "Red onion"));

  assert.equal(dialog.open, false);
  assert.deepEqual(activeNames(), ["Red onion"]);
  assert.equal(document.activeElement, buttonLabeled("Edit Red onion"));
});

test("Cancel after Edit returns focus to the ingredient's Edit button", async () => {
  await openIngredientsPage([ingredient("1", "Onion")]);

  buttonLabeled("Edit Onion").click();
  const dialog = document.getElementById("ingredient-editor");
  dialog.querySelector(".cancel").click();

  assert.equal(dialog.open, false);
  assert.equal(document.activeElement, buttonLabeled("Edit Onion"));
});

test("Escape after Edit returns focus to the ingredient's Edit button", async () => {
  await openIngredientsPage([ingredient("1", "Onion")]);

  buttonLabeled("Edit Onion").click();
  document.getElementById("ingredient-editor").close(); // what Escape does to a modal dialog

  assert.equal(document.activeElement, buttonLabeled("Edit Onion"));
});

test("Edit disables Unit for an ingredient that recipes use, counting archived recipes", async () => {
  await openIngredientsPage(
    [ingredient("1", "Onion"), ingredient("2", "Milk", "ml")],
    [
      recipe("r1", "Soup", ["1"]),
      recipe("r2", "Old soup", ["1"], true),
      recipe("r3", "Latte", ["2"]),
    ],
  );

  buttonLabeled("Edit Onion").click();

  assert.equal(document.getElementById("ingredient-unit").disabled, true);
  assert.equal(
    document.querySelector("#ingredient-editor .unit-hint").textContent,
    "Used in 2 recipes. To change the unit, remove the ingredient from those recipes first.",
  );
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
    "No ingredients yet. Add your first one above.",
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
