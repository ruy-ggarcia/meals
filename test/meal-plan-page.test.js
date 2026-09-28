// Tests for the meal plan page (public/app.js) against a real DOM, built from
// the real public/index.html. See test/dom-helpers.js for the harness and the
// DOM library choice.

import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { formatWeekRange } from "../public/dates.js";
import { assertFocus, fakeFetch, loadPage, tick, waitFor } from "./dom-helpers.js";
import { blankWeek } from "./helpers.js";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const MEALS = ["breakfast", "snack_am", "lunch", "snack_pm", "dinner"];
const WEEK = "2026-09-21"; // a Monday

function withSlot(weekData, day, meal, items) {
  return { ...weekData, [day]: { ...weekData[day], [meal]: { items } } };
}

let page;
let server;

async function openWeek({
  week = WEEK,
  weekData = blankWeek(DAYS, MEALS),
  recipes = [],
  ingredients = [],
} = {}) {
  server = fakeFetch();
  page = await loadPage({
    html: "index.html",
    script: "app.js",
    fetch: server.fetch,
    url: `http://localhost/#${week}`,
  });
  await tick();
  server.requestFor("GET", `/api/weeks/${week}`).respond(200, weekData);
  server.requestFor("GET", "/api/recipes").respond(200, { recipes });
  server.requestFor("GET", "/api/ingredients").respond(200, { ingredients });
  await tick();
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

test("a loaded week renders NAME × SERVINGS lines, or + Add when the slot is empty", async () => {
  const weekData = withSlot(blankWeek(DAYS, MEALS), "mon", "lunch", [
    { recipeId: "soup", servings: 1 },
    { recipeId: "salad", servings: 1.5 },
  ]);
  await openWeek({
    weekData,
    recipes: [
      { id: "soup", name: "Lentil soup", archived: false },
      { id: "salad", name: "Green salad", archived: false },
    ],
  });

  const lunch = slotButton("mon", "lunch");
  assert.deepEqual(
    [...lunch.querySelectorAll("span")].map((span) => span.textContent),
    ["Lentil soup × 1", "Green salad × 1.5"],
  );

  const empty = slotButton("mon", "breakfast");
  assert.equal(empty.querySelector(".slot-empty").textContent, "+ Add");
});

test("a menu item whose recipe isn't in the recipe book falls back to Unknown recipe", async () => {
  const weekData = withSlot(blankWeek(DAYS, MEALS), "mon", "lunch", [
    { recipeId: "gone", servings: 2 },
  ]);
  await openWeek({ weekData, recipes: [] });

  assert.equal(slotButton("mon", "lunch").querySelector("span").textContent, "Unknown recipe × 2");
});

test("the shown week stays in sync with the hash", async () => {
  await openWeek();
  assert.equal(page.document.getElementById("grid").dataset.week, WEEK);
  assert.equal(page.window.location.hash, `#${WEEK}`);

  const nextWeek = "2026-09-28";
  page.window.location.hash = `#${nextWeek}`; // a real hash edit, as in the address bar
  await waitFor(() => server.requestFor("GET", `/api/weeks/${nextWeek}`) !== undefined);
  server.requestFor("GET", `/api/weeks/${nextWeek}`).respond(200, blankWeek(DAYS, MEALS));
  server.requestFor("GET", "/api/recipes").respond(200, { recipes: [] });
  server.requestFor("GET", "/api/ingredients").respond(200, { ingredients: [] });
  await tick();

  assert.equal(page.document.getElementById("grid").dataset.week, nextWeek);
  assert.equal(page.window.location.hash, `#${nextWeek}`);
});

test("leaving a week with an unsaved slot asks confirm; cancel keeps the week", async () => {
  const weekData = withSlot(blankWeek(DAYS, MEALS), "mon", "lunch", [
    { recipeId: "soup", servings: 1 },
  ]);
  await openWeek({
    weekData,
    recipes: [
      { id: "soup", name: "Soup", archived: false },
      { id: "salad", name: "Salad", archived: false },
    ],
  });

  slotButton("mon", "lunch").click();
  const search = page.document.querySelector(".option-search");
  search.value = "salad";
  search.dispatchEvent(new page.window.Event("input", { bubbles: true }));
  page.document.querySelector(".option").click(); // adds Salad
  page.document.querySelector(".done").click(); // queues a save

  await waitFor(() => server.requestFor("PUT", (url) => url.includes("mon")) !== undefined);
  server.requestFor("PUT", (url) => url.includes("mon")).fail(); // the save never reaches the server
  await tick();

  const confirmMock = mock.method(page.window, "confirm", () => false);
  page.document.getElementById("next-week").click();
  await waitFor(() => confirmMock.mock.calls.length === 1);

  assert.equal(
    confirmMock.mock.calls[0].arguments[0],
    "Some changes in this week couldn't be saved. Leave anyway and discard them?",
  );
  await tick();
  assert.equal(page.document.getElementById("grid").dataset.week, WEEK); // stayed
  // Cancel must stop goToWeek before it ever asks the server for the next
  // week, not just leave the request unanswered.
  assert.equal(
    server.requestFor("GET", (url) => url.includes("2026-09-28")),
    undefined,
  );
});

test("leaving a week with an unsaved slot asks confirm; OK shows the last saved menu", async () => {
  const weekData = withSlot(blankWeek(DAYS, MEALS), "mon", "lunch", [
    { recipeId: "soup", servings: 1 },
  ]);
  await openWeek({
    weekData,
    recipes: [
      { id: "soup", name: "Soup", archived: false },
      { id: "salad", name: "Salad", archived: false },
    ],
  });

  slotButton("mon", "lunch").click();
  const search = page.document.querySelector(".option-search");
  search.value = "salad";
  search.dispatchEvent(new page.window.Event("input", { bubbles: true }));
  page.document.querySelector(".option").click(); // adds Salad
  page.document.querySelector(".done").click(); // now Soup and Salad, queues a save

  await waitFor(() => server.requestFor("PUT", (url) => url.includes("mon")) !== undefined);
  server.requestFor("PUT", (url) => url.includes("mon")).fail();
  await tick();
  assert.deepEqual(
    [...slotButton("mon", "lunch").querySelectorAll("span")].map((span) => span.textContent),
    ["Soup × 1", "Salad × 1"],
  );

  mock.method(page.window, "confirm", () => true);
  page.document.getElementById("next-week").click();
  // Paused right before the new week's data arrives: the old grid still shows
  // the reverted (saved) menu for the week being left.
  await waitFor(() => server.requestFor("GET", "/api/weeks/2026-09-28") !== undefined);

  assert.equal(page.document.getElementById("grid").dataset.week, WEEK);
  assert.deepEqual(
    [...slotButton("mon", "lunch").querySelectorAll("span")].map((span) => span.textContent),
    ["Soup × 1"],
  );

  server.requestFor("GET", "/api/weeks/2026-09-28").respond(200, blankWeek(DAYS, MEALS));
  server.requestFor("GET", "/api/recipes").respond(200, { recipes: [] });
  server.requestFor("GET", "/api/ingredients").respond(200, { ingredients: [] });
  await tick();
});

test("a hash change while the editor is open is undone", async () => {
  await openWeek();
  slotButton("mon", "lunch").click();
  assert.equal(page.document.getElementById("slot-editor").open, true);

  page.window.location.hash = "#2026-09-28";
  await waitFor(() => page.window.location.hash === `#${WEEK}`); // undone

  assert.equal(page.window.location.hash, `#${WEEK}`); // undone
  assert.equal(page.document.getElementById("slot-editor").open, true); // still open
  assert.equal(page.document.getElementById("grid").dataset.week, WEEK); // week unchanged
});

test("beforeunload calls preventDefault() only while the editor has changes", async () => {
  await openWeek({
    weekData: blankWeek(DAYS, MEALS),
    recipes: [{ id: "soup", name: "Soup", archived: false }],
  });
  slotButton("mon", "lunch").click();

  function dispatchBeforeUnload() {
    const event = new page.window.Event("beforeunload", { cancelable: true });
    page.window.dispatchEvent(event);
    return event;
  }

  assert.equal(dispatchBeforeUnload().defaultPrevented, false); // no changes yet

  const search = page.document.querySelector(".option-search");
  search.value = "soup";
  search.dispatchEvent(new page.window.Event("input", { bubbles: true }));
  page.document.querySelector("#slot-editor .option")?.click();

  assert.equal(dispatchBeforeUnload().defaultPrevented, true); // has changes, still open

  page.document.querySelector(".cancel").click(); // discards and closes
  assert.equal(dispatchBeforeUnload().defaultPrevented, false); // closed again
});

// How long app.js keeps the "saved" check mark up before reverting to idle.
// Kept in sync with SAVED_BADGE_MS in public/app.js.
const SAVED_BADGE_MS = 3000;

test("the saved badge's timer is canceled by cleanup, so it never fires against a closed page", async () => {
  await openWeek({ recipes: [{ id: "soup", name: "Soup", archived: false }] });
  slotButton("mon", "lunch").click();
  const search = page.document.querySelector("#slot-editor .option-search");
  search.value = "soup";
  search.dispatchEvent(new page.window.Event("input", { bubbles: true }));
  page.document.querySelector("#slot-editor .option").click();
  page.document.querySelector("#slot-editor .done").click();

  const saveUrl = `/api/weeks/${WEEK}/mon/lunch`;
  await waitFor(() => server.requestFor("PUT", saveUrl) !== undefined);

  // Catches setStatus() in app.js scheduling the "saved" badge's timer with
  // the bare setTimeout instead of window.setTimeout: unlike window.setTimeout,
  // a bare timer isn't tied to the page's window, so it survives the window's
  // close and later runs against a torn-down DOM. Any other delay -- such as
  // the harness's own tick(), or app.js's own hashchange debounce -- passes
  // straight through to the real setTimeout, so this never blocks the test or
  // waits in real time.
  //
  // This interception relies on window.setTimeout going through a reference
  // to the real setTimeout that happy-dom's BrowserWindow module captures
  // from globalThis when it's first loaded, before this mock is installed --
  // an internal detail of the pinned happy-dom version. Re-check this test
  // against a happy-dom upgrade.
  const realSetTimeout = globalThis.setTimeout;
  let bareBadgeCallback;
  mock.method(globalThis, "setTimeout", (callback, delay, ...args) => {
    if (delay === SAVED_BADGE_MS) {
      bareBadgeCallback = callback;
      return 0;
    }
    return realSetTimeout(callback, delay, ...args);
  });

  server.requestFor("PUT", saveUrl).respond(200, {
    week: WEEK,
    day: "mon",
    meal: "lunch",
    items: [{ recipeId: "soup", servings: 1 }],
  });
  await tick(); // the slot now shows "saved" and has scheduled the badge's timer

  const status = slotButton("mon", "lunch").closest(".slot").querySelector(".status");
  assert.equal(status.dataset.state, "saved");

  await page.cleanup(); // closes the page's window, canceling any timer tied to it

  assert.equal(
    bareBadgeCallback,
    undefined,
    "setStatus scheduled the saved badge's timer with the bare setTimeout, not " +
      "window.setTimeout, so it would survive the page's close and later run " +
      "against a torn-down DOM",
  );
});

test("a load failure shows the error, and Retry reloads", async () => {
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

  assert.equal(page.document.getElementById("load-error").hidden, false);
  assert.equal(page.document.getElementById("grid").hidden, true);

  page.document.getElementById("retry-load").click();
  await waitFor(
    () => server.requests.filter((request) => request.url === `/api/weeks/${WEEK}`).length === 2,
  );
  const weekRequests = server.requests.filter((request) => request.url === `/api/weeks/${WEEK}`);
  assert.equal(weekRequests.length, 2, "Retry sends a new request");
  weekRequests[1].respond(200, blankWeek(DAYS, MEALS));
  server.requests
    .filter((request) => request.url === "/api/recipes")[1]
    .respond(200, {
      recipes: [],
    });
  server.requests
    .filter((request) => request.url === "/api/ingredients")[1]
    .respond(200, { ingredients: [] });
  await tick();

  assert.equal(page.document.getElementById("load-error").hidden, true);
  assert.equal(page.document.getElementById("grid").hidden, false);
});

// ---------- Shopping list ----------

const EGG = { id: "egg", name: "Egg", unit: "pcs", archived: false };
const ONION = { id: "onion", name: "Onion", unit: "g", archived: false };

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
  assert.equal(
    shoppingDialog().querySelector(".dialog-title").textContent,
    `Shopping list · ${formatWeekRange(WEEK)}`,
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

test("the ingredient catalog loads again with every week", async () => {
  await openWeek();

  page.document.getElementById("next-week").click();
  await waitFor(
    () => server.requests.filter((request) => request.url === "/api/ingredients").length === 2,
  );

  server.requestFor("GET", "/api/weeks/2026-09-28").respond(200, blankWeek(DAYS, MEALS));
  server.requestFor("GET", "/api/recipes").respond(200, { recipes: [] });
  server.requestFor("GET", "/api/ingredients").respond(200, { ingredients: [] });
  await tick();
  assert.equal(page.document.getElementById("grid").dataset.week, "2026-09-28");
});
