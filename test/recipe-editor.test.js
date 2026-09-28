// Tests for the recipe editor (public/recipe-editor.js) against a real DOM,
// built from the real dialog markup in public/recipes.html. See
// test/dom-helpers.js for the harness and the DOM library choice.

import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { assertFocus, fakeFetch, loadDialog, tick, waitFor } from "./dom-helpers.js";

const EGG = { id: "egg", name: "Egg", unit: "pcs", archived: false };
const MILK = { id: "milk", name: "Milk", unit: "ml", archived: false };
const ONION = { id: "onion", name: "Onion", unit: "g", archived: false };
const SALT = { id: "salt", name: "Salt", unit: "g", archived: true };
const CATALOG = [ONION, SALT, EGG, MILK];

const SOUP = {
  id: "soup",
  name: "Onion soup",
  archived: false,
  ingredients: [
    { ingredientId: "onion", quantity: 150 },
    { ingredientId: "salt", quantity: 0.5 },
  ],
};

let server;
let dialog;
let document;
let window;
let editor;
let cleanup;

beforeEach(async () => {
  mock.method(console, "error", () => {}); // some tests simulate a failed save on purpose
  server = fakeFetch();
  let module;
  ({ dialog, document, window, module, cleanup } = await loadDialog({
    html: "recipes.html",
    id: "recipe-editor",
    script: "recipe-editor.js",
    fetch: server.fetch,
  }));
  editor = module.createRecipeEditor(dialog);
});

afterEach(async () => {
  await cleanup();
  mock.restoreAll();
});

function openEditor({ recipe, ingredients = CATALOG } = {}) {
  const opener = document.createElement("button");
  document.body.append(opener);
  const saved = [];
  editor.open({
    recipe,
    ingredients,
    restoreFocus: () => opener.focus(),
    onSaved: (entry) => saved.push(entry),
  });
  return { opener, saved };
}

function query(selector) {
  return document.querySelector(selector);
}

function nameField() {
  return query(".name-field");
}

function search() {
  return query(".option-search");
}

function rowNames() {
  return [...document.querySelectorAll(".ingredient-name")].map((name) => name.textContent);
}

function quantityFields() {
  return [...document.querySelectorAll(".quantity-field")];
}

function optionTexts() {
  return [...document.querySelectorAll(".option")].map((option) => option.textContent);
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

function addIngredient(text) {
  setValue(search(), text);
  keydownOn(search(), "Enter");
}

async function respondTo(method, url, status, body) {
  await waitFor(() => server.requestFor(method, url) !== undefined);
  server.requestFor(method, url).respond(status, body);
  await tick();
}

test("a new recipe opens empty, titled New recipe, with focus in Name", () => {
  openEditor();

  assert.equal(dialog.open, true);
  assert.equal(query(".dialog-title").textContent, "New recipe");
  assert.equal(nameField().value, "");
  assertFocus(document, nameField());
  assert.equal(query(".no-ingredients").hidden, false);
  assert.deepEqual(rowNames(), []);
});

test("an existing recipe opens with its name and ingredients, and focus on the title", () => {
  openEditor({ recipe: SOUP });

  assert.equal(query(".dialog-title").textContent, "Edit recipe");
  assert.equal(nameField().value, "Onion soup");
  assertFocus(document, query(".dialog-title"));
  assert.equal(query(".no-ingredients").hidden, true);
  assert.deepEqual(rowNames(), ["Onion", "Salt (archived)"]);
  assert.deepEqual(
    quantityFields().map((field) => field.value),
    ["150", "0.5"],
  );
  assert.deepEqual(
    [...document.querySelectorAll(".ingredient-row .unit")].map((unit) => unit.textContent),
    ["g", "g"],
  );
  assert.equal(quantityFields()[0].getAttribute("inputmode"), "decimal");
  assert.equal(quantityFields()[0].getAttribute("aria-label"), "Quantity of Onion per serving");
});

test("Add ingredient offers active ingredients not in the recipe, from A to Z, with their unit", () => {
  openEditor({ recipe: SOUP });

  assert.deepEqual(optionTexts(), ["Egg (pcs)", "Milk (ml)"]);
  setValue(search(), "MI");
  assert.deepEqual(optionTexts(), ["Milk (ml)"]);
});

test("Enter in Add ingredient adds the highlighted ingredient with an empty quantity, focused", () => {
  openEditor();
  setValue(search(), "egg");

  const event = keydownOn(search(), "Enter");

  assert.equal(event.defaultPrevented, true);
  assert.equal(dialog.open, true);
  assert.deepEqual(rowNames(), ["Egg"]);
  assert.equal(quantityFields()[0].value, "");
  assertFocus(document, quantityFields()[0]);
  assert.equal(search().value, "");
  assert.equal(query(".no-ingredients").hidden, true);
});

test("with no matches, Add ingredient points to the Ingredients page", () => {
  openEditor();

  setValue(search(), "xyz");

  assert.equal(query(".options").hidden, true);
  assert.equal(query(".no-match").hidden, false);
  assert.equal(
    query(".no-match").textContent,
    "No matching ingredients. To add ingredients, use the Ingredients page.",
  );
});

test("Done with an invalid quantity shows a message under its row, focuses it, and sends nothing", () => {
  openEditor({ recipe: SOUP });
  setValue(quantityFields()[1], "1.255");

  query(".done").click();

  const rows = [...document.querySelectorAll(".ingredient-row")];
  assert.equal(dialog.open, true);
  assert.equal(rows[0].querySelector(".row-message"), null);
  assert.equal(
    rows[1].querySelector(".row-message").textContent,
    "Enter a quantity from 0.01 to 10000, with up to two decimals.",
  );
  assert.equal(quantityFields()[1].value, "1.255");
  assertFocus(document, quantityFields()[1]);
  assert.equal(server.requests.length, 0);
});

test("Done with an empty name shows a message under Name and sends nothing", () => {
  openEditor();
  setValue(nameField(), "   ");

  query(".done").click();

  assert.equal(query(".name-message").textContent, "The name can't be empty.");
  assertFocus(document, nameField());
  assert.equal(server.requests.length, 0);
});

test("Done on a new recipe sends POST with the name and the quantities, then closes", async () => {
  const { saved } = openEditor();
  setValue(nameField(), "Omelette");
  addIngredient("egg");
  setValue(quantityFields()[0], " 0,25 ");

  query(".done").click();

  assert.equal(query(".done").disabled, true);
  assert.equal(query(".cancel").disabled, true);
  await waitFor(() => server.requestFor("POST", "/api/recipes") !== undefined);
  assert.deepEqual(server.requestFor("POST", "/api/recipes").body, {
    name: "Omelette",
    ingredients: [{ ingredientId: "egg", quantity: 0.25 }],
  });
  const created = {
    id: "new",
    name: "Omelette",
    archived: false,
    ingredients: [{ ingredientId: "egg", quantity: 0.25 }],
  };
  await respondTo("POST", "/api/recipes", 201, created);
  assert.equal(dialog.open, false);
  assert.deepEqual(saved, [created]);
});

test("a new recipe can be saved without ingredients", async () => {
  openEditor();
  setValue(nameField(), "Coffee");

  query(".done").click();

  await waitFor(() => server.requestFor("POST", "/api/recipes") !== undefined);
  assert.deepEqual(server.requestFor("POST", "/api/recipes").body, {
    name: "Coffee",
    ingredients: [],
  });
  await respondTo("POST", "/api/recipes", 201, {
    id: "coffee",
    name: "Coffee",
    archived: false,
    ingredients: [],
  });
});

test("Done on an existing recipe sends only the name when only the name changed", async () => {
  openEditor({ recipe: SOUP });
  setValue(nameField(), "French onion soup");

  query(".done").click();

  await waitFor(() => server.requestFor("PATCH", "/api/recipes/soup") !== undefined);
  assert.deepEqual(server.requestFor("PATCH", "/api/recipes/soup").body, {
    name: "French onion soup",
  });
  await respondTo("PATCH", "/api/recipes/soup", 200, { ...SOUP, name: "French onion soup" });
});

test("Done on an existing recipe sends only the ingredients when only a quantity changed", async () => {
  openEditor({ recipe: SOUP });
  setValue(quantityFields()[0], "200");

  query(".done").click();

  await waitFor(() => server.requestFor("PATCH", "/api/recipes/soup") !== undefined);
  assert.deepEqual(server.requestFor("PATCH", "/api/recipes/soup").body, {
    ingredients: [
      { ingredientId: "onion", quantity: 200 },
      { ingredientId: "salt", quantity: 0.5 },
    ],
  });
  await respondTo("PATCH", "/api/recipes/soup", 200, SOUP);
});

test("Done with no changes closes without a request and returns focus to the opener", () => {
  const { opener, saved } = openEditor({ recipe: SOUP });
  setValue(quantityFields()[0], "150.0"); // the same quantity

  query(".done").click();

  assert.equal(dialog.open, false);
  assert.equal(server.requests.length, 0);
  assert.deepEqual(saved, []);
  assertFocus(document, opener);
});

test("a name conflict (409) shows the message under Name and keeps the editor open", async () => {
  openEditor();
  setValue(nameField(), "soup");

  query(".done").click();
  await respondTo("POST", "/api/recipes", 409, {
    error: 'A recipe named "Soup" already exists.',
    recipe: { id: "x", name: "Soup", archived: false, ingredients: [] },
  });

  assert.equal(dialog.open, true);
  assert.equal(query(".name-message").textContent, '"Soup" already exists.');
  assert.equal(nameField().value, "soup");
  assertFocus(document, nameField());
  assert.equal(query(".done").disabled, false);
});

test("a conflict with an archived recipe says to restore it from Archived", async () => {
  openEditor();
  setValue(nameField(), "Soup");

  query(".done").click();
  await respondTo("POST", "/api/recipes", 409, {
    error: 'A recipe named "Soup" already exists.',
    recipe: { id: "x", name: "Soup", archived: true, ingredients: [] },
  });

  assert.equal(
    query(".name-message").textContent,
    '"Soup" is archived. To use it, restore it from Archived.',
  );
});

test("a rejected save (400) shows the server's message", async () => {
  openEditor();
  setValue(nameField(), "Soup");

  query(".done").click();
  await respondTo("POST", "/api/recipes", 400, {
    error: "The name must be at most 100 characters.",
  });

  assert.equal(query(".save-message").textContent, "The name must be at most 100 characters.");
  assert.equal(dialog.open, true);
});

test("a network error keeps the editor open with the changes", async () => {
  openEditor({ recipe: SOUP });
  setValue(nameField(), "Stew");

  query(".done").click();
  await waitFor(() => server.requestFor("PATCH", "/api/recipes/soup") !== undefined);
  server.requestFor("PATCH", "/api/recipes/soup").fail();
  await tick();

  assert.equal(dialog.open, true);
  assert.equal(query(".save-message").textContent, "Couldn't save the recipe. Try again.");
  assert.equal(nameField().value, "Stew");
  assertFocus(document, query(".done"));
});

test("Remove takes the row out and moves focus to the next Remove, then the title", () => {
  openEditor({ recipe: SOUP });

  query('[aria-label="Remove Onion"]').click();

  assert.deepEqual(rowNames(), ["Salt (archived)"]);
  assertFocus(document, query('[aria-label="Remove Salt"]'));
  assert.deepEqual(optionTexts(), ["Egg (pcs)", "Milk (ml)", "Onion (g)"]);

  query('[aria-label="Remove Salt"]').click();

  assertFocus(document, query(".dialog-title"));
  assert.equal(query(".no-ingredients").hidden, false);
});

test("Cancel discards the changes and returns focus to the opener", () => {
  const { opener, saved } = openEditor({ recipe: SOUP });
  setValue(nameField(), "Stew");

  query(".cancel").click();

  assert.equal(dialog.open, false);
  assert.equal(editor.isOpen(), false);
  assert.deepEqual(saved, []);
  assertFocus(document, opener);
  assert.equal(server.requests.length, 0);
});

test("Escape (the dialog's close event) discards the changes", () => {
  const { opener } = openEditor({ recipe: SOUP });
  setValue(nameField(), "Stew");

  // The browser fires "close" for Escape and Android's Back; happy-dom
  // doesn't drive that from a keypress, so the test closes the dialog itself.
  dialog.close();

  assert.equal(editor.isOpen(), false);
  assertFocus(document, opener);
  assert.equal(server.requests.length, 0);
});

test("a backdrop click closes the editor only when nothing changed", () => {
  openEditor({ recipe: SOUP });
  pointerdownOn(dialog);
  dialog.click();
  assert.equal(dialog.open, false);

  openEditor({ recipe: SOUP });
  setValue(quantityFields()[0], "10");
  pointerdownOn(dialog);
  dialog.click();
  assert.equal(dialog.open, true);
  assert.equal(editor.hasChanges(), true);
});

test("Enter in Name or in a quantity confirms, the same as Done", async () => {
  openEditor({ recipe: SOUP });
  setValue(nameField(), "Stew");

  const event = keydownOn(nameField(), "Enter");

  assert.equal(event.defaultPrevented, true);
  await waitFor(() => server.requestFor("PATCH", "/api/recipes/soup") !== undefined);
  await respondTo("PATCH", "/api/recipes/soup", 200, { ...SOUP, name: "Stew" });

  openEditor({ recipe: SOUP });
  setValue(quantityFields()[0], "300");
  keydownOn(quantityFields()[0], "Enter");
  await waitFor(() => server.requests.filter((request) => request.method === "PATCH").length === 2);
  server.requests.filter((request) => request.method === "PATCH")[1].respond(200, SOUP);
  await tick();
});

test("at 50 ingredients, Add ingredient is disabled with the limit's placeholder", () => {
  const many = Array.from({ length: 51 }, (_, index) => ({
    id: `i${index}`,
    name: `Ingredient ${index}`,
    unit: "g",
    archived: false,
  }));
  const big = {
    id: "big",
    name: "Big",
    archived: false,
    ingredients: many
      .slice(0, 50)
      .map((ingredient) => ({ ingredientId: ingredient.id, quantity: 1 })),
  };
  openEditor({ recipe: big, ingredients: many });

  assert.equal(search().disabled, true);
  assert.equal(search().placeholder, "A recipe holds up to 50 ingredients.");
  assert.equal(query(".no-match").hidden, true);

  query('[aria-label="Remove Ingredient 0"]').click();

  assert.equal(search().disabled, false);
});

test("an ingredient name with HTML renders as text", () => {
  openEditor({ ingredients: [{ id: "b", name: "<b>Bold</b>", unit: "g", archived: false }] });

  assert.deepEqual(optionTexts(), ["<b>Bold</b> (g)"]);
  assert.equal(query(".options b"), null);
});
