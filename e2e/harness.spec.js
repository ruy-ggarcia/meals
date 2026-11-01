// Checks of the test harness itself. Each test is expected to fail, because
// the page fixture fails a test on an error in the page.

import { test } from "./fixtures.js";

test("fails a test on an uncaught error in the page", async ({ page }) => {
  test.fail();
  await page.goto("/");

  // The fake clock catches an error thrown from a timer, and logs it as a
  // console error.
  await Promise.all([
    page.waitForEvent("console", (message) => message.type() === "error"),
    page.evaluate(() => {
      setTimeout(() => {
        throw new Error("Thrown from a timer");
      }, 0);
    }),
  ]);
});

test("fails a test on an uncaught error outside a timer", async ({ page }) => {
  test.fail();
  await page.goto("/");

  await Promise.all([
    page.waitForEvent("pageerror"),
    page.evaluate(() => {
      queueMicrotask(() => {
        throw new Error("Thrown from a microtask");
      });
    }),
  ]);
});
