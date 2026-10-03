// Quantities of ingredients per serving, and the arithmetic of the shopping
// list. They never touch the DOM, so tests import this module directly in
// Node.js.

// The same limits the API enforces.
export const MAX_INGREDIENTS = 50;
export const MIN_QUANTITY = 0.01;
export const MAX_QUANTITY = 10000;

// Digits with at most two decimals, after "." or ",": phone keyboards in some
// languages only offer ",".
const QUANTITY_PATTERN = /^(?:\d+(?:[.,]\d{1,2})?|[.,]\d{1,2})$/;

/**
 * The quantity that `text` holds, or null when it isn't a number from
 * MIN_QUANTITY to MAX_QUANTITY with at most two decimals.
 */
export function parseQuantity(text) {
  const trimmed = text.trim();
  if (!QUANTITY_PATTERN.test(trimmed)) return null;
  const quantity = Number(trimmed.replace(",", "."));
  return quantity >= MIN_QUANTITY && quantity <= MAX_QUANTITY ? quantity : null;
}

/**
 * What `quantity` per serving makes for `servings`, in two-hundredths of a
 * unit: hundredths of a unit times half servings. Both are whole numbers, so
 * sums of them are exact, unlike sums of the decimals themselves.
 */
export function twoHundredths(quantity, servings) {
  return Math.round(quantity * 100) * Math.round(servings * 2);
}

/** A total in two-hundredths as the whole number of units to buy, rounded up. */
export function wholeUnits(total) {
  return Math.ceil(total / 200);
}
