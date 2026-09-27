// Creates the stores on one write queue and wires them to each other: the
// recipe book checks ingredients against the catalog, and the catalog asks
// the recipe book whether an ingredient is in use.

import { createQueue } from "./files.js";
import { createIngredients } from "./ingredients.js";
import { createRecipes } from "./recipes.js";
import { createWeeks } from "./weeks.js";

export function createStores({ dataDir }) {
  // One queue for every file, so a save never checks another file while it
  // changes.
  const enqueue = createQueue();
  // `recipes` is read only when isInUse runs, after it's created below.
  const ingredients = createIngredients({
    dataDir,
    enqueue,
    isInUse: (id) => recipes.usesIngredient(id),
  });
  const recipes = createRecipes({ dataDir, enqueue, ingredients });
  const weeks = createWeeks({ dataDir, enqueue, recipes });
  return { ingredients, recipes, weeks };
}
