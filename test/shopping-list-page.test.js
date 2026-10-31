// Tests for the shopping list of the meal plan page (public/app.js and
// public/shopping-dialog.js) against a real DOM, built from the real
// public/index.html. See test/dom-helpers.js for the harness and the DOM
// library choice, and test/shopping-list.test.js for the list's arithmetic.

import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { formatWeekRange } from "../public/dates.js";
import { assertFocus, fakeFetch, loadPage, tick, waitFor } from "./dom-helpers.js";
import { blankWeek } from "./helpers.js";
import { DAYS, MEALS, openMealPlan, WEEK, withSlot } from "./meal-plan-helpers.js";

let page;
let server;

async function openWeek(options) {
  ({ page, server } = await openMealPlan(options));
  return page;
}

function slotButton(day, meal) {
  return page.document.querySelector(`.slot[data-day="${day}"][data-meal="${meal}"] .slot-menu`);
}

beforeEach(() => {
  mock.method(console, "error", () => {}); // some tests simulate a failed load or save on purpose
});

afterEach(async () => {
  await page.cleanup();
  mock.restoreAll();
});

const EGG = { id: "egg", name: "Egg", unit: "pcs", measures: [], archived: false };
const ONION = { id: "onion", name: "Onion", unit: "g", measures: [], archived: false };

function shoppingButton() {
  return page.document.getElementById("shopping-list");
}

function shoppingDialog() {
  return page.document.getElementById("shopping-dialog");
}

function lineTexts() {
  return [...shoppingDialog().querySelectorAll(".shopping-line")].map((line) => [
    line.querySelector(".line-name").textContent,
    line.querySelector(".line-amount").textContent,
  ]);
}

test("the shopping list shows kilograms and a measure breakdown", async () => {
  const weekData = withSlot(blankWeek(DAYS, MEALS), "mon", "lunch", [
    { recipeId: "soup", servings: 1 },
  ]);
  await openWeek({
    weekData,
    recipes: [
      {
        id: "soup",
        name: "Soup",
        archived: false,
        ingredients: [
          { ingredientId: "onion", quantity: 300 },
          { ingredientId: "onion", quantity: 3, measureId: "medium" },
          { ingredientId: "onion", quantity: 1.5, measureId: "large" },
        ],
      },
    ],
    ingredients: [
      {
        ...ONION,
        measures: [
          { id: "medium", name: "medium", amount: 150 },
          { id: "large", name: "large", amount: 250 },
        ],
      },
    ],
  });

  shoppingButton().click();

  assert.deepEqual(lineTexts(), [["Onion", "1.2 kg (300 g, 3 medium, 1.5 large)"]]);
  const amount = shoppingDialog().querySelector(".line-amount");
  assert.equal(amount.querySelector(".line-total").textContent, "1.2 kg");
  assert.equal(amount.querySelector(".line-breakdown").textContent, "(300 g, 3 medium, 1.5 large)");
  assert.equal(
    shoppingDialog().querySelector(".shopping-summary").textContent,
    "1 ingredient · from A to Z · totals rounded up",
  );
});

test("Shopping list shows the week's totals per ingredient, from A to Z", async () => {
  let weekData = withSlot(blankWeek(DAYS, MEALS), "mon", "lunch", [
    { recipeId: "omelette", servings: 2 },
  ]);
  weekData = withSlot(weekData, "tue", "dinner", [{ recipeId: "soup", servings: 1.5 }]);
  await openWeek({
    weekData,
    recipes: [
      {
        id: "omelette",
        name: "Omelette",
        archived: false,
        ingredients: [
          { ingredientId: "egg", quantity: 2 },
          { ingredientId: "onion", quantity: 50 },
        ],
      },
      {
        id: "soup",
        name: "Onion soup",
        archived: false,
        ingredients: [{ ingredientId: "onion", quantity: 150.5 }],
      },
    ],
    ingredients: [ONION, EGG],
  });

  shoppingButton().click();

  assert.equal(shoppingDialog().open, true);
  assert.equal(shoppingDialog().querySelector(".dialog-title").textContent, "Shopping list");
  assert.equal(
    shoppingDialog().querySelector(".sheet-subtitle").textContent,
    formatWeekRange(WEEK),
  );
  assert.equal(
    shoppingDialog().querySelector(".shopping-summary").textContent,
    "2 ingredients · from A to Z · totals rounded up",
  );
  assert.deepEqual(lineTexts(), [
    ["Egg", "4 pcs"],
    ["Onion", "326 g"],
  ]);
  assert.equal(shoppingDialog().querySelector(".empty-week").hidden, true);
  assert.equal(shoppingDialog().querySelector(".not-included").hidden, true);
});

test("the shopping list counts a slot whose save is still pending", async () => {
  await openWeek({
    recipes: [
      {
        id: "omelette",
        name: "Omelette",
        archived: false,
        ingredients: [{ ingredientId: "egg", quantity: 2 }],
      },
    ],
    ingredients: [EGG],
  });
  slotButton("mon", "lunch").click();
  const search = page.document.querySelector("#slot-editor .option-search");
  search.value = "omel";
  search.dispatchEvent(new page.window.Event("input", { bubbles: true }));
  page.document.querySelector("#slot-editor .option").click();
  page.document.querySelector("#slot-editor .done").click();
  const saveUrl = `/api/weeks/${WEEK}/mon/lunch`;
  await waitFor(() => server.requestFor("PUT", saveUrl) !== undefined);

  shoppingButton().click();

  assert.deepEqual(lineTexts(), [["Egg", "2 pcs"]]);
  server
    .requestFor("PUT", saveUrl)
    .respond(200, { week: WEEK, day: "mon", meal: "lunch", items: [] });
  await tick();
});

test("recipes without ingredients are listed as not included, with their slots", async () => {
  let weekData = withSlot(blankWeek(DAYS, MEALS), "mon", "dinner", [
    { recipeId: "burrito", servings: 2 },
  ]);
  weekData = withSlot(weekData, "thu", "snack_am", [{ recipeId: "burrito", servings: 1 }]);
  await openWeek({
    weekData,
    recipes: [{ id: "burrito", name: "Burrito", archived: false, ingredients: [] }],
  });

  shoppingButton().click();

  const block = shoppingDialog().querySelector(".not-included");
  assert.equal(block.hidden, false);
  assert.equal(
    block.querySelector(".not-included-title").textContent,
    "Not included: these recipes have no ingredients.",
  );
  assert.ok(block.querySelector(".not-included-title .warning-icon"));
  assert.deepEqual(
    [...block.querySelectorAll("li")].map((item) => item.textContent),
    ["Burrito · Mon dinner, Thu morning snack"],
  );
  assert.deepEqual(lineTexts(), []);
  assert.equal(shoppingDialog().querySelector(".empty-week").hidden, true);
});

test("an empty week says it has no menus", async () => {
  await openWeek();

  shoppingButton().click();

  const empty = shoppingDialog().querySelector(".empty-week");
  assert.equal(empty.hidden, false);
  assert.equal(empty.textContent, "This week has no menus yet.");
  assert.equal(shoppingDialog().querySelector(".not-included").hidden, true);
});

test("a hash change while the shopping list is open is undone, and Close returns focus", async () => {
  await openWeek();
  shoppingButton().click();

  page.window.location.hash = "#2026-09-28";
  await waitFor(() => page.window.location.hash === `#${WEEK}`);

  assert.equal(shoppingDialog().open, true);
  assert.equal(page.document.getElementById("grid").dataset.week, WEEK);
  shoppingDialog().querySelector(".close-dialog").click();
  assert.equal(shoppingDialog().open, false);
  assertFocus(page.document, shoppingButton());
});

test("a backdrop click closes the shopping list", async () => {
  await openWeek();
  shoppingButton().click();

  shoppingDialog().dispatchEvent(new page.window.PointerEvent("pointerdown", { bubbles: true }));
  shoppingDialog().click();

  assert.equal(shoppingDialog().open, false);
  assertFocus(page.document, shoppingButton());
});

test("Shopping list is disabled while no week is shown, and enabled when a week loads", async () => {
  server = fakeFetch();
  page = await loadPage({
    html: "index.html",
    script: "app.js",
    fetch: server.fetch,
    url: `http://localhost/#${WEEK}`,
  });
  await tick();
  server.requestFor("GET", `/api/weeks/${WEEK}`).fail();
  server.requestFor("GET", "/api/recipes").respond(200, { recipes: [] });
  server.requestFor("GET", "/api/ingredients").respond(200, { ingredients: [] });
  await tick();

  assert.equal(page.document.getElementById("grid").hidden, true);
  assert.equal(shoppingButton().disabled, true);

  page.document.getElementById("retry-load").click();
  await waitFor(
    () => server.requests.filter((request) => request.url === `/api/weeks/${WEEK}`).length === 2,
  );
  server.requestFor("GET", `/api/weeks/${WEEK}`).respond(200, blankWeek(DAYS, MEALS));
  server.requestFor("GET", "/api/recipes").respond(200, { recipes: [] });
  server.requestFor("GET", "/api/ingredients").respond(200, { ingredients: [] });
  await tick();

  assert.equal(page.document.getElementById("grid").hidden, false);
  assert.equal(shoppingButton().disabled, false);
});
