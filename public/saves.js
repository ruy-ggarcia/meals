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
  /** Last text saved, per cell. */
  const lastSaved = new Map();
  /** Per-cell promise chain so saves of one cell run strictly in order. */
  const saveChains = new Map();
  /** Text currently being PUT by the per-cell chain (cleared when that PUT settles). */
  const inFlight = new Map();
  /** Current status, per cell. */
  const statuses = new Map();

  function setStatus(key, state) {
    statuses.set(key, state);
    onStatus(key, state);
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
    try {
      const response = await put(key, text, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      lastSaved.set(key, text);
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
  // unload; bypasses the per-cell chain (last write wins).
  // lastSaved is updated optimistically BEFORE the fetch so a second call
  // (visibilitychange + pagehide) or a later blur doesn't resend; it is
  // restored on failure so the next blur retries.
  function flush(keys, { skipInFlight }) {
    for (const key of keys) {
      const text = readText(key);
      const previous = lastSaved.get(key);
      if (previous === undefined || text === previous) continue; // not loaded / unchanged
      // The page survives a visibilitychange, so a normal PUT already carrying
      // this text will complete; on pagehide it may be cancelled, so resend.
      if (skipInFlight && inFlight.get(key) === text) continue;

      lastSaved.set(key, text);
      const restore = () => {
        if (lastSaved.get(key) === text) lastSaved.set(key, previous);
      };
      put(key, text, { keepalive: true })
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          // Server now has the text; clear a stale error badge.
          if (statuses.get(key) === "error") setStatus(key, "idle");
        })
        .catch((error) => {
          console.error(`Couldn't save ${key} on page hide:`, error);
          restore();
        });
    }
  }

  return { flush, loaded, queueSave };
}
