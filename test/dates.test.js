import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import { plain } from "./dom-helpers.js";

// Set the time zone before the module creates any Date, so the results don't
// depend on the machine. Europe/Madrid ends daylight saving time on 2026-10-25.
process.env.TZ = "Europe/Madrid";
const {
  addDays,
  addWeeks,
  dateIdOf,
  dayIndex,
  formatDayDate,
  formatFullDate,
  formatLongDate,
  formatShortWeekRange,
  formatWeekRange,
  isWeekId,
  weekIdOf,
  weekStart,
} = await import("../public/dates.js");

function localParts(date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours()];
}

describe("dayIndex", () => {
  test("counts from Monday (0) to Sunday (6)", () => {
    for (let day = 21; day <= 27; day++) {
      assert.equal(dayIndex(new Date(2026, 8, day)), day - 21, `September ${day}`);
    }
  });
});

describe("dateIdOf", () => {
  test("gives the local date after midnight while UTC is on the day before", () => {
    assert.equal(dateIdOf(new Date(2026, 0, 6, 0, 30)), "2026-01-06");
  });
});

describe("weekIdOf", () => {
  test("maps every day of a week to its Monday", () => {
    for (let day = 21; day <= 27; day++) {
      assert.equal(weekIdOf(new Date(2026, 8, day, 12)), "2026-09-21", `September ${day}`);
    }
    assert.equal(weekIdOf(new Date(2026, 8, 27, 23, 59)), "2026-09-21", "Sunday at 23:59");
    assert.equal(weekIdOf(new Date(2026, 8, 28, 0, 0)), "2026-09-28", "Monday at 00:00");
    // A Sunday late at night on the day daylight saving time ends.
    assert.equal(weekIdOf(new Date(2026, 9, 25, 23, 30)), "2026-10-19", "the end of DST");
    // A week that spans two years.
    assert.equal(weekIdOf(new Date(2027, 0, 3)), "2026-12-28", "a week of two years");
  });
});

describe("addDays", () => {
  test("counts calendar days across the end of daylight saving time", () => {
    // October 25, 2026 has 25 hours in Europe/Madrid; adding 24 hours would land at 23:00.
    assert.deepEqual(localParts(addDays(new Date(2026, 9, 25), 1)), [2026, 10, 26, 0]);
    assert.deepEqual(localParts(addDays(new Date(2026, 9, 26), -1)), [2026, 10, 25, 0]);
  });

  test("doesn't change its argument", () => {
    const date = new Date(2026, 8, 21);
    addDays(date, 3);
    assert.deepEqual(localParts(date), [2026, 9, 21, 0]);
  });
});

// public/dates.js and server/weeks.js implement isWeekId on purpose, because
// the browser never imports from server/. Both sides' tests read the cases of
// test/fixtures/week-ids.json, so the two can't drift apart.
const weekIds = JSON.parse(
  await readFile(new URL("./fixtures/week-ids.json", import.meta.url), "utf8"),
);

describe("isWeekId", () => {
  test("accepts each valid shared case", () => {
    for (const id of weekIds.valid) {
      assert.equal(isWeekId(id), true, id);
    }
  });

  test("rejects each invalid shared case and a missing ID", () => {
    // JSON can't hold undefined, so the missing ID is added here.
    for (const { id, why } of [...weekIds.invalid, { id: undefined, why: "missing" }]) {
      assert.equal(isWeekId(id), false, `${String(id)}: ${why}`);
    }
  });
});

describe("weekStart", () => {
  test("returns the Monday at local midnight", () => {
    assert.deepEqual(localParts(weekStart("2026-09-21")), [2026, 9, 21, 0]);
  });

  test("keeps years below 1000", () => {
    // The Date constructor would turn year 1 into 1901.
    assert.equal(weekStart("0001-01-01").getFullYear(), 1);
  });
});

describe("addWeeks", () => {
  test("moves across months, years, and daylight saving time", () => {
    assert.equal(addWeeks("2026-09-21", 1), "2026-09-28");
    assert.equal(addWeeks("2026-09-21", -1), "2026-09-14");
    assert.equal(addWeeks("2026-09-28", 1), "2026-10-05");
    assert.equal(addWeeks("2026-10-19", 1), "2026-10-26");
    assert.equal(addWeeks("2026-12-28", 1), "2027-01-04");
    assert.equal(addWeeks("2027-01-04", -1), "2026-12-28");
    // Years below 1000 keep four digits, so the result is still a valid week.
    assert.equal(addWeeks("0001-01-01", 1), "0001-01-08");
  });
});

describe("formatWeekRange", () => {
  test("shares the month and the year when they match", () => {
    assert.equal(plain(formatWeekRange("2026-09-21")), "Sep 21 – 27, 2026");
    assert.equal(plain(formatWeekRange("2026-09-28")), "Sep 28 – Oct 4, 2026");
    assert.equal(plain(formatWeekRange("2026-12-28")), "Dec 28, 2026 – Jan 3, 2027");
  });
});

describe("formatShortWeekRange", () => {
  test("leaves out the year", () => {
    assert.equal(plain(formatShortWeekRange("2026-09-21")), "Sep 21 – 27");
    assert.equal(plain(formatShortWeekRange("2026-09-28")), "Sep 28 – Oct 4");
    assert.equal(plain(formatShortWeekRange("2026-12-28")), "Dec 28 – Jan 3");
  });
});

describe("formatDayDate", () => {
  test("returns the weekday, the short month, and the day", () => {
    assert.equal(formatDayDate(new Date(2026, 8, 21)), "Monday, Sep 21");
  });
});

describe("formatFullDate", () => {
  test("returns the month, day, and year", () => {
    assert.equal(formatFullDate(new Date(2026, 8, 21)), "September 21, 2026");
  });
});

describe("formatLongDate", () => {
  test("returns the weekday, month, and day", () => {
    assert.equal(formatLongDate(new Date(2026, 8, 21)), "Monday, September 21");
  });
});
