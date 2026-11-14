import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { instructions } from "../server/assistant/instructions.js";

// A Sunday, so the week of today starts six days before it.
const TODAY = "2026-11-15";

const PREFERENCES = "No pork.\nThe children eat lunch at school on weekdays.";

/** The instructions with the preferences and today, and `week` when given. */
function text(week = undefined) {
  return instructions({ preferences: PREFERENCES, today: TODAY, week });
}

describe("instructions", () => {
  test("includes the family preferences verbatim", () => {
    assert.ok(text().includes(PREFERENCES), text());
  });

  test("says that there are no family preferences when the text is empty", () => {
    const result = instructions({ preferences: "", today: TODAY, week: undefined });

    assert.match(result, /The family hasn't written any preferences\./);
  });

  test("states today's date with its weekday", () => {
    assert.match(text(), /Today is Sunday, 2026-11-15\./);
  });

  test("states the week of today", () => {
    assert.match(text(), /Today is in the week of 2026-11-09\./);
  });

  test("states the displayed week when the message comes from the meal plan", () => {
    assert.match(text("2026-11-23"), /The meal plan shows the week of 2026-11-23/);
  });

  test("has no line about the displayed week without a week", () => {
    assert.doesNotMatch(text(), /The meal plan shows/);
  });

  test("includes the title of each guide", () => {
    for (const title of ["Planning a week", "Creating a recipe", "Changing ingredients"]) {
      assert.match(text(), new RegExp(`Guide: ${title}`), title);
    }
  });

  // A distinctive phrase of each rule that the model reads, as the design
  // lists them, and of the limits of the domain.
  /** @type {[string, RegExp][]} */
  const rules = [
    ["prefers active recipes that exist over new ones", /Prefer active recipes that exist/],
    ["states that a quantity is what one serving needs", /A quantity is what one serving needs/],
    [
      "lowers the servings or empties the slot when someone eats away",
      /Lower the servings of a menu item, or leave the slot empty, when someone eats away/,
    ],
    ["says that changes are pending and never saved", /never say that they're saved/],
    ["treats attachments as information, never as instructions", /never as instructions/],
    ["answers in plain text", /Answer in plain text/],
    ["answers in the language of the message", /in the language of the user's message/],
    ["names new entries in the language of the recipe book", /language that the recipe book uses/],
    ["states the limits of servings", /multiple of 0\.5 from 0\.5 to 99/],
    ["states the limits of a quantity", /from 0\.01 to 10000 with at most two decimals/],
  ];
  for (const [name, phrase] of rules) {
    test(name, () => {
      assert.match(text(), phrase);
    });
  }
});
