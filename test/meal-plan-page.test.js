// Tests for the meal plan page (public/app.js) against a real DOM, built from
// the real public/index.html. See test/dom-helpers.js for the harness and the
// DOM library choice.

import assert from "node:assert/strict";
import { afterEach, describe, mock, test } from "node:test";
import { addWeeks } from "../public/dates.js";
import { unsavedMessage, unsavedTitle } from "../public/messages.js";
import {
  assertFocus,
  dispatchBeforeUnload,
  fakeFetch,
  openPage,
  plain,
  tick,
  typeInto,
  useQuietConsole,
  waitFor,
} from "./dom-helpers.js";
import {
  addWithEditor,
  answerWeekLoad,
  blankWeek,
  DAYS,
  MEALS,
  openMealPlan,
  slotButton,
  WEEK,
  withSlot,
} from "./meal-plan-helpers.js";

const quiet = useQuietConsole();

let page;
let server;

async function openWeek(t, options) {
  ({ page, server } = await openMealPlan(t, options));
  return page;
}

// The menu items that a slot shows, as [name, servings] pairs.
function slotItems(day, meal) {
  return [...slotButton(page, day, meal).querySelectorAll(".item")].map((item) => [
    item.querySelector(".item-name").textContent,
    item.querySelector(".item-servings").textContent,
  ]);
}

function saveSummaries() {
  return [...page.document.querySelectorAll(".save-summary")].map((summary) =>
    summary.textContent.trim(),
  );
}

function announcement() {
  return page.document.getElementById("save-announcement").textContent;
}

afterEach(() => {
  mock.restoreAll();
});

// Wednesday of the week of WEEK, at noon, in the time zone of the test run.
function setToday(t) {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 8, 23, 12) });
}

// The week that holds the only menu of the tests of week changes.
const MENU_WEEK = "2026-10-05";
const LAST_WEEK = "2026-10-26"; // five weeks ahead of WEEK, which is the first

const LENTIL_SOUP = { id: "soup", name: "Lentil soup", archived: false };

// The order in which each of five weeks answers its three requests. MENU_WEEK
// is the second, and its week answers first.
const ANSWER_ORDERS = [
  ["ingredients", "recipes", "week"],
  ["week", "recipes", "ingredients"],
  ["recipes", "week", "ingredients"],
  ["ingredients", "week", "recipes"],
  ["recipes", "ingredients", "week"],
];

function menuOf(week) {
  const blank = blankWeek();
  return week === MENU_WEEK
    ? withSlot(blank, "mon", "lunch", [{ recipeId: "soup", servings: 1 }])
    : blank;
}

// Taps Next week five times, each time once the week before has loaded, and
// answers the three requests of every week in the order of ANSWER_ORDERS.
// Resolves to the weeks that the grid showed while it held the menu of
// MENU_WEEK, so a menu that shows in another week, even for a moment, counts.
async function tapNextWeekFiveTimes() {
  const grid = page.document.getElementById("grid");
  const next = page.document.getElementById("next-week");
  const weeksWithTheMenu = new Set();
  new page.window.MutationObserver(() => {
    if (grid.textContent.includes("Lentil soup")) weeksWithTheMenu.add(grid.dataset.week);
  }).observe(grid, { attributes: true, characterData: true, childList: true, subtree: true });

  let week = WEEK;
  for (const order of ANSWER_ORDERS) {
    week = addWeeks(week, 1);
    next.click();
    await waitFor(() => server.requestFor("GET", `/api/weeks/${week}`) !== undefined);
    const answers = {
      week: () => server.requestFor("GET", `/api/weeks/${week}`).respond(200, menuOf(week)),
      recipes: () =>
        server
          .requestFor("GET", "/api/recipes")
          .respond(200, { recipes: week === MENU_WEEK ? [LENTIL_SOUP] : [] }),
      ingredients: () =>
        server.requestFor("GET", "/api/ingredients").respond(200, { ingredients: [] }),
    };
    for (const name of order) answers[name]();
    await waitFor(() => grid.dataset.week === week && !next.disabled);
  }
  return weeksWithTheMenu;
}

// Opens a week whose Monday lunch holds Soup with 1 serving and Salad with 1.5.
function openLoadedWeek(t) {
  const weekData = withSlot(blankWeek(), "mon", "lunch", [
    { recipeId: "soup", servings: 1 },
    { recipeId: "salad", servings: 1.5 },
  ]);
  return openWeek(t, {
    weekData,
    recipes: [
      { id: "soup", name: "Soup", archived: false },
      { id: "salad", name: "Salad", archived: false },
    ],
  });
}

// Adds Soup to Monday lunch with the slot editor, and makes the save fail.
async function openWeekWithFailedSave(t) {
  quiet.expect(1);
  await openWeek(t, { recipes: [{ id: "soup", name: "Soup", archived: false }] });
  const save = await addWithEditor(page, server, "mon", "lunch", "soup");
  save.fail();
  await tick();
}

// Opens a week whose Monday lunch holds Soup, adds Salad with the editor, and
// makes that save fail, so the week has one slot that wasn't saved.
async function openWeekWithUnsavedLunch(t) {
  const weekData = withSlot(blankWeek(), "mon", "lunch", [{ recipeId: "soup", servings: 1 }]);
  await openWeek(t, {
    weekData,
    recipes: [
      { id: "soup", name: "Soup", archived: false },
      { id: "salad", name: "Salad", archived: false },
    ],
  });
  const save = await addWithEditor(page, server, "mon", "lunch", "salad"); // now Soup and Salad
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

// Selects Recipes in the sidebar, and returns the click event.
function clickRecipesLink(init = {}) {
  const link = page.document.querySelector('.page-link[href="/recipes.html"]');
  const event = new page.window.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...init,
  });
  link.dispatchEvent(event);
  return event;
}

// How long app.js keeps the "saved" check mark up before reverting to idle.
// Kept in sync with SAVED_BADGE_MS in public/app.js.
const SAVED_BADGE_MS = 3000;

describe("meal plan", () => {
  test("shows the short name and the day of the month in each day header", async (t) => {
    await openWeek(t, { week: "2026-09-28" }); // the month changes on Thursday

    const headers = [...page.document.querySelectorAll(".day-header")].map((header) => [
      header.querySelector(".day-name").textContent,
      header.querySelector(".day-number").textContent,
    ]);

    assert.deepEqual(headers, [
      ["Mon", "28"],
      ["Tue", "29"],
      ["Wed", "30"],
      ["Thu", "1"],
      ["Fri", "2"],
      ["Sat", "3"],
      ["Sun", "4"],
    ]);
  });

  test("shows the week range in the toolbar and a short range on phones", async (t) => {
    await openWeek(t, { week: "2026-09-28" });

    assert.equal(
      plain(page.document.getElementById("week-range").textContent),
      "Sep 28 – Oct 4, 2026",
    );
    assert.equal(page.document.getElementById("week-short").textContent, "Sep 28 – Oct 4");
  });

  test("names the selected day and its date in the day heading", async (t) => {
    await openWeek(t);
    page.document.querySelector('#day-bar button[data-day="wed"]').click();

    const heading = page.document.getElementById("day-heading");
    assert.equal(heading.querySelector(".day-title").textContent, "Wednesday");
    assert.equal(heading.querySelector(".day-date").textContent, "September 23, 2026");
    assert.equal(heading.querySelector(".today-mark").hidden, true);
  });

  test("marks today in the day heading", async (t) => {
    setToday(t);
    await openWeek(t);

    const heading = page.document.getElementById("day-heading");
    assert.equal(heading.querySelector(".day-title").textContent, "Wednesday");
    assert.equal(heading.querySelector(".today-mark").hidden, false);
  });

  test("names today's column only in the week that contains today", async (t) => {
    setToday(t);
    await openWeek(t);
    const grid = page.document.getElementById("grid");
    assert.equal(grid.dataset.todayColumn, "wed");

    page.document.getElementById("next-week").click();
    await waitFor(() => server.requestFor("GET", "/api/weeks/2026-09-28") !== undefined);
    server.requestFor("GET", "/api/weeks/2026-09-28").respond(200, blankWeek());
    server.requestFor("GET", "/api/recipes").respond(200, { recipes: [] });
    server.requestFor("GET", "/api/ingredients").respond(200, { ingredients: [] });
    await tick();

    assert.equal(grid.dataset.week, "2026-09-28");
    assert.equal(grid.dataset.todayColumn, undefined);
  });

  test("marks the days with menu items in the day bar, also after an edit", async (t) => {
    const weekData = withSlot(blankWeek(), "mon", "lunch", [{ recipeId: "soup", servings: 1 }]);
    await openWeek(t, { weekData, recipes: [{ id: "soup", name: "Soup", archived: false }] });
    const dayButton = (day) => page.document.querySelector(`#day-bar button[data-day="${day}"]`);
    assert.equal(dayButton("mon").hasAttribute("data-planned"), true);
    assert.equal(dayButton("tue").hasAttribute("data-planned"), false);

    const save = await addWithEditor(page, server, "tue", "dinner", "soup");

    assert.equal(dayButton("tue").hasAttribute("data-planned"), true);
    // Answer the save: a request that stays open times out in 5 seconds, and
    // logs an error in whichever test runs then.
    save.respond(200, { items: [{ recipeId: "soup", servings: 1 }] });
    await tick();
  });

  test("counts the active recipes and ingredients in the sidebar", async (t) => {
    await openWeek(t, {
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

  test("shows Unknown recipe for a menu item whose recipe is gone", async (t) => {
    const weekData = withSlot(blankWeek(), "mon", "lunch", [{ recipeId: "gone", servings: 2 }]);
    await openWeek(t, { weekData, recipes: [] });

    assert.deepEqual(slotItems("mon", "lunch"), [["Unknown recipe", "×2"]]);
  });

  test("keeps the shown week in sync with the hash", async (t) => {
    await openWeek(t);
    assert.equal(page.document.getElementById("grid").dataset.week, WEEK);
    assert.equal(page.window.location.hash, `#${WEEK}`);

    const nextWeek = "2026-09-28";
    page.window.location.hash = `#${nextWeek}`; // a real hash edit, as in the address bar
    await waitFor(() => server.requestFor("GET", `/api/weeks/${nextWeek}`) !== undefined);
    server.requestFor("GET", `/api/weeks/${nextWeek}`).respond(200, blankWeek());
    server.requestFor("GET", "/api/recipes").respond(200, { recipes: [] });
    server.requestFor("GET", "/api/ingredients").respond(200, { ingredients: [] });
    await tick();

    assert.equal(page.document.getElementById("grid").dataset.week, nextWeek);
    assert.equal(page.window.location.hash, `#${nextWeek}`);
  });

  test("ends on the last week after five changes with answers in any order", async (t) => {
    await openWeek(t); // the recipe book is empty until the first week change loads it

    const weeksWithTheMenu = await tapNextWeekFiveTimes();

    const grid = page.document.getElementById("grid");
    assert.equal(grid.dataset.week, LAST_WEEK);
    assert.equal(
      page.document.querySelector('.day-header[data-day="sun"] .day-number').textContent,
      "1",
    );
    assert.deepEqual(slotItems("mon", "lunch"), []);
    assert.deepEqual([...weeksWithTheMenu], [MENU_WEEK], "the weeks that showed the menu");
  });

  test("ignores taps on Next week while a week loads", async (t) => {
    await openWeek(t);
    const next = page.document.getElementById("next-week");

    next.click();
    next.click();
    next.click();
    await tick();

    const weekUrls = server.requests
      .map((request) => request.url)
      .filter((url) => url.startsWith("/api/weeks/") && url !== `/api/weeks/${WEEK}`);
    assert.deepEqual(weekUrls, ["/api/weeks/2026-09-28"]);
    await answerWeekLoad(server, "2026-09-28");
  });

  test("marks the week range and the save announcement as polite live regions", async (t) => {
    await openWeek(t);

    for (const id of ["week-range", "save-announcement"]) {
      assert.equal(page.document.getElementById(id).getAttribute("aria-live"), "polite", id);
    }
  });

  test("opens the editor on the menu of a slot whose save failed", async (t) => {
    quiet.expect(1);
    await openWeekWithUnsavedLunch(t);

    slotButton(page, "mon", "lunch").click();

    const editor = page.document.getElementById("slot-editor");
    const names = () =>
      [...editor.querySelectorAll(".menu-item .recipe-name")].map((name) => name.textContent);
    assert.deepEqual(names(), ["Soup", "Salad"]);

    editor.querySelector(".cancel").click();

    assert.deepEqual(slotItems("mon", "lunch"), [
      ["Soup", "×1"],
      ["Salad", "×1"],
    ]);
  });

  test("changes weeks without asking while the week can't load", async (t) => {
    await openWeek(t);
    const alert = page.document.getElementById("leave-alert");
    const loadError = page.document.getElementById("load-error");
    const answered = new Set(server.requests);
    let failures = 0;

    // Presses `button`, and answers the requests that the week change sends
    // until it ends. The week fails when `fails` is true. happy-dom's
    // replaceState fires a hashchange that sends one more request.
    const change = async (button, fails) => {
      page.document.getElementById(button).click();
      for (let rounds = 0; rounds < 4; rounds += 1) {
        await tick();
        for (const request of server.requests.filter((entry) => !answered.has(entry))) {
          answered.add(request);
          if (!request.url.startsWith("/api/weeks/")) {
            request.respond(
              200,
              request.url === "/api/recipes" ? { recipes: [] } : { ingredients: [] },
            );
          } else if (fails) {
            failures += 1;
            request.fail();
          } else {
            request.respond(200, blankWeek());
          }
        }
      }
      assert.equal(page.document.getElementById("next-week").disabled, false, "the change ended");
    };

    await change("next-week", true);
    assert.equal(loadError.hidden, false);
    assert.equal(page.window.location.hash, "#2026-09-28");

    await change("previous-week", true);
    assert.equal(loadError.hidden, false);
    assert.equal(page.window.location.hash, `#${WEEK}`);

    await change("next-week", true);
    assert.equal(loadError.hidden, false);
    assert.equal(page.window.location.hash, "#2026-09-28");
    assert.equal(alert.open, false);

    await change("retry-load", false);
    assert.equal(loadError.hidden, true);
    assert.equal(page.document.getElementById("grid").dataset.week, "2026-09-28");
    assert.equal(failures, 6, "two failed loads for each of the three failed week changes");
    quiet.expect(failures);
  });

  test("shows each menu item with its servings", async (t) => {
    await openLoadedWeek(t);

    assert.deepEqual(slotItems("mon", "lunch"), [
      ["Soup", "×1"],
      ["Salad", "×1.5"],
    ]);
  });

  test("labels a slot with its items, or empty when it has none", async (t) => {
    await openLoadedWeek(t);

    assert.equal(
      slotButton(page, "mon", "lunch").getAttribute("aria-label"),
      "Monday, Lunch: Soup × 1, Salad × 1.5",
    );
    assert.equal(
      slotButton(page, "mon", "breakfast").getAttribute("aria-label"),
      "Monday, Breakfast: empty",
    );
  });

  test("marks a slot without items as empty", async (t) => {
    await openLoadedWeek(t);

    assert.deepEqual(slotItems("mon", "breakfast"), []);
    assert.equal(
      slotButton(page, "mon", "breakfast").closest(".slot").hasAttribute("data-empty"),
      true,
    );
    assert.equal(
      slotButton(page, "mon", "lunch").closest(".slot").hasAttribute("data-empty"),
      false,
    );
  });

  test("shows Add in every slot", async (t) => {
    await openLoadedWeek(t);

    for (const day of DAYS) {
      for (const meal of MEALS) {
        assert.equal(
          slotButton(page, day, meal).querySelector(".slot-add").textContent.trim(),
          "Add",
          `${day} ${meal}`,
        );
      }
    }
  });

  test("shows Saving… and then All changes saved in the toolbar", async (t) => {
    await openWeek(t, { recipes: [{ id: "soup", name: "Soup", archived: false }] });
    assert.deepEqual(saveSummaries(), ["", ""]);

    const save = await addWithEditor(page, server, "mon", "lunch", "soup");
    assert.deepEqual(saveSummaries(), ["Saving…", "Saving…"]);

    save.respond(200, { items: [{ recipeId: "soup", servings: 1 }] });
    await tick();
    assert.deepEqual(saveSummaries(), ["All changes saved", "All changes saved"]);
  });

  test("announces a save while it runs and when it ends", async (t) => {
    await openWeek(t, { recipes: [{ id: "soup", name: "Soup", archived: false }] });

    const save = await addWithEditor(page, server, "mon", "lunch", "soup");
    assert.equal(announcement(), "Saving Monday lunch");

    save.respond(200, { items: [{ recipeId: "soup", servings: 1 }] });
    await tick();
    assert.equal(announcement(), "Saved Monday lunch");
  });

  test("shows Retry on the slot and in the toolbar after a failed save", async (t) => {
    await openWeekWithFailedSave(t);

    const status = slotButton(page, "mon", "lunch").closest(".slot").querySelector(".status");
    assert.equal(status.dataset.state, "error");
    assert.equal(status.textContent.trim(), "Retry");
    assert.deepEqual(saveSummaries(), ["1 not saved · Retry", "1 not saved · Retry"]);
  });

  test("marks the day in the header and the day bar after a failed save", async (t) => {
    await openWeekWithFailedSave(t);

    assert.equal(
      page.document.querySelector('.day-header[data-day="mon"]').hasAttribute("data-failed"),
      true,
    );
    assert.equal(
      page.document.querySelector('#day-bar button[data-day="mon"]').hasAttribute("data-failed"),
      true,
    );
  });

  test("announces a failed save", async (t) => {
    await openWeekWithFailedSave(t);

    assert.equal(announcement(), "Couldn't save Monday lunch");
  });

  test("saves the slot again with Retry in the toolbar", async (t) => {
    await openWeekWithFailedSave(t);

    page.document.querySelector(".save-summary button").click();
    await tick();

    const puts = server.requests.filter(
      (request) => request.method === "PUT" && request.url === `/api/weeks/${WEEK}/mon/lunch`,
    );
    assert.equal(puts.length, 2, "the failed save and the retry");
    assert.deepEqual(saveSummaries(), ["Saving…", "Saving…"]);
    puts[1].respond(200, { items: [{ recipeId: "soup", servings: 1 }] });
    await tick();
  });

  test("opens an alert that names the unsaved meal when leaving a week", async (t) => {
    quiet.expect(1);
    await openWeekWithUnsavedLunch(t);

    const alert = await leaveForNextWeek();

    // messages.test.js pins the words. The page picks the meals and the place.
    assert.equal(alert.getAttribute("role"), "alertdialog");
    assert.equal(alert.querySelector(".alert-title").textContent, unsavedTitle(1));
    assert.equal(
      alert.querySelector(".alert-message").textContent,
      unsavedMessage(["Monday lunch"], "this week"),
    );
  });

  test("focuses Stay in the alert that asks before leaving a week", async (t) => {
    quiet.expect(1);
    await openWeekWithUnsavedLunch(t);

    const alert = await leaveForNextWeek();

    assertFocus(page.document, alert.querySelector(".stay"));
  });

  test("asks before opening another page with an unsaved slot", async (t) => {
    quiet.expect(1);
    await openWeekWithUnsavedLunch(t);
    const alert = page.document.getElementById("leave-alert");

    const event = clickRecipesLink();
    await waitFor(() => alert.open);

    assert.equal(event.defaultPrevented, true);
    assert.equal(
      alert.querySelector(".alert-message").textContent,
      unsavedMessage(["Monday lunch"], "this page"),
    );
  });

  test("keeps the unsaved menu with Stay when leaving for another page", async (t) => {
    quiet.expect(1);
    await openWeekWithUnsavedLunch(t);
    const alert = page.document.getElementById("leave-alert");
    clickRecipesLink();
    await waitFor(() => alert.open);

    alert.querySelector(".stay").click();
    await tick();

    assert.equal(page.window.location.pathname, "/");
    assert.deepEqual(slotItems("mon", "lunch"), [
      ["Soup", "×1"],
      ["Salad", "×1"],
    ]);
  });

  test("keeps the week and its unsaved menu with Stay when leaving a week", async (t) => {
    quiet.expect(1);
    await openWeekWithUnsavedLunch(t);
    const alert = await leaveForNextWeek();

    alert.querySelector(".stay").click();
    await tick();

    assert.equal(alert.open, false);
    assert.equal(page.document.getElementById("grid").dataset.week, WEEK);
    assert.deepEqual(slotItems("mon", "lunch"), [
      ["Soup", "×1"],
      ["Salad", "×1"],
    ]);
    const status = slotButton(page, "mon", "lunch").closest(".slot").querySelector(".status");
    assert.equal(status.dataset.state, "error", "the slot still offers Retry");
    // Stay must stop goToWeek before it ever asks the server for the next
    // week, not just leave the request unanswered.
    assert.equal(
      server.requestFor("GET", (url) => url.includes("2026-09-28")),
      undefined,
    );
  });

  test("stays in the week with Escape in the alert", async (t) => {
    quiet.expect(1);
    await openWeekWithUnsavedLunch(t);
    const alert = await leaveForNextWeek();

    alert.close(); // what Escape and Android's Back do to a modal dialog
    await tick();

    assert.equal(page.document.getElementById("grid").dataset.week, WEEK);
    assert.equal(
      server.requestFor("GET", (url) => url.includes("2026-09-28")),
      undefined,
    );
  });

  test("undoes a hash change while the alert asks", async (t) => {
    quiet.expect(1);
    await openWeekWithUnsavedLunch(t);
    const alert = await leaveForNextWeek();

    page.window.location.hash = "#2026-10-05";
    await tick();

    assert.equal(page.window.location.hash, `#${WEEK}`);
    alert.querySelector(".stay").click();
    await tick();
    assert.equal(page.window.location.hash, `#${WEEK}`);
  });

  test("reverts the menu, then opens the next week, with Leave Without Saving", async (t) => {
    quiet.expect(1);
    await openWeekWithUnsavedLunch(t);
    const alert = await leaveForNextWeek();

    alert.querySelector(".leave").click();
    // Paused right before the new week's data arrives: the old grid still shows
    // the reverted (saved) menu for the week being left.
    await waitFor(() => server.requestFor("GET", "/api/weeks/2026-09-28") !== undefined);

    assert.equal(alert.open, false);
    assert.equal(page.document.getElementById("grid").dataset.week, WEEK);
    assert.deepEqual(slotItems("mon", "lunch"), [["Soup", "×1"]]);

    server.requestFor("GET", "/api/weeks/2026-09-28").respond(200, blankWeek());
    server.requestFor("GET", "/api/recipes").respond(200, { recipes: [] });
    server.requestFor("GET", "/api/ingredients").respond(200, { ingredients: [] });
    await tick();
    assert.equal(page.document.getElementById("grid").dataset.week, "2026-09-28");
  });

  test("opens a slot in an editor titled with its meal, under the day and date", async (t) => {
    await openWeek(t);

    slotButton(page, "wed", "snack_pm").click();

    const editor = page.document.getElementById("slot-editor");
    assert.equal(editor.querySelector(".dialog-title").textContent, "Afternoon snack");
    assert.equal(editor.querySelector(".sheet-subtitle").textContent, "Wednesday, Sep 23");
  });

  test("undoes a hash change while the editor is open", async (t) => {
    await openWeek(t);
    slotButton(page, "mon", "lunch").click();
    assert.equal(page.document.getElementById("slot-editor").open, true);

    page.window.location.hash = "#2026-09-28";
    await waitFor(() => page.window.location.hash === `#${WEEK}`); // undone

    assert.equal(page.window.location.hash, `#${WEEK}`); // undone
    assert.equal(page.document.getElementById("slot-editor").open, true); // still open
    assert.equal(page.document.getElementById("grid").dataset.week, WEEK); // week unchanged
  });

  test("calls preventDefault() on beforeunload only with editor changes", async (t) => {
    await openWeek(t, {
      weekData: blankWeek(),
      recipes: [{ id: "soup", name: "Soup", archived: false }],
    });
    slotButton(page, "mon", "lunch").click();

    assert.equal(dispatchBeforeUnload(page.window).defaultPrevented, false); // no changes yet

    typeInto(page.window, page.document.querySelector(".option-search"), "soup");
    page.document.querySelector("#slot-editor .option").click();

    assert.equal(dispatchBeforeUnload(page.window).defaultPrevented, true); // has changes, still open

    page.document.querySelector(".cancel").click(); // discards and closes
    assert.equal(dispatchBeforeUnload(page.window).defaultPrevented, false); // closed again
  });

  test("calls preventDefault() on beforeunload while a slot isn't confirmed", async (t) => {
    quiet.expect(1);
    await openWeek(t, { recipes: [{ id: "soup", name: "Soup", archived: false }] });

    const save = await addWithEditor(page, server, "mon", "lunch", "soup");
    assert.equal(dispatchBeforeUnload(page.window).defaultPrevented, true, "the save is running");

    save.fail();
    await tick();
    assert.equal(dispatchBeforeUnload(page.window).defaultPrevented, true, "the save failed");

    page.document.querySelector(".save-summary button").click(); // Retry
    await tick();
    const puts = server.requests.filter((request) => request.method === "PUT");
    assert.equal(puts.length, 2);
    puts[1].respond(200, {});
    await tick();
    assert.equal(
      dispatchBeforeUnload(page.window).defaultPrevented,
      false,
      "the server confirmed the menu",
    );
  });

  test("leaves a click with a modifier key or another button to the browser", async (t) => {
    quiet.expect(1);
    await openWeekWithUnsavedLunch(t);
    const alert = page.document.getElementById("leave-alert");

    for (const [click, init] of [
      ["Ctrl-click", { ctrlKey: true }],
      ["Meta-click", { metaKey: true }],
      ["Shift-click", { shiftKey: true }],
      ["Alt-click", { altKey: true }],
      ["middle click", { button: 1 }],
    ]) {
      assert.equal(clickRecipesLink(init).defaultPrevented, false, `${click} keeps the default`);
    }
    await tick();
    assert.equal(alert.open, false);
  });

  test("schedules the saved badge's timer on the page's window", async (t) => {
    await openWeek(t, { recipes: [{ id: "soup", name: "Soup", archived: false }] });
    const windowSetTimeout = mock.method(page.window, "setTimeout");
    const save = await addWithEditor(page, server, "mon", "lunch", "soup");

    save.respond(200, {
      week: WEEK,
      day: "mon",
      meal: "lunch",
      items: [{ recipeId: "soup", servings: 1 }],
    });
    await tick(); // the slot now shows "saved" and has scheduled the badge's timer

    const status = slotButton(page, "mon", "lunch").closest(".slot").querySelector(".status");
    assert.equal(status.dataset.state, "saved");
    const delays = windowSetTimeout.mock.calls.map((call) => call.arguments[1]);
    assert.ok(
      delays.includes(SAVED_BADGE_MS),
      `window.setTimeout got the delays ${JSON.stringify(delays)}, none of ${SAVED_BADGE_MS} ms: ` +
        "a timer from the bare setTimeout isn't tied to the page's window, so it would survive " +
        "the page's close and later run against a torn-down DOM",
    );
  });

  test("reloads with Retry after a failed load", async (t) => {
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

    assert.equal(page.document.getElementById("load-error").hidden, false);
    assert.equal(page.document.getElementById("grid").hidden, true);

    page.document.getElementById("retry-load").click();
    await waitFor(
      () => server.requests.filter((request) => request.url === `/api/weeks/${WEEK}`).length === 2,
    );
    const weekRequests = server.requests.filter((request) => request.url === `/api/weeks/${WEEK}`);
    assert.equal(weekRequests.length, 2, "Retry sends a new request");
    weekRequests[1].respond(200, blankWeek());
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

  test("loads the ingredient catalog again with every week", async (t) => {
    await openWeek(t);

    page.document.getElementById("next-week").click();
    await waitFor(
      () => server.requests.filter((request) => request.url === "/api/ingredients").length === 2,
    );

    server.requestFor("GET", "/api/weeks/2026-09-28").respond(200, blankWeek());
    server.requestFor("GET", "/api/recipes").respond(200, { recipes: [] });
    server.requestFor("GET", "/api/ingredients").respond(200, { ingredients: [] });
    await tick();
    assert.equal(page.document.getElementById("grid").dataset.week, "2026-09-28");
  });
});
