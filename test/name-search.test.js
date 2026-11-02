import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import { cleanName, filterByName, nameKey, sortByName } from "../public/name-search.js";

// public/name-search.js and server/names.js implement the same rules on
// purpose, because the browser never imports from server/. Both sides' tests
// read the cases of test/fixtures/names.json, so the two can't drift apart.
const shared = JSON.parse(
  await readFile(new URL("./fixtures/names.json", import.meta.url), "utf8"),
);

function entry(name, archived = false) {
  return { id: `id-${name}`, name, archived };
}

describe("nameKey", () => {
  test("returns the key of each shared case", () => {
    for (const { name, key } of shared.nameKeys) {
      assert.equal(nameKey(name), key, JSON.stringify(name));
    }
  });
});

describe("cleanName", () => {
  test("cleans the name of each shared case", () => {
    for (const { name, clean } of shared.cleanNames) {
      assert.equal(cleanName(name), clean, JSON.stringify(name));
    }
  });
});

test("sortByName returns a new array from A to Z by name key", () => {
  const input = [entry("omelette"), entry("Ñoquis"), entry("Café"), entry("banana")];

  const sorted = sortByName(input);

  assert.deepEqual(
    sorted.map((item) => item.name),
    ["banana", "Café", "Ñoquis", "omelette"],
  );
  assert.equal(input[0].name, "omelette", "the input keeps its order");
});

test("filterByName matches part of the name, ignoring case, accents, and extra spaces", () => {
  const entries = [entry("Iced café"), entry("Tea"), entry("Café con leche")];

  assert.deepEqual(
    filterByName(entries, "cafe").map((item) => item.name),
    ["Iced café", "Café con leche"],
  );
  assert.deepEqual(
    filterByName(entries, "  CAFÉ   CON ").map((item) => item.name),
    ["Café con leche"],
  );
  assert.deepEqual(filterByName(entries, "juice"), []);
});

test("filterByName with a blank query matches every entry", () => {
  const entries = [entry("Tea"), entry("Soup")];
  assert.deepEqual(filterByName(entries, ""), entries);
  assert.deepEqual(filterByName(entries, "   "), entries);
});
