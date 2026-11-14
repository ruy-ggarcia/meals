// Creates the stores on one write queue and wires them to each other: the
// recipe book checks ingredients against the catalog, and the catalog asks
// the recipe book whether an ingredient is in use, and has it move recipe
// lines to a measure when the unit changes. It also reads and writes the
// data of several files at once, for changes that span them.

import { createQueue } from "./files.js";
import { createIngredients } from "./ingredients.js";
import { createRecipes } from "./recipes.js";
import { createWeeks } from "./weeks.js";

/**
 * The data as stored: every ingredient, every recipe with every ingredient
 * line, and each week by its ID, by structure only, so its items keep
 * recipes that the recipe book doesn't have.
 * @typedef {object} State
 * @property {any[]} ingredients
 * @property {any[]} recipes
 * @property {Record<string, any>} weeks
 */

export function createStores({ dataDir }) {
  // One queue for every file, so a save never checks another file while it
  // changes.
  const enqueue = createQueue();
  // `recipes` is read only when these functions run, after it's created below.
  const ingredients = createIngredients({
    dataDir,
    enqueue,
    moveUnitLinesToMeasure: (id, measureId) => recipes.moveUnitLinesToMeasure(id, measureId),
    usageOf: (id) => recipes.usageOf(id),
  });
  const recipes = createRecipes({ dataDir, enqueue, ingredients });
  const weeks = createWeeks({ dataDir, enqueue, recipes });
  // An empty task runs after every write queued before it, so idle()
  // resolves once those writes are on disk.
  const idle = () => enqueue(() => {});

  /**
   * The data of the catalog, the recipe book, and the weeks of `weekIds`.
   * Never waits for the queue. Reads the weeks before the recipe book, and
   * the recipe book before the catalog: entries are never deleted, so this
   * order can't miss an entry that a concurrent save just added and that an
   * earlier read points to.
   * @param {string[]} weekIds
   * @returns {Promise<State>}
   */
  async function read(weekIds) {
    const stored = await Promise.all(weekIds.map((week) => weeks.readStored(week)));
    const recipeList = await recipes.readAll();
    const ingredientList = await ingredients.readAll();
    return {
      ingredients: ingredientList,
      recipes: recipeList,
      weeks: Object.fromEntries(weekIds.map((week, index) => [week, stored[index]])),
    };
  }

  /**
   * Reads the data in one task of the queue, and passes it to `compute`,
   * which returns `{ state, result }` without changing the data that it gets.
   * Writes the catalog, the recipe book, and each week of `weekIds`, in that
   * order, only where `state` holds another object than the one read, and
   * resolves to `result`. When `compute` throws, nothing is written and the
   * error rejects. The order of the writes means that a failure between two
   * of them leaves extra entries, never a recipe or a menu that points to
   * something missing.
   * @param {string[]} weekIds
   * @param {(state: State) => { state: State, result: any }} compute
   * @returns {Promise<any>}
   */
  function transaction(weekIds, compute) {
    return enqueue(async () => {
      const before = await read(weekIds);
      const { state, result } = compute(before);
      if (state.ingredients !== before.ingredients) await ingredients.writeAll(state.ingredients);
      if (state.recipes !== before.recipes) await recipes.writeAll(state.recipes);
      for (const week of weekIds) {
        if (state.weeks[week] !== before.weeks[week]) {
          await weeks.writeStored(week, state.weeks[week]);
        }
      }
      return result;
    });
  }

  return { idle, ingredients, read, recipes, transaction, weeks };
}
