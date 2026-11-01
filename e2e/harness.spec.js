// Checks of the test harness itself: the failure of a test on an error in
// the page, and the server that each test starts.

import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { CURRENT_WEEK } from "./catalog.js";
import { expect, test } from "./fixtures.js";

/**
 * Holds the requests to the health check in `context` without an answer, and
 * starts one in `page` with a signal that times out after 50 milliseconds.
 * `outcomeOf()` reads how the request ended in the page: `pending`, or the
 * name of its error.
 */
async function startHeldRequest(context, page) {
  const held = Promise.withResolvers();
  await context.route("**/api/health", async (route) => {
    await held.promise;
    await route.abort().catch(() => {});
  });
  await page.goto("/");
  await page.evaluate(() => {
    const target = /** @type {any} */ (window);
    target.outcome = "pending";
    fetch("/api/health", { signal: AbortSignal.timeout(50) }).catch((error) => {
      target.outcome = error.name;
    });
  });
  return {
    outcomeOf: () => page.evaluate(() => /** @type {any} */ (window).outcome),
    release: () => held.resolve(undefined),
  };
}

test.describe("e2e/fixtures.js", () => {
  test.describe("neverTimeOut", () => {
    test("keeps a held request pending past its timeout", async ({
      consoleErrors,
      context,
      page,
    }) => {
      consoleErrors.allowed = true; // The browser logs the request that the test ends.
      const request = await startHeldRequest(context, page);

      await page.clock.runFor(5000); // Far past the 50 ms of the request, with no real wait.

      expect(await request.outcomeOf()).toBe("pending");
      request.release();
    });
  });

  test.describe("AbortSignal.timeout", () => {
    test.use({ requestTimeout: "real" });

    test("aborts a held request at its timeout when requestTimeout is real", async ({
      consoleErrors,
      context,
      page,
    }) => {
      consoleErrors.allowed = true; // The browser logs the request that times out.
      const request = await startHeldRequest(context, page);

      await page.clock.runFor(50);

      // The poll waits for the handler in the page to run after the abort,
      // not for time.
      // WebKit reports the abort of a request as an AbortError.
      await expect.poll(request.outcomeOf).toMatch(/^(TimeoutError|AbortError)$/);
      request.release();
    });
  });

  test.describe("page fixture", () => {
    test("fails a test on an error thrown from a timer", async ({ page }) => {
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
  });

  test.describe("app fixture", () => {
    test("starts the app on a free port", async ({ app, page }) => {
      // The server listens on port 3000 by default, so a fixture that asked for
      // a free port got another one.
      expect(app.port, "port of the app must not be 3000, the default port of the server").not.toBe(
        3000,
      );

      await page.goto("/");

      await expect(page).toHaveURL(`${app.url}/#${CURRENT_WEEK}`);
    });

    test("keeps the data in the temp directory", async ({ app }) => {
      expect(
        dirname(app.dataDir),
        "the data directory must be directly in the temp directory",
      ).toBe(tmpdir());
      expect((await stat(app.dataDir)).isDirectory(), "the data directory exists").toBe(true);
    });
  });
});
