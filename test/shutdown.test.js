import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { createShutdown } from "../server/shutdown.js";
import { collectingLogger } from "./helpers.js";

/** A stop() that resolves or rejects when the test says so. */
function controlledStop() {
  const control = {};
  control.stop = mock.fn(
    () =>
      new Promise((resolve, reject) => {
        control.resolve = resolve;
        control.reject = reject;
      }),
  );
  return control;
}

test("shutdown logs the signal, waits for stop(), logs the stop, and exits with 0", async () => {
  const { entries, logger } = collectingLogger();
  const exit = mock.fn();
  const control = controlledStop();
  const shutdown = createShutdown({ exit, logger, stop: control.stop });

  shutdown("SIGTERM");
  await setImmediate();
  assert.equal(control.stop.mock.callCount(), 1);
  assert.equal(exit.mock.callCount(), 0);

  control.resolve();
  await setImmediate();

  assert.deepEqual(
    exit.mock.calls.map((call) => call.arguments),
    [[0]],
  );
  assert.deepEqual(entries, [
    { level: "info", msg: "server stopping", signal: "SIGTERM" },
    { level: "info", msg: "server stopped" },
  ]);
});

test("a second signal doesn't stop the server again", (t) => {
  // Mock timers, so the 10-second deadline doesn't keep the test file running.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { logger } = collectingLogger();
  const control = controlledStop();
  const shutdown = createShutdown({ exit: mock.fn(), logger, stop: control.stop });

  shutdown("SIGTERM");
  shutdown("SIGINT");

  assert.equal(control.stop.mock.callCount(), 1);
});

test("shutdown exits with 1 when stop() takes longer than the deadline", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { entries, logger } = collectingLogger();
  const exit = mock.fn();
  const shutdown = createShutdown({ exit, logger, stop: controlledStop().stop });

  shutdown("SIGTERM");
  t.mock.timers.tick(9_999);
  assert.equal(exit.mock.callCount(), 0);
  t.mock.timers.tick(1);

  assert.deepEqual(
    exit.mock.calls.map((call) => call.arguments),
    [[1]],
  );
  assert.deepEqual(entries.at(-1), { level: "error", msg: "shutdown timed out" });
});

test("shutdown logs the error and exits with 1 when stop() fails", async () => {
  const { entries, logger } = collectingLogger();
  const exit = mock.fn();
  const control = controlledStop();
  const shutdown = createShutdown({ exit, logger, stop: control.stop });

  shutdown("SIGTERM");
  control.reject(new Error("disk gone"));
  await setImmediate();

  assert.deepEqual(
    exit.mock.calls.map((call) => call.arguments),
    [[1]],
  );
  assert.equal(entries.at(-1).msg, "shutdown failed");
  assert.match(entries.at(-1).error, /disk gone/);
});
