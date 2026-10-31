// Meal plan page. Depends ONLY on the HTTP API (/api/weeks, /api/recipes, and
// /api/ingredients); never import from server/.

import {
  addDays,
  addWeeks,
  dayIndex,
  formatFullDate,
  formatLongDate,
  formatShortWeekRange,
  formatWeekRange,
  isWeekId,
  weekIdOf,
  weekStart,
} from "./dates.js";
import { createElement, withLoadState } from "./dom.js";
import { getJson, REQUEST_TIMEOUT_MS } from "./http.js";
import { describeItem } from "./menus.js";
import { unsavedMessage, unsavedTitle } from "./messages.js";
import { createSaves } from "./saves.js";
import { setUpShell, showCounts } from "./shell.js";
import { createShoppingDialog } from "./shopping-dialog.js";
import { shoppingList } from "./shopping-list.js";
import { createSlotEditor } from "./slot-editor.js";

const DAYS = [
  { id: "mon", label: "Monday", short: "M" },
  { id: "tue", label: "Tuesday", short: "T" },
  { id: "wed", label: "Wednesday", short: "W" },
  { id: "thu", label: "Thursday", short: "T" },
  { id: "fri", label: "Friday", short: "F" },
  { id: "sat", label: "Saturday", short: "S" },
  { id: "sun", label: "Sunday", short: "S" },
];

const MEALS = [
  { id: "breakfast", label: "Breakfast" },
  { id: "snack_am", label: "Morning snack" },
  { id: "lunch", label: "Lunch" },
  { id: "snack_pm", label: "Afternoon snack" },
  { id: "dinner", label: "Dinner" },
];

const SAVED_BADGE_MS = 3000; // how long a slot counts as just saved

// Monochrome line icons drawn with currentColor, so CSS sets each one's color.
const ICON_PATHS = {
  add: '<path d="M12 5v14M5 12h14"/>',
  saving: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  saved: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  error: '<path d="M12 5v9M12 19h.01"/>',
};
// What a slot whose save failed says: a Retry button.
const RETRY_LABEL = "Couldn't save. Select to retry.";
// What the live region says when a slot, such as "Monday lunch", changes state.
const ANNOUNCEMENT = {
  saving: (slot) => `Saving ${slot}`,
  saved: (slot) => `Saved ${slot}`,
  error: (slot) => `Couldn't save ${slot}`,
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICON_PATHS[name]}</svg>`;
}

// An element with `name`'s icon, followed by `text`.
function withIcon(tag, className, name, text) {
  const element = createElement(tag, className);
  element.innerHTML = icon(name); // static markup, never user text
  element.append(text);
  return element;
}

const grid = document.getElementById("grid");
const dayBar = document.getElementById("day-bar");
const dayHeading = document.getElementById("day-heading");
const loadError = document.getElementById("load-error");
const retryLoadButton = document.getElementById("retry-load");
const weekBar = document.getElementById("week-bar");
const weekRange = document.getElementById("week-range");
const weekShort = document.getElementById("week-short");
const saveSummaries = document.querySelectorAll(".save-summary");
const saveAnnouncement = document.getElementById("save-announcement");
const leaveAlert = document.getElementById("leave-alert");
const editor = createSlotEditor(document.getElementById("slot-editor"));
const shopping = createShoppingDialog(document.getElementById("shopping-dialog"));
const shoppingButton = document.getElementById("shopping-list");

/** Timer that hides the "✓" badge, per slot element: it acts on what is on screen, whatever the week. */
const savedTimers = new Map();
/** The menu of each slot of the loaded week, by slot key. Saves send these. */
const menus = new Map();
/** The recipe book as last loaded, by recipe ID. */
let recipesById = new Map();
/** The ingredient catalog as last loaded. */
let ingredients = [];

/** The week in the URL hash and the range label. Retry loads it again. */
let requestedWeek;
/** True while a week change runs, so two changes never overlap. */
let changingWeek = false;
/** True when the user chose Leave Without Saving in the open leave alert. */
let leaveChosen = false;
/** The day headers and the day bar buttons, which mark a day with a slot that wasn't saved. */
let failedMarks = [];

// Keys include the week, so the same slot in two weeks never shares save state.
function slotKey(week, day, meal) {
  return `${week}/${day}/${meal}`;
}

// The slot element of `key`, or null when its week isn't on screen.
function slotOf(key) {
  const [week, day, meal] = key.split("/");
  if (week !== grid.dataset.week) return null;
  return grid.querySelector(`.slot[data-day="${day}"][data-meal="${meal}"]`);
}

const saves = createSaves({
  fetch: (url, options) => fetch(url, options),
  url: (key) => `/api/weeks/${key}`,
  readMenu: (key) => menus.get(key),
  onStatus: (key, state) => {
    const slot = slotOf(key);
    if (!slot) return;
    setStatus(slot, state);
    if (state in ANNOUNCEMENT) saveAnnouncement.textContent = ANNOUNCEMENT[state](slotName(key));
  },
  timeoutMs: REQUEST_TIMEOUT_MS,
});

function todayId() {
  return DAYS[dayIndex(new Date())].id;
}

function buildDayBar() {
  for (const day of DAYS) {
    const button = createElement("button");
    // The day number is filled in when a week loads. The dot marks a day with
    // menu items, or with a slot that wasn't saved.
    const dot = createElement("span", "day-dot");
    dot.setAttribute("aria-hidden", "true");
    button.append(
      createElement("span", "day-letter", day.short),
      createElement("span", "day-number"),
      dot,
    );
    button.type = "button";
    button.dataset.day = day.id;
    button.setAttribute("aria-label", day.label);
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => selectDay(day.id));
    dayBar.append(button);
  }
}

// DOM order = CSS grid order on wide screens: 7 day headers, then for each
// meal a meal header, as wide as the grid, followed by its 7 slots.
function buildGrid() {
  for (const day of DAYS) {
    const header = createElement("div", "day-header");
    header.dataset.day = day.id;
    // The day number is filled in when a week loads.
    const failed = createElement("span", "failed-dot");
    failed.title = "A meal this day wasn't saved";
    header.append(
      createElement("span", "day-name", day.label.slice(0, 3)),
      createElement("span", "day-number"),
      failed,
    );
    grid.append(header);
  }
  for (const meal of MEALS) {
    const header = createElement("div", "meal-header", meal.label);
    header.dataset.meal = meal.id;
    grid.append(header);
    for (const day of DAYS) grid.append(buildSlot(day, meal));
  }
}

function buildSlot(day, meal) {
  const slot = createElement("div", "slot");
  slot.dataset.day = day.id;
  slot.dataset.meal = meal.id;

  // Visible only on mobile, where the meal header column is hidden. The
  // button's accessible name already says the meal.
  const label = createElement("span", "slot-label", meal.label);
  label.setAttribute("aria-hidden", "true");

  const menuButton = createElement("button", "slot-menu");
  menuButton.type = "button";
  menuButton.addEventListener("click", () => openEditor(slot));

  // Shows only after a failed save, as a Retry button. The save summary in
  // the toolbar and the live region tell about the other states.
  const status = createElement("button", "status");
  status.type = "button";
  status.disabled = true;
  status.dataset.state = "idle";
  // Only clickable in "error".
  status.addEventListener("click", () =>
    saves.queueSave(slotKey(grid.dataset.week, day.id, meal.id)),
  );

  slot.append(label, menuButton, status);
  return slot;
}

function recipeName(recipeId) {
  return recipesById.get(recipeId)?.name ?? "Unknown recipe";
}

// Shows `menu` in the slot, one menu item per line with its servings, then
// Add, which wide screens show only in an empty slot.
function renderSlot(slot, menu) {
  const day = DAYS.find((entry) => entry.id === slot.dataset.day);
  const meal = MEALS.find((entry) => entry.id === slot.dataset.meal);
  const items = menu.items.map((item) => {
    const line = createElement("span", "item");
    line.append(
      createElement("span", "item-name", recipeName(item.recipeId)),
      createElement("span", "item-servings", `×${item.servings}`),
    );
    return line;
  });
  slot
    .querySelector(".slot-menu")
    .replaceChildren(...items, withIcon("span", "slot-add", "add", "Add"));
  slot.toggleAttribute("data-empty", items.length === 0);
  const lines = menu.items.map((item) => describeItem(recipeName(item.recipeId), item.servings));
  const content = lines.length === 0 ? "empty" : lines.join(", ");
  slot
    .querySelector(".slot-menu")
    .setAttribute("aria-label", `${day.label}, ${meal.label}: ${content}`);
}

// Marks the days of the day bar that have menu items.
function markPlannedDays() {
  const { week } = grid.dataset;
  for (const day of DAYS) {
    const planned = MEALS.some(
      (meal) => menus.get(slotKey(week, day.id, meal.id))?.items.length > 0,
    );
    dayBar.querySelector(`button[data-day="${day.id}"]`).toggleAttribute("data-planned", planned);
  }
}

// Opens the editor on the slot's menu. That is the menu confirmed with Done,
// even when its save failed, so a retry from the editor keeps the changes.
function openEditor(slot) {
  const { week } = grid.dataset;
  const { day, meal } = slot.dataset;
  const key = slotKey(week, day, meal);
  const dayIndexInWeek = DAYS.findIndex((entry) => entry.id === day);
  const mealLabel = MEALS.find((entry) => entry.id === meal).label;
  editor.open({
    title: `${formatLongDate(addDays(weekStart(week), dayIndexInWeek))} · ${mealLabel}`,
    menu: menus.get(key),
    recipes: [...recipesById.values()],
    opener: slot.querySelector(".slot-menu"),
    onDone: (menu) => {
      menus.set(key, menu);
      renderSlot(slot, menu);
      markPlannedDays();
      saves.queueSave(key);
    },
  });
}

// For example, "Mon dinner".
function slotLabel({ day, meal }) {
  const dayLabel = DAYS.find((entry) => entry.id === day).label.slice(0, 3);
  return `${dayLabel} ${MEALS.find((entry) => entry.id === meal).label.toLowerCase()}`;
}

// The slot of `key`, such as "Monday lunch".
function slotName(key) {
  const [, day, meal] = key.split("/");
  const dayLabel = DAYS.find((entry) => entry.id === day).label;
  return `${dayLabel} ${MEALS.find((entry) => entry.id === meal).label.toLowerCase()}`;
}

// Opens the shopping list of the week on screen. It counts the menus that
// the grid shows, including slots that are saving or whose save failed.
function openShoppingList() {
  const { week } = grid.dataset;
  if (grid.hidden || week === undefined) return;
  const slots = DAYS.flatMap((day) =>
    MEALS.map((meal) => ({
      day: day.id,
      meal: meal.id,
      menu: menus.get(slotKey(week, day.id, meal.id)),
    })),
  );
  shopping.open({
    title: `Shopping list · ${formatWeekRange(week)}`,
    list: shoppingList(slots, [...recipesById.values()], ingredients),
    isEmpty: slots.every((slot) => slot.menu.items.length === 0),
    slotLabel,
    opener: shoppingButton,
  });
}

function selectDay(dayId) {
  grid.dataset.selectedDay = dayId;
  for (const button of dayBar.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.day === dayId));
  }
  showDayHeading();
}

// Names the selected day and its date above the day bar, and marks today.
function showDayHeading() {
  const { week, selectedDay } = grid.dataset;
  if (week === undefined) return; // no week loaded yet
  const index = DAYS.findIndex((day) => day.id === selectedDay);
  const date = addDays(weekStart(week), index);
  dayHeading.querySelector(".day-title").textContent = DAYS[index].label;
  dayHeading.querySelector(".day-date").textContent = formatFullDate(date);
  dayHeading.querySelector(".today-mark").hidden =
    week !== weekIdOf(new Date()) || selectedDay !== todayId();
}

function fillWeek(week, weekData) {
  grid.dataset.week = week;
  menus.clear();
  const entries = [];
  for (const slot of grid.querySelectorAll(".slot")) {
    const { day, meal } = slot.dataset;
    const key = slotKey(week, day, meal);
    const menu = weekData[day][meal];
    menus.set(key, menu);
    renderSlot(slot, menu);
    entries.push([key, menu]);
  }
  markPlannedDays();
  // Sets every status to idle, which also clears a pending "saved" timer from
  // the previous week.
  saves.loaded(entries);
}

// Puts the day of the month on the day headers and the day bar.
function showDayDates(week) {
  const monday = weekStart(week);
  for (const [index, day] of DAYS.entries()) {
    const date = addDays(monday, index);
    grid.querySelector(`.day-header[data-day="${day.id}"] .day-number`).textContent = String(
      date.getDate(),
    );
    const button = dayBar.querySelector(`button[data-day="${day.id}"]`);
    button.querySelector(".day-number").textContent = String(date.getDate());
    button.setAttribute("aria-label", formatLongDate(date));
  }
}

// Marks today's header, slots, and day bar button when the loaded week contains today.
function markToday() {
  const todayDay = weekIdOf(new Date()) === grid.dataset.week ? todayId() : null;
  for (const element of document.querySelectorAll("[data-day]")) {
    element.toggleAttribute("data-today", element.dataset.day === todayDay);
  }
  // Wide screens shade today's column, from its header to its last slot.
  if (todayDay) grid.dataset.todayColumn = todayDay;
  else delete grid.dataset.todayColumn;
  showDayHeading();
}

// The keys of the slots on screen.
function shownKeys() {
  const { week } = grid.dataset;
  return [...grid.querySelectorAll(".slot")].map((slot) =>
    slotKey(week, slot.dataset.day, slot.dataset.meal),
  );
}

// Shows a slot's save status. The status itself comes from saves.js.
// window.setTimeout/clearTimeout (rather than the bare globals), so that
// tests that close their page mid-badge never run this callback against a
// torn-down DOM.
function setStatus(slot, state) {
  window.clearTimeout(savedTimers.get(slot));

  const status = slot.querySelector(".status");
  status.dataset.state = state;
  status.disabled = state !== "error";
  if (state === "error") {
    status.replaceChildren(withIcon("span", "retry", "error", "Retry"));
    status.setAttribute("aria-label", RETRY_LABEL);
    status.title = RETRY_LABEL;
  } else {
    status.replaceChildren();
    status.removeAttribute("aria-label");
    status.removeAttribute("title");
  }

  if (state === "saved") {
    savedTimers.set(
      slot,
      window.setTimeout(() => setStatus(slot, "idle"), SAVED_BADGE_MS),
    );
  }
  showWeekStatus();
}

// Shows what the statuses of the slots add up to. It runs after every status
// change, 35 times when a week loads, so it reads the statuses in one pass.
function showWeekStatus() {
  const count = { idle: 0, saving: 0, saved: 0, error: 0 };
  const failedDays = new Set();
  for (const status of grid.querySelectorAll(".status")) {
    const { state } = status.dataset;
    count[state] += 1;
    if (state === "error") failedDays.add(status.parentElement.dataset.day);
  }
  markFailedDays(failedDays);
  showSaveSummary(count);
}

// Marks the day headers and the day bar buttons of the days in `failedDays`,
// which have a slot that wasn't saved.
function markFailedDays(failedDays) {
  for (const element of failedMarks) {
    element.toggleAttribute("data-failed", failedDays.has(element.dataset.day));
  }
}

// Says in the toolbar, and above the day bar on phones, whether the week is
// saving, has slots that weren't saved, or has just saved everything, from
// the `count` of slots in each state. The slots that weren't saved come with
// a Retry button for all of them.
function showSaveSummary(count) {
  for (const summary of saveSummaries) {
    if (count.saving > 0) {
      summary.replaceChildren(withIcon("span", "save-state", "saving", "Saving…"));
    } else if (count.error > 0) {
      const retry = withIcon("button", "save-state", "error", `${count.error} not saved · Retry`);
      retry.type = "button";
      retry.dataset.state = "error";
      retry.addEventListener("click", retryFailedSlots);
      summary.replaceChildren(retry);
    } else if (count.saved > 0) {
      const saved = withIcon("span", "save-state", "saved", "All changes saved");
      saved.dataset.state = "saved";
      summary.replaceChildren(saved);
    } else {
      summary.replaceChildren();
    }
  }
}

function retryFailedSlots() {
  const { week } = grid.dataset;
  for (const slot of grid.querySelectorAll('.slot:has(.status[data-state="error"])')) {
    saves.queueSave(slotKey(week, slot.dataset.day, slot.dataset.meal));
  }
}

async function loadWeek(week) {
  await withLoadState({
    loadError,
    retryButton: retryLoadButton,
    content: [dayHeading, dayBar, grid],
    errorMessage: "Couldn't load the meal plan:",
    run: async () => {
      // The recipe book and the ingredient catalog load with every week, so
      // what the other pages add shows up without a reload.
      const [weekData, recipeBook, catalog] = await Promise.all([
        getJson(`/api/weeks/${week}`),
        getJson("/api/recipes"),
        getJson("/api/ingredients"),
      ]);
      recipesById = new Map(recipeBook.recipes.map((recipe) => [recipe.id, recipe]));
      ingredients = catalog.ingredients;
      showCounts({ recipes: recipeBook.recipes, ingredients });
      fillWeek(week, weekData);
      showDayDates(week);
      markToday();
    },
  });
}

function syncHash() {
  // replaceState adds no history entry, so Back doesn't step through weeks.
  if (requestedWeek) history.replaceState(null, "", `#${requestedWeek}`);
}

function setChangingWeek(changing) {
  changingWeek = changing;
  for (const button of weekBar.querySelectorAll("button")) button.disabled = changing;
  // After a failed load, no week is shown, so there's no shopping list.
  shoppingButton.disabled = changing || grid.hidden;
  grid.inert = changing; // no editing a week that is being left
}

// Waits for pending saves, then returns true if the loaded week can be left:
// every slot is saved, or the user agreed to discard what couldn't be saved.
async function leaveLoadedWeek() {
  await saves.settle();
  const unsaved = saves.unsaved(shownKeys());
  if (unsaved.length === 0) return true;
  if (!(await askToLeave(unsaved))) return false;
  // Put the saved menu back, so no later page-hide save can send the
  // discarded menu.
  for (const key of unsaved) {
    const menu = saves.discard(key);
    menus.set(key, menu);
    renderSlot(slotOf(key), menu);
  }
  markPlannedDays();
  return true;
}

// Asks whether to leave the week although the slots of `keys` weren't saved,
// naming them day by day. Resolves to true for Leave Without Saving, and to
// false for Stay, Escape, or Android's Back.
function askToLeave(keys) {
  const order = (key) => {
    const [, day, meal] = key.split("/");
    return (
      DAYS.findIndex((entry) => entry.id === day) * MEALS.length +
      MEALS.findIndex((entry) => entry.id === meal)
    );
  };
  const names = [...keys].sort((a, b) => order(a) - order(b)).map(slotName);
  leaveAlert.querySelector(".alert-title").textContent = unsavedTitle(names.length);
  leaveAlert.querySelector(".alert-message").textContent = unsavedMessage(names);
  leaveChosen = false;
  return new Promise((resolve) => {
    leaveAlert.addEventListener("close", () => resolve(leaveChosen), { once: true });
    leaveAlert.showModal();
    // Stay, the choice that keeps the changes.
    leaveAlert.querySelector(".stay").focus();
  });
}

// Shows `week` without ever dropping an unsaved menu silently. On mobile, the
// selected day stays the same unless `selectToday` is set.
async function goToWeek(week, { selectToday = false } = {}) {
  if (changingWeek || editor.isOpen() || shopping.isOpen()) return;
  // Disabling the clicked button (a week bar button or Retry) moves focus to
  // <body>; remember it so it can be refocused afterward.
  const focused = document.activeElement;
  setChangingWeek(true);
  try {
    if (week !== grid.dataset.week || grid.hidden) {
      if (!(await leaveLoadedWeek())) return;
      requestedWeek = week;
      syncHash();
      weekRange.textContent = formatWeekRange(week);
      weekShort.textContent = formatShortWeekRange(week);
      await loadWeek(week);
    }
    if (selectToday) selectDay(todayId());
    markToday(); // covers the case where the target week was already shown
  } finally {
    setChangingWeek(false);
    // Only if focus was lost, not moved elsewhere by the user, and the button
    // is still shown (Retry hides after a successful load).
    const refocus = weekBar.contains(focused) || focused === retryLoadButton;
    if (refocus && document.activeElement === document.body && !focused.closest("[hidden]")) {
      focused.focus();
    }
    syncHash(); // also undoes a hash edit that was cancelled or ignored
  }
}

setUpShell();
buildDayBar();
buildGrid();
failedMarks = [...document.querySelectorAll(".day-header, #day-bar button")];
selectDay(todayId());
retryLoadButton.addEventListener("click", () => goToWeek(requestedWeek));
document
  .getElementById("previous-week")
  .addEventListener("click", () => goToWeek(addWeeks(requestedWeek, -1)));
document
  .getElementById("next-week")
  .addEventListener("click", () => goToWeek(addWeeks(requestedWeek, 1)));
document
  .getElementById("today")
  .addEventListener("click", () => goToWeek(weekIdOf(new Date()), { selectToday: true }));
shoppingButton.addEventListener("click", openShoppingList);
window.addEventListener("hashchange", () => {
  const week = location.hash.slice(1);
  // The week never changes behind an open dialog, or while it changes.
  if (isWeekId(week) && !changingWeek && !editor.isOpen() && !shopping.isOpen()) goToWeek(week);
  else syncHash();
});
leaveAlert.querySelector(".stay").addEventListener("click", () => leaveAlert.close());
leaveAlert.querySelector(".leave").addEventListener("click", () => {
  leaveChosen = true;
  leaveAlert.close();
});
window.addEventListener("pagehide", () => saves.flush(shownKeys(), { skipInFlight: false }));
// Unconfirmed changes in the editor would be lost: ask before leaving.
window.addEventListener("beforeunload", (event) => {
  if (!editor.hasChanges()) return;
  event.preventDefault();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saves.flush(shownKeys(), { skipInFlight: true });
  else markToday(); // the day may have changed while the page was hidden
});

const hashWeek = location.hash.slice(1);
goToWeek(isWeekId(hashWeek) ? hashWeek : weekIdOf(new Date()));
