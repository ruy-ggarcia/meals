// Tests for the slot editor (public/slot-editor.js) against a real DOM, built
// from the real dialog markup in public/index.html. See test/dom-helpers.js
// for the harness and the DOM library choice.

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { loadSlotEditorDialog } from "./dom-helpers.js";

function recipe(id, name, archived = false) {
  return { id, name, archived };
}

function menu(...items) {
  return { items: items.map(([recipeId, servings]) => ({ recipeId, servings })) };
}

const RECIPES = [
  recipe("soup", "Lentil soup"),
  recipe("salad", "Green salad"),
  recipe("omelette", "Omelette"),
  recipe("cafe", "Café", true), // archived: never offered
];

let dialog;
let editor;
let document;
let window;
let cleanup;

beforeEach(async () => {
  ({ dialog, editor, document, window, cleanup } = await loadSlotEditorDialog());
});

afterEach(async () => {
  await cleanup();
});

function search() {
  return document.querySelector(".recipe-search");
}

function title() {
  return document.querySelector(".slot-editor-title");
}

function itemRows() {
  return [...document.querySelectorAll(".menu-item")];
}

function optionEls() {
  return [...document.querySelectorAll(".recipe-option")];
}

function openEditor({ menu: initialMenu = menu(), recipes = RECIPES } = {}) {
  const opener = document.createElement("button");
  document.body.append(opener);
  let done = "not called";
  editor.open({
    title: "Monday, September 21 · Lunch",
    menu: initialMenu,
    recipes,
    opener,
    onDone: (savedMenu) => {
      done = savedMenu;
    },
  });
  return { opener, savedMenu: () => done };
}

function type(value) {
  search().value = value;
  search().dispatchEvent(new window.Event("input", { bubbles: true }));
}

function keydownOn(element, key) {
  const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  return event;
}

function pointerdownOn(element) {
  element.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }));
}

test("Done saves the copy, closes the dialog, and returns focus to the opener", () => {
  const { opener, savedMenu } = openEditor();
  type("sal");
  keydownOn(search(), "Enter"); // adds Green salad

  document.querySelector(".done").click();

  assert.equal(dialog.open, false);
  assert.deepEqual(savedMenu(), menu(["salad", 1]));
  assert.equal(document.activeElement, opener);
});

test("Cancel discards the copy and closes the dialog", () => {
  const { opener, savedMenu } = openEditor();
  type("sal");
  keydownOn(search(), "Enter");

  document.querySelector(".cancel").click();

  assert.equal(dialog.open, false);
  assert.equal(savedMenu(), "not called");
  assert.equal(document.activeElement, opener);
});

test("Escape (the dialog's close event) discards the copy", () => {
  const { opener, savedMenu } = openEditor();
  type("sal");
  keydownOn(search(), "Enter");

  // The browser fires "close" on the dialog for Escape and Android's Back;
  // happy-dom doesn't drive that from a real Escape keypress, so the test
  // triggers the same event the browser would.
  dialog.close();

  assert.equal(dialog.open, false);
  assert.equal(savedMenu(), "not called");
  assert.equal(document.activeElement, opener);
});

test("Escape in Add recipe with text clears it and keeps the editor open", () => {
  openEditor();
  type("sal");

  const event = keydownOn(search(), "Escape");

  assert.equal(search().value, "");
  assert.equal(dialog.open, true);
  assert.equal(event.defaultPrevented, true);
});

test("a backdrop click with no changes closes the editor without saving", () => {
  const { savedMenu } = openEditor();

  pointerdownOn(dialog);
  dialog.click();

  assert.equal(dialog.open, false);
  assert.equal(savedMenu(), "not called");
});

test("a backdrop click with changes leaves the editor open", () => {
  openEditor();
  type("sal");
  keydownOn(search(), "Enter");

  pointerdownOn(dialog);
  dialog.click();

  assert.equal(dialog.open, true);
});

test("a press that starts in the field and a click on the dialog doesn't close it", () => {
  openEditor();

  pointerdownOn(search()); // the press started on the field, not the backdrop
  dialog.click(); // released over the backdrop: target is the dialog

  assert.equal(dialog.open, true);
});

test("Enter on the title saves, the same as Done", () => {
  const { savedMenu } = openEditor();
  type("sal");
  keydownOn(search(), "Enter"); // adds the recipe, doesn't confirm

  keydownOn(title(), "Enter");

  assert.equal(dialog.open, false);
  assert.deepEqual(savedMenu(), menu(["salad", 1]));
});

test("Enter in Add recipe adds the highlighted recipe and doesn't close the editor", () => {
  openEditor();
  type("sal");

  keydownOn(search(), "Enter");

  assert.equal(dialog.open, true);
  assert.deepEqual(
    itemRows().map((row) => row.querySelector(".recipe-name").textContent),
    ["Green salad"],
  );
  assert.equal(search().value, ""); // the field clears after adding
});

test("arrow keys move the highlight among the offered recipes", () => {
  openEditor(); // offers Green salad, Lentil soup, Omelette, A to Z

  assert.deepEqual(
    optionEls().map((option) => option.getAttribute("aria-selected")),
    ["true", "false", "false"],
  );

  keydownOn(search(), "ArrowDown");
  assert.deepEqual(
    optionEls().map((option) => option.getAttribute("aria-selected")),
    ["false", "true", "false"],
  );

  keydownOn(search(), "ArrowUp");
  keydownOn(search(), "ArrowUp"); // wraps around to the last option
  assert.deepEqual(
    optionEls().map((option) => option.getAttribute("aria-selected")),
    ["false", "false", "true"],
  );
});

test("the offered list excludes archived recipes and recipes already in the menu", () => {
  openEditor({ menu: menu(["soup", 1]) }); // Lentil soup is already in the menu

  assert.deepEqual(
    optionEls().map((option) => option.textContent),
    ["Green salad", "Omelette"], // Café is archived, Lentil soup is in the menu; A to Z
  );
});

test("the + stepper stops at 99 and moves focus to −", () => {
  openEditor({ menu: menu(["soup", 98.5]) });
  const [decrease, increase] = document.querySelectorAll(".step");

  increase.click();

  assert.equal(document.querySelector(".servings").textContent, "99");
  assert.equal(increase.disabled, true);
  assert.equal(document.activeElement, decrease);
});

test("the − stepper stops at 0.5 and moves focus to +", () => {
  openEditor({ menu: menu(["soup", 1]) });
  const [decrease, increase] = document.querySelectorAll(".step");

  decrease.click();

  assert.equal(document.querySelector(".servings").textContent, "0.5");
  assert.equal(decrease.disabled, true);
  assert.equal(document.activeElement, increase);
});

test("Remove moves focus to the next Remove, then the previous, then the title", () => {
  openEditor({ menu: menu(["soup", 1], ["salad", 1], ["omelette", 1]) });

  itemRows()[1].querySelector(".remove").click(); // remove Green salad (the middle row)
  assert.deepEqual(
    itemRows().map((row) => row.querySelector(".recipe-name").textContent),
    ["Lentil soup", "Omelette"],
  );
  assert.equal(document.activeElement, itemRows()[1].querySelector(".remove")); // now Omelette

  itemRows()[1].querySelector(".remove").click(); // remove Omelette (now the last row)
  assert.deepEqual(
    itemRows().map((row) => row.querySelector(".recipe-name").textContent),
    ["Lentil soup"],
  );
  assert.equal(document.activeElement, itemRows()[0].querySelector(".remove")); // the previous row

  itemRows()[0].querySelector(".remove").click(); // remove the last remaining item
  assert.equal(itemRows().length, 0);
  assert.equal(document.activeElement, title());
});

test("at 20 items, Add recipe is disabled with the limit's placeholder", () => {
  const recipes = [
    ...RECIPES,
    ...Array.from({ length: 20 }, (_, index) => recipe(`filler-${index}`, `Filler ${index}`)),
  ];
  const items = recipes.slice(0, 20).map((r) => [r.id, 1]);
  openEditor({ menu: menu(...items), recipes });

  assert.equal(search().disabled, true);
  assert.equal(search().placeholder, "A menu holds up to 20 recipes.");
  assert.equal(optionEls().length, 0);
});

test("a recipe name with HTML renders as text, not markup", () => {
  const recipes = [...RECIPES, recipe("bold", "<b>Bold</b> soup")];
  openEditor({ menu: menu(["bold", 1]), recipes });

  const name = itemRows()[0].querySelector(".recipe-name");
  assert.equal(name.textContent, "<b>Bold</b> soup");
  assert.equal(name.querySelector("b"), null);
});
