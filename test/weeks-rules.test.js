import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DAYS, isWeekId, MEALS } from "../server/weeks.js";

// Expected values are written out literally so the tests do not trust the module under test.
const EXPECTED_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const EXPECTED_MEALS = ["breakfast", "snack_am", "lunch", "snack_pm", "dinner"];

describe("DAYS", () => {
  test("lists the stable day identifiers in order", () => {
    assert.deepEqual(DAYS, EXPECTED_DAYS);
  });
});

describe("MEALS", () => {
  test("lists the stable meal identifiers in order", () => {
    assert.deepEqual(MEALS, EXPECTED_MEALS);
  });
});

// Parallels the isWeekId tests in test/dates.test.js on purpose: this tests
// server/weeks.js's own implementation, required by the public/-never-
// imports-server/ rule, not a duplicate of that other test.
describe("isWeekId", () => {
  test("accepts a Monday in YYYY-MM-DD format", () => {
    for (const week of ["2026-09-21", "2026-12-28", "2027-01-04"]) {
      assert.equal(isWeekId(week), true, week);
    }
  });

  test("rejects other weekdays, impossible dates, and other formats", () => {
    const invalid = [
      "2026-09-22", // Tuesday
      "2026-09-27", // Sunday
      "2026-02-30", // doesn't exist; JavaScript rolls it over to Monday, March 2
      "2026-13-07",
      "2026-9-21",
      "20260921",
      "2026-09-21T00:00:00Z",
      " 2026-09-21",
      "__proto__",
      "",
      undefined,
      21,
    ];
    for (const week of invalid) {
      assert.equal(isWeekId(week), false, String(week));
    }
  });
});
