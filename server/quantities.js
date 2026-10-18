// The quantity rules shared by recipes and ingredient measures.

import { ValidationError } from "./errors.js";

export const MIN_QUANTITY = 0.01;
export const MAX_QUANTITY = 10000;
/**
 * The tolerance for binary floating point, in hundredths: how far a quantity
 * times 100 can be from a whole number, or from a limit, and still count as on
 * it.
 */
export const TOLERANCE = 1e-6;

/**
 * The quantity rounded to two decimals, or undefined when it isn't a number
 * from MIN_QUANTITY to MAX_QUANTITY with at most two decimals. The tolerance
 * absorbs binary floating point, so 0.30000000000000004 counts as 0.3.
 */
export function cleanQuantity(quantity) {
  if (typeof quantity !== "number" || !Number.isFinite(quantity)) return undefined;
  const hundredths = Math.round(quantity * 100);
  if (Math.abs(quantity * 100 - hundredths) > TOLERANCE) return undefined;
  const clean = hundredths / 100;
  return clean >= MIN_QUANTITY && clean <= MAX_QUANTITY ? clean : undefined;
}

/**
 * The clean quantity of `value`. Throws a ValidationError that names the
 * field as `where` when cleanQuantity rejects it.
 */
export function requireQuantity(value, where) {
  const quantity = cleanQuantity(value);
  if (quantity === undefined) {
    throw new ValidationError(
      `${where} must be from ${MIN_QUANTITY} to ${MAX_QUANTITY}, with at most two decimals.`,
    );
  }
  return quantity;
}
