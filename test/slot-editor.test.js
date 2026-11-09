// Tests for the slot editor (public/slot-editor.js) against a real DOM, built
// from the real dialog markup in public/index.html. See test/dom-helpers.js
// for the harness and the DOM library choice.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  assertFocus,
  loadSlotEditorDialog,
  pointerdown,
  pressKey,
  typeInto,
} from "./dom-helpers.js";

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
  return document.querySelector(".option-search");
}

function title() {
  return document.querySelector(".dialog-title");
}

function itemRows() {
  return [...document.querySelectorAll(".menu-item")];
}

function optionEls() {
  return [...document.querySelectorAll(".option")];
}

function openEditor({ menu: initialMenu = menu(), recipes = RECIPES } = {}) {
  const opener = document.createElement("button");
  document.body.append(opener);
  let done = "not called";
  editor.open({
    title: "Lunch",
    subtitle: "Monday, Sep 21",
    menu: initialMenu,
    recipes,
    opener,
    onDone: (savedMenu) => {
      done = savedMenu;
    },
  });
  return { opener, savedMenu: () => done };
}

describe("slot editor", () => {
  test("shows its title and subtitle", () => {
    openEditor();

    assert.equal(title().textContent, "Lunch");
    assert.equal(document.querySelector(".sheet-subtitle").textContent, "Monday, Sep 21");
  });

  test("holds Cancel and Done above the menu", () => {
    openEditor();

    const header = document.querySelector(".sheet-header");
    assert.notEqual(header.querySelector(".cancel"), null, "Cancel is in the header");
    assert.notEqual(header.querySelector(".done"), null, "Done is in the header");
  });

  test("says that nothing is planned until a recipe is added", () => {
    openEditor();
    const empty = document.querySelector(".empty-menu");
    assert.equal(empty.hidden, false);
    assert.equal(empty.textContent, "Nothing planned. Add a recipe below.");

    typeInto(window, search(), "soup");
    optionEls()[0].click();

    assert.equal(empty.hidden, true);
  });

  test("offers every addable recipe before you type, with a hint to type", () => {
    openEditor({ menu: menu(["soup", 1]) });

    assert.equal(search().placeholder, "Type part of a name");
    assert.deepEqual(
      optionEls().map((option) => option.textContent),
      ["Green salad", "Omelette"], // Café is archived, Lentil soup is in the menu; A to Z
    );
  });

  test("points Add recipe to the Recipes page when no recipe matches", () => {
    openEditor();

    typeInto(window, search(), "xyz");

    assert.equal(document.querySelector(".options").hidden, true);
    assert.equal(
      document.querySelector(".no-match").textContent,
      "No active recipes match. Add recipes on the Recipes page.",
    );
  });

  test("saves the copy and closes with Done", () => {
    const { savedMenu } = openEditor();
    typeInto(window, search(), "sal");
    pressKey(window, search(), "Enter"); // adds Green salad

    document.querySelector(".done").click();

    assert.equal(dialog.open, false);
    assert.deepEqual(savedMenu(), menu(["salad", 1]));
  });

  test("returns focus to the opener with Done", () => {
    const { opener } = openEditor();
    typeInto(window, search(), "sal");
    pressKey(window, search(), "Enter"); // adds Green salad

    document.querySelector(".done").click();

    assertFocus(document, opener);
  });

  test("discards the copy and closes the dialog with Cancel", () => {
    const { opener, savedMenu } = openEditor();
    typeInto(window, search(), "sal");
    pressKey(window, search(), "Enter");

    document.querySelector(".cancel").click();

    assert.equal(dialog.open, false);
    assert.equal(savedMenu(), "not called");
    assertFocus(document, opener);
  });

  test("discards the copy with Escape, the close event of the dialog", () => {
    const { opener, savedMenu } = openEditor();
    typeInto(window, search(), "sal");
    pressKey(window, search(), "Enter");

    // The browser fires "close" on the dialog for Escape and Android's Back;
    // happy-dom doesn't drive that from a real Escape keypress, so the test
    // triggers the same event the browser would.
    dialog.close();

    assert.equal(dialog.open, false);
    assert.equal(savedMenu(), "not called");
    assertFocus(document, opener);
  });

  test("clears the text of Add recipe on Escape", () => {
    openEditor();
    typeInto(window, search(), "sal");

    pressKey(window, search(), "Escape");

    assert.equal(search().value, "");
  });

  test("keeps the editor open on Escape in Add recipe with text", () => {
    openEditor();
    typeInto(window, search(), "sal");

    const event = pressKey(window, search(), "Escape");

    assert.equal(dialog.open, true);
    assert.equal(event.defaultPrevented, true);
  });

  test("closes without saving on a backdrop click without changes", () => {
    const { savedMenu } = openEditor();

    pointerdown(window, dialog);
    dialog.click();

    assert.equal(dialog.open, false);
    assert.equal(savedMenu(), "not called");
  });

  test("stays open on a backdrop click with changes", () => {
    openEditor();
    typeInto(window, search(), "sal");
    pressKey(window, search(), "Enter");

    pointerdown(window, dialog);
    dialog.click();

    assert.equal(dialog.open, true);
  });

  test("stays open after a press in the field and a click on the dialog", () => {
    openEditor();

    pointerdown(window, search()); // the press started on the field, not the backdrop
    dialog.click(); // released over the backdrop: target is the dialog

    assert.equal(dialog.open, true);
  });

  test("saves with Enter on the title, the same as Done", () => {
    const { savedMenu } = openEditor();
    typeInto(window, search(), "sal");
    pressKey(window, search(), "Enter"); // adds the recipe, doesn't confirm

    pressKey(window, title(), "Enter");

    assert.equal(dialog.open, false);
    assert.deepEqual(savedMenu(), menu(["salad", 1]));
  });

  test("adds the highlighted recipe with Enter and keeps the editor open", () => {
    openEditor();
    typeInto(window, search(), "sal");

    pressKey(window, search(), "Enter");

    assert.equal(dialog.open, true);
    assert.deepEqual(
      itemRows().map((row) => row.querySelector(".recipe-name").textContent),
      ["Green salad"],
    );
    assert.equal(search().value, ""); // the field clears after adding
  });

  test("moves the highlight among the offered recipes with arrow keys", () => {
    openEditor(); // offers Green salad, Lentil soup, Omelette, A to Z

    assert.deepEqual(
      optionEls().map((option) => option.getAttribute("aria-selected")),
      ["true", "false", "false"],
    );

    pressKey(window, search(), "ArrowDown");
    assert.deepEqual(
      optionEls().map((option) => option.getAttribute("aria-selected")),
      ["false", "true", "false"],
    );

    pressKey(window, search(), "ArrowUp");
    pressKey(window, search(), "ArrowUp"); // wraps around to the last option
    assert.deepEqual(
      optionEls().map((option) => option.getAttribute("aria-selected")),
      ["false", "false", "true"],
    );
  });

  test("stops the + stepper at 99 and moves focus to −", () => {
    openEditor({ menu: menu(["soup", 98.5]) });
    const [decrease, increase] = document.querySelectorAll(".step");

    increase.click();

    assert.equal(document.querySelector(".servings").textContent, "99");
    assert.equal(increase.disabled, true);
    assertFocus(document, decrease);
  });

  test("stops the − stepper at 0.5 and moves focus to +", () => {
    openEditor({ menu: menu(["soup", 1]) });
    const [decrease, increase] = document.querySelectorAll(".step");

    decrease.click();

    assert.equal(document.querySelector(".servings").textContent, "0.5");
    assert.equal(decrease.disabled, true);
    assertFocus(document, increase);
  });

  test("moves focus from Remove to the next Remove, the previous, or the title", () => {
    openEditor({ menu: menu(["soup", 1], ["salad", 1], ["omelette", 1]) });

    itemRows()[1].querySelector(".remove").click(); // remove Green salad (the middle row)
    assert.deepEqual(
      itemRows().map((row) => row.querySelector(".recipe-name").textContent),
      ["Lentil soup", "Omelette"],
    );
    assertFocus(document, itemRows()[1].querySelector(".remove")); // now Omelette

    itemRows()[1].querySelector(".remove").click(); // remove Omelette (now the last row)
    assert.deepEqual(
      itemRows().map((row) => row.querySelector(".recipe-name").textContent),
      ["Lentil soup"],
    );
    assertFocus(document, itemRows()[0].querySelector(".remove")); // the previous row

    itemRows()[0].querySelector(".remove").click(); // remove the last remaining item
    assert.equal(itemRows().length, 0);
    assertFocus(document, title());
  });

  function openFullMenu() {
    const recipes = [
      ...RECIPES,
      ...Array.from({ length: 20 }, (_, index) => recipe(`filler-${index}`, `Filler ${index}`)),
    ];
    const items = recipes.slice(0, 20).map((r) => [r.id, 1]);
    openEditor({ menu: menu(...items), recipes });
  }

  test("disables Add recipe at 20 items", () => {
    openFullMenu();

    assert.equal(search().disabled, true);
    assert.equal(optionEls().length, 0);
  });

  test("shows the limit's placeholder in Add recipe at 20 items", () => {
    openFullMenu();

    assert.equal(search().placeholder, "A menu holds up to 20 recipes.");
  });

  test("renders a recipe name with HTML as text, not markup", () => {
    const recipes = [...RECIPES, recipe("bold", "<b>Bold</b> soup")];
    openEditor({ menu: menu(["bold", 1]), recipes });

    const name = itemRows()[0].querySelector(".recipe-name");
    assert.equal(name.textContent, "<b>Bold</b> soup");
    assert.equal(name.querySelector("b") === null, true, "the recipe name has no <b> element");
  });

  test("moves the focus to Done when the 20th recipe fills the menu", () => {
    const recipes = [
      ...RECIPES,
      ...Array.from({ length: 20 }, (_, index) => recipe(`filler-${index}`, `Filler ${index}`)),
    ];
    const items = recipes.slice(4, 23).map((r) => [r.id, 1]);
    openEditor({ menu: menu(...items), recipes });
    assert.equal(itemRows().length, 19);
    typeInto(window, search(), "Filler");

    pressKey(window, search(), "Enter");

    assert.equal(itemRows().length, 20);
    assert.equal(search().disabled, true);
    assertFocus(document, document.querySelector(".done"));
  });

  test("stops offering a recipe once you add it", () => {
    openEditor();
    typeInto(window, search(), "sal");

    pressKey(window, search(), "Enter");

    assert.deepEqual(
      optionEls().map((option) => option.textContent),
      ["Lentil soup", "Omelette"],
    );
  });

  test("points aria-activedescendant at the highlighted recipe", () => {
    openEditor();
    const highlightedId = () => search().getAttribute("aria-activedescendant");
    assert.equal(highlightedId(), optionEls()[0].id);

    pressKey(window, search(), "ArrowDown");

    assert.equal(highlightedId(), optionEls()[1].id);
    assert.ok(optionEls()[1].id, "the option has an ID");
  });

  test("announces the servings through a polite live region", () => {
    openEditor({ menu: menu(["soup", 2]) });

    assert.equal(document.querySelector(".servings").getAttribute("aria-live"), "polite");
  });
});
