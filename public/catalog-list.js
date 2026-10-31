// The list logic that the recipe book and the ingredient catalog share:
// search, the active and archived lists, restoring, row messages, moving
// focus after a row leaves a list, and reloading before New or a row opens
// the editor, where archiving happens. Each page supplies its elements, its
// texts, what a row shows under or after the name, its reload, and its
// editor.

import { createButton, createElement, createIcon, focusIsFree } from "./dom.js";
import { sendJson } from "./http.js";
import { quoted } from "./messages.js";
import { filterByName, sortByName } from "./name-search.js";

/**
 * `elements` holds the page's `search` field, `emptyMessage`, `noMatches`,
 * `activeList`, `archived` (the <details>), `archivedCount`, `archivedList`,
 * the `newButton` that opens the editor on a new entry, and the
 * `retryButton` of the load error. `noun` is "recipe" or "ingredient", for
 * messages and IDs. `url(id)` is an entry's API URL, and `details(entry)`
 * returns the nodes a row shows with the name. `onChange(entries)` runs
 * whenever the entries change, with all of them.
 *
 * `reload()` loads the entries again, calls setEntries(), and resolves to
 * true when the load succeeds. `open(entry, { restoreFocus, onSaved })` opens
 * the page's editor on `entry`, or on a new entry when it's undefined, and
 * passes the two callbacks on to it.
 *
 * Returns { setEntries }.
 */
export function createCatalogList({ elements, noun, url, details, onChange, reload, open }) {
  const {
    search,
    emptyMessage,
    noMatches,
    activeList,
    archived,
    archivedCount,
    archivedList,
    newButton,
    retryButton,
  } = elements;

  /** Every entry, active and archived, as the server last confirmed. */
  let entries = [];
  /** Error messages under rows, by entry ID. */
  const rowMessages = new Map();
  /** Entry IDs with a restore request running. */
  const busy = new Set();
  /** True while New or a row reloads, so a second click opens no second editor. */
  let opening = false;

  function rowElement(id) {
    const selector = `.catalog-row[data-id="${CSS.escape(id)}"]`;
    return activeList.querySelector(selector) ?? archivedList.querySelector(selector);
  }

  // A row: a button with the name and the details that opens the editor, and
  // for an archived entry, Restore.
  function row(entry) {
    const item = createElement("li", "catalog-row");
    item.dataset.id = entry.id;
    const detail = createElement("span", "entry-detail");
    detail.id = `${noun}-detail-${entry.id}`;
    detail.append(...details(entry));
    const edit = createButton("", `Edit ${entry.name}`, "entry");
    // A screen reader reads the details after the button's name.
    edit.setAttribute("aria-describedby", detail.id);
    edit.append(
      createElement("span", "entry-name", entry.name),
      detail,
      createIcon("chevron", "chevron"),
    );
    edit.addEventListener("click", () => openEditor(entry.id));
    item.append(edit);
    if (entry.archived) {
      const restoreButton = createButton("Restore", `Restore ${entry.name}`, "restore");
      restoreButton.disabled = busy.has(entry.id);
      restoreButton.addEventListener("click", () => restore(entry.id));
      item.append(restoreButton);
    }
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
    onChange(entries);
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

  /** Focuses an entry's row, or Search when a search hides the row. */
  function focusEdit(id) {
    (rowElement(id)?.querySelector(".entry") ?? search).focus();
  }

  function indexIn(list, id) {
    return [...list.children].findIndex((element) => element.dataset.id === id);
  }

  // After a row leaves a list, focus moves to the row now in its place, the
  // one before it, or the search field: to the row itself in the active list,
  // and to its Restore button in Archived.
  function focusNeighbor(list, index) {
    const target = list.children[Math.min(index, list.children.length - 1)];
    const control = list === activeList ? ".entry" : ".restore";
    (target?.querySelector(control) ?? search).focus();
  }

  async function restore(id) {
    const failure = `Couldn't restore the ${noun}. Try again.`;
    const index = indexIn(archivedList, id);
    busy.add(id);
    resetMessages();
    try {
      const { status, body } = await sendJson("PATCH", url(id), { archived: false });
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
      rowElement(id)?.querySelector(".restore")?.focus();
    } else {
      focusNeighbor(archivedList, index);
    }
  }

  // Opens the editor on the entry with `id`, or on a new entry when it's
  // undefined. It first reloads, so the editor never saves what another device
  // changed since the page loaded, such as the unit of an ingredient. When the
  // reload fails, the load error shows instead, with focus on Retry.
  async function openEditor(id) {
    if (opening) return;
    opening = true;
    resetMessages();
    const loaded = await reload();
    opening = false;
    if (!loaded) {
      retryButton.focus();
      return;
    }
    const entry = id === undefined ? undefined : entries.find((other) => other.id === id);
    // The refreshed list no longer has the row, so focus falls back to Search.
    if (id !== undefined && !entry) {
      focusEdit(id);
      return;
    }
    open(entry, {
      // By ID: the rows re-render, which replaces the button that was clicked.
      restoreFocus: () => (entry ? focusEdit(entry.id) : newButton.focus()),
      onSaved: (saved) => {
        // An entry that the editor archived leaves the active list.
        const index = saved.archived ? indexIn(activeList, saved.id) : -1;
        remember(saved);
        if (index >= 0) focusNeighbor(activeList, index);
        else focusEdit(saved.id);
      },
    });
  }

  newButton.addEventListener("click", () => openEditor());
  search.addEventListener("input", render);

  return { setEntries };
}
