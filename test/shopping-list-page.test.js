// Tests for the shopping list of the meal plan page (public/app.js and
// public/shopping-dialog.js) against a real DOM, built from the real
// public/index.html. See test/dom-helpers.js for the harness and the DOM
// library choice, and test/shopping-list.test.js for the list's arithmetic.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { formatWeekRange } from "../public/dates.js";
import { assertFocus, fakeFetch, openPage, tick, useQuietConsole, waitFor } from "./dom-helpers.js";
import { addWithEditor, blankWeek, openMealPlan, WEEK, withSlot } from "./meal-plan-helpers.js";

const quiet = useQuietConsole();

let page;
let server;

async function openWeek(t, options) {
  ({ page, server } = await openMealPlan(t, options));
  return page;
}

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

// Opens a week whose Monday lunch has Soup, which needs 300 g of onion, 3
// medium onions of 150 g, and 1.5 large onions of 250 g: 1.2 kg in all.
async function openWeekWithOnionSoup(t) {
  const weekData = withSlot(blankWeek(), "mon", "lunch", [{ recipeId: "soup", servings: 1 }]);
  await openWeek(t, {
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
}

// Opens a week with an omelette for 2 servings on Monday and an onion soup for
// 1.5 servings on Tuesday, so the list has Egg and Onion.
async function openWeekWithEggAndOnion(t) {
  let weekData = withSlot(blankWeek(), "mon", "lunch", [{ recipeId: "omelette", servings: 2 }]);
  weekData = withSlot(weekData, "tue", "dinner", [{ recipeId: "soup", servings: 1.5 }]);
  await openWeek(t, {
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
}

describe("shopping list", () => {
  test("shows the total in kilograms with a breakdown by measure", async (t) => {
    await openWeekWithOnionSoup(t);

    shoppingButton().click();

    assert.deepEqual(lineTexts(), [["Onion", "1.2 kg (300 g, 3 medium, 1.5 large)"]]);
  });

  test("shows the total and the breakdown of a line in separate elements", async (t) => {
    await openWeekWithOnionSoup(t);

    shoppingButton().click();

    const amount = shoppingDialog().querySelector(".line-amount");
    assert.equal(amount.querySelector(".line-total").textContent, "1.2 kg");
    assert.equal(
      amount.querySelector(".line-breakdown").textContent,
      "(300 g, 3 medium, 1.5 large)",
    );
  });

  test("words the summary in the singular for one ingredient", async (t) => {
    await openWeekWithOnionSoup(t);

    shoppingButton().click();

    assert.equal(
      shoppingDialog().querySelector(".shopping-summary").textContent,
      "1 ingredient · from A to Z · totals rounded up",
    );
  });

  test("opens a dialog titled with the week range", async (t) => {
    await openWeekWithEggAndOnion(t);

    shoppingButton().click();

    assert.equal(shoppingDialog().open, true);
    assert.equal(shoppingDialog().querySelector(".dialog-title").textContent, "Shopping list");
    assert.equal(
      shoppingDialog().querySelector(".sheet-subtitle").textContent,
      formatWeekRange(WEEK),
    );
  });

  test("words the summary in the plural for two ingredients", async (t) => {
    await openWeekWithEggAndOnion(t);

    shoppingButton().click();

    assert.equal(
      shoppingDialog().querySelector(".shopping-summary").textContent,
      "2 ingredients · from A to Z · totals rounded up",
    );
  });

  test("lists the totals per ingredient from A to Z", async (t) => {
    await openWeekWithEggAndOnion(t);

    shoppingButton().click();

    assert.deepEqual(lineTexts(), [
      ["Egg", "4 pcs"],
      ["Onion", "326 g"],
    ]);
  });

  test("hides the empty-week and not-included messages", async (t) => {
    await openWeekWithEggAndOnion(t);

    shoppingButton().click();

    assert.equal(shoppingDialog().querySelector(".empty-week").hidden, true);
    assert.equal(shoppingDialog().querySelector(".not-included").hidden, true);
  });

  test("undoes a hash change while it's open", async (t) => {
    await openWeek(t);
    shoppingButton().click();

    page.window.location.hash = "#2026-09-28";
    await waitFor(() => page.window.location.hash === `#${WEEK}`);

    assert.equal(shoppingDialog().open, true);
    assert.equal(page.document.getElementById("grid").dataset.week, WEEK);
  });

  test("returns focus to Shopping list with Close", async (t) => {
    await openWeek(t);
    shoppingButton().click();

    shoppingDialog().querySelector(".close-dialog").click();

    assert.equal(shoppingDialog().open, false);
    assertFocus(page.document, shoppingButton());
  });

  test("counts a slot whose save is still pending", async (t) => {
    await openWeek(t, {
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
    const save = await addWithEditor(page, server, "mon", "lunch", "omel");

    shoppingButton().click();

    assert.deepEqual(lineTexts(), [["Egg", "2 pcs"]]);
    save.respond(200, { week: WEEK, day: "mon", meal: "lunch", items: [] });
    await tick();
  });

  test("lists recipes without ingredients as not included, with their slots", async (t) => {
    let weekData = withSlot(blankWeek(), "mon", "dinner", [{ recipeId: "burrito", servings: 2 }]);
    weekData = withSlot(weekData, "thu", "snack_am", [{ recipeId: "burrito", servings: 1 }]);
    await openWeek(t, {
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
    assert.notEqual(
      block.querySelector(".not-included-title .warning-icon"),
      null,
      "the warning icon in the title of the block",
    );
    assert.deepEqual(
      [...block.querySelectorAll("li")].map((item) => item.textContent),
      ["Burrito · Mon dinner, Thu morning snack"],
    );
    assert.deepEqual(lineTexts(), []);
    assert.equal(shoppingDialog().querySelector(".empty-week").hidden, true);
  });

  test("says there is nothing to buy for an empty week", async (t) => {
    await openWeek(t);

    shoppingButton().click();

    const empty = shoppingDialog().querySelector(".empty-week");
    assert.equal(empty.hidden, false);
    assert.equal(empty.textContent, "Nothing to buy. Plan some meals first.");
    assert.equal(shoppingDialog().querySelector(".not-included").hidden, true);
  });

  test("closes with a backdrop click", async (t) => {
    await openWeek(t);
    shoppingButton().click();

    shoppingDialog().dispatchEvent(new page.window.PointerEvent("pointerdown", { bubbles: true }));
    shoppingDialog().click();

    assert.equal(shoppingDialog().open, false);
    assertFocus(page.document, shoppingButton());
  });

  test("disables Shopping list until a week is shown", async (t) => {
    quiet.expect(1);
    server = fakeFetch();
    page = await openPage(t, {
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
      {
        message: () =>
          `Retry sent a second load of the week, but the page has ${server.requests.map((request) => request.url).join(", ")}`,
      },
    );
    server.requestFor("GET", `/api/weeks/${WEEK}`).respond(200, blankWeek());
    server.requestFor("GET", "/api/recipes").respond(200, { recipes: [] });
    server.requestFor("GET", "/api/ingredients").respond(200, { ingredients: [] });
    await tick();

    assert.equal(page.document.getElementById("grid").hidden, false);
    assert.equal(shoppingButton().disabled, false);
  });
});
