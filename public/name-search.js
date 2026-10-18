// Name helpers for recipes and ingredients. They never touch the DOM, so
// tests import this module directly in Node.js.

/**
 * The name as the server stores it: trimmed, with runs of whitespace
 * collapsed to one space. The server has the same rule in server/names.js.
 */
export function cleanName(name) {
  return name.trim().replace(/\s+/g, " ");
}

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
  const key = nameKey(cleanName(query));
  return entries.filter((entry) => nameKey(entry.name).includes(key));
}
