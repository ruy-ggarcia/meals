// Date helpers for the week grid. They use the browser's local time and never
// touch the DOM, so tests import this module directly in Node.js.

const WEEK_ID_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function pad(number, length = 2) {
  return String(number).padStart(length, "0");
}

/** A new Date `days` calendar days later (or earlier), at the same local time. */
export function addDays(date, days) {
  const result = new Date(date);
  // setDate counts calendar days, so a daylight saving time change doesn't shift the time.
  result.setDate(result.getDate() + days);
  return result;
}

/** Position of `date` in its week: 0 = Monday, ..., 6 = Sunday. */
export function dayIndex(date) {
  // Date#getDay(): 0 = Sunday, 1 = Monday, ..., 6 = Saturday.
  return (date.getDay() + 6) % 7;
}

/** Identifier of the week that contains `date`: its Monday as YYYY-MM-DD. */
export function weekIdOf(date) {
  const monday = addDays(date, -dayIndex(date));
  return `${pad(monday.getFullYear(), 4)}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
}

/** True for a real calendar date in YYYY-MM-DD format that falls on a Monday. */
export function isWeekId(id) {
  if (typeof id !== "string" || !WEEK_ID_PATTERN.test(id)) return false;
  // UTC, so the answer doesn't depend on the time zone. An impossible date such
  // as 2026-02-30 rolls over to another day, so it fails the round trip.
  const date = new Date(`${id}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().startsWith(id) && date.getUTCDay() === 1
  );
}

/** The Monday of week `id` as a local Date at midnight. */
export function weekStart(id) {
  const [year, month, day] = id.split("-").map(Number);
  const date = new Date(2000, 0, 1);
  // Unlike the Date constructor, setFullYear doesn't map years 0-99 to 1900-1999.
  date.setFullYear(year, month - 1, day);
  return date;
}

export function addWeeks(id, weeks) {
  return weekIdOf(addDays(weekStart(id), weeks * 7));
}

/** For example, "Sep 21 – 27, 2026". */
export function formatWeekRange(id) {
  const monday = weekStart(id);
  const format = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return format.formatRange(monday, addDays(monday, 6));
}

/** For example, "Monday, September 21". */
export function formatLongDate(date) {
  const format = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  return format.format(date);
}
