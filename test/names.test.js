import assert from "node:assert/strict";
import { describe, test } from "node:test";
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

describe("validName", () => {
  test("returns the cleaned name", () => {
    assert.equal(validName("  Onion   soup "), "Onion soup");
  });

  test("rejects a name that isn't a string", () => {
    for (const name of [undefined, null, 42, ["Soup"]]) {
      assert.throws(() => validName(name), {
        name: "ValidationError",
        message: '"name" must be a string.',
      });
    }
  });

  test("rejects a blank name", () => {
    for (const name of ["", " ", "   \n "]) {
      assert.throws(() => validName(name), {
        name: "ValidationError",
        message: "The name can't be empty.",
      });
    }
  });

  test("rejects a name of more than 100 characters", () => {
    assert.throws(() => validName("x".repeat(101)), {
      name: "ValidationError",
      message: "The name must be at most 100 characters.",
    });
  });

  test("accepts a name of 100 characters after the cleanup", () => {
    assert.equal(validName(` ${"x".repeat(100)} `), "x".repeat(100));
  });

  test("counts a surrogate pair as 2 characters when it rejects a name", () => {
    // U+1F600 is a surrogate pair in UTF-16, so its .length is 2, not 1.
    const tooLong = `${"x".repeat(99)}😀`;
    assert.equal(tooLong.length, 101);

    assert.throws(() => validName(tooLong), {
      name: "ValidationError",
      message: "The name must be at most 100 characters.",
    });
  });

  test("counts a surrogate pair as 2 characters when it accepts a name", () => {
    const justRight = `${"x".repeat(98)}😀`;
    assert.equal(justRight.length, 100);

    assert.equal(validName(justRight), justRight);
  });
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
