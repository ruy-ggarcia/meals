// Test helpers shared across test files.

/** A week with every slot holding an empty menu, for `days` and `meals` arrays. */
export function blankWeek(days, meals) {
  return Object.fromEntries(
    days.map((day) => [day, Object.fromEntries(meals.map((meal) => [meal, { items: [] }]))]),
  );
}

/**
 * A logger that keeps each entry as `{ level, msg, ...fields }` in `entries`,
 * so tests can check logs without printing them.
 */
export function collectingLogger() {
  const entries = [];
  const entry =
    (level) =>
    (msg, fields = {}) => {
      entries.push({ level, msg, ...fields });
    };
  return { entries, logger: { error: entry("error"), info: entry("info") } };
}

/**
 * Waits for PROMISE and returns its value. Rejects with an error that has
 * MESSAGE if PROMISE doesn't settle within MS milliseconds, so a regression
 * fails the test at once instead of waiting for the test timeout. The timer
 * never outlives the wait.
 */
export async function within(promise, message, ms = 2000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
