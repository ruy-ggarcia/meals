// Recipe name helpers for both pages. They never touch the DOM, so tests
// import this module directly in Node.js.

/**
 * Decides matching and order. It ignores case and accents, so "Café" and
 * "cafe" share a key. The server has the same rule in server/recipes.js.
 */
export function nameKey(name) {
  return name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** A new array of `recipes`, sorted from A to Z by name key. */
export function sortRecipes(recipes) {
  return [...recipes].sort((a, b) => {
    const keyA = nameKey(a.name);
    const keyB = nameKey(b.name);
    if (keyA < keyB) return -1;
    return keyA > keyB ? 1 : 0;
  });
}

/** The recipes whose name contains `query`, ignoring case, accents, and extra spaces. */
export function filterRecipes(recipes, query) {
  const key = nameKey(query.trim().replace(/\s+/g, " "));
  return recipes.filter((recipe) => nameKey(recipe.name).includes(key));
}
