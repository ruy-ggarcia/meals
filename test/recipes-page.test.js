// Tests for the recipe book page (public/recipes.js) against a real DOM,
// built from the real public/recipes.html. See test/dom-helpers.js for the
// harness and the DOM library choice. The recipe editor itself has its own
// tests in test/recipe-editor.test.js.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  assertFocus,
  catalogPage,
  dispatchBeforeUnload,
  fakeFetch,
  openPage,
  pointerdown,
  pressKey,
  respondTo,
  tick,
  typeInto,
  useQuietConsole,
  waitFor,
} from "./dom-helpers.js";

const quiet = useQuietConsole();

const ONION = { id: "onion", name: "Onion", unit: "g", archived: false };
const WITH_ONION = [{ ingredientId: "onion", quantity: 100 }];

function recipe(id, name, archived = false, ingredients = []) {
  return { id, name, archived, ingredients };
}

let page;
let server;
let document;
let window;
/** The recipes and the catalog that the page loaded with: { recipes, ingredients }. */
let served;

const { clickAndReload, reloadRequests, requestUrls, open } = catalogPage({
  html: "recipes.html",
  script: "recipes.js",
  collections: ["recipes", "ingredients"],
});

async function openRecipesPage(t, recipes = [], ingredients = [ONION]) {
  ({ page, server, served } = await open(t, { recipes, ingredients }));
  ({ document, window } = page);
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

// Opens the editor with New recipe, names the recipe Apple pie, and answers
// the save of the new recipe. The book held Green salad.
async function saveNewRecipe(t) {
  await openRecipesPage(t, [recipe("1", "Green salad", false, WITH_ONION)]);
  await clickAndReload(document.getElementById("new-recipe"));
  typeInto(window, document.getElementById("recipe-name"), "Apple pie");
  editorDialog().querySelector(".done").click();
  await respondTo(server, "POST", "/api/recipes", 201, recipe("2", "Apple pie"));
}

// Opens the editor with Edit on Soup, renames the recipe Onion soup, and
// answers the save.
async function saveEditedRecipe(t) {
  await openRecipesPage(t, [recipe("1", "Soup", false, WITH_ONION)]);
  await clickAndReload(buttonLabeled("Edit Soup"));
  typeInto(window, document.getElementById("recipe-name"), "Onion soup");
  editorDialog().querySelector(".done").click();
  await respondTo(
    server,
    "PATCH",
    "/api/recipes/1",
    200,
    recipe("1", "Onion soup", false, WITH_ONION),
  );
}

// Archives Omelette in the editor, in a book where Pancakes follows it and
// Café is archived already.
async function archiveOmelette(t) {
  await openRecipesPage(t, [
    recipe("1", "Omelette"),
    recipe("2", "Pancakes"),
    recipe("3", "Café", true),
  ]);
  await archiveWithEditor("1", "Omelette");
}

// Restores Café, in a book where Omelette is archived too.
async function restoreCafe(t) {
  await openRecipesPage(t, [recipe("1", "Omelette", true), recipe("2", "Café", true)]);
  buttonLabeled("Restore Café").click();
  await respondTo(server, "PATCH", "/api/recipes/2", 200, recipe("2", "Café", false));
}

// Opens the editor on the recipe named `name`, chooses Archive, and answers
// the request with the recipe, archived.
async function archiveWithEditor(id, name) {
  await clickAndReload(buttonLabeled(`Edit ${name}`));
  editorDialog().querySelector(".archive").click();
  await respondTo(server, "PATCH", `/api/recipes/${id}`, 200, recipe(id, name, true));
}

const CARROT_PCS = { id: "carrot", name: "Carrot", unit: "pcs", measures: [], archived: false };
const CARROT_G = {
  ...CARROT_PCS,
  unit: "g",
  measures: [{ id: "piece", name: "pcs", amount: 120 }],
};

describe("recipe book", () => {
  test("opens the editor titled New recipe with New recipe", async (t) => {
    await openRecipesPage(t);

    await clickAndReload(document.getElementById("new-recipe"));

    assert.equal(editorDialog().open, true);
    assert.equal(editorDialog().querySelector(".dialog-title").textContent, "New recipe");
  });

  test("closes the editor after a new recipe is saved", async (t) => {
    await saveNewRecipe(t);

    assert.equal(editorDialog().open, false);
  });

  test("shows a saved new recipe in its sorted place", async (t) => {
    await saveNewRecipe(t);

    assert.deepEqual(activeNames(), ["Apple pie", "Green salad"]);
  });

  test("focuses the Edit button of a saved new recipe", async (t) => {
    await saveNewRecipe(t);

    assertFocus(document, buttonLabeled("Edit Apple pie"));
  });

  test("opens the editor with the name and the ingredients of the recipe", async (t) => {
    await openRecipesPage(t, [recipe("1", "Soup", false, WITH_ONION)]);

    await clickAndReload(buttonLabeled("Edit Soup"));

    assert.equal(document.getElementById("recipe-name").value, "Soup");
    assert.equal(editorDialog().querySelector(".quantity-field").value, "100");
  });

  test("updates the row of an edited recipe after a save", async (t) => {
    await saveEditedRecipe(t);

    assert.deepEqual(activeNames(), ["Onion soup"]);
  });

  test("focuses the Edit button of an edited recipe after a save", async (t) => {
    await saveEditedRecipe(t);

    assertFocus(document, buttonLabeled("Edit Onion soup"));
  });

  test("moves a recipe to Archived with Archive in the editor", async (t) => {
    await archiveOmelette(t);

    assert.deepEqual(server.requestFor("PATCH", "/api/recipes/1").body, { archived: true });
    assert.equal(editorDialog().open, false);
    assert.deepEqual(activeNames(), ["Pancakes"]);
    assert.deepEqual(archivedNames(), ["Café", "Omelette"]);
  });

  test("focuses the row in the place of an archived recipe", async (t) => {
    await archiveOmelette(t);

    assertFocus(document, buttonLabeled("Edit Pancakes"));
  });

  test("moves a recipe back to the active list with Restore", async (t) => {
    await restoreCafe(t);

    assert.deepEqual(server.requestFor("PATCH", "/api/recipes/2").body, { archived: false });
    assert.deepEqual(activeNames(), ["Café"]);
    assert.deepEqual(archivedNames(), ["Omelette"]);
  });

  test("focuses the row in the place of a restored recipe", async (t) => {
    await restoreCafe(t);

    assertFocus(document, buttonLabeled("Restore Omelette"));
  });

  test("returns focus to New recipe after Cancel", async (t) => {
    await openRecipesPage(t);
    const newRecipe = document.getElementById("new-recipe");

    await clickAndReload(newRecipe);
    editorDialog().querySelector(".cancel").click();

    assert.equal(editorDialog().open, false);
    assertFocus(document, newRecipe);
    assert.equal(server.requestFor("POST", "/api/recipes"), undefined);
  });

  test("focuses Search after a save of a recipe that the search hides", async (t) => {
    await openRecipesPage(t, [recipe("1", "Green salad", false, WITH_ONION)]);
    typeInto(window, searchField(), "sal");

    await clickAndReload(buttonLabeled("Edit Green salad"));
    typeInto(window, document.getElementById("recipe-name"), "Soup");
    editorDialog().querySelector(".done").click();
    await respondTo(server, "PATCH", "/api/recipes/1", 200, recipe("1", "Soup", false, WITH_ONION));

    assert.deepEqual(activeNames(), []);
    assertFocus(document, searchField());
  });

  test("returns focus to the recipe's Edit button after Cancel", async (t) => {
    await openRecipesPage(t, [recipe("1", "Soup", false, WITH_ONION)]);

    await clickAndReload(buttonLabeled("Edit Soup"));
    editorDialog().querySelector(".cancel").click();

    assert.equal(editorDialog().open, false);
    assertFocus(document, buttonLabeled("Edit Soup"));
  });

  test("returns focus to the recipe's Edit button after Escape", async (t) => {
    await openRecipesPage(t, [recipe("1", "Soup", false, WITH_ONION)]);

    await clickAndReload(buttonLabeled("Edit Soup"));
    editorDialog().close(); // what Escape does to a modal dialog

    assertFocus(document, buttonLabeled("Edit Soup"));
  });

  test("returns focus to the Edit button on a backdrop click without changes", async (t) => {
    await openRecipesPage(t, [recipe("1", "Soup", false, WITH_ONION)]);

    await clickAndReload(buttonLabeled("Edit Soup"));
    pointerdown(window, editorDialog());
    editorDialog().click();

    assert.equal(editorDialog().open, false);
    assertFocus(document, buttonLabeled("Edit Soup"));
  });

  test("checks the name against the recipes of the reload as you type", async (t) => {
    await openRecipesPage(t, [recipe("1", "Soup")]);

    await clickAndReload(document.getElementById("new-recipe"), {
      recipes: [recipe("1", "Soup"), recipe("2", "Stew", true)],
      ingredients: [ONION],
    });
    typeInto(window, document.getElementById("recipe-name"), "stew");

    assert.equal(
      editorDialog().querySelector(".name-message").textContent,
      '"Stew" is archived. To use it, restore it from Archived.',
    );
  });

  test("gives archived recipes Edit and Restore", async (t) => {
    await openRecipesPage(t, [recipe("1", "Café", true)]);

    assert.notEqual(buttonLabeled("Edit Café"), null, "the Edit Café button");
    assert.notEqual(buttonLabeled("Restore Café"), null, "the Restore Café button");
    assert.equal(
      buttonLabeled("Archive Café") === null,
      true,
      "an archived recipe has no Archive Café button",
    );
  });

  test("shows the ingredients of each recipe, or a warning when it has none", async (t) => {
    await openRecipesPage(t, [recipe("1", "Coffee"), recipe("2", "Soup", false, WITH_ONION)]);

    const detail = (id) => rowById(id).querySelector(".entry-detail");
    assert.equal(detail("1").textContent.trim(), "No ingredients · not in shopping list");
    assert.notEqual(
      detail("1").querySelector(".warning-icon"),
      null,
      "the warning icon of the recipe without ingredients",
    );
    assert.equal(detail("2").textContent, "Onion");
    assert.equal(
      detail("2").querySelector(".warning-icon") === null,
      true,
      "the recipe with ingredients has no warning icon",
    );
    // A screen reader reads the detail after the row's name.
    assert.equal(buttonLabeled("Edit Coffee").getAttribute("aria-describedby"), detail("1").id);
  });

  test("removes the warning icon of a recipe after saving its ingredients", async (t) => {
    await openRecipesPage(t, [recipe("1", "Soup")]);

    await clickAndReload(buttonLabeled("Edit Soup"));
    const search = editorDialog().querySelector(".option-search");
    typeInto(window, search, "oni");
    pressKey(window, search, "Enter");
    typeInto(window, editorDialog().querySelector(".quantity-field"), "100");
    editorDialog().querySelector(".done").click();
    await respondTo(server, "PATCH", "/api/recipes/1", 200, recipe("1", "Soup", false, WITH_ONION));

    assert.equal(
      rowById("1").querySelector(".warning-icon") === null,
      true,
      "the recipe lost its warning icon",
    );
  });

  test("prevents leaving on beforeunload only while the editor has changes", async (t) => {
    await openRecipesPage(t);
    await clickAndReload(document.getElementById("new-recipe"));
    assert.equal(dispatchBeforeUnload(window).defaultPrevented, false);
    typeInto(window, document.getElementById("recipe-name"), "Pie");
    assert.equal(dispatchBeforeUnload(window).defaultPrevented, true);
    editorDialog().querySelector(".cancel").click();
    assert.equal(dispatchBeforeUnload(window).defaultPrevented, false);
  });

  test("keeps the recipe in Archived and shows a message when a restore fails", async (t) => {
    quiet.expect(1);
    await openRecipesPage(t, [recipe("1", "Omelette", true)]);

    buttonLabeled("Restore Omelette").click();
    await waitFor(() => server.requestFor("PATCH", "/api/recipes/1") !== undefined);
    server.requestFor("PATCH", "/api/recipes/1").fail();
    await tick();

    assert.equal(
      rowById("1").querySelector(".row-message").textContent,
      "Couldn't restore the recipe. Try again.",
    );
    assert.deepEqual(archivedNames(), ["Omelette"]);
  });

  test("counts active recipes in the title and sidebar, also after an archive", async (t) => {
    await openRecipesPage(t, [
      recipe("1", "Omelette"),
      recipe("2", "Soup"),
      recipe("3", "Café", true),
    ]);
    const counts = () =>
      [...document.querySelectorAll('[data-count="recipes"]')].map((count) => count.textContent);
    assert.deepEqual(counts(), ["2", "2"]);

    await archiveWithEditor("1", "Omelette");

    assert.deepEqual(counts(), ["1", "1"]);
  });

  test("shows the empty-book message when there are no recipes", async (t) => {
    await openRecipesPage(t, []);

    const empty = document.getElementById("empty-book");
    assert.equal(empty.hidden, false);
    assert.equal(empty.textContent, "No recipes yet. Add your first one with New recipe.");
  });

  test("filters the active list to the matches of the search", async (t) => {
    await openRecipesPage(t, [recipe("1", "Green salad"), recipe("2", "Lentil soup")]);
    assert.equal(document.getElementById("empty-book").hidden, true);
    assert.equal(document.getElementById("no-matches").hidden, true);

    typeInto(window, searchField(), "sal");

    assert.deepEqual(activeNames(), ["Green salad"]);
  });

  test("shows the no-match message when no active recipe matches the search", async (t) => {
    await openRecipesPage(t, [recipe("1", "Green salad"), recipe("2", "Lentil soup")]);

    typeInto(window, searchField(), "zzz");

    assert.deepEqual(activeNames(), []);
    assert.equal(document.getElementById("no-matches").hidden, false);
    assert.equal(document.getElementById("no-matches").textContent, 'No recipes match "zzz".');
  });

  test("shows the no-match message when only an archived recipe matches", async (t) => {
    await openRecipesPage(t, [recipe("1", "Omelette", true)]);

    typeInto(window, searchField(), "omel");

    assert.deepEqual(activeNames(), []);
    assert.equal(document.getElementById("no-matches").hidden, false);
    assert.equal(document.getElementById("no-matches").textContent, 'No recipes match "omel".');
    assert.deepEqual(archivedNames(), ["Omelette"]); // stays in Archived
  });

  test("counts the archived recipes in Archived", async (t) => {
    await openRecipesPage(t, [recipe("1", "Omelette"), recipe("2", "Café", true)]);

    assert.equal(document.getElementById("archived").hidden, false);
    assert.equal(document.getElementById("archived-count").textContent, "1");

    await archiveWithEditor("1", "Omelette");

    assert.equal(document.getElementById("archived-count").textContent, "2");
  });

  test("keeps the Archived count when the search matches no archived recipe", async (t) => {
    await openRecipesPage(t, [recipe("1", "Omelette"), recipe("2", "Café", true)]);
    assert.equal(document.getElementById("archived-count").textContent, "1");

    typeInto(window, searchField(), "zzz");

    assert.equal(document.getElementById("archived-count").textContent, "1");
  });

  test("loads both again with Retry after a failed catalog load", async (t) => {
    quiet.expect(1);
    server = fakeFetch();
    page = await openPage(t, { html: "recipes.html", script: "recipes.js", fetch: server.fetch });
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

  test("opens the editor with the recipe and the catalog of the reload", async (t) => {
    await openRecipesPage(
      t,
      [recipe("1", "Soup", false, [{ ingredientId: "carrot", quantity: 2 }])],
      [CARROT_PCS],
    );
    // Meanwhile, another device converted Carrot to g, and added a recipe.
    const soup = recipe("1", "Soup", false, [
      { ingredientId: "carrot", quantity: 2, measureId: "piece" },
    ]);

    await clickAndReload(buttonLabeled("Edit Soup"), {
      recipes: [soup, recipe("2", "Stew", false, WITH_ONION)],
      ingredients: [CARROT_G, ONION],
    });

    assert.equal(editorDialog().open, true);
    assert.equal(editorDialog().querySelector(".quantity-field").value, "2");
    const measure = editorDialog().querySelector(".measure-field");
    assert.equal(measure.value, "piece");
    assert.equal(measure.selectedOptions[0].textContent, "pcs (120 g)");
    assert.deepEqual(activeNames(), ["Soup", "Stew"]);
  });

  test("offers the catalog of the reload in New recipe", async (t) => {
    await openRecipesPage(t, [], [ONION]);

    await clickAndReload(document.getElementById("new-recipe"), {
      recipes: [],
      ingredients: [CARROT_G, ONION],
    });
    typeInto(window, editorDialog().querySelector(".option-search"), "car");

    assert.equal(editorDialog().open, true);
    assert.deepEqual(
      [...editorDialog().querySelectorAll(".options .option")].map((option) => option.textContent),
      ["Carrot (g)"],
    );
  });

  test("shows the load error and keeps the editor closed when a reload fails", async (t) => {
    quiet.expect(2);
    await openRecipesPage(t, [recipe("1", "Soup", false, WITH_ONION)]);

    for (const [name, button] of [
      ["Edit", buttonLabeled("Edit Soup")],
      ["New recipe", document.getElementById("new-recipe")],
    ]) {
      const count = server.requests.length;
      button.click();
      await waitFor(() => server.requests.length === count + 2, {
        message: () => `${name} sent two requests (the reload), but the page has ${requestUrls()}`,
      });
      server.requestFor("GET", "/api/recipes").respond(200, { recipes: served.recipes });
      server.requestFor("GET", "/api/ingredients").fail();
      await tick();

      assert.equal(editorDialog().open, false, `${name} doesn't open the editor`);
      assert.equal(document.getElementById("load-error").hidden, false, `${name} shows the error`);
      assertFocus(document, document.getElementById("retry-load"), `${name} focuses Retry`);

      document.getElementById("retry-load").click();
      await waitFor(() => server.requests.length === count + 4, {
        message: () => `Retry sent two more requests, but the page has ${requestUrls()}`,
      });
      server.requestFor("GET", "/api/recipes").respond(200, { recipes: served.recipes });
      server
        .requestFor("GET", "/api/ingredients")
        .respond(200, { ingredients: served.ingredients });
      await tick();
      assert.equal(document.getElementById("load-error").hidden, true, `${name} then Retry`);
    }
  });

  test("refreshes the list instead of opening a recipe that the reload lacks", async (t) => {
    await openRecipesPage(t, [recipe("1", "Soup", false, WITH_ONION)]);

    await clickAndReload(buttonLabeled("Edit Soup"), {
      recipes: [recipe("2", "Stew", false, WITH_ONION)],
      ingredients: [ONION],
    });

    assert.equal(editorDialog().open, false);
    assert.deepEqual(activeNames(), ["Stew"]);
    assertFocus(document, searchField());
  });

  test("sends no second reload on a second click while the reload runs", async (t) => {
    await openRecipesPage(t, [recipe("1", "Soup", false, WITH_ONION)]);

    buttonLabeled("Edit Soup").click();
    document.getElementById("new-recipe").click();
    const reload = await reloadRequests();
    reload.recipes.respond(200, { recipes: served.recipes });
    reload.ingredients.respond(200, { ingredients: served.ingredients });
    await tick();

    assert.deepEqual(
      server.requests.map((request) => request.url),
      ["/api/recipes", "/api/ingredients", "/api/recipes", "/api/ingredients"],
      "the first load and one reload, each of the recipes and the ingredients",
    );
    assert.equal(editorDialog().querySelector(".dialog-title").textContent, "Edit recipe");
  });
});
