// The limits of the domain as the model reads them, in the instructions and in
// the descriptions of the proposal tools. They're built from the constants
// that the stores enforce, so what the model reads can't drift from the rules.

import { MAX_MEASURES } from "../ingredients.js";
import { MAX_NAME_LENGTH } from "../names.js";
import { MAX_QUANTITY, MIN_QUANTITY } from "../quantities.js";
import { MAX_INGREDIENTS } from "../recipes.js";
import { MAX_ITEMS, MAX_SERVINGS, MIN_SERVINGS } from "../weeks.js";

const LISTS = {
  and: new Intl.ListFormat("en-US", { type: "conjunction" }),
  or: new Intl.ListFormat("en-US", { type: "disjunction" }),
};

/**
 * Joins `words` as a list in US English, with a serial comma: "g, ml, or pcs".
 * @param {readonly string[]} words
 * @param {"and" | "or"} conjunction
 * @returns {string}
 */
export function listOf(words, conjunction) {
  return LISTS[conjunction].format(words);
}

/** The limits of the domain, one sentence each. */
export const LIMITS = [
  `Servings are a multiple of ${MIN_SERVINGS} from ${MIN_SERVINGS} to ${MAX_SERVINGS}.`,
  `A quantity, and the amount of a measure, is a number from ${MIN_QUANTITY} to ${MAX_QUANTITY} with at most two decimals.`,
  `A menu holds at most ${MAX_ITEMS} menu items, each recipe once.`,
  `A recipe holds at most ${MAX_INGREDIENTS} ingredients, each ingredient once.`,
  `An ingredient holds at most ${MAX_MEASURES} measures.`,
  `A name, of a recipe, an ingredient, or a measure, has at most ${MAX_NAME_LENGTH} characters.`,
];
