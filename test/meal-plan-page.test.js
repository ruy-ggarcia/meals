// Tests for the meal plan page (public/app.js) against a real DOM, built from
// the real public/index.html. See test/dom-helpers.js for the harness and the
// DOM library choice.

import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { addWeeks, formatWeekRange, weekIdOf } from "../public/dates.js";
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

// The menu items that a slot shows, as [name, servings] pairs.
function slotItems(day, meal) {
  return [...slotButton(day, meal).querySelectorAll(".item")].map((item) => [
    item.querySelector(".item-name").textContent,
    item.querySelector(".item-servings").textContent,
  ]);
}

// Adds the first recipe that matches `query` to a slot with the slot editor,
// and confirms with Done. Resolves to the save request that Done queues.
async function addWithEditor(day, meal, query) {
  slotButton(day, meal).click();
  const search = page.document.querySelector("#slot-editor .option-search");
  search.value = query;
  search.dispatchEvent(new page.window.Event("input", { bubbles: true }));
  page.document.querySelector("#slot-editor .option").click();
  page.document.querySelector("#slot-editor .done").click();
  const url = `/api/weeks/${WEEK}/${day}/${meal}`;
  await waitFor(() => server.requestFor("PUT", url) !== undefined);
  return server.requestFor("PUT", url);
}

function saveSummaries() {
  return [...page.document.querySelectorAll(".save-summary")].map((summary) =>
    summary.textContent.trim(),
  );
}

function announcement() {
  return page.document.getElementById("save-announcement").textContent;
}

beforeEach(() => {
  mock.method(console, "error", () => {}); // some tests simulate a failed load or save on purpose
});

afterEach(async () => {
  await page.cleanup();
  mock.restoreAll();
});

test("a loaded week shows each menu item with its servings, and Add in every slot", async () => {
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

  assert.deepEqual(slotItems("mon", "lunch"), [
    ["Lentil soup", "×1"],
    ["Green salad", "×1.5"],
  ]);
  assert.equal(
    slotButton("mon", "lunch").getAttribute("aria-label"),
    "Monday, Lunch: Lentil soup × 1, Green salad × 1.5",
  );
  assert.deepEqual(slotItems("mon", "breakfast"), []);
  assert.equal(
    slotButton("mon", "breakfast").getAttribute("aria-label"),
    "Monday, Breakfast: empty",
  );
  for (const meal of ["breakfast", "lunch"]) {
    assert.equal(slotButton("mon", meal).querySelector(".slot-add").textContent.trim(), "Add");
  }
  assert.equal(slotButton("mon", "breakfast").closest(".slot").hasAttribute("data-empty"), true);
  assert.equal(slotButton("mon", "lunch").closest(".slot").hasAttribute("data-empty"), false);
});

test("each day header shows the short name of the day and its day of the month", async () => {
  await openWeek();

  const header = page.document.querySelector('.day-header[data-day="tue"]');
  assert.equal(header.querySelector(".day-name").textContent, "Tue");
  assert.equal(header.querySelector(".day-number").textContent, "22");
});

test("the toolbar shows the range of the week, and a short range for phones", async () => {
  await openWeek({ week: "2026-09-28" });

  const plain = (text) => text.replace(/\s/g, " ");
  assert.equal(
    plain(page.document.getElementById("week-range").textContent),
    "Sep 28 – Oct 4, 2026",
  );
  assert.equal(page.document.getElementById("week-short").textContent, "Sep 28 – Oct 4");
});

test("the day heading names the selected day and its date", async () => {
  await openWeek();
  page.document.querySelector('#day-bar button[data-day="wed"]').click();

  const heading = page.document.getElementById("day-heading");
  assert.equal(heading.querySelector(".day-title").textContent, "Wednesday");
  assert.equal(heading.querySelector(".day-date").textContent, "September 23, 2026");
  assert.equal(heading.querySelector(".today-mark").hidden, true);
});

test("the day heading marks today", async () => {
  await openWeek({ week: weekIdOf(new Date()) });

  const heading = page.document.getElementById("day-heading");
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(new Date());
  assert.equal(heading.querySelector(".day-title").textContent, weekday);
  assert.equal(heading.querySelector(".today-mark").hidden, false);
});

test("the grid names today's column only in the week that contains today", async () => {
  await openWeek({ week: weekIdOf(new Date()) });
  const todayDay = DAYS[(new Date().getDay() + 6) % 7];
  const grid = page.document.getElementById("grid");
  assert.equal(grid.dataset.todayColumn, todayDay);

  const nextWeek = addWeeks(weekIdOf(new Date()), 1);
  page.document.getElementById("next-week").click();
  await waitFor(() => server.requestFor("GET", `/api/weeks/${nextWeek}`) !== undefined);
  server.requestFor("GET", `/api/weeks/${nextWeek}`).respond(200, blankWeek(DAYS, MEALS));
  server.requestFor("GET", "/api/recipes").respond(200, { recipes: [] });
  server.requestFor("GET", "/api/ingredients").respond(200, { ingredients: [] });
  await tick();

  assert.equal(grid.dataset.week, nextWeek);
  assert.equal(grid.dataset.todayColumn, undefined);
});

test("the day bar marks the days with menu items, also after an edit", async () => {
  const weekData = withSlot(blankWeek(DAYS, MEALS), "mon", "lunch", [
    { recipeId: "soup", servings: 1 },
  ]);
  await openWeek({ weekData, recipes: [{ id: "soup", name: "Soup", archived: false }] });
  const dayButton = (day) => page.document.querySelector(`#day-bar button[data-day="${day}"]`);
  assert.equal(dayButton("mon").hasAttribute("data-planned"), true);
  assert.equal(dayButton("tue").hasAttribute("data-planned"), false);

  await addWithEditor("tue", "dinner", "soup");

  assert.equal(dayButton("tue").hasAttribute("data-planned"), true);
});

test("the toolbar says while the week saves, and then that all changes are saved", async () => {
  await openWeek({ recipes: [{ id: "soup", name: "Soup", archived: false }] });
  assert.deepEqual(saveSummaries(), ["", ""]);

  const save = await addWithEditor("mon", "lunch", "soup");
  assert.deepEqual(saveSummaries(), ["Saving…", "Saving…"]);
  assert.equal(announcement(), "Saving Monday lunch");

  save.respond(200, { items: [{ recipeId: "soup", servings: 1 }] });
  await tick();
  assert.deepEqual(saveSummaries(), ["All changes saved", "All changes saved"]);
  assert.equal(announcement(), "Saved Monday lunch");
});

test("a failed save shows Retry on the slot and in the toolbar, and Retry saves again", async () => {
  await openWeek({ recipes: [{ id: "soup", name: "Soup", archived: false }] });
  const save = await addWithEditor("mon", "lunch", "soup");
  save.fail();
  await tick();

  const status = slotButton("mon", "lunch").closest(".slot").querySelector(".status");
  assert.equal(status.dataset.state, "error");
  assert.equal(status.textContent.trim(), "Retry");
  assert.deepEqual(saveSummaries(), ["1 not saved · Retry", "1 not saved · Retry"]);
  assert.equal(announcement(), "Couldn't save Monday lunch");
  assert.equal(
    page.document.querySelector('.day-header[data-day="mon"]').hasAttribute("data-failed"),
    true,
  );
  assert.equal(
    page.document.querySelector('#day-bar button[data-day="mon"]').hasAttribute("data-failed"),
    true,
  );

  page.document.querySelector(".save-summary button").click();
  await tick();
  const puts = server.requests.filter(
    (request) => request.method === "PUT" && request.url === `/api/weeks/${WEEK}/mon/lunch`,
  );
  assert.equal(puts.length, 2);
  assert.deepEqual(saveSummaries(), ["Saving…", "Saving…"]);
});

test("the sidebar counts the active recipes and the active ingredients", async () => {
  await openWeek({
    recipes: [
      { id: "soup", name: "Lentil soup", archived: false },
      { id: "pie", name: "Apple pie", archived: true },
    ],
    ingredients: [
      { id: "onion", name: "Onion", unit: "g", archived: false, measures: [] },
      { id: "milk", name: "Milk", unit: "ml", archived: false, measures: [] },
    ],
  });

  const count = (href) =>
    page.document.querySelector(`.page-links a[href="${href}"] .page-count`).textContent;
  assert.equal(count("/"), "");
  assert.equal(count("/recipes.html"), "1");
  assert.equal(count("/ingredients.html"), "2");
});

test("a menu item whose recipe isn't in the recipe book falls back to Unknown recipe", async () => {
  const weekData = withSlot(blankWeek(DAYS, MEALS), "mon", "lunch", [
    { recipeId: "gone", servings: 2 },
  ]);
  await openWeek({ weekData, recipes: [] });

  assert.deepEqual(slotItems("mon", "lunch"), [["Unknown recipe", "×2"]]);
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

// Opens a week whose Monday lunch holds Soup, adds Salad with the editor, and
// makes that save fail, so the week has one slot that wasn't saved.
async function openWeekWithUnsavedLunch() {
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
  const save = await addWithEditor("mon", "lunch", "salad"); // now Soup and Salad
  save.fail(); // the save never reaches the server
  await tick();
}

// Selects Next week, and waits for the alert that asks before leaving.
async function leaveForNextWeek() {
  const alert = page.document.getElementById("leave-alert");
  page.document.getElementById("next-week").click();
  await waitFor(() => alert.open);
  return alert;
}

test("leaving a week with an unsaved slot asks first, and names the meal", async () => {
  await openWeekWithUnsavedLunch();

  const alert = await leaveForNextWeek();

  assert.equal(alert.getAttribute("role"), "alertdialog");
  assert.equal(alert.querySelector(".alert-title").textContent, "1 meal wasn't saved");
  assert.equal(
    alert.querySelector(".alert-message").textContent,
    "Monday lunch couldn't be saved. If you leave this week, it goes back to its last saved menu.",
  );
  assertFocus(page.document, alert.querySelector(".stay"));
  alert.querySelector(".stay").click();
  await tick();
});

test("Stay keeps the week and its unsaved menu", async () => {
  await openWeekWithUnsavedLunch();
  const alert = await leaveForNextWeek();

  alert.querySelector(".stay").click();
  await tick();

  assert.equal(alert.open, false);
  assert.equal(page.document.getElementById("grid").dataset.week, WEEK);
  assert.deepEqual(slotItems("mon", "lunch"), [
    ["Soup", "×1"],
    ["Salad", "×1"],
  ]);
  // Stay must stop goToWeek before it ever asks the server for the next
  // week, not just leave the request unanswered.
  assert.equal(
    server.requestFor("GET", (url) => url.includes("2026-09-28")),
    undefined,
  );
});

test("Escape in the alert stays in the week", async () => {
  await openWeekWithUnsavedLunch();
  const alert = await leaveForNextWeek();

  alert.close(); // what Escape and Android's Back do to a modal dialog
  await tick();

  assert.equal(page.document.getElementById("grid").dataset.week, WEEK);
  assert.equal(
    server.requestFor("GET", (url) => url.includes("2026-09-28")),
    undefined,
  );
});

test("a hash change while the alert asks is undone", async () => {
  await openWeekWithUnsavedLunch();
  const alert = await leaveForNextWeek();

  page.window.location.hash = "#2026-10-05";
  await tick();

  assert.equal(page.window.location.hash, `#${WEEK}`);
  alert.querySelector(".stay").click();
  await tick();
  assert.equal(page.window.location.hash, `#${WEEK}`);
});

test("Leave Without Saving shows the last saved menu, then the next week", async () => {
  await openWeekWithUnsavedLunch();
  const alert = await leaveForNextWeek();

  alert.querySelector(".leave").click();
  // Paused right before the new week's data arrives: the old grid still shows
  // the reverted (saved) menu for the week being left.
  await waitFor(() => server.requestFor("GET", "/api/weeks/2026-09-28") !== undefined);

  assert.equal(alert.open, false);
  assert.equal(page.document.getElementById("grid").dataset.week, WEEK);
  assert.deepEqual(slotItems("mon", "lunch"), [["Soup", "×1"]]);

  server.requestFor("GET", "/api/weeks/2026-09-28").respond(200, blankWeek(DAYS, MEALS));
  server.requestFor("GET", "/api/recipes").respond(200, { recipes: [] });
  server.requestFor("GET", "/api/ingredients").respond(200, { ingredients: [] });
  await tick();
  assert.equal(page.document.getElementById("grid").dataset.week, "2026-09-28");
});

test("a slot opens the editor titled with its meal, under the day and date", async () => {
  await openWeek();

  slotButton("wed", "snack_pm").click();

  const editor = page.document.getElementById("slot-editor");
  assert.equal(editor.querySelector(".dialog-title").textContent, "Afternoon snack");
  assert.equal(editor.querySelector(".sheet-subtitle").textContent, "Wednesday, Sep 23");
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
