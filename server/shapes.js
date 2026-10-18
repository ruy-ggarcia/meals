// Shape checks shared by the stores, for request bodies and stored entries.

/** Whether the value is an object other than null or an array. */
export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The keys of a plain object, sorted and joined with commas, such as
 * "name,unit", or "" for any other value. Compare it with a sorted key list
 * to check that a value has exactly those keys.
 */
export function shapeOf(value) {
  return isPlainObject(value) ? Object.keys(value).sort().join() : "";
}
