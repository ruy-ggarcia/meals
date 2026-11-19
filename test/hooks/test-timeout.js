// Preloaded with `node --import` by `npm test`. Gives each test and each
// hook a time limit of its own, so a file with many tests never fails for
// its total time on a loaded machine. `node --test --test-timeout` can't do
// that: it bounds each file as a whole, so `npm test` sets it only as a
// generous backstop. A `timeout` option on a `describe` block bounds the
// whole block too.
//
// The hook wraps the functions of node:test that start a test or a hook,
// except `describe()`, to pass a default `timeout` option.
// `syncBuiltinESMExports()` makes `import { test } from "node:test"` return
// the wrapped functions. The default export of node:test and the hooks of a
// test's context, such as `t.after()`, stay node:test's own.
//
// A test or a hook that times out can leave a timer, a socket, or a child
// process alive, which would keep its file from ever ending. So each
// wrapped function also starts a watchdog on `REAL_CLOCK`, which waits 2
// seconds past the limit, unless the function settles first. Its timer
// doesn't keep the process alive: if it fires, something else does, and the
// watchdog says which test or hook hung and ends the process with exit
// code 1.
//
// Importing this file patches node:test once per process, wherever it's
// imported, as in its own tests. The runner then reports this file as the
// location of every test.
//
// See docs/testing.md for what a test writer needs to know.

import { createRequire, syncBuiltinESMExports } from "node:module";

/** Catches a test that hangs. A slow machine takes seconds, never this long. */
const TEST_TIMEOUT_MS = 10_000;

/**
 * How long the watchdog waits past the limit, for node:test to report the
 * timeout and the file to end on its own.
 */
const GRACE_MS = 2_000;

/** @typedef {(message: string) => void} Exit */

/**
 * @typedef {object} Clock
 * @property {(fn: () => void, ms: number) => any} setTimeout
 * @property {(timer: any) => void} clearTimeout
 */

/**
 * The timers of the process, kept before any test can mock them: a test
 * that mocks `setTimeout` would otherwise stop its own watchdog with the
 * mock, which leaves the real timer running.
 *
 * @type {Clock}
 */
const REAL_CLOCK = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };

/**
 * What the watchdog uses: `exit`, which ends the process with a message,
 * and `clock`, whose timers it sets.
 *
 * @typedef {{ exit: Exit, clock: Clock }} Watchdog
 */

/** @type {Exit} */
function endProcess(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/**
 * `fn`, a test's or a hook's function, with a watchdog that calls its
 * `exit` when the function runs `limit` milliseconds plus the grace without
 * settling. It keeps the number of parameters of `fn`, by which node:test
 * tells a function with a `done` callback.
 *
 * @param {any} fn
 * @param {number} limit
 * @param {(context: any) => string} whatHung Says what hung, from the context
 *   that node:test passes to the function.
 * @param {Watchdog} watchdog
 */
function watched(fn, limit, whatHung, { exit, clock }) {
  if (typeof fn !== "function" || !Number.isFinite(limit)) return fn;
  /** @this {any} */
  function watchedFn(/** @type {any[]} */ ...args) {
    const timer = clock.setTimeout(() => {
      exit(
        `${process.argv[1]}: ${whatHung(args[0])} still runs ${GRACE_MS} ms after its time limit of ${limit} ms, and something keeps the process alive. Ending it.`,
      );
    }, limit + GRACE_MS);
    timer.unref?.();
    const settle = () => clock.clearTimeout(timer);
    // node:test passes a done callback only to a function of exactly 2
    // parameters: a function of 3 or more gets none, and returns as usual.
    const takesDone = fn.length >= 2 && typeof args[1] === "function";
    if (takesDone) {
      const done = args[1];
      args[1] = (/** @type {any[]} */ ...results) => {
        settle();
        return done(...results);
      };
    }
    let result;
    try {
      result = fn.apply(this, args);
    } catch (error) {
      settle();
      throw error;
    }
    if (typeof result?.then === "function") result.then(settle, settle);
    else if (!takesDone) settle();
    return result;
  }
  Object.defineProperty(watchedFn, "length", { value: fn.length });
  return watchedFn;
}

/**
 * `run`, `test()` or one of its variants, with a default `timeout` option
 * and a watchdog. Takes the arguments as `test()` does: a name, options, and
 * a function, each optional.
 *
 * @param {(...args: any[]) => any} run
 * @param {Watchdog} watchdog
 */
function withTestTimeout(run, watchdog) {
  return (/** @type {any[]} */ ...args) => {
    const fn = typeof args.at(-1) === "function" ? args.pop() : undefined;
    const own = typeof args.at(-1) === "object" && args.at(-1) !== null ? args.pop() : {};
    const name = args[0];
    const options = { timeout: TEST_TIMEOUT_MS, ...own };
    const whatHung = () => `the test "${name ?? fn?.name}"`;
    return run(name, options, watched(fn, options.timeout, whatHung, watchdog));
  };
}

/**
 * `hook`, such as `before()`, with a default `timeout` option and a
 * watchdog.
 *
 * @param {string} kind The name of the hook, such as `before`.
 * @param {(fn?: any, options?: any) => any} hook
 * @param {Watchdog} watchdog
 */
function withHookTimeout(kind, hook, watchdog) {
  return (/** @type {any} */ fn, /** @type {any} */ own) => {
    const options = { timeout: TEST_TIMEOUT_MS, ...own };
    const whatHung = (/** @type {any} */ context) => `the ${kind} hook of "${context?.name}"`;
    return hook(watched(fn, options.timeout, whatHung, watchdog), options);
  };
}

/**
 * Replaces the functions of `nodeTest`, the exports of node:test, with ones
 * that have a default `timeout` option and a watchdog, and returns it.
 *
 * @param {any} nodeTest
 * @param {Partial<Watchdog>} [watchdog] The process's by default.
 */
export function addTimeouts(nodeTest, { exit = endProcess, clock = REAL_CLOCK } = {}) {
  const { test } = nodeTest;
  const watchdog = { exit, clock };
  const bounded = Object.assign(withTestTimeout(test, watchdog), {
    only: withTestTimeout(test.only, watchdog),
    skip: withTestTimeout(test.skip, watchdog),
    todo: withTestTimeout(test.todo, watchdog),
  });
  nodeTest.test = bounded;
  nodeTest.it = bounded;
  // node:test also exports the variants by name, as `only`, `skip`, and `todo`.
  for (const keyword of ["only", "skip", "todo"]) nodeTest[keyword] = bounded[keyword];
  for (const hook of ["after", "afterEach", "before", "beforeEach"]) {
    nodeTest[hook] = withHookTimeout(hook, nodeTest[hook], watchdog);
  }
  return nodeTest;
}

const require = createRequire(import.meta.url);
addTimeouts(require("node:test"));
syncBuiltinESMExports();
