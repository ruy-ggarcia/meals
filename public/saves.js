// Save logic for the grid: the last saved menu, pending saves, and the status
// of each slot. It never touches the DOM, so tests import this module directly
// in Node.js. app.js connects it to the page.

import { copyMenu, sameMenu } from "./menus.js";

// Like sameMenu, but a missing menu (a slot that isn't loaded) matches nothing.
function same(a, b) {
  return a !== undefined && b !== undefined && sameMenu(a, b);
}

/**
 * Creates the save state. A key identifies a slot, for example
 * "2026-09-21/mon/lunch".
 *
 * - `fetch`: sends the requests.
 * - `url(key)`: the URL to PUT a slot's menu to.
 * - `readMenu(key)`: the slot's current menu, or undefined when the slot
 *   isn't loaded. Saves read it when they run.
 * - `onStatus(key, state)`: called when a slot's status changes to "idle",
 *   "saving", "saved", or "error".
 * - `timeoutMs`: how long a save waits for the server before it gives up.
 *
 * Menus are compared by content, and this module keeps its own copies, so
 * callers may reuse or change the objects they pass.
 */
export function createSaves({ fetch, url, readMenu, onStatus, timeoutMs }) {
  /** Last menu saved, per slot, including page-hide saves still pending. */
  const lastSaved = new Map();
  /** Last menu the server confirmed, per slot. Differs from lastSaved only while a page-hide save is pending. */
  const confirmedMenu = new Map();
  /** Sequence number of the request behind confirmedMenu, per slot. */
  const confirmedSequence = new Map();
  /** Sequence number of the last PUT sent, for any slot. */
  let lastSequence = 0;
  /** Per-slot promise chain so saves of one slot run strictly in order. */
  const saveChains = new Map();
  /** Menu currently being PUT by the per-slot chain (cleared when that PUT settles). */
  const inFlight = new Map();
  /** Current status, per slot. */
  const statuses = new Map();
  /** Page-hide save promises still in flight (never reject; removed when settled). */
  const pageHideSaves = new Set();

  function setStatus(key, state) {
    statuses.set(key, state);
    onStatus(key, state);
  }

  // Records `menu` as confirmed unless the server already confirmed a newer
  // request of the slot: responses can arrive in another order than requests.
  function markConfirmed(key, menu, sequence) {
    if (sequence < confirmedSequence.get(key)) return;
    confirmedSequence.set(key, sequence);
    confirmedMenu.set(key, menu);
  }

  function put(key, menu, options) {
    return fetch(url(key), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: menu.items }),
      ...options,
    });
  }

  /** Records the menu the server returned for each slot, as [key, menu] pairs. */
  function loaded(entries) {
    for (const [key, menu] of entries) {
      const copy = copyMenu(menu);
      lastSaved.set(key, copy);
      markConfirmed(key, copy, lastSequence);
      setStatus(key, "idle");
    }
  }

  // Never rejects. Always saves the slot's CURRENT menu.
  async function saveIfChanged(key) {
    const current = readMenu(key);
    if (current === undefined || lastSaved.get(key) === undefined) return; // not loaded: nothing to save

    if (same(current, lastSaved.get(key))) {
      // Nothing to send. If a previous attempt failed, the server already has this menu.
      if (statuses.get(key) === "error") setStatus(key, "idle");
      return;
    }

    const menu = copyMenu(current);
    setStatus(key, "saving");
    inFlight.set(key, menu);
    const sequence = ++lastSequence;
    try {
      const response = await put(key, menu, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      lastSaved.set(key, menu);
      markConfirmed(key, menu, sequence);
      setStatus(key, "saved");
    } catch (error) {
      console.error(`Couldn't save ${key}:`, error);
      setStatus(key, "error"); // the slot keeps its menu
    } finally {
      inFlight.delete(key);
    }
  }

  /** Chains saves per slot: an older PUT can never finish after a newer one. */
  function queueSave(key) {
    const previous = saveChains.get(key) ?? Promise.resolve();
    const next = previous.then(() => saveIfChanged(key));
    saveChains.set(key, next);
    return next;
  }

  // Last-chance save when the page is hidden or unloaded (reload, close, app
  // switch). Uses keepalive so the PUT survives unload, with the same timeout
  // as any other save; bypasses the per-slot chain (last write wins). Each
  // save is tracked in pageHideSaves so that settle can wait for it.
  // lastSaved is updated optimistically BEFORE the fetch so a second call
  // (visibilitychange + pagehide) or a later queueSave doesn't resend; it is
  // restored to the confirmed menu on failure so the next save retries.
  function flush(keys, { skipInFlight }) {
    for (const key of keys) {
      const current = readMenu(key);
      const previous = lastSaved.get(key);
      if (current === undefined || previous === undefined) continue; // not loaded
      if (sameMenu(current, previous)) continue; // unchanged
      // The page survives a visibilitychange, so a normal PUT already carrying
      // this menu will complete; on pagehide it may be cancelled, so resend.
      if (skipInFlight && same(inFlight.get(key), current)) continue;

      const menu = copyMenu(current);
      lastSaved.set(key, menu);
      // Returns true if it restored, that is, if no newer save replaced the menu.
      // It restores the confirmed menu, not `previous`: `previous` may be the
      // menu of an earlier page-hide save that fails too.
      const restore = () => {
        if (!same(lastSaved.get(key), menu)) return false;
        lastSaved.set(key, confirmedMenu.get(key));
        return true;
      };
      const sequence = ++lastSequence;
      const save = put(key, menu, { keepalive: true, signal: AbortSignal.timeout(timeoutMs) })
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          markConfirmed(key, menu, sequence);
          // Server now has the menu; clear a stale error badge, unless the slot
          // holds a newer menu that failed to save since.
          if (statuses.get(key) === "error" && same(readMenu(key), menu)) setStatus(key, "idle");
        })
        .catch((error) => {
          console.error(`Couldn't save ${key} on page hide:`, error);
          // Show the error so the menu can be retried, but only if the menu is
          // still unsaved and no newer save is running.
          if (restore() && statuses.get(key) !== "saving") setStatus(key, "error");
        })
        .finally(() => pageHideSaves.delete(save));
      pageHideSaves.add(save);
    }
  }

  /** Waits for every pending save, including page-hide saves that start meanwhile. */
  async function settle() {
    // Each page-hide save removes itself when it settles, so this ends.
    do {
      await Promise.all([...saveChains.values(), ...pageHideSaves]);
    } while (pageHideSaves.size > 0);
  }

  /** The loaded slots, among `keys`, whose menu differs from the saved menu. */
  function unsaved(keys) {
    return keys.filter((key) => {
      const saved = lastSaved.get(key);
      const current = readMenu(key);
      return saved !== undefined && current !== undefined && !sameMenu(current, saved);
    });
  }

  /**
   * Gives up the unsaved menu of a slot: returns a copy of the menu the server
   * has, to show instead, and clears the slot's status. No later save sends
   * the discarded menu once the slot shows the returned menu.
   */
  function discard(key) {
    lastSaved.set(key, confirmedMenu.get(key));
    setStatus(key, "idle");
    return copyMenu(confirmedMenu.get(key));
  }

  return { discard, flush, loaded, queueSave, settle, unsaved };
}
