// Helpers of the backend tests, the ones that run `server/`. They don't serve
// any other layer: the frontend tests, the host tests, and `e2e/` have their
// own helpers.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "node:test";
import { silentLogger } from "../server/logger.js";
import { start } from "../server/start.js";

// The days and the meals of a week, written out literally so the tests don't
// trust the module under test.
export const EXPECTED_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const EXPECTED_MEALS = ["breakfast", "snack_am", "lunch", "snack_pm", "dinner"];

/** What an ID that the server generates looks like: a version 4 UUID. */
export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A week with every slot holding an empty menu. */
export function blankWeek() {
  return Object.fromEntries(
    EXPECTED_DAYS.map((day) => [
      day,
      Object.fromEntries(EXPECTED_MEALS.map((meal) => [meal, { items: [] }])),
    ]),
  );
}

/**
 * Creates an empty data directory before each test and removes it after the
 * test. Returns a function that gives the path of the directory of the test
 * that runs. The name of the directory starts with `prefix`.
 *
 * @param {string} prefix
 * @returns {() => string}
 */
export function useDataDir(prefix) {
  /** @type {string} */
  let dir;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return () => dir;
}

/**
 * Writes `content` to `file`, a path inside `dataDir`, such as
 * `v2/recipes.json`, and creates the directories on the way.
 *
 * @param {string} dataDir
 * @param {string} file
 * @param {string} content
 */
export async function writeDataFile(dataDir, file, content) {
  const target = path.join(dataDir, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

/**
 * Starts the server on a free port of `127.0.0.1`, with no logs, and stops
 * it when the test `t` ends. `options` replace the defaults.
 *
 * @param {import("node:test").TestContext} t
 * @param {string} dataDir
 * @param {Partial<Parameters<typeof start>[0]>} [options]
 */
export async function startTestServer(t, dataDir, options = {}) {
  const server = await start({
    dataDir,
    host: "127.0.0.1",
    logger: silentLogger,
    port: 0,
    version: "1.2.3",
    ...options,
  });
  t.after(() => server.stop());
  return server;
}

/**
 * A logger that keeps each entry as `{ level, msg, ...fields }` in `entries`,
 * so tests can check logs without printing them.
 */
export function collectingLogger() {
  const entries = [];
  const entry =
    (level) =>
    (msg, fields = {}) => {
      entries.push({ level, msg, ...fields });
    };
  return { entries, logger: { error: entry("error"), info: entry("info") } };
}

/**
 * Waits for PROMISE and returns its value. Rejects with an error that has
 * MESSAGE if PROMISE doesn't settle within MS milliseconds, so a regression
 * fails the test at once instead of waiting for the test timeout. The timer
 * never outlives the wait.
 */
export async function within(promise, message, ms = 2000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The `skip` option of a test that relies on file permissions: REASON as
 * root, who has every permission, and false otherwise.
 */
export function skipAsRoot(reason) {
  return process.getuid?.() === 0 ? reason : false;
}
