import assert from "node:assert/strict";
import { test } from "node:test";
import { conflictText, quoted } from "../public/messages.js";

test("quoted wraps the name in double quotes", () => {
  assert.equal(quoted("Soup"), '"Soup"');
});

test("conflictText says an active recipe already exists", () => {
  assert.equal(conflictText({ name: "Soup", archived: false }), '"Soup" already exists.');
});

test("conflictText says an archived recipe is archived", () => {
  assert.equal(conflictText({ name: "Soup", archived: true }), '"Soup" is archived.');
});
