import assert from "node:assert/strict";
import { test } from "node:test";

// Set the time zone before the module creates any Date, so the results don't
// depend on the machine. Europe/Madrid ends daylight saving time on 2026-10-25.
process.env.TZ = "Europe/Madrid";
const {
  addDays,
  addWeeks,
  dayIndex,
  formatLongDate,
  formatWeekRange,
  isWeekId,
  weekIdOf,
  weekStart,
} = await import("../public/dates.js");

// Intl puts thin spaces around the dash in a range; compare with plain spaces.
function plain(text) {
  return text.replace(/\s/g, " ");
}

function localParts(date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours()];
}

test("dayIndex counts from Monday (0) to Sunday (6)", () => {
  for (let day = 21; day <= 27; day++) {
    assert.equal(dayIndex(new Date(2026, 8, day)), day - 21, `September ${day}`);
  }
});

test("weekIdOf maps every day of a week to its Monday", () => {
  for (let day = 21; day <= 27; day++) {
    assert.equal(weekIdOf(new Date(2026, 8, day, 12)), "2026-09-21", `September ${day}`);
  }
  assert.equal(weekIdOf(new Date(2026, 8, 27, 23, 59)), "2026-09-21");
  assert.equal(weekIdOf(new Date(2026, 8, 28, 0, 0)), "2026-09-28");
  // A Sunday late at night on the day daylight saving time ends.
  assert.equal(weekIdOf(new Date(2026, 9, 25, 23, 30)), "2026-10-19");
  // A week that spans two years.
  assert.equal(weekIdOf(new Date(2027, 0, 3)), "2026-12-28");
});

test("addDays counts calendar days across the end of daylight saving time", () => {
  // October 25, 2026 has 25 hours in Europe/Madrid; adding 24 hours would land at 23:00.
  assert.deepEqual(localParts(addDays(new Date(2026, 9, 25), 1)), [2026, 10, 26, 0]);
  assert.deepEqual(localParts(addDays(new Date(2026, 9, 26), -1)), [2026, 10, 25, 0]);
});

test("addDays doesn't change its argument", () => {
  const date = new Date(2026, 8, 21);
  addDays(date, 3);
  assert.deepEqual(localParts(date), [2026, 9, 21, 0]);
});

test("isWeekId accepts a Monday in YYYY-MM-DD format", () => {
  for (const id of ["2026-09-21", "2026-12-28", "2027-01-04"]) {
    assert.equal(isWeekId(id), true, id);
  }
});

test("isWeekId rejects other weekdays, impossible dates, and other formats", () => {
  const invalid = [
    "2026-09-22", // Tuesday
    "2026-09-27", // Sunday
    "2026-02-30", // doesn't exist; JavaScript rolls it over to Monday, March 2
    "2026-13-07",
    "2026-9-21",
    "20260921",
    "2026-09-21T00:00:00Z",
    " 2026-09-21",
    "hello",
    "",
    undefined,
    21,
  ];
  for (const id of invalid) {
    assert.equal(isWeekId(id), false, String(id));
  }
});

test("weekStart returns the Monday at local midnight", () => {
  assert.deepEqual(localParts(weekStart("2026-09-21")), [2026, 9, 21, 0]);
  // The Date constructor would turn year 1 into 1901.
  assert.equal(weekStart("0001-01-01").getFullYear(), 1);
});

test("addWeeks moves across months, years, and daylight saving time", () => {
  assert.equal(addWeeks("2026-09-21", 1), "2026-09-28");
  assert.equal(addWeeks("2026-09-21", -1), "2026-09-14");
  assert.equal(addWeeks("2026-09-28", 1), "2026-10-05");
  assert.equal(addWeeks("2026-10-19", 1), "2026-10-26");
  assert.equal(addWeeks("2026-12-28", 1), "2027-01-04");
  assert.equal(addWeeks("2027-01-04", -1), "2026-12-28");
  // Years below 1000 keep four digits, so the result is still a valid week.
  assert.equal(addWeeks("0001-01-01", 1), "0001-01-08");
});

test("formatWeekRange shares the month and the year when they match", () => {
  assert.equal(plain(formatWeekRange("2026-09-21")), "Sep 21 – 27, 2026");
  assert.equal(plain(formatWeekRange("2026-09-28")), "Sep 28 – Oct 4, 2026");
  assert.equal(plain(formatWeekRange("2026-12-28")), "Dec 28, 2026 – Jan 3, 2027");
});

test("formatLongDate returns the weekday, month, and day", () => {
  assert.equal(formatLongDate(new Date(2026, 8, 21)), "Monday, September 21");
});
