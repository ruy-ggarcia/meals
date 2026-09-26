// Meal plan page. Depends ONLY on the HTTP API (/api/weeks and /api/recipes);
// never import from server/.

import {
  addDays,
  addWeeks,
  dayIndex,
  formatLongDate,
  formatWeekRange,
  isWeekId,
  weekIdOf,
  weekStart,
} from "./dates.js";
import { createElement } from "./dom.js";
import { getJson, REQUEST_TIMEOUT_MS } from "./http.js";
import { describeItem } from "./menus.js";
import { createSaves } from "./saves.js";
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

const SAVED_BADGE_MS = 3000; // how long the "saved" check mark stays visible
const UNSAVED_QUESTION =
  "Some changes in this week couldn't be saved. Leave anyway and discard them?";

// Monochrome line icons drawn with currentColor, so CSS sets each state's color.
const ICON_PATHS = {
  saving: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  saved: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  error: '<path d="M6 6l12 12M18 6L6 18"/>',
};
// Accessible name and tooltip for each icon.
const STATUS_LABEL = {
  saving: "Saving…",
  saved: "Saved",
  error: "Couldn't save. Click to retry",
};

function statusIcon(state) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICON_PATHS[state]}</svg>`;
}

const grid = document.getElementById("grid");
const dayBar = document.getElementById("day-bar");
const loadError = document.getElementById("load-error");
const retryLoadButton = document.getElementById("retry-load");
const weekBar = document.getElementById("week-bar");
const weekRange = document.getElementById("week-range");
const editor = createSlotEditor(document.getElementById("slot-editor"));

/** Timer that hides the "✓" badge, per slot element: it acts on what is on screen, whatever the week. */
const savedTimers = new Map();
/** The menu of each slot of the loaded week, by slot key. Saves send these. */
const menus = new Map();
/** The recipe book as last loaded, by recipe ID. */
let recipesById = new Map();

/** The week in the URL hash and the range label. Retry loads it again. */
let requestedWeek;
/** True while a week change runs, so two changes never overlap. */
let changingWeek = false;

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
    if (slot) setStatus(slot, state);
  },
  timeoutMs: REQUEST_TIMEOUT_MS,
});

function todayId() {
  return DAYS[dayIndex(new Date())].id;
}

function buildDayBar() {
  for (const day of DAYS) {
    const button = createElement("button");
    // The day number is filled in when a week loads.
    button.append(
      createElement("span", "day-letter", day.short),
      createElement("span", "day-number"),
    );
    button.type = "button";
    button.dataset.day = day.id;
    button.setAttribute("aria-label", day.label);
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => selectDay(day.id));
    dayBar.append(button);
  }
}

// DOM order = CSS grid order on desktop: corner, 7 day headers,
// then for each meal a meal header followed by its 7 slots.
function buildGrid() {
  grid.append(createElement("div", "corner"));
  for (const day of DAYS) {
    const header = createElement("div", "day-header", day.label);
    header.dataset.day = day.id;
    grid.append(header);
  }
  for (const meal of MEALS) {
    grid.append(createElement("div", "meal-header", meal.label));
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

  const status = createElement("button", "status");
  status.type = "button";
  status.disabled = true;
  status.dataset.state = "idle";
  status.setAttribute("aria-live", "polite");
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

// Shows `menu` in the slot, one menu item per line.
function renderSlot(slot, menu) {
  const day = DAYS.find((entry) => entry.id === slot.dataset.day);
  const meal = MEALS.find((entry) => entry.id === slot.dataset.meal);
  const lines = menu.items.map((item) => describeItem(recipeName(item.recipeId), item.servings));
  const button = slot.querySelector(".slot-menu");
  if (lines.length === 0) {
    button.replaceChildren(createElement("span", "slot-empty", "+ Add"));
  } else {
    button.replaceChildren(...lines.map((line) => createElement("span", undefined, line)));
  }
  const content = lines.length === 0 ? "empty" : lines.join(", ");
  button.setAttribute("aria-label", `${day.label}, ${meal.label}: ${content}`);
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
      saves.queueSave(key);
    },
  });
}

function selectDay(dayId) {
  grid.dataset.selectedDay = dayId;
  for (const button of dayBar.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.day === dayId));
  }
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
  // Sets every status to idle, which also clears a pending "✓" timer from the
  // previous week.
  saves.loaded(entries);
}

// Puts the day of the month on the desktop headers and the mobile day bar.
function showDayDates(week) {
  const monday = weekStart(week);
  for (const [index, day] of DAYS.entries()) {
    const date = addDays(monday, index);
    grid.querySelector(`.day-header[data-day="${day.id}"]`).textContent =
      `${day.label} ${date.getDate()}`;
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
}

// The keys of the slots on screen.
function shownKeys() {
  const { week } = grid.dataset;
  return [...grid.querySelectorAll(".slot")].map((slot) =>
    slotKey(week, slot.dataset.day, slot.dataset.meal),
  );
}

// Shows a slot's save status. The status itself comes from saves.js.
function setStatus(slot, state) {
  clearTimeout(savedTimers.get(slot));

  const status = slot.querySelector(".status");
  status.dataset.state = state;
  status.disabled = state !== "error";
  if (state === "idle") {
    status.replaceChildren();
    status.removeAttribute("aria-label");
    status.removeAttribute("title");
  } else {
    status.innerHTML = statusIcon(state); // static markup, never user text
    status.setAttribute("aria-label", STATUS_LABEL[state]);
    status.title = STATUS_LABEL[state];
  }

  if (state === "saved") {
    savedTimers.set(
      slot,
      setTimeout(() => setStatus(slot, "idle"), SAVED_BADGE_MS),
    );
  }
}

async function loadWeek(week) {
  loadError.hidden = true;
  retryLoadButton.disabled = true;
  try {
    // The recipe book loads with every week, so recipes added on the Recipes
    // page show up without a reload.
    const [weekData, recipeBook] = await Promise.all([
      getJson(`/api/weeks/${week}`),
      getJson("/api/recipes"),
    ]);
    recipesById = new Map(recipeBook.recipes.map((recipe) => [recipe.id, recipe]));
    fillWeek(week, weekData);
    showDayDates(week);
    markToday();
    dayBar.hidden = false;
    grid.hidden = false;
  } catch (error) {
    console.error("Couldn't load the meal plan:", error);
    dayBar.hidden = true;
    grid.hidden = true;
    loadError.hidden = false;
  } finally {
    retryLoadButton.disabled = false;
  }
}

function syncHash() {
  // replaceState adds no history entry, so Back doesn't step through weeks.
  if (requestedWeek) history.replaceState(null, "", `#${requestedWeek}`);
}

function setChangingWeek(changing) {
  changingWeek = changing;
  for (const button of weekBar.querySelectorAll("button")) button.disabled = changing;
  grid.inert = changing; // no editing a week that is being left
}

// Waits for pending saves, then returns true if the loaded week can be left:
// every slot is saved, or the user agreed to discard what couldn't be saved.
async function leaveLoadedWeek() {
  await saves.settle();
  const unsaved = saves.unsaved(shownKeys());
  if (unsaved.length === 0) return true;
  // Let the browser paint the red crosses first: confirm() blocks painting.
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
  if (!window.confirm(UNSAVED_QUESTION)) return false;
  // Put the saved menu back, so no later page-hide save can send the
  // discarded menu.
  for (const key of unsaved) {
    const menu = saves.discard(key);
    menus.set(key, menu);
    renderSlot(slotOf(key), menu);
  }
  return true;
}

// Shows `week` without ever dropping an unsaved menu silently. On mobile, the
// selected day stays the same unless `selectToday` is set.
async function goToWeek(week, { selectToday = false } = {}) {
  if (changingWeek || editor.isOpen()) return;
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

buildDayBar();
buildGrid();
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
window.addEventListener("hashchange", () => {
  const week = location.hash.slice(1);
  // The week never changes behind an open editor.
  if (isWeekId(week) && !editor.isOpen()) goToWeek(week);
  else syncHash();
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
