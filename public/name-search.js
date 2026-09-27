// Name helpers for recipes and ingredients. They never touch the DOM, so
// tests import this module directly in Node.js.

/**
 * Decides matching and order. It ignores case and accents, so "Café" and
 * "cafe" share a key. The server has the same rule in server/names.js.
 */
export function nameKey(name) {
  return name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** A new array of `entries`, each with a `name`, sorted from A to Z by name key. */
export function sortByName(entries) {
  return [...entries].sort((a, b) => {
    const keyA = nameKey(a.name);
    const keyB = nameKey(b.name);
    if (keyA < keyB) return -1;
    return keyA > keyB ? 1 : 0;
  });
}

/** The entries whose name contains `query`, ignoring case, accents, and extra spaces. */
export function filterByName(entries, query) {
  const key = nameKey(query.trim().replace(/\s+/g, " "));
  return entries.filter((entry) => nameKey(entry.name).includes(key));
}
