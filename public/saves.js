// Save logic for the grid: the last saved text, pending saves, and the status
// of each cell. It never touches the DOM, so tests import this module directly
// in Node.js. app.js connects it to the page.

/**
 * Creates the save state. A key identifies a cell, for example "mon/lunch".
 *
 * - `fetch`: sends the requests.
 * - `url(key)`: the URL to PUT a cell's text to.
 * - `readText(key)`: the cell's current text. Saves read it when they run.
 * - `onStatus(key, state)`: called when a cell's status changes to "idle",
 *   "saving", "saved", or "error".
 * - `timeoutMs`: how long a save waits for the server before it gives up.
 */
export function createSaves({ fetch, url, readText, onStatus, timeoutMs }) {
  /** Last text saved, per cell, including page-hide saves still pending. */
  const lastSaved = new Map();
  /** Last text the server confirmed, per cell. Differs from lastSaved only while a page-hide save is pending. */
  const confirmedText = new Map();
  /** Sequence number of the request behind confirmedText, per cell. */
  const confirmedSequence = new Map();
  /** Sequence number of the last PUT sent, for any cell. */
  let lastSequence = 0;
  /** Per-cell promise chain so saves of one cell run strictly in order. */
  const saveChains = new Map();
  /** Text currently being PUT by the per-cell chain (cleared when that PUT settles). */
  const inFlight = new Map();
  /** Current status, per cell. */
  const statuses = new Map();
  /** Page-hide save promises still in flight (never reject; removed when settled). */
  const pageHideSaves = new Set();

  function setStatus(key, state) {
    statuses.set(key, state);
    onStatus(key, state);
  }

  // Records `text` as confirmed unless the server already confirmed a newer
  // request of the cell: responses can arrive in another order than requests.
  function markConfirmed(key, text, sequence) {
    if (sequence < confirmedSequence.get(key)) return;
    confirmedSequence.set(key, sequence);
    confirmedText.set(key, text);
  }

  function put(key, text, options) {
    return fetch(url(key), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      ...options,
    });
  }

  /** Records the text the server returned for each cell, as [key, text] pairs. */
  function loaded(entries) {
    for (const [key, text] of entries) {
      lastSaved.set(key, text);
      markConfirmed(key, text, lastSequence);
      setStatus(key, "idle");
    }
  }

  // Never rejects. Always saves the cell's CURRENT text.
  async function saveIfChanged(key) {
    const text = readText(key);

    if (text === lastSaved.get(key)) {
      // Nothing to send. If a previous attempt failed, the server already has this text.
      if (statuses.get(key) === "error") setStatus(key, "idle");
      return;
    }

    setStatus(key, "saving");
    inFlight.set(key, text);
    const sequence = ++lastSequence;
    try {
      const response = await put(key, text, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      lastSaved.set(key, text);
      markConfirmed(key, text, sequence);
      setStatus(key, "saved");
    } catch (error) {
      console.error(`Couldn't save ${key}:`, error);
      setStatus(key, "error"); // the text stays in the cell
    } finally {
      inFlight.delete(key);
    }
  }

  /** Chains saves per cell: an older PUT can never finish after a newer one. */
  function queueSave(key) {
    const previous = saveChains.get(key) ?? Promise.resolve();
    const next = previous.then(() => saveIfChanged(key));
    saveChains.set(key, next);
    return next;
  }

  // Last-chance save when the page is hidden or unloaded (reload, close, app
  // switch), where blur may never fire. Uses keepalive so the PUT survives
  // unload, with the same timeout as any other save; bypasses the per-cell
  // chain (last write wins). Each save is tracked in pageHideSaves so that
  // settle can wait for it.
  // lastSaved is updated optimistically BEFORE the fetch so a second call
  // (visibilitychange + pagehide) or a later blur doesn't resend; it is
  // restored to the confirmed text on failure so the next blur retries.
  function flush(keys, { skipInFlight }) {
    for (const key of keys) {
      const text = readText(key);
      const previous = lastSaved.get(key);
      if (previous === undefined || text === previous) continue; // not loaded / unchanged
      // The page survives a visibilitychange, so a normal PUT already carrying
      // this text will complete; on pagehide it may be cancelled, so resend.
      if (skipInFlight && inFlight.get(key) === text) continue;

      lastSaved.set(key, text);
      // Returns true if it restored, that is, if no newer save replaced the text.
      // It restores the confirmed text, not `previous`: `previous` may be the
      // text of an earlier page-hide save that fails too.
      const restore = () => {
        if (lastSaved.get(key) !== text) return false;
        lastSaved.set(key, confirmedText.get(key));
        return true;
      };
      const sequence = ++lastSequence;
      const save = put(key, text, { keepalive: true, signal: AbortSignal.timeout(timeoutMs) })
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          markConfirmed(key, text, sequence);
          // Server now has the text; clear a stale error badge, unless the cell
          // holds a newer text that failed to save since.
          if (statuses.get(key) === "error" && readText(key) === text) setStatus(key, "idle");
        })
        .catch((error) => {
          console.error(`Couldn't save ${key} on page hide:`, error);
          // Show the error so the text can be retried, but only if the text is
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

  /** The loaded cells, among `keys`, whose text differs from the saved text. */
  function unsaved(keys) {
    return keys.filter((key) => {
      const saved = lastSaved.get(key);
      return saved !== undefined && readText(key) !== saved;
    });
  }

  /**
   * Gives up the unsaved text of a cell: returns the text the server has, to show
   * instead, and clears the cell's status. No later save sends the discarded
   * text once the cell shows the returned text.
   */
  function discard(key) {
    lastSaved.set(key, confirmedText.get(key));
    setStatus(key, "idle");
    return confirmedText.get(key);
  }

  return { discard, flush, loaded, queueSave, settle, unsaved };
}
