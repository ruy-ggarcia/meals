import assert from "node:assert/strict";
import { test } from "node:test";
import { ValidationError } from "../server/errors.js";
import { byNameKey, cleanName, holderOf, nameKey, validName } from "../server/names.js";

test("cleanName trims the name and collapses runs of whitespace", () => {
  assert.equal(cleanName("  Green \t salad\n "), "Green salad");
});

test("nameKey ignores case and accents", () => {
  assert.equal(nameKey("Café"), nameKey("CAFE"));
  assert.equal(nameKey("Ñoquis"), "noquis");
  assert.notEqual(nameKey("Cafe"), nameKey("Cafes"));
});

test("byNameKey sorts entries from A to Z by name key", () => {
  const entries = [{ name: "omelette" }, { name: "Ñoquis" }, { name: "Café" }];

  assert.deepEqual(
    entries.sort(byNameKey).map((entry) => entry.name),
    ["Café", "Ñoquis", "omelette"],
  );
});

test("validName returns the cleaned name", () => {
  assert.equal(validName("  Onion   soup "), "Onion soup");
});

test("validName rejects a name that isn't a string, is blank, or is too long", () => {
  for (const name of [undefined, null, 42, ["Soup"], "", "   \n "]) {
    assert.throws(() => validName(name), ValidationError, String(name));
  }
  assert.throws(() => validName(" "), { message: "The name can't be empty." });
  assert.throws(() => validName("x".repeat(101)), {
    message: "The name must be at most 100 characters.",
  });
  // The limit counts the cleaned name.
  assert.equal(validName(` ${"x".repeat(100)} `), "x".repeat(100));
});

test("holderOf finds the entry with the same name key, except the given ID", () => {
  const all = [
    { id: "1", name: "Café" },
    { id: "2", name: "Tea" },
  ];

  assert.equal(holderOf(all, "  CAFE "), all[0]);
  assert.equal(holderOf(all, "cafe", "1"), undefined);
  assert.equal(holderOf(all, "Soup"), undefined);
});
