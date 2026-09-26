// The only module that touches disk: JSON files, atomic writes, and the queue
// that keeps writes from interleaving.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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

/** Writes `value` to `file` atomically, creating its directory if needed. */
export async function writeJson(file, value) {
  if (value === undefined) throw new TypeError("writeJson: value must not be undefined.");
  await mkdir(path.dirname(file), { recursive: true });
  const tmpFile = `${file}.tmp`;
  await writeFile(tmpFile, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tmpFile, file); // atomic replace
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
