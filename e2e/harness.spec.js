// Checks of the test harness itself: the errors that the fixtures collect,
// and the failure of a test on such an error.

import { NOW } from "./catalog.js";
import { expect, test, watchErrors } from "./fixtures.js";

/** Throws `message` from a timer. The fake clock catches it, and logs it as a console error. */
function throwFromTimer(page, message) {
  return Promise.all([
    page.waitForEvent("console", (logged) => logged.type() === "error"),
    page.evaluate((text) => {
      setTimeout(() => {
        throw new Error(text);
      }, 0);
    }, message),
  ]);
}

/** Throws `message` from a microtask, an uncaught error outside a timer. */
function throwFromMicrotask(page, message) {
  return Promise.all([
    page.waitForEvent("pageerror"),
    page.evaluate((text) => {
      queueMicrotask(() => {
        throw new Error(text);
      });
    }, message),
  ]);
}

/**
 * Throws an error from a timer that reads like the app's own logs, so only
 * its type tells it apart.
 */
function throwLikeTheApp(page) {
  return Promise.all([
    page.waitForEvent("console", (logged) => logged.type() === "error"),
    page.evaluate(() => {
      setTimeout(() => {
        const error = new Error("a timer");
        error.name = "Couldn't run";
        error.stack = "Couldn't run: a timer";
        throw error;
      }, 0);
    }),
  ]);
}

/**
 * Opens the app in a new page of `context`, which no fixture watches, with
 * the fake clock, and returns the page and what `watchErrors` collects.
 */
async function openWatched(context, consoleErrors) {
  const page = await context.newPage();
  const errorsOf = watchErrors(page, consoleErrors);
  await page.clock.install({ time: NOW });
  await page.goto("/");
  return { page, errorsOf };
}

test("collects an error thrown from a timer", async ({ context }) => {
  const { page, errorsOf } = await openWatched(context, { allowed: false });

  await throwFromTimer(page, "Thrown from a timer");

  expect(await errorsOf()).toEqual([expect.stringContaining("Error: Thrown from a timer")]);
});

test("collects an error thrown from a microtask", async ({ context }) => {
  const { page, errorsOf } = await openWatched(context, { allowed: false });

  await throwFromMicrotask(page, "Thrown from a microtask");

  expect(await errorsOf()).toEqual(["Uncaught error: Thrown from a microtask"]);
});

test("collects an error thrown from a timer while console errors are allowed", async ({
  context,
}) => {
  const { page, errorsOf } = await openWatched(context, { allowed: true });

  await throwLikeTheApp(page);

  expect(await errorsOf()).toEqual([expect.stringContaining("Couldn't run: a timer")]);
});

// Each test below is expected to fail, because the page fixture fails a test
// on an error in the page. Under `test.fail()`, a timeout counts as the
// expected failure too, so only the tests above show that the fixture sees
// the error. The short timeout keeps a run that times out fast.

test("fails a test on an uncaught error in the page", async ({ page }) => {
  test.fail();
  test.setTimeout(5000);
  await page.goto("/");

  await throwFromTimer(page, "Thrown from a timer");
});

test("fails a test on an uncaught error outside a timer", async ({ page }) => {
  test.fail();
  test.setTimeout(5000);
  await page.goto("/");

  await throwFromMicrotask(page, "Thrown from a microtask");
});

test("fails a test on an error thrown from a timer while console errors are allowed", async ({
  consoleErrors,
  page,
}) => {
  test.fail();
  test.setTimeout(5000);
  consoleErrors.allowed = true;
  await page.goto("/");

  await throwLikeTheApp(page);
});
