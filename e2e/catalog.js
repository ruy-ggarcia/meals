// The data that every browser test starts from: the fixed date, the weeks
// around it, and the catalog of recipes and ingredients.

/** Wednesday, September 23, 2026, 10:00 in Madrid. */
export const NOW = new Date("2026-09-23T10:00:00+02:00");

/** The week of `NOW`, and the week after it. */
export const CURRENT_WEEK = "2026-09-21";
export const NEXT_WEEK = "2026-09-28";

/** What the toolbar shows as the range of those two weeks. */
export const CURRENT_RANGE = "Sep 21 – 27, 2026";
export const NEXT_RANGE = "Sep 28 – Oct 4, 2026";

// A word of 77 letters, with no hyphen or space where a line could break, and
// within the 100 characters that a name may have.
export const LONG_NAME =
  "SupercalifragilisticexpialidociousSupercalifragilisticexpialidociousSupercali";

export const RECIPE_NAMES = [
  "Gnocchi carbonara",
  "Green salad",
  "Lentil soup",
  "Omelette",
  "Russian salad",
  "<b>Bold</b> soup",
  LONG_NAME,
];

export const INGREDIENTS = [
  { name: "Egg", unit: "pcs" },
  { name: "Milk", unit: "ml" },
  { name: "Onion", unit: "g" },
  { name: "Rice", unit: "g" },
];
