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

function openEditor({ ingredient = MILK, usage = noUsage() } = {}) {
  const opener = document.createElement("button");
  document.body.append(opener);
  const saved = [];
  editor.open({
    ingredient,
    usage,
    restoreFocus: () => opener.focus(),
    onSaved: (entry) => saved.push(entry),
  });
  return { opener, saved };
}

function noUsage() {
  return { recipes: 0, inUnit: false, measures: new Map() };
}

function usedBy(recipes) {
  return { ...noUsage(), recipes };
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

async function respondToPost(status, body) {
  await waitFor(() => server.requestFor("POST", "/api/ingredients") !== undefined);
  server.requestFor("POST", "/api/ingredients").respond(status, body);
  await tick();
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
  openEditor({ usage: usedBy(2) });

  assert.equal(query(".unit-field").disabled, true);
  assert.equal(query(".unit-hint").hidden, false);
  assert.equal(
    query(".unit-hint").textContent,
    "Used in 2 recipes. To change the unit, remove the ingredient from those recipes first.",
  );

  query(".cancel").click();
  openEditor({ usage: usedBy(1) });

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

function openNewEditor() {
  return openEditor({ ingredient: null });
}

test("a new ingredient opens titled New ingredient, empty, with Choose a unit, and focus in Name", () => {
  openNewEditor();

  assert.equal(dialog.open, true);
  assert.equal(query(".dialog-title").textContent, "New ingredient");
  assert.equal(query(".name-field").value, "");
  assert.equal(query(".unit-field").value, "");
  assert.equal(query(".unit-field").selectedOptions[0].textContent, "Choose a unit");
  assert.equal(query(".unit-field").disabled, false);
  assertFocus(document, query(".name-field"));
});

test("an existing ingredient opens titled Edit ingredient, without the Choose a unit option", () => {
  openNewEditor();
  query(".cancel").click();
  openEditor();

  assert.equal(query(".dialog-title").textContent, "Edit ingredient");
  assert.equal(query('.unit-field option[value=""]').hidden, true);
  assert.equal(query(".unit-field").value, "g");
});

test("Done on a new ingredient without a unit shows Choose a unit. and sends nothing", () => {
  openNewEditor();
  setName("Onion");

  query(".done").click();

  assert.equal(dialog.open, true);
  assert.equal(query(".save-message").textContent, "Choose a unit.");
  assertFocus(document, query(".unit-field"));
  assert.equal(server.requests.length, 0);
});

test("Done on a new ingredient sends POST with the name and the unit, then closes", async () => {
  const { saved } = openNewEditor();
  setName("Onion");
  setUnit("pcs");

  query(".done").click();
  await waitFor(() => server.requestFor("POST", "/api/ingredients") !== undefined);
  assert.deepEqual(server.requestFor("POST", "/api/ingredients").body, {
    name: "Onion",
    unit: "pcs",
  });
  const created = { id: "onion", name: "Onion", unit: "pcs", measures: [], archived: false };
  await respondToPost(201, created);

  assert.equal(dialog.open, false);
  assert.deepEqual(saved, [created]);
});

test("a 409 with an archived ingredient says to restore it from Archived", async () => {
  openNewEditor();
  setName("saffron");
  setUnit("g");

  query(".done").click();
  await respondToPost(409, {
    error: 'An ingredient named "Saffron" already exists.',
    ingredient: { id: "saffron", name: "Saffron", unit: "g", archived: true },
  });

  assert.equal(dialog.open, true);
  assert.equal(
    query(".name-message").textContent,
    '"Saffron" is archived. To use it, restore it from Archived.',
  );
});

test("a new ingredient has changes once a field is filled", () => {
  openNewEditor();
  assert.equal(editor.hasChanges(), false);

  setName("Onion");
  assert.equal(editor.hasChanges(), true);
});

const SIZED_MILK = {
  ...MILK,
  measures: [
    { id: "m1", name: "medium", amount: 150 },
    { id: "m2", name: "large", amount: 250 },
  ],
};

function measureRows() {
  return [...document.querySelectorAll(".measure-row")];
}

function measureValues() {
  return measureRows().map((row) => [
    row.querySelector(".measure-name").value,
    row.querySelector(".measure-amount").value,
  ]);
}

function setField(element, value) {
  element.value = value;
  element.dispatchEvent(new window.Event("input", { bubbles: true }));
}

function pressEnter(element) {
  const event = new window.KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
  });
  element.dispatchEvent(event);
  return event;
}

async function sentBody() {
  await waitFor(() => server.requestFor("PATCH", "/api/ingredients/milk") !== undefined);
  return server.requestFor("PATCH", "/api/ingredients/milk").body;
}

test("opens with a row per measure, in order, with the unit after each amount", () => {
  openEditor({ ingredient: SIZED_MILK });

  assert.equal(query(".dialog-subtitle").textContent, "Measures");
  assert.deepEqual(measureValues(), [
    ["medium", "150"],
    ["large", "250"],
  ]);
  const [row] = measureRows();
  assert.equal(row.querySelector(".measure-name").getAttribute("aria-label"), "Measure name");
  assert.equal(
    row.querySelector(".measure-amount").getAttribute("aria-label"),
    "Amount of medium in g",
  );
  assert.equal(row.querySelector(".measure-amount").getAttribute("inputmode"), "decimal");
  assert.equal(row.querySelector(".unit").textContent, "g");
  assert.equal(row.querySelector(".remove").getAttribute("aria-label"), "Remove medium");
});

test("Add measure adds an empty row and focuses its name; at 20 rows it's disabled", () => {
  openEditor();
  const add = query(".add-measure");

  add.click();

  assert.deepEqual(measureValues(), [["", ""]]);
  assertFocus(document, query(".measure-name"));
  for (let count = 1; count < 20; count += 1) add.click();
  assert.equal(measureRows().length, 20);
  assert.equal(add.disabled, true);

  query(".measure-row .remove").click();
  assert.equal(add.disabled, false);
});

test("changing the unit of a new ingredient updates the unit after each amount", () => {
  openNewEditor();
  query(".add-measure").click();

  setUnit("ml");

  assert.equal(query(".measure-row .unit").textContent, "ml");
});

test("Remove is disabled on a measure that recipes use, with Used in 2 recipes.", () => {
  const measures = new Map([
    ["m1", 2],
    ["m2", 1],
  ]);
  openEditor({ ingredient: SIZED_MILK, usage: { ...noUsage(), measures } });

  const [first, second] = measureRows();
  assert.equal(first.querySelector(".remove").disabled, true);
  assert.equal(first.querySelector(".row-hint").textContent, "Used in 2 recipes.");
  assert.equal(second.querySelector(".remove").disabled, true);
  assert.equal(second.querySelector(".row-hint").textContent, "Used in 1 recipe.");
});

test("Remove stays disabled after a failed save", async () => {
  openEditor({
    ingredient: SIZED_MILK,
    usage: { ...noUsage(), measures: new Map([["m1", 1]]) },
  });
  setName("Oat milk");

  query(".done").click();
  await waitFor(() => server.requestFor("PATCH", "/api/ingredients/milk") !== undefined);
  server.requestFor("PATCH", "/api/ingredients/milk").fail();
  await tick();

  const [first, second] = measureRows();
  assert.equal(first.querySelector(".remove").disabled, true);
  assert.equal(second.querySelector(".remove").disabled, false);
});

test("Remove takes the row out and moves focus to the next row's Remove, else the title", () => {
  openEditor({ ingredient: SIZED_MILK });

  measureRows()[0].querySelector(".remove").click();
  assert.deepEqual(measureValues(), [["large", "250"]]);
  assertFocus(document, query(".measure-row .remove"));

  query(".measure-row .remove").click();
  assert.equal(measureRows().length, 0);
  assertFocus(document, query(".dialog-title"));
});

test("Remove moves focus to the previous row's Remove when the next row's is disabled", () => {
  const measures = [
    { id: "a", name: "a", amount: 1 },
    { id: "b", name: "b", amount: 2 },
    { id: "c", name: "c", amount: 3 },
  ];
  openEditor({
    ingredient: { ...MILK, measures },
    usage: { ...noUsage(), measures: new Map([["c", 1]]) },
  });

  measureRows()[1].querySelector(".remove").click();

  assert.deepEqual(measureValues(), [
    ["a", "1"],
    ["c", "3"],
  ]);
  assertFocus(document, measureRows()[0].querySelector(".remove"));
});

test("Done with an empty name or an invalid amount shows a message under its row and sends nothing", () => {
  openEditor({ ingredient: SIZED_MILK });
  const [first, second] = measureRows();
  setField(first.querySelector(".measure-name"), "  ");
  setField(second.querySelector(".measure-amount"), "0");

  query(".done").click();

  const [firstRow, secondRow] = measureRows();
  assert.equal(firstRow.querySelector(".row-message").textContent, "Enter a name.");
  assert.equal(
    secondRow.querySelector(".row-message").textContent,
    "Enter an amount from 0.01 to 10000, with up to two decimals.",
  );
  assertFocus(document, firstRow.querySelector(".measure-name"));
  assert.equal(server.requests.length, 0);
});

test("editing an invalid measure field clears its message and aria-invalid, and keeps focus in it", () => {
  openEditor({ ingredient: SIZED_MILK });
  setField(measureRows()[0].querySelector(".measure-name"), "  ");
  setField(measureRows()[1].querySelector(".measure-amount"), "0");
  query(".done").click();
  const [first, second] = measureRows();

  setField(first.querySelector(".measure-amount"), "151");
  assert.equal(first.querySelector(".row-message").textContent, "Enter a name.");

  const name = first.querySelector(".measure-name");
  setField(name, "s");
  assert.equal(first.querySelector(".row-message")?.textContent, undefined);
  assert.equal(name.hasAttribute("aria-invalid"), false);
  assertFocus(document, name);

  const amount = second.querySelector(".measure-amount");
  amount.focus();
  setField(amount, "2");
  assert.equal(second.querySelector(".row-message")?.textContent, undefined);
  assert.equal(amount.hasAttribute("aria-invalid"), false);
  assertFocus(document, amount);
});

test("a valid Done clears a message that a fix in another row made stale", async () => {
  openEditor({ ingredient: SIZED_MILK });
  setField(measureRows()[1].querySelector(".measure-name"), "medium");
  query(".done").click();
  assert.equal(
    measureRows()[1].querySelector(".row-message").textContent,
    '"medium" is already a measure.',
  );
  setField(measureRows()[0].querySelector(".measure-name"), "small");

  query(".done").click();

  assert.equal(measureRows()[1].querySelector(".row-message")?.textContent, undefined);
  assert.deepEqual((await sentBody()).measures[0], { id: "m1", name: "small", amount: 150 });
});

test("Enter in a valid measure field keeps the rows, so focus stays in the field", async () => {
  openEditor({ ingredient: SIZED_MILK });
  const amount = measureRows()[0].querySelector(".measure-amount");
  amount.focus();
  setField(amount, "160");

  pressEnter(amount);

  await sentBody();
  assert.equal(amount.isConnected, true);
  assertFocus(document, amount);
});

test('Done with two names that share a name key shows "medium" is already a measure.', () => {
  openEditor({ ingredient: SIZED_MILK });
  setField(measureRows()[1].querySelector(".measure-name"), " MÉDIUM ");

  query(".done").click();

  assert.equal(measureRows()[0].querySelector(".row-message"), null);
  assert.equal(
    measureRows()[1].querySelector(".row-message").textContent,
    '"MÉDIUM" is already a measure.',
  );
  assertFocus(document, measureRows()[1].querySelector(".measure-name"));
  assert.equal(server.requests.length, 0);
});

test("an amount typed as 1,09 is sent as 1.09", async () => {
  openEditor({ ingredient: SIZED_MILK });
  setField(measureRows()[0].querySelector(".measure-amount"), "1,09");

  query(".done").click();

  assert.deepEqual(await sentBody(), {
    measures: [
      { id: "m1", name: "medium", amount: 1.09 },
      { id: "m2", name: "large", amount: 250 },
    ],
  });
});

test("renaming a measure sends its id with the new name", async () => {
  openEditor({ ingredient: { ...MILK, measures: [{ id: "m1", name: "medium", amount: 150 }] } });
  setField(query(".measure-name"), "mediana");

  query(".done").click();

  assert.deepEqual(await sentBody(), { measures: [{ id: "m1", name: "mediana", amount: 150 }] });
});

test("Done sends measures only when they changed, new ones without id", async () => {
  openEditor({ ingredient: SIZED_MILK });
  setName("Oat milk");

  query(".done").click();
  assert.deepEqual(await sentBody(), { name: "Oat milk" });
  await respondToPatch(200, { ...SIZED_MILK, name: "Oat milk" });

  openEditor({ ingredient: SIZED_MILK });
  query(".add-measure").click();
  setField(query(".measure-row:last-child .measure-name"), "  extra   large ");
  setField(query(".measure-row:last-child .measure-amount"), "300");
  server.requests.length = 0;

  query(".done").click();

  assert.deepEqual(await sentBody(), {
    measures: [
      { id: "m1", name: "medium", amount: 150 },
      { id: "m2", name: "large", amount: 250 },
      { name: "extra large", amount: 300 },
    ],
  });
});

test("a new ingredient sends its measures with the POST", async () => {
  openNewEditor();
  setName("Onion");
  setUnit("g");
  query(".add-measure").click();
  setField(query(".measure-name"), "medium");
  setField(query(".measure-amount"), "150");

  query(".done").click();
  await waitFor(() => server.requestFor("POST", "/api/ingredients") !== undefined);

  assert.deepEqual(server.requestFor("POST", "/api/ingredients").body, {
    name: "Onion",
    unit: "g",
    measures: [{ name: "medium", amount: 150 }],
  });
});

test("Enter in a measure field confirms, the same as Done", async () => {
  openEditor({ ingredient: SIZED_MILK });
  setField(measureRows()[0].querySelector(".measure-amount"), "160");

  const event = pressEnter(measureRows()[0].querySelector(".measure-amount"));

  assert.equal(event.defaultPrevented, true);
  assert.deepEqual((await sentBody()).measures[0], { id: "m1", name: "medium", amount: 160 });
});

test("a measure in use (409 without an ingredient) shows the server's message", async () => {
  openEditor({ ingredient: SIZED_MILK });
  query(".remove").click();

  query(".done").click();
  await respondToPatch(409, { error: '"medium" is used in recipes.' });

  assert.equal(query(".save-message").textContent, '"medium" is used in recipes.');
  assert.equal(measureRows().length, 1);
});

test("hasChanges is true after editing, adding, or removing a measure", () => {
  openEditor({ ingredient: SIZED_MILK });
  assert.equal(editor.hasChanges(), false);

  setField(measureRows()[0].querySelector(".measure-amount"), "151");
  assert.equal(editor.hasChanges(), true);
  setField(measureRows()[0].querySelector(".measure-amount"), "150");
  assert.equal(editor.hasChanges(), false);

  query(".add-measure").click();
  assert.equal(editor.hasChanges(), true);
  measureRows()[2].querySelector(".remove").click();
  assert.equal(editor.hasChanges(), false);

  measureRows()[0].querySelector(".remove").click();
  assert.equal(editor.hasChanges(), true);
});
