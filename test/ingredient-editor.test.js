// Tests for the ingredient editor (public/ingredient-editor.js) against a
// real DOM, built from the real dialog markup in public/ingredients.html. See
// test/dom-helpers.js for the harness and the DOM library choice.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  assertFocus,
  fakeFetch,
  loadDialog,
  pointerdown,
  pressKey,
  respondTo,
  tick,
  typeInto,
  useQuietConsole,
  waitFor,
} from "./dom-helpers.js";

const quiet = useQuietConsole();

const MILK = { id: "milk", name: "Milk", unit: "g", archived: false };

let server;
let dialog;
let document;
let window;
let editor;
let cleanup;

beforeEach(async () => {
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
});

/** @param {{ ingredient?: object, usage?: object, others?: object[] }} [options] */
function openEditor({ ingredient = MILK, usage = noUsage(), others = [] } = {}) {
  const opener = document.createElement("button");
  document.body.append(opener);
  const saved = [];
  editor.open({
    ingredient,
    usage,
    others,
    restoreFocus: () => opener.focus(),
    onSaved: (entry) => saved.push(entry),
  });
  return { opener, saved };
}

function noUsage() {
  return { inUnit: false, measures: new Map() };
}

function query(selector) {
  return document.querySelector(selector);
}

function unitRadio(value) {
  return query(`.unit-field input[value="${value}"]`);
}

// Checks the unit's radio button, as a click or an arrow key does.
function setUnit(value) {
  unitRadio(value).checked = true;
  unitRadio(value).dispatchEvent(new window.Event("change", { bubbles: true }));
}

/** The checked unit, or "" when none is. */
function unitValue() {
  return query(".unit-field input:checked")?.value ?? "";
}

function openNewEditor() {
  return openEditor({ ingredient: null });
}

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

async function sentBody() {
  await waitFor(() => server.requestFor("PATCH", "/api/ingredients/milk") !== undefined);
  return server.requestFor("PATCH", "/api/ingredients/milk").body;
}

const unitsUsed = { ...noUsage(), inUnit: true };

function conversion() {
  return query(".conversion");
}

function setConversion(from, to) {
  typeInto(window, query(".conversion-from"), from);
  typeInto(window, query(".conversion-to"), to);
}

const NET = {
  id: "net",
  name: "net",
  unit: "pcs",
  measures: [{ id: "m1", name: "1", amount: 4 }],
};

function openConversion() {
  openEditor({ ingredient: SIZED_MILK, usage: unitsUsed });
  setUnit("ml");
}

// Converts Milk to ml, and selects Done.
function doneOnConversion() {
  openEditor({ ingredient: SIZED_MILK });
  setUnit("ml");
  setConversion("1", "2");
  query(".done").click();
}

// Changes the name, and selects Archive, which asks first.
async function archiveWithChanges() {
  const opened = openEditor();
  typeInto(window, query(".name-field"), "Changed, but not saved");
  query(".archive").click();
  await tick();
  return { ...opened, alert: document.querySelector('[role="alertdialog"]') };
}

describe("ingredient editor", () => {
  test("opens with the name and the unit", () => {
    openEditor();

    assert.equal(dialog.open, true);
    assert.equal(query(".name-field").value, "Milk");
    assert.equal(unitValue(), "g");
    assert.equal(query(".unit-field").disabled, false);
  });

  test("opens with focus on the title", () => {
    openEditor();

    assertFocus(document, query(".dialog-title"));
  });

  test("enables Unit even when recipes use the ingredient", () => {
    openEditor({ usage: { ...noUsage(), inUnit: true } });

    assert.equal(query(".unit-field").disabled, false);
    assert.equal(query(".unit-hint") === null, true, "there is no Unit hint");
  });

  test("closes without a request and returns focus on Done without changes", () => {
    const { opener } = openEditor();

    query(".done").click();

    assert.equal(dialog.open, false);
    assert.equal(server.requests.length, 0);
    assertFocus(document, opener);
  });

  test("sends the changed name and unit in one PATCH, then closes", async () => {
    const { saved } = openEditor();
    typeInto(window, query(".name-field"), "Whole milk");
    setUnit("ml");

    query(".done").click();

    assert.equal(query(".done").disabled, true);
    await waitFor(() => server.requestFor("PATCH", "/api/ingredients/milk") !== undefined);
    assert.deepEqual(server.requestFor("PATCH", "/api/ingredients/milk").body, {
      name: "Whole milk",
      unit: "ml",
    });
    const updated = { ...MILK, name: "Whole milk", unit: "ml" };
    await respondTo(server, "PATCH", "/api/ingredients/milk", 200, updated);
    assert.equal(dialog.open, false);
    assert.deepEqual(saved, [updated]);
  });

  test("shows the message under Name on a name conflict (409)", async () => {
    openEditor();
    typeInto(window, query(".name-field"), "egg");

    query(".done").click();
    await respondTo(server, "PATCH", "/api/ingredients/milk", 409, {
      error: 'An ingredient named "Egg" already exists.',
      ingredient: { id: "egg", name: "Egg", unit: "pcs", archived: false },
    });

    assert.equal(dialog.open, true);
    assert.equal(query(".name-message").textContent, '"Egg" already exists.');
    assertFocus(document, query(".name-field"));
  });

  test("points to Archived when the name conflicts with an archived ingredient", async () => {
    openEditor();
    typeInto(window, query(".name-field"), "saffron");

    query(".done").click();
    await respondTo(server, "PATCH", "/api/ingredients/milk", 409, {
      error: 'An ingredient named "Saffron" already exists.',
      ingredient: { id: "saffron", name: "Saffron", unit: "g", archived: true },
    });

    assert.equal(
      query(".name-message").textContent,
      '"Saffron" is archived. To use it, restore it from Archived.',
    );
  });

  test("shows the server's message when the unit is in use (409)", async () => {
    openEditor();
    setUnit("ml");

    query(".done").click();
    await respondTo(server, "PATCH", "/api/ingredients/milk", 409, {
      error: '"Milk" is used in recipes. To change its unit, remove it from those recipes first.',
    });

    assert.equal(dialog.open, true);
    assert.equal(
      query(".save-message").textContent,
      '"Milk" is used in recipes. To change its unit, remove it from those recipes first.',
    );
    assert.equal(unitValue(), "ml");
  });

  test("rejects Done with an empty name, with a message under Name", () => {
    openEditor();
    typeInto(window, query(".name-field"), "   ");

    query(".done").click();

    assert.equal(dialog.open, true);
    assert.equal(query(".name-message").textContent, "The name can't be empty.");
    assertFocus(document, query(".name-field"));
    assert.equal(server.requests.length, 0);
  });

  test("shows the server's message on a rejected save (400)", async () => {
    openEditor();
    typeInto(window, query(".name-field"), "x".repeat(101));

    query(".done").click();
    await respondTo(server, "PATCH", "/api/ingredients/milk", 400, {
      error: "The name must be at most 100 characters.",
    });

    assert.equal(query(".save-message").textContent, "The name must be at most 100 characters.");
  });

  test("keeps the editor open with the changes on a network error", async () => {
    quiet.expect(1);
    openEditor();
    typeInto(window, query(".name-field"), "Oat milk");

    query(".done").click();
    await waitFor(() => server.requestFor("PATCH", "/api/ingredients/milk") !== undefined);
    server.requestFor("PATCH", "/api/ingredients/milk").fail();
    await tick();

    assert.equal(dialog.open, true);
    assert.equal(query(".save-message").textContent, "Couldn't save the ingredient. Try again.");
    assert.equal(query(".name-field").value, "Oat milk");
    assertFocus(document, query(".done"));
  });

  test("closes and returns focus to the opener with Cancel", () => {
    const { opener } = openEditor();
    typeInto(window, query(".name-field"), "Oat milk");

    query(".cancel").click();

    assert.equal(dialog.open, false);
    assertFocus(document, opener);
  });

  test("discards the changes with Escape, the close event of the dialog", () => {
    openEditor();
    typeInto(window, query(".name-field"), "Oat milk");

    dialog.close();

    assert.equal(dialog.open, false);
    assert.equal(editor.hasChanges(), false);
    assert.equal(server.requests.length, 0);
  });

  test("closes on a backdrop click only when nothing changed", () => {
    openEditor();
    pointerdown(window, dialog);
    dialog.click();
    assert.equal(dialog.open, false);

    openEditor();
    setUnit("ml");
    pointerdown(window, dialog);
    dialog.click();
    assert.equal(dialog.open, true);
  });

  test("confirms with Enter in Name, the same as Done", async () => {
    openEditor();
    typeInto(window, query(".name-field"), "Oat milk");

    const event = pressKey(window, query(".name-field"), "Enter");

    assert.equal(event.defaultPrevented, true);
    await respondTo(server, "PATCH", "/api/ingredients/milk", 200, { ...MILK, name: "Oat milk" });
  });

  test("offers Unit as a group of g, ml, and pcs", () => {
    openEditor();

    const group = query(".unit-field");
    assert.equal(group.tagName, "FIELDSET");
    assert.equal(group.querySelector("legend").textContent, "Unit");
    assert.deepEqual(
      [...group.querySelectorAll('input[type="radio"]')].map((radio) => [
        radio.value,
        radio.closest("label").textContent.trim(),
      ]),
      [
        ["g", "g"],
        ["ml", "ml"],
        ["pcs", "pcs"],
      ],
    );
  });

  test("opens a new ingredient titled New ingredient, with no unit chosen", () => {
    openNewEditor();

    assert.equal(dialog.open, true);
    assert.equal(query(".dialog-title").textContent, "New ingredient");
    assert.equal(query(".name-field").value, "");
    assert.equal(unitValue(), "");
    assert.equal(query(".unit-field").disabled, false);
    assertFocus(document, query(".name-field"));
  });

  test("opens an existing ingredient titled Edit ingredient after a new one", () => {
    openNewEditor();
    setUnit("pcs");
    query(".cancel").click();
    openEditor();

    assert.equal(query(".dialog-title").textContent, "Edit ingredient");
    assert.equal(unitValue(), "g");
  });

  test("rejects Done for a new ingredient without a unit", () => {
    openNewEditor();
    typeInto(window, query(".name-field"), "Onion");

    query(".done").click();

    assert.equal(dialog.open, true);
    assert.equal(query(".save-message").textContent, "Choose a unit.");
    assertFocus(document, unitRadio("g"));
    assert.equal(server.requests.length, 0);
  });

  test("sends POST with a new ingredient's name and unit, then closes", async () => {
    const { saved } = openNewEditor();
    typeInto(window, query(".name-field"), "Onion");
    setUnit("pcs");

    query(".done").click();
    await waitFor(() => server.requestFor("POST", "/api/ingredients") !== undefined);
    assert.deepEqual(server.requestFor("POST", "/api/ingredients").body, {
      name: "Onion",
      unit: "pcs",
    });
    const created = { id: "onion", name: "Onion", unit: "pcs", measures: [], archived: false };
    await respondTo(server, "POST", "/api/ingredients", 201, created);

    assert.equal(dialog.open, false);
    assert.deepEqual(saved, [created]);
  });

  test("points to Archived when a new name conflicts with an archived one", async () => {
    openNewEditor();
    typeInto(window, query(".name-field"), "saffron");
    setUnit("g");

    query(".done").click();
    await respondTo(server, "POST", "/api/ingredients", 409, {
      error: 'An ingredient named "Saffron" already exists.',
      ingredient: { id: "saffron", name: "Saffron", unit: "g", archived: true },
    });

    assert.equal(dialog.open, true);
    assert.equal(
      query(".name-message").textContent,
      '"Saffron" is archived. To use it, restore it from Archived.',
    );
  });

  test("reports changes once a field of a new ingredient is filled", () => {
    openNewEditor();
    assert.equal(editor.hasChanges(), false);

    typeInto(window, query(".name-field"), "Onion");
    assert.equal(editor.hasChanges(), true);
  });

  test("opens a row per measure, in order, with the unit after each amount", () => {
    openEditor({ ingredient: SIZED_MILK });

    assert.equal(
      query(".measure-rows").closest(".card").previousElementSibling.textContent,
      "Measures",
    );
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

  test("adds an empty row with focus on its name with Add measure", () => {
    openEditor();

    query(".add-measure").click();

    assert.deepEqual(measureValues(), [["", ""]]);
    assertFocus(document, query(".measure-name"));
  });

  test("disables Add measure at 20 rows until a row is removed", () => {
    openEditor();
    const add = query(".add-measure");

    for (let count = 0; count < 20; count += 1) add.click();
    assert.equal(measureRows().length, 20);
    assert.equal(add.disabled, true);

    query(".measure-row .remove").click();
    assert.equal(add.disabled, false);
  });

  test("updates the unit after each amount when the unit changes", () => {
    openNewEditor();
    query(".add-measure").click();

    setUnit("ml");

    assert.equal(query(".measure-row .unit").textContent, "ml");
  });

  test("disables Remove on a measure that two recipes use", () => {
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

  test("keeps Remove disabled after a failed save", async () => {
    quiet.expect(1);
    openEditor({
      ingredient: SIZED_MILK,
      usage: { ...noUsage(), measures: new Map([["m1", 1]]) },
    });
    typeInto(window, query(".name-field"), "Oat milk");

    query(".done").click();
    await waitFor(() => server.requestFor("PATCH", "/api/ingredients/milk") !== undefined);
    server.requestFor("PATCH", "/api/ingredients/milk").fail();
    await tick();

    const [first, second] = measureRows();
    assert.equal(first.querySelector(".remove").disabled, true);
    assert.equal(second.querySelector(".remove").disabled, false);
  });

  test("removes a row and moves focus to the next Remove, else the title", () => {
    openEditor({ ingredient: SIZED_MILK });

    measureRows()[0].querySelector(".remove").click();
    assert.deepEqual(measureValues(), [["large", "250"]]);
    assertFocus(document, query(".measure-row .remove"));

    query(".measure-row .remove").click();
    assert.equal(measureRows().length, 0);
    assertFocus(document, query(".dialog-title"));
  });

  test("moves focus to the previous Remove when the next Remove is disabled", () => {
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

  test("rejects Done with an invalid measure row", () => {
    openEditor({ ingredient: SIZED_MILK });
    const [first, second] = measureRows();
    typeInto(window, first.querySelector(".measure-name"), "  ");
    typeInto(window, second.querySelector(".measure-amount"), "0");

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

  test("clears the message and aria-invalid of an edited field, keeping focus", () => {
    openEditor({ ingredient: SIZED_MILK });
    typeInto(window, measureRows()[0].querySelector(".measure-name"), "  ");
    typeInto(window, measureRows()[1].querySelector(".measure-amount"), "0");
    query(".done").click();
    const [first, second] = measureRows();

    typeInto(window, first.querySelector(".measure-amount"), "151");
    assert.equal(first.querySelector(".row-message").textContent, "Enter a name.");

    const name = first.querySelector(".measure-name");
    typeInto(window, name, "s");
    assert.equal(first.querySelector(".row-message")?.textContent, undefined);
    assert.equal(name.hasAttribute("aria-invalid"), false);
    assertFocus(document, name);

    const amount = second.querySelector(".measure-amount");
    amount.focus();
    typeInto(window, amount, "2");
    assert.equal(second.querySelector(".row-message")?.textContent, undefined);
    assert.equal(amount.hasAttribute("aria-invalid"), false);
    assertFocus(document, amount);
  });

  test("clears a stale message on a valid Done after a fix in another row", async () => {
    openEditor({ ingredient: SIZED_MILK });
    typeInto(window, measureRows()[1].querySelector(".measure-name"), "medium");
    query(".done").click();
    assert.equal(
      measureRows()[1].querySelector(".row-message").textContent,
      '"medium" is already a measure.',
    );
    typeInto(window, measureRows()[0].querySelector(".measure-name"), "small");

    query(".done").click();

    assert.equal(measureRows()[1].querySelector(".row-message")?.textContent, undefined);
    assert.deepEqual((await sentBody()).measures[0], { id: "m1", name: "small", amount: 150 });
    await respondTo(server, "PATCH", "/api/ingredients/milk", 200, MILK);
  });

  test("keeps focus in a valid measure field on Enter", async () => {
    openEditor({ ingredient: SIZED_MILK });
    const amount = measureRows()[0].querySelector(".measure-amount");
    amount.focus();
    typeInto(window, amount, "160");

    pressKey(window, amount, "Enter");

    await sentBody();
    assert.equal(amount.isConnected, true);
    assertFocus(document, amount);
    await respondTo(server, "PATCH", "/api/ingredients/milk", 200, MILK);
  });

  test("shows a message on Done when two measures share a name key", () => {
    openEditor({ ingredient: SIZED_MILK });
    typeInto(window, measureRows()[1].querySelector(".measure-name"), " MÉDIUM ");

    query(".done").click();

    assert.equal(
      measureRows()[0].querySelector(".row-message") === null,
      true,
      "the first measure row has no message",
    );
    assert.equal(
      measureRows()[1].querySelector(".row-message").textContent,
      '"MÉDIUM" is already a measure.',
    );
    assertFocus(document, measureRows()[1].querySelector(".measure-name"));
    assert.equal(server.requests.length, 0);
  });

  test("sends an amount typed as 1,09 as 1.09", async () => {
    openEditor({ ingredient: SIZED_MILK });
    typeInto(window, measureRows()[0].querySelector(".measure-amount"), "1,09");

    query(".done").click();

    assert.deepEqual(await sentBody(), {
      unit: "g",
      measures: [
        { id: "m1", name: "medium", amount: 1.09 },
        { id: "m2", name: "large", amount: 250 },
      ],
    });
    await respondTo(server, "PATCH", "/api/ingredients/milk", 200, MILK);
  });

  test("sends the id and the new name of a renamed measure", async () => {
    openEditor({ ingredient: { ...MILK, measures: [{ id: "m1", name: "medium", amount: 150 }] } });
    typeInto(window, query(".measure-name"), "mediana");

    query(".done").click();

    assert.deepEqual(await sentBody(), {
      unit: "g",
      measures: [{ id: "m1", name: "mediana", amount: 150 }],
    });
    await respondTo(server, "PATCH", "/api/ingredients/milk", 200, MILK);
  });

  test("sends only the name with Done when only the name changed", async () => {
    openEditor({ ingredient: SIZED_MILK });
    typeInto(window, query(".name-field"), "Oat milk");

    query(".done").click();

    assert.deepEqual(await sentBody(), { name: "Oat milk" });
    await respondTo(server, "PATCH", "/api/ingredients/milk", 200, {
      ...SIZED_MILK,
      name: "Oat milk",
    });
  });

  test("sends all measures, new ones without an id, when one was added", async () => {
    openEditor({ ingredient: SIZED_MILK });
    query(".add-measure").click();
    typeInto(window, query(".measure-row:last-child .measure-name"), "  extra   large ");
    typeInto(window, query(".measure-row:last-child .measure-amount"), "300");

    query(".done").click();

    assert.deepEqual(await sentBody(), {
      unit: "g",
      measures: [
        { id: "m1", name: "medium", amount: 150 },
        { id: "m2", name: "large", amount: 250 },
        { name: "extra large", amount: 300 },
      ],
    });
    await respondTo(server, "PATCH", "/api/ingredients/milk", 200, SIZED_MILK);
  });

  test("sends the unit with the measures", async () => {
    openEditor({ ingredient: SIZED_MILK });
    typeInto(window, measureRows()[0].querySelector(".measure-amount"), "160");

    query(".done").click();

    assert.equal((await sentBody()).unit, "g");
    await respondTo(server, "PATCH", "/api/ingredients/milk", 200, SIZED_MILK);
  });

  test("shows the message of a 400 for a stale unit", async () => {
    openEditor({ ingredient: SIZED_MILK });
    typeInto(window, measureRows()[0].querySelector(".measure-amount"), "160");

    query(".done").click();

    await sentBody();
    const error = '"Milk" has measures or recipes in ml. Reload the page to change its unit.';
    await respondTo(server, "PATCH", "/api/ingredients/milk", 400, { error });
    assert.equal(dialog.open, true);
    assert.equal(query(".save-message").textContent, error);
  });

  test("sends the measures of a new ingredient with the POST", async () => {
    openNewEditor();
    typeInto(window, query(".name-field"), "Onion");
    setUnit("g");
    query(".add-measure").click();
    typeInto(window, query(".measure-name"), "medium");
    typeInto(window, query(".measure-amount"), "150");

    query(".done").click();
    await waitFor(() => server.requestFor("POST", "/api/ingredients") !== undefined);

    assert.deepEqual(server.requestFor("POST", "/api/ingredients").body, {
      name: "Onion",
      unit: "g",
      measures: [{ name: "medium", amount: 150 }],
    });
    await respondTo(server, "POST", "/api/ingredients", 201, { ...MILK, name: "Onion" });
  });

  test("confirms with Enter in a measure field, the same as Done", async () => {
    openEditor({ ingredient: SIZED_MILK });
    typeInto(window, measureRows()[0].querySelector(".measure-amount"), "160");

    const event = pressKey(window, measureRows()[0].querySelector(".measure-amount"), "Enter");

    assert.equal(event.defaultPrevented, true);
    assert.deepEqual((await sentBody()).measures[0], { id: "m1", name: "medium", amount: 160 });
    await respondTo(server, "PATCH", "/api/ingredients/milk", 200, MILK);
  });

  test("shows the server's message when a measure is in use (409)", async () => {
    openEditor({ ingredient: SIZED_MILK });
    query(".remove").click();

    query(".done").click();
    await respondTo(server, "PATCH", "/api/ingredients/milk", 409, {
      error: '"medium" is used in recipes.',
    });

    assert.equal(query(".save-message").textContent, '"medium" is used in recipes.');
    assert.equal(measureRows().length, 1);
  });

  test("reports changes after editing, adding, or removing a measure", () => {
    openEditor({ ingredient: SIZED_MILK });
    assert.equal(editor.hasChanges(), false);

    typeInto(window, measureRows()[0].querySelector(".measure-amount"), "151");
    assert.equal(editor.hasChanges(), true);
    typeInto(window, measureRows()[0].querySelector(".measure-amount"), "150");
    assert.equal(editor.hasChanges(), false);

    query(".add-measure").click();
    assert.equal(editor.hasChanges(), true);
    measureRows()[2].querySelector(".remove").click();
    assert.equal(editor.hasChanges(), false);

    measureRows()[0].querySelector(".remove").click();
    assert.equal(editor.hasChanges(), true);
  });

  test("hides the conversion row when nothing uses the unit", () => {
    openEditor();

    setUnit("ml");

    assert.equal(conversion().hidden, true);
  });

  test("shows the conversion row when the ingredient has measures", () => {
    openEditor({ ingredient: SIZED_MILK });
    assert.equal(conversion().hidden, true);

    setUnit("ml");

    assert.equal(conversion().hidden, false);
  });

  test("shows the conversion row when recipes use the unit", () => {
    openEditor({ usage: unitsUsed });

    setUnit("ml");

    assert.equal(conversion().hidden, false);
  });

  test("hides the conversion row for a new ingredient", () => {
    openNewEditor();

    setUnit("ml");

    assert.equal(conversion().hidden, true);
  });

  test("asks for the measure name only when recipes use the unit", () => {
    openEditor({ ingredient: SIZED_MILK });
    setUnit("ml");

    assert.equal(query(".conversion-from").value, "1");
    assert.equal(query(".conversion-to").value, "");
    assert.equal(query(".conversion-from").getAttribute("aria-label"), "Amount in the old unit");
    assert.equal(query(".conversion-to").getAttribute("aria-label"), "Amount in the new unit");
    assert.equal(query(".conversion-from-unit").textContent, "g");
    assert.equal(query(".conversion-to-unit").textContent, "ml");
    assert.equal(query(".conversion-measure").hidden, true);

    query(".cancel").click();
    openEditor({ usage: unitsUsed });
    setUnit("ml");

    assert.equal(query(".conversion-measure").hidden, false);
    assert.equal(query(".conversion-measure-name").value, "g");
  });

  test("shows measure rows as read-only previews in the new unit", () => {
    openEditor({ ingredient: NET });
    setUnit("g");
    setConversion("1", "120");

    // 4 pcs × 120 g per 1 pcs = 480 g
    assert.deepEqual(measureValues(), [["1", "480"]]);
    const [row] = measureRows();
    assert.equal(row.querySelector(".unit").textContent, "g");
    assert.equal(row.querySelector(".measure-name").readOnly, true);
    assert.equal(row.querySelector(".measure-amount").readOnly, true);
    assert.equal(row.querySelector(".remove").disabled, true);
    assert.equal(query(".add-measure").disabled, true);

    setConversion("3", "10");
    // 4 pcs × 10 g per 3 pcs = 13.333… g, rounded to two decimals
    assert.deepEqual(measureValues(), [["1", "13.33"]]);
  });

  test("falls back to the stored amount when the conversion isn't a number", () => {
    openEditor({ ingredient: NET });
    setUnit("g");

    setConversion("x", "10");

    assert.deepEqual(measureValues(), [["1", "4"]]);
  });

  test("keeps the old unit and explains why when measures have unsaved changes", () => {
    openEditor({ ingredient: SIZED_MILK });
    typeInto(window, measureRows()[0].querySelector(".measure-amount"), "160");

    setUnit("ml");

    assert.equal(unitValue(), "g");
    assert.equal(conversion().hidden, true);
    assert.equal(
      query(".save-message").textContent,
      "Save your changes to the measures before you change the unit.",
    );
    assert.deepEqual(measureValues()[0], ["medium", "160"]);
  });

  test("sends the unit and the conversion, without measures, on Done", async () => {
    openEditor({ ingredient: SIZED_MILK, usage: unitsUsed });
    setUnit("ml");
    setConversion("1", "120");
    typeInto(window, query(".conversion-measure-name"), "piece");

    query(".done").click();

    assert.deepEqual(await sentBody(), {
      unit: "ml",
      conversion: { from: 1, to: 120, measureName: "piece" },
    });
    await respondTo(server, "PATCH", "/api/ingredients/milk", 200, MILK);
  });

  test("sends no measureName on Done when recipes don't use the unit", async () => {
    openEditor({ ingredient: SIZED_MILK });
    setUnit("ml");
    setConversion("1", "2");

    query(".done").click();

    assert.deepEqual(await sentBody(), { unit: "ml", conversion: { from: 1, to: 2 } });
    await respondTo(server, "PATCH", "/api/ingredients/milk", 200, MILK);
  });

  test("sends a conversion typed as 1,5 as 1.5", async () => {
    openEditor({ ingredient: SIZED_MILK });
    setUnit("ml");
    setConversion("1,5", "120,25");

    query(".done").click();

    assert.deepEqual((await sentBody()).conversion, { from: 1.5, to: 120.25 });
    await respondTo(server, "PATCH", "/api/ingredients/milk", 200, MILK);
  });

  test("shows a message and focuses the new amount when it's empty", () => {
    openConversion();
    setConversion("1", "");

    query(".done").click();

    assert.equal(
      query(".conversion-message").textContent,
      "Enter a number from 0.01 to 10000, with up to two decimals.",
    );
    assertFocus(document, query(".conversion-to"));
    assert.equal(server.requests.length, 0);
  });

  test("focuses the old amount when it's zero", () => {
    openConversion();
    setConversion("0", "5");

    query(".done").click();

    assertFocus(document, query(".conversion-from"));
    assert.equal(server.requests.length, 0);
  });

  test("shows a message and focuses the measure name when it's empty", () => {
    openConversion();
    setConversion("1", "5");
    typeInto(window, query(".conversion-measure-name"), "  ");

    query(".done").click();

    assert.equal(query(".conversion-message").textContent, "Enter a name.");
    assertFocus(document, query(".conversion-measure-name"));
    assert.equal(server.requests.length, 0);
  });

  test("hides the conversion row and enables the rows on the old unit", () => {
    openEditor({ ingredient: SIZED_MILK });
    setUnit("ml");
    setConversion("1", "2");

    setUnit("g");

    assert.equal(conversion().hidden, true);
    assert.deepEqual(measureValues(), [
      ["medium", "150"],
      ["large", "250"],
    ]);
    assert.equal(measureRows()[0].querySelector(".measure-amount").readOnly, false);
    assert.equal(query(".add-measure").disabled, false);
    assert.equal(editor.hasChanges(), false);
  });

  test("keeps the conversion for another new unit", () => {
    openEditor({ usage: unitsUsed });
    setUnit("ml");
    typeInto(window, query(".conversion-to"), "2");
    typeInto(window, query(".conversion-measure-name"), "piece");

    setUnit("pcs");

    assert.equal(query(".conversion-from").value, "1");
    assert.equal(query(".conversion-to").value, "2");
    assert.equal(query(".conversion-measure-name").value, "piece");
    assert.equal(query(".conversion-from-unit").textContent, "g");
    assert.equal(query(".conversion-to-unit").textContent, "pcs");
  });

  test("resets the conversion when the unit goes back to the old one", () => {
    openEditor({ usage: unitsUsed });
    setUnit("ml");
    typeInto(window, query(".conversion-to"), "2");
    typeInto(window, query(".conversion-measure-name"), "piece");
    setUnit("pcs");

    setUnit("g");
    setUnit("ml");

    assert.equal(query(".conversion-from").value, "1");
    assert.equal(query(".conversion-to").value, "");
    assert.equal(query(".conversion-measure-name").value, "g");
    assert.equal(query(".conversion-to-unit").textContent, "ml");
  });

  test("shows the message of a 400 and keeps measure rows read-only", async () => {
    openEditor({ ingredient: SIZED_MILK });
    setUnit("ml");
    setConversion("1", "9999");

    query(".done").click();
    await respondTo(server, "PATCH", "/api/ingredients/milk", 400, {
      error: 'The amount of "large" is out of limits.',
    });

    assert.equal(dialog.open, true);
    assert.equal(query(".save-message").textContent, 'The amount of "large" is out of limits.');
    assert.equal(measureRows()[0].querySelector(".measure-amount").readOnly, true);
  });

  test("disables Unit while the save is pending", async () => {
    doneOnConversion();

    assert.equal(query(".unit-field").disabled, true);
    // Answer the save: a request that stays open times out, and logs an error.
    await respondTo(server, "PATCH", "/api/ingredients/milk", 200, { ...SIZED_MILK, unit: "ml" });
  });

  test("keeps the conversion row and enables Unit after a failed save", async () => {
    quiet.expect(1);
    doneOnConversion();

    await waitFor(() => server.requestFor("PATCH", "/api/ingredients/milk") !== undefined);
    server.requestFor("PATCH", "/api/ingredients/milk").fail();
    await tick();

    assert.equal(query(".unit-field").disabled, false);
    assert.equal(conversion().hidden, false);
    assert.equal(query(".conversion-from").disabled, false);
    assert.equal(query(".conversion-to").disabled, false);
  });

  test("shows Archive only for an ingredient that exists and isn't archived", () => {
    openNewEditor();
    assert.equal(query(".archive").hidden, true);
    query(".cancel").click();

    openEditor({ ingredient: { ...MILK, archived: true } });
    assert.equal(query(".archive").hidden, true);
    query(".cancel").click();

    openEditor();
    assert.equal(query(".archive").hidden, false);
  });

  test("asks before it archives with changes", async () => {
    const { alert } = await archiveWithChanges();

    assert.equal(alert.querySelector(".alert-title").textContent, "Archive without saving?");
    assert.equal(server.requests.length, 0);
  });

  test("sends only archived: true with Archive Without Saving", async () => {
    const { alert, saved } = await archiveWithChanges();

    alert.querySelector(".lose").click();
    await respondTo(server, "PATCH", "/api/ingredients/milk", 200, { ...MILK, archived: true });

    assert.deepEqual(server.requestFor("PATCH", "/api/ingredients/milk").body, { archived: true });
    assert.equal(dialog.open, false);
    assert.deepEqual(saved, [{ ...MILK, archived: true }]);
  });

  test("keeps the editor open and shows a message when the archive fails", async () => {
    quiet.expect(1);
    openEditor();

    query(".archive").click();
    await waitFor(() => server.requestFor("PATCH", "/api/ingredients/milk") !== undefined);
    server.requestFor("PATCH", "/api/ingredients/milk").fail();
    await tick();

    assert.equal(dialog.open, true);
    assert.equal(query(".save-message").textContent, "Couldn't archive the ingredient. Try again.");
  });

  test("marks an invalid measure amount as you type without disabling Done", () => {
    openEditor({ ingredient: SIZED_MILK });
    const amount = measureRows()[0].querySelector(".measure-amount");

    typeInto(window, amount, "0");
    assert.equal(amount.getAttribute("aria-invalid"), "true");
    assert.equal(
      measureRows()[0].querySelector(".row-message") === null,
      true,
      "the first measure row has no message",
    );
    assert.equal(query(".done").disabled, false);

    typeInto(window, amount, "160");
    assert.equal(amount.hasAttribute("aria-invalid"), false);
  });

  test("reports a taken name as you type", () => {
    openEditor({
      others: [
        { id: "flour", name: "Flour", archived: false },
        { id: "milk", name: "Milk", archived: false }, // the ingredient being edited
      ],
    });

    typeInto(window, query(".name-field"), "flour");
    assert.equal(query(".name-message").textContent, '"Flour" already exists.');
    query(".done").click();
    assert.equal(server.requests.length, 0);
    assertFocus(document, query(".name-field"));

    typeInto(window, query(".name-field"), "Milk");
    assert.equal(query(".name-message").textContent, "");
  });
});
