// Tests for the meal plan page (public/app.js) against a real DOM, built from
// the real public/index.html. See test/dom-helpers.js for the harness and the
// DOM library choice.

import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { fakeFetch, loadPage, tick, waitFor } from "./dom-helpers.js";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const MEALS = ["breakfast", "snack_am", "lunch", "snack_pm", "dinner"];
const WEEK = "2026-09-21"; // a Monday

function blankWeekData() {
  const data = {};
  for (const day of DAYS) {
    data[day] = {};
    for (const meal of MEALS) data[day][meal] = { items: [] };
  }
  return data;
}

function withSlot(weekData, day, meal, items) {
  return { ...weekData, [day]: { ...weekData[day], [meal]: { items } } };
}

let page;
let server;

async function openWeek({ week = WEEK, weekData = blankWeekData(), recipes = [] } = {}) {
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
  const weekData = withSlot(blankWeekData(), "mon", "lunch", [
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
  const weekData = withSlot(blankWeekData(), "mon", "lunch", [{ recipeId: "gone", servings: 2 }]);
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
  server.requestFor("GET", `/api/weeks/${nextWeek}`).respond(200, blankWeekData());
  server.requestFor("GET", "/api/recipes").respond(200, { recipes: [] });
  await tick();

  assert.equal(page.document.getElementById("grid").dataset.week, nextWeek);
  assert.equal(page.window.location.hash, `#${nextWeek}`);
});

test("leaving a week with an unsaved slot asks confirm; cancel keeps the week", async () => {
  const weekData = withSlot(blankWeekData(), "mon", "lunch", [{ recipeId: "soup", servings: 1 }]);
  await openWeek({
    weekData,
    recipes: [
      { id: "soup", name: "Soup", archived: false },
      { id: "salad", name: "Salad", archived: false },
    ],
  });

  slotButton("mon", "lunch").click();
  const search = page.document.querySelector(".recipe-search");
  search.value = "salad";
  search.dispatchEvent(new page.window.Event("input", { bubbles: true }));
  page.document.querySelector(".recipe-option").click(); // adds Salad
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
  const weekData = withSlot(blankWeekData(), "mon", "lunch", [{ recipeId: "soup", servings: 1 }]);
  await openWeek({
    weekData,
    recipes: [
      { id: "soup", name: "Soup", archived: false },
      { id: "salad", name: "Salad", archived: false },
    ],
  });

  slotButton("mon", "lunch").click();
  const search = page.document.querySelector(".recipe-search");
  search.value = "salad";
  search.dispatchEvent(new page.window.Event("input", { bubbles: true }));
  page.document.querySelector(".recipe-option").click(); // adds Salad
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

  server.requestFor("GET", "/api/weeks/2026-09-28").respond(200, blankWeekData());
  server.requestFor("GET", "/api/recipes").respond(200, { recipes: [] });
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
    weekData: blankWeekData(),
    recipes: [{ id: "soup", name: "Soup", archived: false }],
  });
  slotButton("mon", "lunch").click();

  function dispatchBeforeUnload() {
    const event = new page.window.Event("beforeunload", { cancelable: true });
    page.window.dispatchEvent(event);
    return event;
  }

  assert.equal(dispatchBeforeUnload().defaultPrevented, false); // no changes yet

  const search = page.document.querySelector(".recipe-search");
  search.value = "soup";
  search.dispatchEvent(new page.window.Event("input", { bubbles: true }));
  page.document.querySelector("#slot-editor .recipe-option")?.click();

  assert.equal(dispatchBeforeUnload().defaultPrevented, true); // has changes, still open

  page.document.querySelector(".cancel").click(); // discards and closes
  assert.equal(dispatchBeforeUnload().defaultPrevented, false); // closed again
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
  await tick();

  assert.equal(page.document.getElementById("load-error").hidden, false);
  assert.equal(page.document.getElementById("grid").hidden, true);

  page.document.getElementById("retry-load").click();
  await waitFor(
    () => server.requests.filter((request) => request.url === `/api/weeks/${WEEK}`).length === 2,
  );
  const weekRequests = server.requests.filter((request) => request.url === `/api/weeks/${WEEK}`);
  assert.equal(weekRequests.length, 2, "Retry sends a new request");
  weekRequests[1].respond(200, blankWeekData());
  server.requests
    .filter((request) => request.url === "/api/recipes")[1]
    .respond(200, {
      recipes: [],
    });
  await tick();

  assert.equal(page.document.getElementById("load-error").hidden, true);
  assert.equal(page.document.getElementById("grid").hidden, false);
});
