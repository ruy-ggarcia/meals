// Weekly grid frontend. Depends ONLY on the HTTP API (/api/weeks); never import from server/.

import { addWeeks, dayIndex, formatWeekRange, isWeekId, weekIdOf } from "./dates.js";
import { createSaves } from "./saves.js";

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

const MAX_TEXT_LENGTH = 2000; // same limit the API enforces
const SAVED_BADGE_MS = 3000; // how long the "saved" check mark stays visible
const REQUEST_TIMEOUT_MS = 10000; // load/save give up (-> error UI) after this
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

/** Timer that hides the "✓" badge, per cell element: it acts on what is on screen, whatever the week. */
const savedTimers = new Map();

/** The week in the URL hash and the range label. Retry loads it again. */
let requestedWeek;
/** True while a week change runs, so two changes never overlap. */
let changingWeek = false;

// Keys include the week, so the same cell in two weeks never shares save state.
function cellKey(week, day, meal) {
  return `${week}/${day}/${meal}`;
}

// The cell element of `key`, or null when its week isn't on screen.
function cellOf(key) {
  const [week, day, meal] = key.split("/");
  if (week !== grid.dataset.week) return null;
  return grid.querySelector(`.cell[data-day="${day}"][data-meal="${meal}"]`);
}

const saves = createSaves({
  fetch: (url, options) => fetch(url, options),
  url: (key) => `/api/weeks/${key}`,
  readText: (key) => cellOf(key)?.querySelector("textarea").value,
  onStatus: (key, state) => {
    const cell = cellOf(key);
    if (cell) setStatus(cell, state);
  },
  timeoutMs: REQUEST_TIMEOUT_MS,
});

function todayId() {
  return DAYS[dayIndex(new Date())].id;
}

function createElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function buildDayBar() {
  for (const day of DAYS) {
    const button = createElement("button", "", day.short);
    button.type = "button";
    button.dataset.day = day.id;
    button.setAttribute("aria-label", day.label);
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => selectDay(day.id));
    dayBar.append(button);
  }
}

// DOM order = CSS grid order on desktop: corner, 7 day headers,
// then for each meal a meal header followed by its 7 cells.
function buildGrid() {
  grid.append(createElement("div", "corner"));
  for (const day of DAYS) grid.append(createElement("div", "day-header", day.label));
  for (const meal of MEALS) {
    grid.append(createElement("div", "meal-header", meal.label));
    for (const day of DAYS) grid.append(buildCell(day, meal));
  }
}

function buildCell(day, meal) {
  const cell = createElement("div", "cell");
  cell.dataset.day = day.id;
  cell.dataset.meal = meal.id;

  const textareaId = `cell-${day.id}-${meal.id}`;

  // Visible only on mobile, where the meal header column is hidden.
  const label = createElement("label", "cell-label", meal.label);
  label.htmlFor = textareaId;

  const textarea = createElement("textarea");
  textarea.id = textareaId;
  textarea.rows = 3;
  textarea.maxLength = MAX_TEXT_LENGTH;
  textarea.setAttribute("aria-label", `${day.label}, ${meal.label}`);
  textarea.addEventListener("blur", () =>
    saves.queueSave(cellKey(grid.dataset.week, day.id, meal.id)),
  );

  const status = createElement("button", "status");
  status.type = "button";
  status.disabled = true;
  status.dataset.state = "idle";
  status.setAttribute("aria-live", "polite");
  // Only clickable in "error".
  status.addEventListener("click", () =>
    saves.queueSave(cellKey(grid.dataset.week, day.id, meal.id)),
  );

  cell.append(label, textarea, status);
  return cell;
}

function blurActiveCell() {
  // Hiding a focused textarea doesn't reliably fire blur (and Safari doesn't
  // focus buttons on click), so blur it explicitly to trigger its save.
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement && grid.contains(active)) active.blur();
}

function selectDay(dayId) {
  blurActiveCell();
  grid.dataset.selectedDay = dayId;
  for (const button of dayBar.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.day === dayId));
  }
}

function fillWeek(week, cells) {
  grid.dataset.week = week;
  const entries = [];
  for (const cell of grid.querySelectorAll(".cell")) {
    const { day, meal } = cell.dataset;
    const text = cells[day][meal];
    cell.querySelector("textarea").value = text;
    entries.push([cellKey(week, day, meal), text]);
  }
  // Sets every status to idle, which also clears a pending "✓" timer from the
  // previous week.
  saves.loaded(entries);
}

// The keys of the cells on screen.
function shownKeys() {
  const { week } = grid.dataset;
  return [...grid.querySelectorAll(".cell")].map((cell) =>
    cellKey(week, cell.dataset.day, cell.dataset.meal),
  );
}

// Shows a cell's save status. The status itself comes from saves.js.
function setStatus(cell, state) {
  clearTimeout(savedTimers.get(cell));

  const status = cell.querySelector(".status");
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
      cell,
      setTimeout(() => setStatus(cell, "idle"), SAVED_BADGE_MS),
    );
  }
}

async function loadWeek(week) {
  loadError.hidden = true;
  retryLoadButton.disabled = true;
  try {
    const response = await fetch(`/api/weeks/${week}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    fillWeek(week, await response.json());
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
  grid.inert = changing; // no typing into a week that is being left
}

// Waits for pending saves, then returns true if the loaded week can be left:
// every cell is saved, or the user agreed to discard what couldn't be saved.
async function leaveLoadedWeek() {
  await saves.settle();
  const unsaved = saves.unsaved(shownKeys());
  if (unsaved.length === 0) return true;
  // Let the browser paint the red crosses first: confirm() blocks painting.
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
  if (!window.confirm(UNSAVED_QUESTION)) return false;
  // Put the saved text back, so no later blur or page-hide save can send the
  // discarded text.
  for (const key of unsaved) {
    cellOf(key).querySelector("textarea").value = saves.discard(key);
  }
  return true;
}

// Shows `week` without ever dropping unsaved text silently. On mobile, the
// selected day stays the same unless `selectToday` is set.
async function goToWeek(week, { selectToday = false } = {}) {
  if (changingWeek) return;
  // Disabling the clicked week bar button moves focus to <body>; remember it
  // so it can be refocused afterward.
  const focused = document.activeElement;
  blurActiveCell(); // starts the save of the focused cell before the wait
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
  } finally {
    setChangingWeek(false);
    // Only if focus was lost, not moved elsewhere by the user. Never refocus a
    // textarea: on mobile that would open the keyboard in the new week.
    if (weekBar.contains(focused) && document.activeElement === document.body) {
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
  if (isWeekId(week)) goToWeek(week);
  else syncHash();
});
window.addEventListener("pagehide", () => saves.flush(shownKeys(), { skipInFlight: false }));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saves.flush(shownKeys(), { skipInFlight: true });
});

const hashWeek = location.hash.slice(1);
goToWeek(isWeekId(hashWeek) ? hashWeek : weekIdOf(new Date()));
