// The family preferences: one free text that the assistant reads in every
// conversation, such as dietary rules and who eats away from home.

import { ValidationError } from "./errors.js";
import { dataPath, readJson, writeJson } from "./files.js";
import { isPlainObject } from "./shapes.js";

export const MAX_PREFERENCES = 10000;

// The text of the file. `raw` is undefined when the file doesn't exist,
// which is an empty text. A file that exists but isn't shaped like
// { text: "..." } is rejected instead, the same as invalid JSON, so it's
// never overwritten.
function normalize(raw) {
  if (raw === undefined) return "";
  if (!isPlainObject(raw) || typeof raw.text !== "string") {
    throw new Error('preferences.json must be an object with a "text" string.');
  }
  return raw.text;
}

/**
 * @param {{ dataDir: string, enqueue: (task: () => Promise<any>) => Promise<any> }} options
 */
export function createPreferences({ dataDir, enqueue }) {
  const file = dataPath(dataDir, "preferences.json");

  /** The saved text, or "" before the first save. Never waits for the queue. */
  async function read() {
    return normalize(await readJson(file));
  }

  /**
   * Saves `text` and resolves to it. Rejects with a ValidationError when
   * `text` isn't a string of at most MAX_PREFERENCES characters.
   * @param {unknown} text
   * @returns {Promise<string>}
   */
  async function save(text) {
    if (typeof text !== "string" || text.length > MAX_PREFERENCES) {
      throw new ValidationError(
        `"text" must be a string of at most ${MAX_PREFERENCES} characters.`,
      );
    }
    return enqueue(async () => {
      // Reads first, so a file with the wrong shape rejects and stays as it is.
      await read();
      await writeJson(file, { text });
      return text;
    });
  }

  return { read, save };
}
