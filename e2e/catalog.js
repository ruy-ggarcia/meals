// The data that every browser test starts from: the fixed date, the weeks
// around it, and the catalog of recipes and ingredients.

/** Wednesday, September 23, 2026, 10:00 in Madrid. */
export const NOW = new Date("2026-09-23T10:00:00+02:00");

/** The week of `NOW`, and the week after it. */
export const CURRENT_WEEK = "2026-09-21";
export const NEXT_WEEK = "2026-09-28";

export const RECIPE_NAMES = [
  "Gnocchi carbonara",
  "Green salad",
  "Lentil soup",
  "Omelette",
  "Russian salad",
  "<b>Bold</b> soup",
  "Supercalifragilisticexpialidocious-casserole-with-a-very-long-name",
];

export const INGREDIENTS = [
  { name: "Egg", unit: "pcs" },
  { name: "Milk", unit: "ml" },
  { name: "Onion", unit: "g" },
  { name: "Rice", unit: "g" },
];
