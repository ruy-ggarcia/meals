// Tests for the recipe book page (public/recipes.js) against a real DOM,
// built from the real public/recipes.html. See test/dom-helpers.js for the
// harness and the DOM library choice.

import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { fakeFetch, loadPage, tick, waitFor } from "./dom-helpers.js";

function recipe(id, name, archived = false) {
  return { id, name, archived };
}

let page;
let server;
let document;
let window;

async function openRecipesPage(recipes = []) {
  server = fakeFetch();
  page = await loadPage({ html: "recipes.html", script: "recipes.js", fetch: server.fetch });
  ({ document, window } = page);
  await tick();
  server.requestFor("GET", "/api/recipes").respond(200, { recipes });
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

function nameField() {
  return document.getElementById("new-recipe-name");
}

function addButton() {
  return document.querySelector('#new-recipe button[type="submit"]');
}

function formMessage() {
  return document.getElementById("new-recipe-message");
}

function searchField() {
  return document.getElementById("search");
}

function activeNames() {
  return [...document.querySelectorAll("#active-recipes .recipe-name")].map((el) => el.textContent);
}

function archivedNames() {
  return [...document.querySelectorAll("#archived-recipes .recipe-name")].map(
    (el) => el.textContent,
  );
}

// Identifies a row by ID: a row in rename mode has no .recipe-name to search by.
function rowById(id) {
  return document.querySelector(`.recipe-row[data-id="${id}"]`);
}

function buttonLabeled(label) {
  return document.querySelector(`[aria-label="${label}"]`);
}

beforeEach(() => {
  mock.method(console, "error", () => {}); // some tests simulate a failed request on purpose
});

afterEach(async () => {
  await page.cleanup();
  mock.restoreAll();
});

test("adding a recipe (201) clears the field, keeps focus, and shows it in its sorted place", async () => {
  await openRecipesPage([recipe("1", "Green salad")]);

  setValue(nameField(), "Café");
  addButton().click();
  await waitFor(() => server.requestFor("POST", "/api/recipes") !== undefined);
  server.requestFor("POST", "/api/recipes").respond(201, recipe("2", "Café"));
  await tick();

  assert.equal(nameField().value, "");
  assert.equal(document.activeElement, nameField());
  assert.deepEqual(activeNames(), ["Café", "Green salad"]); // A to Z
});

test("adding a recipe that conflicts with an active recipe (409) shows the conflict", async () => {
  await openRecipesPage([recipe("1", "Green salad")]);

  setValue(nameField(), "GREEN SALAD");
  addButton().click();
  await waitFor(() => server.requestFor("POST", "/api/recipes") !== undefined);
  server.requestFor("POST", "/api/recipes").respond(409, { recipe: recipe("1", "Green salad") });
  await tick();

  assert.equal(formMessage().textContent, '"Green salad" already exists.');
  assert.equal(nameField().value, "GREEN SALAD"); // the text stays in the field
});

test("adding a recipe that conflicts with an archived recipe (409) offers Restore it", async () => {
  await openRecipesPage([recipe("1", "Café", true)]);

  setValue(nameField(), "cafe");
  addButton().click();
  await waitFor(() => server.requestFor("POST", "/api/recipes") !== undefined);
  server.requestFor("POST", "/api/recipes").respond(409, { recipe: recipe("1", "Café", true) });
  await tick();

  assert.match(formMessage().textContent, /^"Café" is archived\./);
  const restore = buttonLabeled("Restore it: Café");
  assert.ok(restore);

  restore.click();
  await waitFor(() => server.requestFor("PATCH", "/api/recipes/1") !== undefined);
  server.requestFor("PATCH", "/api/recipes/1").respond(200, recipe("1", "Café", false));
  await tick();

  assert.deepEqual(activeNames(), ["Café"]);
  assert.equal(formMessage().textContent, "");
  assert.equal(nameField().value, "");
});

test("adding a recipe rejected as invalid (400) shows the server's message", async () => {
  await openRecipesPage([]);

  setValue(nameField(), "   ");
  addButton().click();
  await waitFor(() => server.requestFor("POST", "/api/recipes") !== undefined);
  server.requestFor("POST", "/api/recipes").respond(400, { error: "The name can't be empty." });
  await tick();

  assert.equal(formMessage().textContent, "The name can't be empty.");
  assert.equal(nameField().value, "   "); // the text stays in the field
});

test("a network error adding a recipe keeps the typed text", async () => {
  await openRecipesPage([]);

  setValue(nameField(), "Soup");
  addButton().click();
  await waitFor(() => server.requestFor("POST", "/api/recipes") !== undefined);
  server.requestFor("POST", "/api/recipes").fail();
  await tick();

  assert.equal(formMessage().textContent, "Couldn't add the recipe. Try again.");
  assert.equal(nameField().value, "Soup");
});

test("Escape clears New recipe", async () => {
  await openRecipesPage([]);
  setValue(nameField(), "Soup");

  keydownOn(nameField(), "Escape");

  assert.equal(nameField().value, "");
  assert.equal(formMessage().textContent, "");
});

test("rename: Enter saves the new name", async () => {
  await openRecipesPage([recipe("1", "Omelette")]);

  buttonLabeled("Rename Omelette").click();
  const field = rowById("1").querySelector(".rename-field");
  setValue(field, "Tomato omelette");
  keydownOn(field, "Enter");
  await waitFor(() => server.requestFor("PATCH", "/api/recipes/1") !== undefined);
  server.requestFor("PATCH", "/api/recipes/1").respond(200, recipe("1", "Tomato omelette"));
  await tick();

  assert.deepEqual(activeNames(), ["Tomato omelette"]);
  assert.equal(document.activeElement, buttonLabeled("Rename Tomato omelette"));
});

test("rename: the Save button saves the new name", async () => {
  await openRecipesPage([recipe("1", "Omelette")]);

  buttonLabeled("Rename Omelette").click();
  setValue(rowById("1").querySelector(".rename-field"), "Tomato omelette");
  buttonLabeled("Save the name of Omelette").click();
  await waitFor(() => server.requestFor("PATCH", "/api/recipes/1") !== undefined);
  server.requestFor("PATCH", "/api/recipes/1").respond(200, recipe("1", "Tomato omelette"));
  await tick();

  assert.deepEqual(activeNames(), ["Tomato omelette"]);
});

test("rename: Escape cancels without sending a request", async () => {
  await openRecipesPage([recipe("1", "Omelette")]);

  buttonLabeled("Rename Omelette").click();
  setValue(rowById("1").querySelector(".rename-field"), "Tomato omelette");
  keydownOn(rowById("1"), "Escape");

  assert.equal(rowById("1").querySelector(".rename-field"), null);
  assert.deepEqual(activeNames(), ["Omelette"]);
  assert.equal(
    server.requestFor("PATCH", () => true),
    undefined,
  );
});

test("rename: the Cancel button cancels without sending a request", async () => {
  await openRecipesPage([recipe("1", "Omelette")]);

  buttonLabeled("Rename Omelette").click();
  setValue(rowById("1").querySelector(".rename-field"), "Tomato omelette");
  buttonLabeled("Cancel renaming Omelette").click();

  assert.equal(rowById("1").querySelector(".rename-field"), null);
  assert.deepEqual(activeNames(), ["Omelette"]);
  assert.equal(
    server.requestFor("PATCH", () => true),
    undefined,
  );
});

test("an unchanged rename doesn't send a request", async () => {
  await openRecipesPage([recipe("1", "Omelette")]);

  buttonLabeled("Rename Omelette").click();
  keydownOn(rowById("1").querySelector(".rename-field"), "Enter"); // same name, not edited
  await tick();

  assert.equal(rowById("1").querySelector(".rename-field"), null);
  assert.equal(
    server.requestFor("PATCH", () => true),
    undefined,
  );
});

test("focusout closes only an unchanged rename, and a click on another row's button after that still works", async () => {
  await openRecipesPage([recipe("1", "Omelette"), recipe("2", "Salad")]);

  buttonLabeled("Rename Omelette").click();
  assert.ok(rowById("1").querySelector(".rename-field"));

  const archiveSalad = buttonLabeled("Archive Salad");
  // A real click also focuses the clicked control first; happy-dom's
  // synthetic .click() doesn't move focus on its own, so this does both,
  // in that order, to exercise the row's focusout handler.
  archiveSalad.focus();
  archiveSalad.click();
  await waitFor(() => server.requestFor("PATCH", "/api/recipes/2") !== undefined);
  server.requestFor("PATCH", "/api/recipes/2").respond(200, recipe("2", "Salad", true));
  await tick();

  assert.equal(rowById("1").querySelector(".rename-field"), null); // closed, unchanged
  assert.deepEqual(archivedNames(), ["Salad"]); // the single click still archived it
});

test("Archive and Restore move a recipe between the lists", async () => {
  await openRecipesPage([recipe("1", "Omelette"), recipe("2", "Café", true)]);

  buttonLabeled("Archive Omelette").click();
  await waitFor(() => server.requestFor("PATCH", "/api/recipes/1") !== undefined);
  server.requestFor("PATCH", "/api/recipes/1").respond(200, recipe("1", "Omelette", true));
  await tick();
  assert.deepEqual(activeNames(), []);
  assert.deepEqual(archivedNames(), ["Café", "Omelette"]);

  buttonLabeled("Restore Café").click();
  await waitFor(() => server.requestFor("PATCH", "/api/recipes/2") !== undefined);
  server.requestFor("PATCH", "/api/recipes/2").respond(200, recipe("2", "Café", false));
  await tick();
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
  assert.equal(document.getElementById("empty-book").hidden, false);
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
  await waitFor(() => server.requestFor("PATCH", "/api/recipes/1") !== undefined);
  server.requestFor("PATCH", "/api/recipes/1").respond(200, recipe("1", "Omelette", true));
  await tick();

  assert.equal(document.getElementById("archived-count").textContent, "2");
});

test("a search that doesn't match an archived recipe leaves the Archived count unchanged", async () => {
  await openRecipesPage([recipe("1", "Omelette"), recipe("2", "Café", true)]);
  assert.equal(document.getElementById("archived-count").textContent, "1");

  setValue(searchField(), "zzz");

  assert.equal(document.getElementById("archived-count").textContent, "1");
});
