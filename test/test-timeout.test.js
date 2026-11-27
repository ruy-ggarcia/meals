// Tests for the hook in test/hooks/test-timeout.js, on a stand-in for
// node:test: a test whose time limit or keyword breaks would hang `npm test`
// or fail to load, so these tests check what each function passes on, and
// when the watchdog would end the process, with mocked timers. One test
// checks the exports of the real node:test, which the hook has already
// patched, preloaded by `npm test` or imported by this file.

import assert from "node:assert/strict";
import * as nodeTest from "node:test";
import { describe, mock, test } from "node:test";
import { addTimeouts } from "./hooks/test-timeout.js";

const HOOKS = ["after", "afterEach", "before", "beforeEach"];
const KEYWORDS = ["only", "skip", "todo"];

/**
 * A stand-in for node:test, whose functions record their calls: the
 * `original` functions, the `bounded` exports that `addTimeouts` makes of
 * them, and `exit`, which records the watchdog's calls. The watchdog uses
 * `clock`, or else the global timers at the time of each call, so
 * `t.mock.timers` controls it.
 *
 * @param {any} [clock]
 * @returns {{ original: any, bounded: any, exit: any }}
 */
function fakeNodeTest(clock = GLOBAL_CLOCK) {
  const originalTest = Object.assign(
    mock.fn(),
    Object.fromEntries(KEYWORDS.map((key) => [key, mock.fn()])),
  );
  // As in node:test, the named `only`, `skip`, and `todo` exports are the
  // functions of `test`.
  const original = {
    test: originalTest,
    ...Object.fromEntries(KEYWORDS.map((key) => [key, originalTest[key]])),
    ...Object.fromEntries(HOOKS.map((hook) => [hook, mock.fn()])),
  };
  const exit = mock.fn();
  return { original, bounded: addTimeouts({ ...original }, { exit, clock }), exit };
}

/** The arguments of the only call of `fn`, a function of `mock.fn()`. */
function argumentsOf(fn) {
  assert.equal(fn.mock.callCount(), 1, "the function must be called once");
  return fn.mock.calls[0].arguments;
}

/** The name and the options that the only call of a test function got. */
function nameAndOptionsOf(fn) {
  const [name, options] = argumentsOf(fn);
  return [name, options];
}

/** The function that the only call of a test function got. */
function functionOf(fn) {
  return argumentsOf(fn)[2];
}

/** The global timers at the time of each call, mocked or not. */
const GLOBAL_CLOCK = {
  setTimeout: (/** @type {() => void} */ fn, /** @type {number} */ ms) => setTimeout(fn, ms),
  clearTimeout: (/** @type {any} */ timer) => clearTimeout(timer),
};

/** A promise that never settles, as a test or a hook that hangs returns. */
const hang = () => new Promise(() => {});

describe("addTimeouts", () => {
  test("gives a test 10 seconds", () => {
    const { original, bounded } = fakeNodeTest();

    bounded.test("a test", () => {});

    assert.deepEqual(nameAndOptionsOf(original.test), ["a test", { timeout: 10_000 }]);
  });

  test("gives a test without a name 10 seconds", () => {
    const { original, bounded } = fakeNodeTest();

    bounded.test(() => {});

    assert.deepEqual(nameAndOptionsOf(original.test), [undefined, { timeout: 10_000 }]);
  });

  test("keeps the options of a test, its own timeout included", () => {
    const { original, bounded } = fakeNodeTest();

    bounded.test("a test", { concurrency: 2, timeout: 50 }, () => {});

    assert.deepEqual(nameAndOptionsOf(original.test), ["a test", { concurrency: 2, timeout: 50 }]);
  });

  test("exports the bounded test under the name it too", () => {
    const { bounded } = fakeNodeTest();

    assert.equal(bounded.it, bounded.test);
  });

  for (const keyword of KEYWORDS) {
    test(`gives test.${keyword} 10 seconds`, () => {
      const { original, bounded } = fakeNodeTest();

      bounded.test[keyword]("a test", () => {});

      assert.equal(original.test.mock.callCount(), 0, "test must not run in place of the keyword");
      assert.deepEqual(nameAndOptionsOf(original.test[keyword]), ["a test", { timeout: 10_000 }]);
    });
  }

  for (const keyword of KEYWORDS) {
    test(`gives the named export ${keyword} 10 seconds`, () => {
      const { original, bounded } = fakeNodeTest();

      bounded[keyword]("a test", () => {});

      assert.deepEqual(nameAndOptionsOf(original.test[keyword]), ["a test", { timeout: 10_000 }]);
    });
  }

  test("exports the bounded only, skip, and todo of node:test by name", () => {
    assert.notEqual(nodeTest.test, nodeTest.default, "the hook must have replaced test");
    assert.equal(nodeTest.only, nodeTest.test.only, "only must be test.only");
    assert.equal(nodeTest.skip, nodeTest.test.skip, "skip must be test.skip");
    assert.equal(nodeTest.todo, nodeTest.test.todo, "todo must be test.todo");
  });

  test("gives test.todo without a function 10 seconds", () => {
    const { original, bounded } = fakeNodeTest();

    bounded.test.todo("a test");

    assert.deepEqual(argumentsOf(original.test.todo), ["a test", { timeout: 10_000 }, undefined]);
  });

  for (const hook of HOOKS) {
    test(`gives ${hook} 10 seconds`, () => {
      const { original, bounded } = fakeNodeTest();

      bounded[hook](() => {});

      assert.deepEqual(argumentsOf(original[hook])[1], { timeout: 10_000 });
    });
  }

  test("keeps the options of a hook, its own timeout included", () => {
    const { original, bounded } = fakeNodeTest();

    bounded.beforeEach(() => {}, { signal: undefined, timeout: 50 });

    assert.deepEqual(argumentsOf(original.beforeEach)[1], { signal: undefined, timeout: 50 });
  });

  test("runs the function of a test with its context and returns its result", () => {
    const { original, bounded } = fakeNodeTest();
    const body = mock.fn(() => "a result");
    bounded.test("a test", body);
    const context = { name: "a test" };

    const result = functionOf(original.test)(context);

    assert.equal(result, "a result");
    assert.deepEqual(argumentsOf(body), [context]);
  });

  test("keeps the done callback of a test", () => {
    const { original, bounded } = fakeNodeTest();
    bounded.test("a test", (_t, done) => done("an error"));
    const done = mock.fn();

    const fn = functionOf(original.test);
    fn({}, done);

    assert.equal(fn.length, 2, "node:test must still see a callback test");
    assert.deepEqual(argumentsOf(done), ["an error"]);
  });

  test("ends the process 2 seconds after the limit of a test that hangs", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { original, bounded, exit } = fakeNodeTest();
    bounded.test("a test", hang);
    functionOf(original.test)({ name: "a test" });

    t.mock.timers.tick(11_999);
    assert.equal(exit.mock.callCount(), 0, "the watchdog must wait 2 seconds past the limit");
    t.mock.timers.tick(1);

    assert.match(argumentsOf(exit)[0], /the test "a test" /);
  });

  test("waits 2 seconds past the own timeout of a test that hangs", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { original, bounded, exit } = fakeNodeTest();
    bounded.test("a test", { timeout: 50 }, hang);
    functionOf(original.test)({ name: "a test" });

    t.mock.timers.tick(2_049);
    assert.equal(exit.mock.callCount(), 0, "the watchdog must wait 2 seconds past the limit");
    t.mock.timers.tick(1);

    assert.equal(exit.mock.callCount(), 1);
  });

  test("ends the process 2 seconds after the limit of a hook that hangs", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { original, bounded, exit } = fakeNodeTest();
    bounded.beforeEach(hang);
    argumentsOf(original.beforeEach)[0]({ name: "a test" });

    t.mock.timers.tick(12_000);

    assert.match(argumentsOf(exit)[0], /the beforeEach hook of "a test" /);
  });

  test("leaves the process alone after a test settles in time", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { original, bounded, exit } = fakeNodeTest();
    bounded.test("a test", async () => {});
    await functionOf(original.test)({ name: "a test" });

    t.mock.timers.tick(12_000);

    assert.equal(exit.mock.callCount(), 0);
  });

  test("leaves the process alone after a test throws in time", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { original, bounded, exit } = fakeNodeTest();
    bounded.test("a test", () => {
      throw new Error("a failure");
    });
    assert.throws(() => functionOf(original.test)({ name: "a test" }), /a failure/);

    t.mock.timers.tick(12_000);

    assert.equal(exit.mock.callCount(), 0);
  });

  test("leaves the process alone after a test calls done in time", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { original, bounded, exit } = fakeNodeTest();
    bounded.test("a test", (_t, done) => done());
    functionOf(original.test)({ name: "a test" }, () => {});

    t.mock.timers.tick(12_000);

    assert.equal(exit.mock.callCount(), 0);
  });

  test("leaves the process alone after a test of 3 parameters returns", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { original, bounded, exit } = fakeNodeTest();
    bounded.test("a test", (_t, _done, _more) => {});
    // node:test passes a done callback only to a function of 2 parameters.
    functionOf(original.test)({ name: "a test" });

    t.mock.timers.tick(12_000);

    assert.equal(exit.mock.callCount(), 0);
  });

  test("stops the watchdog with the clock that started it", () => {
    const timer = { unref: mock.fn() };
    const clock = { setTimeout: mock.fn(() => timer), clearTimeout: mock.fn() };
    const { original, bounded } = fakeNodeTest(clock);
    bounded.test("a test", () => {});

    functionOf(original.test)({ name: "a test" });

    assert.deepEqual(argumentsOf(clock.clearTimeout), [timer]);
  });

  test("starts a watchdog that doesn't keep the process alive", () => {
    const timer = { unref: mock.fn() };
    const clock = { setTimeout: mock.fn(() => timer), clearTimeout: mock.fn() };
    const { original, bounded } = fakeNodeTest(clock);
    bounded.test("a test", hang);

    functionOf(original.test)({ name: "a test" });

    assert.equal(timer.unref.mock.callCount(), 1);
  });

  test("sets no watchdog for a test without a time limit", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { original, bounded, exit } = fakeNodeTest();
    bounded.test("a test", { timeout: Number.POSITIVE_INFINITY }, hang);
    functionOf(original.test)({ name: "a test" });

    t.mock.timers.runAll();

    assert.equal(exit.mock.callCount(), 0);
  });
});
