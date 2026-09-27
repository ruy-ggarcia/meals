import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_QUANTITY,
  MIN_QUANTITY,
  parseQuantity,
  twoHundredths,
  wholeUnits,
} from "../public/quantities.js";

test("parseQuantity reads whole numbers and up to two decimals, after . or ,", () => {
  const cases = [
    ["150", 150],
    ["0.5", 0.5],
    ["0,5", 0.5],
    ["1,5", 1.5],
    [" 2 ", 2],
    [".5", 0.5],
    [",5", 0.5],
    ["0.25", 0.25],
    ["0,25", 0.25],
    [".25", 0.25],
    [",25", 0.25],
    ["1.05", 1.05],
    ["0.01", MIN_QUANTITY],
    ["10000", MAX_QUANTITY],
    ["10000.0", MAX_QUANTITY],
    ["10000.00", MAX_QUANTITY],
  ];
  for (const [text, quantity] of cases) {
    assert.equal(parseQuantity(text), quantity, text);
  }
});

test("parseQuantity rejects text that isn't a quantity from 0.01 to 10000 with up to two decimals", () => {
  const texts = [
    "",
    "   ",
    "abc",
    "1,255",
    "1.255",
    ".255",
    "0",
    "0.0",
    "0.00",
    "0,001",
    "0,005",
    "10000.01",
    "10001",
    "-1",
    "+1",
    "1e3",
    "1.000,5",
    "1.",
    "1 000",
  ];
  for (const text of texts) {
    assert.equal(parseQuantity(text), null, text);
  }
});

test("twoHundredths counts hundredths of a unit times half servings", () => {
  assert.equal(twoHundredths(1, 1), 200);
  assert.equal(twoHundredths(0.01, 0.5), 1);
  assert.equal(twoHundredths(0.25, 1), 50);
  assert.equal(twoHundredths(4.4, 12.5), 11000);
  assert.equal(twoHundredths(0.3, 99), 5940);
});

test("wholeUnits rounds a total up to a whole number", () => {
  assert.equal(wholeUnits(0), 0);
  assert.equal(wholeUnits(1), 1);
  assert.equal(wholeUnits(200), 1);
  assert.equal(wholeUnits(201), 2);
  assert.equal(wholeUnits(11000), 55);
});

test("the arithmetic stays exact where decimals don't", () => {
  // In floating point, 4.4 × 12.5 is 55.00000000000001,
  // 0.1 + 2.7 + 0.2 is 3.0000000000000004, and 0.56 × 12.5 is
  // 7.000000000000001.
  assert.equal(Math.ceil(4.4 * 12.5), 56);
  assert.equal(wholeUnits(twoHundredths(4.4, 12.5)), 55);
  assert.equal(Math.ceil(0.1 + 2.7 + 0.2), 4);
  assert.equal(
    wholeUnits(twoHundredths(0.1, 1) + twoHundredths(2.7, 1) + twoHundredths(0.2, 1)),
    3,
  );
  assert.equal(Math.ceil(0.56 * 12.5), 8);
  assert.equal(wholeUnits(twoHundredths(0.56, 12.5)), 7);
});
