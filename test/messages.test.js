import assert from "node:assert/strict";
import { test } from "node:test";
import {
  conflictText,
  joinNames,
  quoted,
  unsavedMessage,
  unsavedTitle,
} from "../public/messages.js";

test("quoted wraps the name in double quotes", () => {
  assert.equal(quoted("Soup"), '"Soup"');
});

test("conflictText says an active recipe already exists", () => {
  assert.equal(conflictText({ name: "Soup", archived: false }), '"Soup" already exists.');
});

test("conflictText says an archived recipe is archived", () => {
  assert.equal(conflictText({ name: "Soup", archived: true }), '"Soup" is archived.');
});

test("joinNames joins with and, and a serial comma from three names on", () => {
  assert.equal(joinNames(["Monday lunch"]), "Monday lunch");
  assert.equal(joinNames(["Monday lunch", "Tuesday dinner"]), "Monday lunch and Tuesday dinner");
  assert.equal(
    joinNames(["Monday lunch", "Tuesday dinner", "Friday breakfast"]),
    "Monday lunch, Tuesday dinner, and Friday breakfast",
  );
});

test("unsavedTitle counts the meals that weren't saved", () => {
  assert.equal(unsavedTitle(1), "1 meal wasn't saved");
  assert.equal(unsavedTitle(2), "2 meals weren't saved");
});

test("unsavedMessage names the meals and says what leaving the week does to them", () => {
  assert.equal(
    unsavedMessage(["Monday lunch"], "this week"),
    "Monday lunch couldn't be saved. If you leave this week, it goes back to its last saved menu.",
  );
  assert.equal(
    unsavedMessage(["Monday lunch", "Tuesday dinner"], "this week"),
    "Monday lunch and Tuesday dinner couldn't be saved. If you leave this week, they go back to their last saved menus.",
  );
});

test("unsavedMessage says what leaving the page does to the meals", () => {
  assert.equal(
    unsavedMessage(["Monday lunch"], "this page"),
    "Monday lunch couldn't be saved. If you leave this page, it goes back to its last saved menu.",
  );
  assert.equal(
    unsavedMessage(["Monday lunch", "Tuesday dinner"], "this page"),
    "Monday lunch and Tuesday dinner couldn't be saved. If you leave this page, they go back to their last saved menus.",
  );
});
