// Weekly grid frontend. Depends ONLY on the HTTP API (/api/week); never import from server/.

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

/** Per-cell timer that hides the "✓" badge. */
const savedTimers = new Map();

function cellKey(day, meal) {
  return `${day}/${meal}`;
}

function cellOf(key) {
  const [day, meal] = key.split("/");
  return grid.querySelector(`.cell[data-day="${day}"][data-meal="${meal}"]`);
}

const saves = createSaves({
  fetch: (url, options) => fetch(url, options),
  url: (key) => `/api/week/${key}`,
  readText: (key) => cellOf(key).querySelector("textarea").value,
  onStatus: (key, state) => setStatus(cellOf(key), state),
  timeoutMs: REQUEST_TIMEOUT_MS,
});

function todayId() {
  // Date#getDay(): 0 = Sunday, 1 = Monday, ..., 6 = Saturday.
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date().getDay()];
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
  textarea.addEventListener("blur", () => saves.queueSave(cellKey(day.id, meal.id)));

  const status = createElement("button", "status");
  status.type = "button";
  status.disabled = true;
  status.dataset.state = "idle";
  status.setAttribute("aria-live", "polite");
  status.addEventListener("click", () => saves.queueSave(cellKey(day.id, meal.id))); // only clickable in "error"

  cell.append(label, textarea, status);
  return cell;
}

function selectDay(dayId) {
  // Hiding a focused textarea doesn't reliably fire blur (and Safari doesn't
  // focus buttons on click), so blur it explicitly to trigger its save.
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement && grid.contains(active)) active.blur();

  grid.dataset.selectedDay = dayId;
  for (const button of dayBar.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.day === dayId));
  }
}

function fillWeek(week) {
  const entries = [];
  for (const cell of grid.querySelectorAll(".cell")) {
    const { day, meal } = cell.dataset;
    const text = week[day][meal];
    cell.querySelector("textarea").value = text;
    entries.push([cellKey(day, meal), text]);
  }
  saves.loaded(entries); // sets every status to idle
}

function allKeys() {
  return [...grid.querySelectorAll(".cell")].map((cell) =>
    cellKey(cell.dataset.day, cell.dataset.meal),
  );
}

// Shows a cell's save status. The status itself comes from saves.js.
function setStatus(cell, state) {
  const key = cellKey(cell.dataset.day, cell.dataset.meal);
  clearTimeout(savedTimers.get(key));

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
      key,
      setTimeout(() => setStatus(cell, "idle"), SAVED_BADGE_MS),
    );
  }
}

async function loadWeek() {
  loadError.hidden = true;
  retryLoadButton.disabled = true;
  try {
    const response = await fetch("/api/week", { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    fillWeek(await response.json());
    dayBar.hidden = false;
    grid.hidden = false;
  } catch (error) {
    console.error("Couldn't load the meal plan:", error);
    loadError.hidden = false;
  } finally {
    retryLoadButton.disabled = false;
  }
}

buildDayBar();
buildGrid();
selectDay(todayId());
retryLoadButton.addEventListener("click", loadWeek);
window.addEventListener("pagehide", () => saves.flush(allKeys(), { skipInFlight: false }));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saves.flush(allKeys(), { skipInFlight: true });
});
loadWeek();
