// The assistant's settings that the owner saves in Settings: the provider, the
// model, and the API key. They live in DATA_DIR/v2/assistant.json with the
// other data, so backups include the key, in plain text. The key never goes
// back to a browser or into a log: no message of this module holds a value
// that it got.

import { ConflictError, ValidationError } from "../errors.js";
import { dataPath, readJson, writeJson } from "../files.js";
import { shapeOf } from "../shapes.js";
import { PROVIDERS } from "./providers/index.js";

export const MAX_MODEL = 200;
export const MAX_KEY = 500;
// The C0 controls, DEL, and the C1 controls.
// biome-ignore lint/suspicious/noControlCharactersInRegex: it finds them on purpose.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
// Printable ASCII without the space: what the providers' keys are made of.
const KEY = new RegExp(`^[\\x21-\\x7e]{1,${MAX_KEY}}$`);
// Only the owner and the group of the data directory read the key. The other
// data files follow the umask, which leaves them readable by everyone.
const MODE = 0o640;

/**
 * The settings as saved. `apiKey` is null when no key is saved.
 * @typedef {{ provider: "anthropic" | "openai", model: string, apiKey: string | null }} SavedSettings
 */

function isProvider(value) {
  return PROVIDERS.includes(value);
}

function isModel(value) {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= MAX_MODEL &&
    !CONTROL.test(value)
  );
}

function isKey(value) {
  return typeof value === "string" && KEY.test(value);
}

/**
 * The settings of the file. `raw` is undefined when the file doesn't exist.
 * A file of another shape rejects, the same as invalid JSON, so it's never
 * overwritten.
 * @returns {SavedSettings | undefined}
 */
function normalize(raw) {
  if (raw === undefined) return undefined;
  if (
    shapeOf(raw) !== "apiKey,model,provider" ||
    !isProvider(raw.provider) ||
    !isModel(raw.model) ||
    (raw.apiKey !== null && !isKey(raw.apiKey))
  ) {
    throw new Error(
      'assistant.json must be an object with a "provider", a "model", and an "apiKey" that Settings accepts.',
    );
  }
  return raw;
}

/**
 * Throws a ValidationError, which names the field and never its value, when
 * `changes` isn't `{ provider, model }` or `{ provider, model, apiKey }` with
 * valid values.
 * @param {any} changes
 */
export function checkChanges(changes) {
  const shape = shapeOf(changes);
  if (shape !== "model,provider" && shape !== "apiKey,model,provider") {
    throw new ValidationError(
      'The settings must have "provider" and "model", may have "apiKey", and have nothing else.',
    );
  }
  if (!isProvider(changes.provider)) {
    throw new ValidationError(`"provider" must be ${PROVIDERS.join(" or ")}.`);
  }
  if (!isModel(changes.model)) {
    throw new ValidationError(
      `"model" must have 1 to ${MAX_MODEL} characters and no control characters.`,
    );
  }
  const { apiKey } = changes;
  if (apiKey !== undefined && apiKey !== null && !isKey(apiKey)) {
    throw new ValidationError(
      `"apiKey" must be null, or 1 to ${MAX_KEY} printable ASCII characters without spaces.`,
    );
  }
}

/**
 * Throws a ValidationError, which names the field and never its value, when
 * `request` for a model list isn't `{ provider }` or `{ provider, apiKey }`
 * with valid values. Its rules are those of `checkChanges`, except that the
 * key can't be null.
 * @param {any} request
 */
export function checkListRequest(request) {
  const shape = shapeOf(request);
  if (shape !== "provider" && shape !== "apiKey,provider") {
    throw new ValidationError(
      'The request must have "provider", may have "apiKey", and have nothing else.',
    );
  }
  if (!isProvider(request.provider)) {
    throw new ValidationError(`"provider" must be ${PROVIDERS.join(" or ")}.`);
  }
  if (request.apiKey !== undefined && !isKey(request.apiKey)) {
    throw new ValidationError(
      `"apiKey" must have 1 to ${MAX_KEY} printable ASCII characters without spaces.`,
    );
  }
}

/**
 * @param {{ dataDir: string, enqueue: (task: () => Promise<any>) => Promise<any> }} options
 */
export function createAssistantSettings({ dataDir, enqueue }) {
  const file = dataPath(dataDir, "assistant.json");

  /**
   * The saved settings, or undefined before the first save. Never waits for
   * the queue.
   * @returns {Promise<SavedSettings | undefined>}
   */
  async function read() {
    let raw;
    try {
      raw = await readJson(file);
    } catch (error) {
      // The message of JSON.parse quotes the text around the error, which
      // can be the key.
      if (error instanceof SyntaxError) throw new Error("assistant.json isn't valid JSON.");
      throw error;
    }
    return normalize(raw);
  }

  /**
   * Saves `changes`, `{ provider, model }` or `{ provider, model, apiKey }`,
   * and resolves to the saved settings. Without `apiKey`, the saved key
   * stays; with `apiKey: null`, it's removed. Rejects with a ValidationError
   * when the changes break a rule, and with a ConflictError when they have
   * no key and the saved key belongs to another provider, as after a save
   * for that provider that came in between.
   * @param {unknown} changes
   * @returns {Promise<SavedSettings>}
   */
  async function save(changes) {
    checkChanges(changes);
    const { provider, model, apiKey } = /** @type {any} */ (changes);
    return enqueue(async () => {
      // Reads first, so a file with the wrong shape rejects and stays as it is.
      const saved = await read();
      if (apiKey === undefined && saved?.apiKey && saved.provider !== provider) {
        throw new ConflictError("The saved key changed. Check the settings again.");
      }
      /** @type {SavedSettings} */
      const next = {
        provider,
        model,
        apiKey: apiKey === undefined ? (saved?.apiKey ?? null) : apiKey,
      };
      await writeJson(file, next, { mode: MODE });
      return next;
    });
  }

  return { read, save };
}
