// Tests for the ingredient editor (public/ingredient-editor.js) against a
// real DOM, built from the real dialog markup in public/ingredients.html. See
// test/dom-helpers.js for the harness and the DOM library choice.

import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { assertFocus, fakeFetch, loadDialog, tick, waitFor } from "./dom-helpers.js";

const MILK = { id: "milk", name: "Milk", unit: "g", archived: false };

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
    html: "ingredients.html",
    id: "ingredient-editor",
    script: "ingredient-editor.js",
    fetch: server.fetch,
  }));
  editor = module.createIngredientEditor(dialog);
});

afterEach(async () => {
  await cleanup();
  mock.restoreAll();
});

function openEditor({ ingredient = MILK, usedIn = 0 } = {}) {
  const opener = document.createElement("button");
  document.body.append(opener);
  const saved = [];
  editor.open({
    ingredient,
    usedIn,
    restoreFocus: () => opener.focus(),
    onSaved: (entry) => saved.push(entry),
  });
  return { opener, saved };
}

function query(selector) {
  return document.querySelector(selector);
}

function setName(value) {
  query(".name-field").value = value;
  query(".name-field").dispatchEvent(new window.Event("input", { bubbles: true }));
}

function setUnit(value) {
  query(".unit-field").value = value;
  query(".unit-field").dispatchEvent(new window.Event("change", { bubbles: true }));
}

function pointerdownOn(element) {
  element.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }));
}

async function respondToPatch(status, body) {
  await waitFor(() => server.requestFor("PATCH", "/api/ingredients/milk") !== undefined);
  server.requestFor("PATCH", "/api/ingredients/milk").respond(status, body);
  await tick();
}

test("opens with the name and the unit, focus on the title, and Unit enabled when no recipe uses it", () => {
  openEditor();

  assert.equal(dialog.open, true);
  assert.equal(query(".name-field").value, "Milk");
  assert.equal(query(".unit-field").value, "g");
  assert.equal(query(".unit-field").disabled, false);
  assert.equal(query(".unit-hint").hidden, true);
  assertFocus(document, query(".dialog-title"));
});

test("Unit is disabled, with the reason, while recipes use the ingredient", () => {
  openEditor({ usedIn: 2 });

  assert.equal(query(".unit-field").disabled, true);
  assert.equal(query(".unit-hint").hidden, false);
  assert.equal(
    query(".unit-hint").textContent,
    "Used in 2 recipes. To change the unit, remove the ingredient from those recipes first.",
  );

  query(".cancel").click();
  openEditor({ usedIn: 1 });

  assert.equal(
    query(".unit-hint").textContent,
    "Used in 1 recipe. To change the unit, remove the ingredient from that recipe first.",
  );
});

test("Done with no changes closes without a request and returns focus to the opener", () => {
  const { opener } = openEditor();

  query(".done").click();

  assert.equal(dialog.open, false);
  assert.equal(server.requests.length, 0);
  assertFocus(document, opener);
});

test("Done sends the changed name and unit in one PATCH, then closes", async () => {
  const { saved } = openEditor();
  setName("Whole milk");
  setUnit("ml");

  query(".done").click();

  assert.equal(query(".done").disabled, true);
  await waitFor(() => server.requestFor("PATCH", "/api/ingredients/milk") !== undefined);
  assert.deepEqual(server.requestFor("PATCH", "/api/ingredients/milk").body, {
    name: "Whole milk",
    unit: "ml",
  });
  const updated = { ...MILK, name: "Whole milk", unit: "ml" };
  await respondToPatch(200, updated);
  assert.equal(dialog.open, false);
  assert.deepEqual(saved, [updated]);
});

test("a name conflict (409) shows the message under Name", async () => {
  openEditor();
  setName("egg");

  query(".done").click();
  await respondToPatch(409, {
    error: 'An ingredient named "Egg" already exists.',
    ingredient: { id: "egg", name: "Egg", unit: "pcs", archived: false },
  });

  assert.equal(dialog.open, true);
  assert.equal(query(".name-message").textContent, '"Egg" already exists.');
  assertFocus(document, query(".name-field"));
});

test("a conflict with an archived ingredient says to restore it from Archived", async () => {
  openEditor();
  setName("saffron");

  query(".done").click();
  await respondToPatch(409, {
    error: 'An ingredient named "Saffron" already exists.',
    ingredient: { id: "saffron", name: "Saffron", unit: "g", archived: true },
  });

  assert.equal(
    query(".name-message").textContent,
    '"Saffron" is archived. To use it, restore it from Archived.',
  );
});

test("a unit in use (409 without an ingredient) shows the server's message", async () => {
  openEditor();
  setUnit("ml");

  query(".done").click();
  await respondToPatch(409, {
    error: '"Milk" is used in recipes. To change its unit, remove it from those recipes first.',
  });

  assert.equal(dialog.open, true);
  assert.equal(
    query(".save-message").textContent,
    '"Milk" is used in recipes. To change its unit, remove it from those recipes first.',
  );
  assert.equal(query(".unit-field").value, "ml");
});

test("Done with an empty name shows a message under Name and sends nothing", () => {
  openEditor();
  setName("   ");

  query(".done").click();

  assert.equal(dialog.open, true);
  assert.equal(query(".name-message").textContent, "The name can't be empty.");
  assertFocus(document, query(".name-field"));
  assert.equal(server.requests.length, 0);
});

test("a rejected save (400) shows the server's message", async () => {
  openEditor();
  setName("x".repeat(101));

  query(".done").click();
  await respondToPatch(400, { error: "The name must be at most 100 characters." });

  assert.equal(query(".save-message").textContent, "The name must be at most 100 characters.");
});

test("a network error keeps the editor open with the changes", async () => {
  openEditor();
  setName("Oat milk");

  query(".done").click();
  await waitFor(() => server.requestFor("PATCH", "/api/ingredients/milk") !== undefined);
  server.requestFor("PATCH", "/api/ingredients/milk").fail();
  await tick();

  assert.equal(dialog.open, true);
  assert.equal(query(".save-message").textContent, "Couldn't save the ingredient. Try again.");
  assert.equal(query(".name-field").value, "Oat milk");
  assertFocus(document, query(".done"));
});

test("Cancel and Escape (the dialog's close event) discard the changes", () => {
  const { opener } = openEditor();
  setName("Oat milk");
  query(".cancel").click();
  assert.equal(dialog.open, false);
  assertFocus(document, opener);

  openEditor();
  setName("Oat milk");
  dialog.close();
  assert.equal(editor.hasChanges(), false);
  assert.equal(server.requests.length, 0);
});

test("a backdrop click closes the editor only when nothing changed", () => {
  openEditor();
  pointerdownOn(dialog);
  dialog.click();
  assert.equal(dialog.open, false);

  openEditor();
  setUnit("ml");
  pointerdownOn(dialog);
  dialog.click();
  assert.equal(dialog.open, true);
});

test("Enter in Name confirms, the same as Done", async () => {
  openEditor();
  setName("Oat milk");

  const event = new window.KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
  });
  query(".name-field").dispatchEvent(event);

  assert.equal(event.defaultPrevented, true);
  await respondToPatch(200, { ...MILK, name: "Oat milk" });
});
