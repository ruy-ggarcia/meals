// A client of the HTTP API, for the seed data of the tests and for reading
// what the server saved.

/**
 * Returns the API of the server at `url`. Each method resolves to the parsed
 * JSON body, and throws for any status other than 2xx. `day` is `mon` to
 * `sun`, and `meal` is one of `breakfast`, `snack_am`, `lunch`, `snack_pm`,
 * and `dinner`.
 */
export function createApi(url) {
  async function request(method, path, body) {
    const response = await fetch(`${url}${path}`, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}: ${text}`);
    return JSON.parse(text);
  }

  return {
    recipes: () => request("GET", "/api/recipes"),
    createRecipe: (fields) => request("POST", "/api/recipes", fields),
    updateRecipe: (id, changes) => request("PATCH", `/api/recipes/${id}`, changes),
    ingredients: () => request("GET", "/api/ingredients"),
    createIngredient: (fields) => request("POST", "/api/ingredients", fields),
    updateIngredient: (id, changes) => request("PATCH", `/api/ingredients/${id}`, changes),
    week: (weekId) => request("GET", `/api/weeks/${weekId}`),
    saveSlot: (weekId, day, meal, items) =>
      request("PUT", `/api/weeks/${weekId}/${day}/${meal}`, { items }),
  };
}
