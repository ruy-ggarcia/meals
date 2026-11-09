import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  conflictText,
  joinNames,
  quoted,
  unsavedMessage,
  unsavedTitle,
} from "../public/messages.js";

describe("quoted", () => {
  test("wraps the name in double quotes", () => {
    assert.equal(quoted("Soup"), '"Soup"');
  });
});

describe("conflictText", () => {
  test("says that an active recipe already exists", () => {
    assert.equal(conflictText({ name: "Soup", archived: false }), '"Soup" already exists.');
  });

  test("says that an archived recipe is archived", () => {
    assert.equal(conflictText({ name: "Soup", archived: true }), '"Soup" is archived.');
  });
});

describe("joinNames", () => {
  test("joins with and, and adds a serial comma from three names", () => {
    assert.equal(joinNames(["Monday lunch"]), "Monday lunch");
    assert.equal(joinNames(["Monday lunch", "Tuesday dinner"]), "Monday lunch and Tuesday dinner");
    assert.equal(
      joinNames(["Monday lunch", "Tuesday dinner", "Friday breakfast"]),
      "Monday lunch, Tuesday dinner, and Friday breakfast",
    );
  });
});

describe("unsavedTitle", () => {
  test("counts the meals that weren't saved", () => {
    assert.equal(unsavedTitle(1), "1 meal wasn't saved");
    assert.equal(unsavedTitle(2), "2 meals weren't saved");
  });
});

describe("unsavedMessage", () => {
  test("says what leaving the week does to the meals", () => {
    assert.equal(
      unsavedMessage(["Monday lunch"], "this week"),
      "Monday lunch couldn't be saved. If you leave this week, it goes back to its last saved menu.",
    );
    assert.equal(
      unsavedMessage(["Monday lunch", "Tuesday dinner"], "this week"),
      "Monday lunch and Tuesday dinner couldn't be saved. If you leave this week, they go back to their last saved menus.",
    );
  });

  test("says what leaving the page does to the meals", () => {
    assert.equal(
      unsavedMessage(["Monday lunch"], "this page"),
      "Monday lunch couldn't be saved. If you leave this page, it goes back to its last saved menu.",
    );
    assert.equal(
      unsavedMessage(["Monday lunch", "Tuesday dinner"], "this page"),
      "Monday lunch and Tuesday dinner couldn't be saved. If you leave this page, they go back to their last saved menus.",
    );
  });
});
