// Test helpers shared across test files.

/** A week with every slot holding an empty menu, for `days` and `meals` arrays. */
export function blankWeek(days, meals) {
  return Object.fromEntries(
    days.map((day) => [day, Object.fromEntries(meals.map((meal) => [meal, { items: [] }]))]),
  );
}
