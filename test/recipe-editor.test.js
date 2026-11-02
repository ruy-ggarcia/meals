// Tests for the recipe editor (public/recipe-editor.js) against a real DOM,
// built from the real dialog markup in public/recipes.html. See
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

const QUANTITY_MESSAGE = "Enter a quantity from 0.01 to 10000, with up to two decimals.";
const EGG = { id: "egg", name: "Egg", unit: "pcs", measures: [], archived: false };
const MILK = { id: "milk", name: "Milk", unit: "ml", measures: [], archived: false };
const ONION = {
  id: "onion",
  name: "Onion",
  unit: "g",
  measures: [
    { id: "medium", name: "medium", amount: 150 },
    { id: "large", name: "large", amount: 250 },
  ],
  archived: false,
};
const SALT = { id: "salt", name: "Salt", unit: "g", measures: [], archived: true };
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
});

/** @param {{ recipe?: object, ingredients?: object[], others?: object[] }} [options] */
function openEditor({ recipe, ingredients = CATALOG, others = [] } = {}) {
  const opener = document.createElement("button");
  document.body.append(opener);
  const saved = [];
  editor.open({
    recipe,
    ingredients,
    others,
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

function addIngredient(text) {
  typeInto(window, search(), text);
  pressKey(window, search(), "Enter");
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

describe("recipe editor", () => {
  test("opens an existing recipe with its name and ingredients", () => {
    openEditor({ recipe: SOUP });

    assert.equal(query(".dialog-title").textContent, "Edit recipe");
    assert.equal(nameField().value, "Onion soup");
    assert.equal(query(".no-ingredients").hidden, true);
    assert.deepEqual(rowNames(), ["Onion", "Salt (archived)"]);
    assert.deepEqual(
      quantityFields().map((field) => field.value),
      ["150", "0.5"],
    );
    assert.deepEqual(
      [...document.querySelectorAll(".ingredient-row .unit")].map((unit) => unit.textContent),
      ["g"],
    );
  });

  test("opens an existing recipe with focus on the title", () => {
    openEditor({ recipe: SOUP });

    assertFocus(document, query(".dialog-title"));
  });

  test("gives a quantity field a decimal input mode and an ingredient label", () => {
    openEditor({ recipe: SOUP });

    assert.equal(quantityFields()[0].getAttribute("inputmode"), "decimal");
    assert.equal(quantityFields()[0].getAttribute("aria-label"), "Quantity of Onion per serving");
  });
});

test("Add ingredient offers active ingredients not in the recipe, from A to Z, with their unit", () => {
  openEditor({ recipe: SOUP });

  assert.deepEqual(optionTexts(), ["Egg (pcs)", "Milk (ml)"]);
  typeInto(window, search(), "MI");
  assert.deepEqual(optionTexts(), ["Milk (ml)"]);
});

test("Enter in Add ingredient adds the highlighted ingredient with an empty quantity, focused", () => {
  openEditor();
  typeInto(window, search(), "egg");

  const event = pressKey(window, search(), "Enter");

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

  typeInto(window, search(), "xyz");

  assert.equal(query(".options").hidden, true);
  assert.equal(query(".no-match").hidden, false);
  assert.equal(
    query(".no-match").textContent,
    "No active ingredients match. Add them on the Ingredients page.",
  );
});

test("a recipe without ingredients warns that the shopping list can't count it", () => {
  openEditor();

  assert.equal(
    query(".no-ingredients").textContent.trim(),
    "No ingredients yet. You can save it, but the shopping list can't count it.",
  );
  assert.equal(search().placeholder, "Type part of a name");
});

test("Done with an invalid quantity shows a message under its row, focuses it, and sends nothing", () => {
  openEditor({ recipe: SOUP });
  typeInto(window, quantityFields()[1], "1.255");

  query(".done").click();

  const rows = [...document.querySelectorAll(".ingredient-row")];
  assert.equal(dialog.open, true);
  assert.equal(
    rows[0].querySelector(".row-message") === null,
    true,
    "the first row has no message",
  );
  assert.equal(
    rows[1].querySelector(".row-message").textContent,
    "Enter a quantity from 0.01 to 10000, with up to two decimals.",
  );
  assert.equal(quantityFields()[1].value, "1.255");
  assertFocus(document, quantityFields()[1]);
  assert.equal(server.requests.length, 0);
});

describe("recipe editor", () => {
  // Marks both quantities invalid with Done, then fixes the first one.
  function fixFirstQuantity() {
    openEditor({ recipe: SOUP });
    typeInto(window, quantityFields()[0], "1.255");
    typeInto(window, quantityFields()[1], "0");
    query(".done").click();
    const rows = [...document.querySelectorAll(".ingredient-row")];

    typeInto(window, quantityFields()[0], "1.25");
    return rows;
  }

  test("clears the edited quantity's message and aria-invalid, and keeps focus", () => {
    const [first] = fixFirstQuantity();

    assert.equal(first.querySelector(".row-message")?.textContent, undefined);
    assert.equal(quantityFields()[0].hasAttribute("aria-invalid"), false);
    assertFocus(document, quantityFields()[0]);
  });

  test("leaves the message of another invalid quantity", () => {
    const [, second] = fixFirstQuantity();

    assert.equal(second.querySelector(".row-message")?.textContent, QUANTITY_MESSAGE);
    assert.equal(quantityFields()[1].getAttribute("aria-invalid"), "true");
  });
});

test("a quantity that isn't valid is marked as you type, and Done stays enabled", () => {
  openEditor({ recipe: SOUP });
  const field = quantityFields()[0];

  typeInto(window, field, "1.255");
  assert.equal(field.getAttribute("aria-invalid"), "true");
  assert.equal(
    field.closest(".ingredient-row").querySelector(".row-message") === null,
    true,
    "the row of the field has no message",
  );
  assert.equal(query(".done").disabled, false);

  typeInto(window, field, "1,25");
  assert.equal(field.hasAttribute("aria-invalid"), false);

  typeInto(window, field, "");
  assert.equal(field.hasAttribute("aria-invalid"), false); // empty says nothing until Done
});

test("a quantity marked as you type stays marked when the rows render again", () => {
  openEditor({ recipe: SOUP });
  typeInto(window, quantityFields()[0], "abc");

  addIngredient("egg");

  assert.equal(quantityFields()[0].getAttribute("aria-invalid"), "true");
});

const OTHERS = [
  { id: "gazpacho", name: "Gazpacho", archived: false },
  { id: "old", name: "Old stew", archived: true },
  { id: "soup", name: "Onion soup", archived: false }, // the recipe being edited
];

test("a name that another recipe has shows its message as you type, ignoring case and accents", () => {
  openEditor({ recipe: SOUP, others: OTHERS });

  typeInto(window, nameField(), "GAZPÁCHO");
  assert.equal(query(".name-message").textContent, '"Gazpacho" already exists.');

  typeInto(window, nameField(), "old  stew");
  assert.equal(
    query(".name-message").textContent,
    '"Old stew" is archived. To use it, restore it from Archived.',
  );

  typeInto(window, nameField(), "Gazpacho andaluz");
  assert.equal(query(".name-message").textContent, "");

  typeInto(window, nameField(), "Onion soup"); // its own name
  assert.equal(query(".name-message").textContent, "");
});

test("Done with a name that another recipe has keeps the message and sends nothing", () => {
  openEditor({ others: OTHERS });
  typeInto(window, nameField(), "gazpacho");

  query(".done").click();

  assert.equal(query(".name-message").textContent, '"Gazpacho" already exists.');
  assertFocus(document, nameField());
  assert.equal(server.requests.length, 0);
});

test("typing in Name clears the empty-name message", () => {
  openEditor();
  query(".done").click();
  assert.equal(query(".name-message").textContent, "The name can't be empty.");

  typeInto(window, nameField(), "P");

  assert.equal(query(".name-message").textContent, "");
});

test("a valid Done doesn't re-render the rows, so focus stays in the field", async () => {
  openEditor({ recipe: SOUP });
  const field = quantityFields()[0];
  field.focus();
  typeInto(window, field, "160");

  query(".done").click();

  await waitFor(() => server.requestFor("PATCH", "/api/recipes/soup") !== undefined);
  assert.equal(field.isConnected, true);
  assertFocus(document, field);
  await respondTo(server, "PATCH", "/api/recipes/soup", 200, SOUP);
});

test("Done with an empty name shows a message under Name and sends nothing", () => {
  openEditor();
  typeInto(window, nameField(), "   ");

  query(".done").click();

  assert.equal(query(".name-message").textContent, "The name can't be empty.");
  assertFocus(document, nameField());
  assert.equal(server.requests.length, 0);
});

describe("recipe editor", () => {
  const created = {
    id: "new",
    name: "Omelette",
    archived: false,
    ingredients: [{ ingredientId: "egg", quantity: 0.25 }],
  };

  // Names the recipe Omelette, adds 0.25 of Egg, and selects Done.
  function doneOnOmelette() {
    const opened = openEditor();
    typeInto(window, nameField(), "Omelette");
    addIngredient("egg");
    typeInto(window, quantityFields()[0], " 0,25 ");
    query(".done").click();
    return opened;
  }

  test("sends POST with the name and the quantities of a new recipe", async () => {
    doneOnOmelette();

    await waitFor(() => server.requestFor("POST", "/api/recipes") !== undefined);

    assert.deepEqual(server.requestFor("POST", "/api/recipes").body, {
      name: "Omelette",
      ingredients: [{ ingredientId: "egg", quantity: 0.25 }],
    });
    await respondTo(server, "POST", "/api/recipes", 201, created);
  });

  test("disables Done and Cancel while a new recipe saves", async () => {
    doneOnOmelette();

    assert.equal(query(".done").disabled, true);
    assert.equal(query(".cancel").disabled, true);
    await respondTo(server, "POST", "/api/recipes", 201, created);
  });

  test("closes and reports the recipe after a new recipe saves", async () => {
    const { saved } = doneOnOmelette();

    await respondTo(server, "POST", "/api/recipes", 201, created);

    assert.equal(dialog.open, false);
    assert.deepEqual(saved, [created]);
  });
});

test("a new recipe can be saved without ingredients", async () => {
  openEditor();
  typeInto(window, nameField(), "Coffee");

  query(".done").click();

  await waitFor(() => server.requestFor("POST", "/api/recipes") !== undefined);
  assert.deepEqual(server.requestFor("POST", "/api/recipes").body, {
    name: "Coffee",
    ingredients: [],
  });
  await respondTo(server, "POST", "/api/recipes", 201, {
    id: "coffee",
    name: "Coffee",
    archived: false,
    ingredients: [],
  });
});

test("Done on an existing recipe sends only the name when only the name changed", async () => {
  openEditor({ recipe: SOUP });
  typeInto(window, nameField(), "French onion soup");

  query(".done").click();

  await waitFor(() => server.requestFor("PATCH", "/api/recipes/soup") !== undefined);
  assert.deepEqual(server.requestFor("PATCH", "/api/recipes/soup").body, {
    name: "French onion soup",
  });
  await respondTo(server, "PATCH", "/api/recipes/soup", 200, {
    ...SOUP,
    name: "French onion soup",
  });
});

test("Done on an existing recipe sends only the ingredients when only a quantity changed", async () => {
  openEditor({ recipe: SOUP });
  typeInto(window, quantityFields()[0], "200");

  query(".done").click();

  await waitFor(() => server.requestFor("PATCH", "/api/recipes/soup") !== undefined);
  assert.deepEqual(server.requestFor("PATCH", "/api/recipes/soup").body, {
    ingredients: [
      { ingredientId: "onion", quantity: 200 },
      { ingredientId: "salt", quantity: 0.5 },
    ],
  });
  await respondTo(server, "PATCH", "/api/recipes/soup", 200, SOUP);
});

test("Done with no changes closes without a request and returns focus to the opener", () => {
  const { opener, saved } = openEditor({ recipe: SOUP });
  typeInto(window, quantityFields()[0], "150.0"); // the same quantity

  query(".done").click();

  assert.equal(dialog.open, false);
  assert.equal(server.requests.length, 0);
  assert.deepEqual(saved, []);
  assertFocus(document, opener);
});

test("a name conflict (409) shows the message under Name and keeps the editor open", async () => {
  openEditor();
  typeInto(window, nameField(), "soup");

  query(".done").click();
  await respondTo(server, "POST", "/api/recipes", 409, {
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
  typeInto(window, nameField(), "Soup");

  query(".done").click();
  await respondTo(server, "POST", "/api/recipes", 409, {
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
  typeInto(window, nameField(), "Soup");

  query(".done").click();
  await respondTo(server, "POST", "/api/recipes", 400, {
    error: "The name must be at most 100 characters.",
  });

  assert.equal(query(".save-message").textContent, "The name must be at most 100 characters.");
  assert.equal(dialog.open, true);
});

test("a network error keeps the editor open with the changes", async () => {
  quiet.expect(1);
  openEditor({ recipe: SOUP });
  typeInto(window, nameField(), "Stew");

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
  typeInto(window, nameField(), "Stew");

  query(".cancel").click();

  assert.equal(dialog.open, false);
  assert.equal(editor.isOpen(), false);
  assert.deepEqual(saved, []);
  assertFocus(document, opener);
  assert.equal(server.requests.length, 0);
});

test("Escape (the dialog's close event) discards the changes", () => {
  const { opener } = openEditor({ recipe: SOUP });
  typeInto(window, nameField(), "Stew");

  // The browser fires "close" for Escape and Android's Back; happy-dom
  // doesn't drive that from a keypress, so the test closes the dialog itself.
  dialog.close();

  assert.equal(editor.isOpen(), false);
  assertFocus(document, opener);
  assert.equal(server.requests.length, 0);
});

test("a backdrop click closes the editor only when nothing changed", () => {
  openEditor({ recipe: SOUP });
  pointerdown(window, dialog);
  dialog.click();
  assert.equal(dialog.open, false);

  openEditor({ recipe: SOUP });
  typeInto(window, quantityFields()[0], "10");
  pointerdown(window, dialog);
  dialog.click();
  assert.equal(dialog.open, true);
  assert.equal(editor.hasChanges(), true);
});

describe("recipe editor", () => {
  test("confirms with Enter in Name, the same as Done", async () => {
    openEditor({ recipe: SOUP });
    typeInto(window, nameField(), "Stew");

    const event = pressKey(window, nameField(), "Enter");

    assert.equal(event.defaultPrevented, true);
    await waitFor(() => server.requestFor("PATCH", "/api/recipes/soup") !== undefined);
    await respondTo(server, "PATCH", "/api/recipes/soup", 200, { ...SOUP, name: "Stew" });
  });

  test("confirms with Enter in a quantity, the same as Done", async () => {
    openEditor({ recipe: SOUP });
    typeInto(window, quantityFields()[0], "300");

    pressKey(window, quantityFields()[0], "Enter");

    await waitFor(() => server.requestFor("PATCH", "/api/recipes/soup") !== undefined);
    await respondTo(server, "PATCH", "/api/recipes/soup", 200, SOUP);
  });
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
  assert.equal(query(".options b") === null, true, "the options have no bold text");
});

function measureFields() {
  return [...document.querySelectorAll("select.measure-field")];
}

test("a row offers the unit and then each measure, as medium (150 g)", () => {
  openEditor({ recipe: SOUP });

  const [select] = measureFields();
  assert.equal(select.getAttribute("aria-label"), "Measure of Onion");
  assert.deepEqual(
    [...select.options].map((option) => [option.value, option.textContent]),
    [
      ["", "g"],
      ["medium", "medium (150 g)"],
      ["large", "large (250 g)"],
    ],
  );
});

test("a new row starts on the unit", () => {
  openEditor();
  addIngredient("onion");

  const [select] = measureFields();
  assert.equal(select.value, "");
  assert.equal(select.options[select.selectedIndex].textContent, "g");
});

test("an existing line opens on its measure", () => {
  const recipe = {
    ...SOUP,
    ingredients: [{ ingredientId: "onion", quantity: 2, measureId: "large" }],
  };
  openEditor({ recipe });

  assert.equal(measureFields()[0].value, "large");
  assert.equal(editor.hasChanges(), false);
});

test("Done sends measureId for a line in a measure and leaves it out for the unit", async () => {
  openEditor();
  typeInto(window, nameField(), "Stew");
  addIngredient("onion");
  typeInto(window, quantityFields()[0], "2");
  measureFields()[0].value = "medium";
  measureFields()[0].dispatchEvent(new window.Event("change", { bubbles: true }));
  addIngredient("egg");
  typeInto(window, quantityFields()[1], "3");

  query(".done").click();

  await waitFor(() => server.requestFor("POST", "/api/recipes") !== undefined);
  const { ingredients } = server.requestFor("POST", "/api/recipes").body;
  assert.deepEqual(ingredients, [
    { ingredientId: "onion", quantity: 2, measureId: "medium" },
    { ingredientId: "egg", quantity: 3 },
  ]);
  assert.equal("measureId" in ingredients[1], false);
  await respondTo(server, "POST", "/api/recipes", 201, { id: "stew", name: "Stew", ingredients });
});

test("changing only the measure counts as a change and is sent", async () => {
  openEditor({ recipe: SOUP });
  assert.equal(editor.hasChanges(), false);
  measureFields()[0].value = "large";
  measureFields()[0].dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(editor.hasChanges(), true);

  query(".done").click();

  await waitFor(() => server.requestFor("PATCH", "/api/recipes/soup") !== undefined);
  assert.deepEqual(server.requestFor("PATCH", "/api/recipes/soup").body, {
    ingredients: [
      { ingredientId: "onion", quantity: 150, measureId: "large" },
      { ingredientId: "salt", quantity: 0.5 },
    ],
  });
  await respondTo(server, "PATCH", "/api/recipes/soup", 200, SOUP);
});

test("an ingredient without measures shows its unit as text", () => {
  openEditor({ recipe: SOUP });

  const rows = [...document.querySelectorAll(".ingredient-row")];
  assert.equal(
    rows[1].querySelector("select.measure-field") === null,
    true,
    "the second row has no measure select",
  );
  assert.equal(rows[1].querySelector(".unit").textContent, "g");
  assert.equal(rows[0].querySelector(".unit") === null, true, "the first row has no unit text");
});

test("switching an existing measure line back to the unit is a change and drops measureId", async () => {
  const recipe = {
    ...SOUP,
    ingredients: [{ ingredientId: "onion", quantity: 2, measureId: "large" }],
  };
  openEditor({ recipe });
  measureFields()[0].value = "";
  measureFields()[0].dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(editor.hasChanges(), true);

  query(".done").click();

  await waitFor(() => server.requestFor("PATCH", "/api/recipes/soup") !== undefined);
  const { ingredients } = server.requestFor("PATCH", "/api/recipes/soup").body;
  assert.deepEqual(ingredients, [{ ingredientId: "onion", quantity: 2 }]);
  assert.equal("measureId" in ingredients[0], false);
  await respondTo(server, "PATCH", "/api/recipes/soup", 200, { ...recipe, ingredients });
});

test("a measure choice survives the re-render when another ingredient is added", () => {
  openEditor();
  addIngredient("onion");
  measureFields()[0].value = "large";
  measureFields()[0].dispatchEvent(new window.Event("change", { bubbles: true }));

  addIngredient("egg");

  assert.equal(measureFields()[0].value, "large");
});

test("an archived ingredient with measures still shows its measure select", () => {
  const archived = { ...ONION, archived: true };
  const recipe = {
    ...SOUP,
    ingredients: [{ ingredientId: "onion", quantity: 2, measureId: "large" }],
  };
  openEditor({ recipe, ingredients: [archived] });

  assert.equal(measureFields().length, 1);
  assert.equal(measureFields()[0].value, "large");
  assert.equal(document.querySelector(".ingredient-name").textContent, "Onion (archived)");
});

test("a measure choice survives the re-render after an invalid quantity", () => {
  openEditor({ recipe: SOUP });
  measureFields()[0].value = "large";
  measureFields()[0].dispatchEvent(new window.Event("change", { bubbles: true }));
  typeInto(window, quantityFields()[0], "1.255");

  query(".done").click();

  assert.equal(document.querySelectorAll(".row-message").length, 1);
  assert.equal(measureFields()[0].value, "large");
});

test("Archive shows only for a recipe that exists and isn't archived", () => {
  openEditor();
  assert.equal(query(".archive").hidden, true);
  query(".cancel").click();

  openEditor({ recipe: { ...SOUP, archived: true } });
  assert.equal(query(".archive").hidden, true);
  query(".cancel").click();

  openEditor({ recipe: SOUP });
  assert.equal(query(".archive").hidden, false);
});

test("Archive without changes sends only archived: true, then closes with the archived recipe", async () => {
  const { saved } = openEditor({ recipe: SOUP });

  query(".archive").click();
  assert.equal(query(".archive").disabled, true);
  await respondTo(server, "PATCH", "/api/recipes/soup", 200, { ...SOUP, archived: true });

  assert.equal(document.querySelector('[role="alertdialog"]') === null, true, "no alert is open");
  assert.deepEqual(server.requestFor("PATCH", "/api/recipes/soup").body, { archived: true });
  assert.equal(dialog.open, false);
  assert.deepEqual(saved, [{ ...SOUP, archived: true }]);
});

// Changes the name, chooses Archive, and returns the alert that asks first.
async function archiveWithChanges() {
  openEditor({ recipe: SOUP });
  typeInto(window, nameField(), "Changed, but not saved");
  query(".archive").click();
  await tick();
  return document.querySelector('[role="alertdialog"]');
}

test("Archive with changes asks first, with Keep Editing focused", async () => {
  const alert = await archiveWithChanges();

  assert.equal(alert.open, true);
  assert.equal(alert.querySelector(".alert-title").textContent, "Archive without saving?");
  assert.equal(
    alert.querySelector(".alert-message").textContent,
    "Your changes aren't saved. If you archive now, they're lost.",
  );
  assert.equal(alert.getAttribute("aria-labelledby"), alert.querySelector(".alert-title").id);
  assert.equal(alert.getAttribute("aria-describedby"), alert.querySelector(".alert-message").id);
  assertFocus(document, alert.querySelector(".keep"));
  assert.equal(alert.querySelector(".keep").textContent, "Keep Editing");
  assert.equal(alert.querySelector(".lose").textContent, "Archive Without Saving");
  alert.querySelector(".keep").click();
  await tick();
});

test("Keep Editing keeps the editor and its changes, and sends nothing", async () => {
  const alert = await archiveWithChanges();

  alert.querySelector(".keep").click();
  await tick();

  assert.equal(document.querySelector('[role="alertdialog"]') === null, true, "no alert is open");
  assert.equal(dialog.open, true);
  assert.equal(nameField().value, "Changed, but not saved");
  assert.equal(server.requests.length, 0);
  assertFocus(document, query(".archive"));
});

test("Escape in the alert keeps the editor, the same as Keep Editing", async () => {
  const alert = await archiveWithChanges();

  alert.close(); // what Escape and Android's Back do to a modal dialog
  await tick();

  assert.equal(dialog.open, true);
  assert.equal(server.requests.length, 0);
});

test("Archive Without Saving archives the recipe without the changes", async () => {
  const alert = await archiveWithChanges();

  alert.querySelector(".lose").click();
  await respondTo(server, "PATCH", "/api/recipes/soup", 200, { ...SOUP, archived: true });

  assert.deepEqual(server.requestFor("PATCH", "/api/recipes/soup").body, { archived: true });
  assert.equal(dialog.open, false);
});

test("a failed archive keeps the editor open and says so", async () => {
  quiet.expect(1);
  openEditor({ recipe: SOUP });

  query(".archive").click();
  await waitFor(() => server.requestFor("PATCH", "/api/recipes/soup") !== undefined);
  server.requestFor("PATCH", "/api/recipes/soup").fail();
  await tick();

  assert.equal(dialog.open, true);
  assert.equal(query(".save-message").textContent, "Couldn't archive the recipe. Try again.");
  assert.equal(query(".archive").disabled, false);
});
