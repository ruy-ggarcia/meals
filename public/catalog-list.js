// The list logic that the recipe book and the ingredient catalog share:
// search, the active and archived lists, archiving and restoring, row
// messages, and moving focus after a row leaves a list. Each page supplies
// its elements, its texts, and what a row shows besides the name.

import { createButton, createElement, focusIsFree } from "./dom.js";
import { sendJson } from "./http.js";
import { quoted } from "./messages.js";
import { filterByName, sortByName } from "./name-search.js";

/**
 * `elements` holds the page's `search` field, `emptyMessage`, `noMatches`,
 * `activeList`, `archived` (the <details>), `archivedCount`, and
 * `archivedList`. `noun` is "recipe" or "ingredient", for messages.
 * `url(id)` is an entry's API URL, and `details(entry)` returns the nodes a
 * row shows after the name. `onEdit(entry)` opens the entry's editor.
 *
 * Returns { focusEdit, remember, resetMessages, setEntries }.
 */
export function createCatalogList({ elements, noun, url, details, onEdit }) {
  const { search, emptyMessage, noMatches, activeList, archived, archivedCount, archivedList } =
    elements;

  /** Every entry, active and archived, as the server last confirmed. */
  let entries = [];
  /** Error messages under rows, by entry ID. */
  const rowMessages = new Map();
  /** Entry IDs with an archive or restore request running. */
  const busy = new Set();

  function rowElement(id) {
    const selector = `.catalog-row[data-id="${CSS.escape(id)}"]`;
    return activeList.querySelector(selector) ?? archivedList.querySelector(selector);
  }

  function button(text, label, onClick) {
    const element = createButton(text, label);
    element.addEventListener("click", onClick);
    return element;
  }

  function row(entry) {
    const item = createElement("li", "catalog-row");
    item.dataset.id = entry.id;
    const label = createElement("span", "entry");
    label.append(createElement("span", "entry-name", entry.name), ...details(entry));
    const edit = button("Edit", `Edit ${entry.name}`, () => onEdit(entry));
    const toggle = entry.archived
      ? button("Restore", `Restore ${entry.name}`, () => setArchived(entry.id, false))
      : button("Archive", `Archive ${entry.name}`, () => setArchived(entry.id, true));
    const actions = createElement("span", "row-actions");
    actions.append(edit, toggle);
    for (const control of actions.children) control.disabled = busy.has(entry.id);
    item.append(label, actions);
    const message = rowMessages.get(entry.id);
    if (message) item.append(createElement("p", "row-message", message));
    return item;
  }

  function render() {
    const query = search.value.trim();
    const matches = sortByName(filterByName(entries, search.value));
    const activeMatches = matches.filter((entry) => !entry.archived);
    const archivedTotal = entries.filter((entry) => entry.archived).length;
    activeList.replaceChildren(...activeMatches.map(row));
    archivedList.replaceChildren(...matches.filter((entry) => entry.archived).map(row));
    archivedCount.textContent = String(archivedTotal);
    archived.hidden = archivedTotal === 0;
    emptyMessage.hidden = entries.length > 0;
    // Depends on active matches only: an archived entry that matches doesn't
    // hide the message, because it's as if it didn't exist.
    noMatches.hidden = entries.length === 0 || query === "" || activeMatches.length > 0;
    noMatches.textContent = `No ${noun}s match ${quoted(query)}.`;
  }

  function setEntries(list) {
    entries = list;
    render();
  }

  /** Replaces or adds `entry`, as the server confirmed it, and shows it. */
  function remember(entry) {
    entries = [...entries.filter((other) => other.id !== entry.id), entry];
    render();
  }

  // Clears every row message and re-renders, so a new request starts without
  // a stale error from an earlier one.
  function resetMessages() {
    rowMessages.clear();
    render();
  }

  /** Focuses the Edit button of an entry's row, or Search when a search hides the row. */
  function focusEdit(id) {
    (rowElement(id)?.querySelector(".row-actions button") ?? search).focus();
  }

  // After a row leaves a list, focus moves to the row now in its place, the
  // one before it, or the search field.
  function focusNeighbor(list, index) {
    const target = list.children[Math.min(index, list.children.length - 1)];
    (target?.querySelector(".row-actions button:last-child") ?? search).focus();
  }

  async function setArchived(id, archive) {
    const failure = archive
      ? `Couldn't archive the ${noun}. Try again.`
      : `Couldn't restore the ${noun}. Try again.`;
    const list = archive ? activeList : archivedList;
    const index = [...list.children].findIndex((element) => element.dataset.id === id);
    busy.add(id);
    resetMessages();
    try {
      const { status, body } = await sendJson("PATCH", url(id), { archived: archive });
      if (status !== 200) throw new Error(`HTTP ${status}`);
      entries = [...entries.filter((entry) => entry.id !== id), body];
    } catch (error) {
      console.error(failure, error);
      rowMessages.set(id, failure);
    }
    busy.delete(id);
    render();
    if (!focusIsFree()) return;
    if (rowMessages.has(id)) {
      rowElement(id)?.querySelector(".row-actions button:last-child")?.focus();
    } else {
      focusNeighbor(list, index);
    }
  }

  search.addEventListener("input", render);

  return { focusEdit, remember, resetMessages, setEntries };
}
