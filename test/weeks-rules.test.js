import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import {
  DAYS,
  isSlot,
  isValidServings,
  isWeekId,
  MEALS,
  normalizeWeek,
  validItems,
} from "../server/weeks.js";
import { blankWeek, EXPECTED_DAYS, EXPECTED_MEALS } from "./backend-helpers.js";

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

// server/weeks.js and public/dates.js implement isWeekId on purpose, because
// the browser never imports from server/. Both sides' tests read the cases of
// test/fixtures/week-ids.json, so the two can't drift apart.
const weekIds = JSON.parse(
  await readFile(new URL("./fixtures/week-ids.json", import.meta.url), "utf8"),
);

describe("isWeekId", () => {
  test("accepts each valid shared case", () => {
    for (const week of weekIds.valid) {
      assert.equal(isWeekId(week), true, week);
    }
  });

  test("rejects each invalid shared case, and a missing week", () => {
    // JSON can't hold undefined, so the missing week is added here.
    for (const { id, why } of [...weekIds.invalid, { id: undefined, why: "missing" }]) {
      assert.equal(isWeekId(id), false, `${String(id)}: ${why}`);
    }
  });
});

describe("isSlot", () => {
  const WEEK = "2026-09-21";

  test("accepts a Monday with a known day and meal", () => {
    for (const day of EXPECTED_DAYS) {
      for (const meal of EXPECTED_MEALS) {
        assert.equal(isSlot(WEEK, day, meal), true, `${day}/${meal}`);
      }
    }
  });

  test("rejects an invalid week, an unknown day, or an unknown meal", () => {
    const invalid = [
      ["2026-09-22", "mon", "lunch"],
      ["../week", "mon", "lunch"],
      [WEEK, "funday", "lunch"],
      [WEEK, "mon", "brunch"],
      [WEEK, "__proto__", "lunch"],
      [WEEK, "mon", "constructor"],
      [WEEK, undefined, "lunch"],
      [WEEK, "mon", undefined],
    ];
    for (const slot of invalid) {
      assert.equal(isSlot(...slot), false, slot.join("/"));
    }
  });
});

describe("isValidServings", () => {
  test("accepts the multiples of 0.5 from 0.5 to 99", () => {
    for (const servings of [0.5, 1, 1.5, 2, 50, 98.5, 99]) {
      assert.equal(isValidServings(servings), true, String(servings));
    }
  });

  test("rejects other numbers and values that aren't numbers", () => {
    const invalid = [0, 0.25, 1.2, -1, 99.5, 100, Number.NaN, Infinity, "1", null, undefined];
    for (const servings of invalid) {
      assert.equal(isValidServings(servings), false, String(servings));
    }
  });
});

describe("validItems", () => {
  const notAnArray = '"items" must be an array.';
  const wrongShape = 'items[0] must have exactly "recipeId" and "servings".';
  const wrongServings = "items[0].servings must be a multiple of 0.5 from 0.5 to 99.";

  test("rejects items that aren't an array", () => {
    for (const items of [undefined, null, "Soup", {}, 7]) {
      assert.throws(
        () => validItems(items),
        { name: "ValidationError", message: notAnArray },
        String(items),
      );
    }
  });

  test("rejects more than 20 menu items", () => {
    const tooMany = Array.from({ length: 21 }, (_, index) => ({
      recipeId: `recipe-${index}`,
      servings: 1,
    }));

    assert.throws(() => validItems(tooMany), {
      name: "ValidationError",
      message: "A menu holds at most 20 menu items.",
    });
  });

  test("rejects an item without exactly recipeId and servings", () => {
    const invalid = [
      null,
      "soup",
      { recipeId: "soup" },
      { servings: 1 },
      { recipeId: "soup", servings: 1, note: "hot" },
    ];
    for (const item of invalid) {
      assert.throws(
        () => validItems([item]),
        { name: "ValidationError", message: wrongShape },
        JSON.stringify(item),
      );
    }
  });

  test("rejects a recipeId that isn't a string", () => {
    assert.throws(() => validItems([{ recipeId: 42, servings: 1 }]), {
      name: "ValidationError",
      message: "items[0].recipeId must be a string.",
    });
  });

  test("rejects servings that aren't a multiple of 0.5 from 0.5 to 99", () => {
    for (const servings of ["1", 0, 0.25, 1.2, -1, 99.5, Number.NaN]) {
      assert.throws(
        () => validItems([{ recipeId: "soup", servings }]),
        { name: "ValidationError", message: wrongServings },
        String(servings),
      );
    }
  });

  test("rejects a repeated recipe", () => {
    assert.throws(
      () =>
        validItems([
          { recipeId: "soup", servings: 1 },
          { recipeId: "soup", servings: 2 },
        ]),
      { name: "ValidationError", message: "items[1] repeats recipe soup." },
    );
  });

  test("accepts no items, and returns an empty array", () => {
    assert.deepEqual(validItems([]), []);
  });

  test("accepts the limits: 0.5 and 99 servings, and 20 menu items", () => {
    const limits = [
      { recipeId: "soup", servings: 0.5 },
      { recipeId: "salad", servings: 99 },
    ];
    const full = Array.from({ length: 20 }, (_, index) => ({
      recipeId: `recipe-${index}`,
      servings: 1,
    }));

    assert.deepEqual(validItems(limits), limits);
    assert.equal(validItems(full).length, 20);
  });

  test("returns new objects with only recipeId and servings", () => {
    const items = [{ recipeId: "soup", servings: 2 }];

    const clean = validItems(items);

    assert.deepEqual(clean, items);
    assert.notEqual(clean[0], items[0]);
  });
});

describe("normalizeWeek", () => {
  test("returns a complete week of empty menus for data that isn't a week", () => {
    for (const raw of [undefined, null, "Paella", 7, [], {}]) {
      assert.deepEqual(normalizeWeek(raw, new Set()), blankWeek(), JSON.stringify(raw));
    }
  });

  test("keeps only the menu items that validItems accepts", () => {
    const raw = {
      mon: {
        breakfast: {
          items: [
            { recipeId: "soup", servings: 1 },
            { recipeId: "soup", servings: 2 }, // repeated recipe -> dropped
            { recipeId: "salad", servings: 0.3 }, // off the 0.5 grid -> dropped
            { recipeId: 7, servings: 1 }, // not a string -> dropped
            null,
            { recipeId: "salad", servings: 2, extra: true }, // kept without the extra key
          ],
        },
        lunch: "Paella", // free text from an earlier version -> empty menu
        dinner: { items: "soup" }, // broken items -> empty menu
      },
      fri: null, // broken day -> all empty
    };

    const week = normalizeWeek(raw, new Set(["soup", "salad"]));

    const expected = blankWeek();
    expected.mon.breakfast = {
      items: [
        { recipeId: "soup", servings: 1 },
        { recipeId: "salad", servings: 2 },
      ],
    };
    assert.deepEqual(week, expected);
    for (const day of EXPECTED_DAYS) {
      for (const meal of EXPECTED_MEALS) {
        assert.deepEqual(validItems(week[day][meal].items), week[day][meal].items);
      }
    }
  });

  test("drops the items whose recipe isn't known", () => {
    const raw = {
      tue: {
        lunch: {
          items: [
            { recipeId: "gone", servings: 1 },
            { recipeId: "soup", servings: 1 },
          ],
        },
      },
    };

    const week = normalizeWeek(raw, new Set(["soup"]));

    assert.deepEqual(week.tue.lunch, { items: [{ recipeId: "soup", servings: 1 }] });
  });

  test("drops the days and meals that aren't in the week", () => {
    const raw = { holiday: { lunch: { items: [] } }, mon: { brunch: { items: [] } } };

    const week = normalizeWeek(raw, new Set());

    assert.deepEqual(week, blankWeek());
  });

  test("keeps at most 20 menu items per slot", () => {
    const ids = Array.from({ length: 25 }, (_, index) => `recipe-${index}`);
    const items = ids.map((recipeId) => ({ recipeId, servings: 1 }));

    const week = normalizeWeek({ sun: { dinner: { items } } }, new Set(ids));

    assert.deepEqual(week.sun.dinner.items, items.slice(0, 20));
  });
});
