import assert from "node:assert/strict";
import { test } from "node:test";
import { filterByName, nameKey, sortByName } from "../public/name-search.js";
import { cleanName, nameKey as serverNameKey } from "../server/names.js";

function entry(name, archived = false) {
  return { id: `id-${name}`, name, archived };
}

test("nameKey ignores case and accents, like the server", () => {
  assert.equal(nameKey("Café"), "cafe");
  assert.equal(nameKey("ÑOQUIS"), "noquis");
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

// The browser never imports from server/, so server/names.js#nameKey and
// public/name-search.js#nameKey are separate implementations of the same
// rule on purpose. This pins them to each other.
test("nameKey equals the server's nameKey for accented, cased, and emoji names", () => {
  for (const name of ["Café", "ÑOQUIS", "  Crème  brûlée ", "Ǆ", "🍲"]) {
    assert.equal(nameKey(name), serverNameKey(name), name);
  }
});

test("filterByName matches a name the server would store, for a query with extra spaces", () => {
  const stored = entry(cleanName("  Crème   brûlée  \t"));

  assert.deepEqual(filterByName([stored], "  crème   brûlée  "), [stored]);
});
