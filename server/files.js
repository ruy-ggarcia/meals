// The only module that touches disk: JSON files, atomic writes, and the queue
// that keeps writes from interleaving.

import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

/** Every file of the current storage format lives under DATA_DIR/v2/. */
export function dataPath(dataDir, ...parts) {
  return path.join(dataDir, "v2", ...parts);
}

/**
 * The parsed content of `file`, or undefined when it doesn't exist. Invalid
 * JSON rejects on purpose: treating it as empty would overwrite the user's
 * data on the next write.
 */
export async function readJson(file) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
  return JSON.parse(text);
}

/**
 * Writes `value` to `file` atomically, creating its directory if needed. With
 * `mode`, such as 0o640, the file gets exactly that mode, whatever the umask;
 * without it, a new file gets 0o666 minus the umask.
 * @param {string} file
 * @param {unknown} value
 * @param {{ mode?: number }} [options]
 */
export async function writeJson(file, value, { mode } = {}) {
  if (value === undefined) throw new TypeError("writeJson: value must not be undefined.");
  await mkdir(path.dirname(file), { recursive: true });
  const tmpFile = `${file}.tmp`;
  // A temporary file that a crash left goes first, so the value lands in a new
  // file: a reader of the old one never sees it, whatever its owner or mode.
  // "wx" fails if another file appears at its path in between.
  await unlink(tmpFile).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  const handle = await open(tmpFile, "wx", mode);
  try {
    // open applies the umask, so chmod sets the exact mode before the content
    // arrives.
    if (mode !== undefined) await handle.chmod(mode);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
  } finally {
    await handle.close();
  }
  await rename(tmpFile, file); // atomic replace, which keeps the mode
}

/**
 * Returns `enqueue(task)`, which runs each task after the previous one
 * finishes, so two read-modify-write cycles never interleave and lose each
 * other's changes. It resolves or rejects like the task.
 */
export function createQueue() {
  let tail = Promise.resolve();
  return function enqueue(task) {
    const run = tail.then(task);
    tail = run.catch(() => {}); // a failed task must not block later ones
    return run;
  };
}
