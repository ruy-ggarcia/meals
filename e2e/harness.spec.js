// Checks of the test harness itself: the errors that the fixtures collect,
// the failure of a test on such an error, the server that each test starts,
// its fake model lists, and the scripted provider of the assistant. The tests
// that call `test.fail()` prove only that the fixture wires `watchErrors` to
// the page, or that it checks the calls beyond the script of the assistant.

import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { scriptedProvider } from "./assistant.js";
import { CURRENT_WEEK, NOW } from "./catalog.js";
import { expect, settleRequests, test, trackRequests, watchErrors } from "./fixtures.js";

/** A request to a provider, with nothing in it. */
const REQUEST = { system: "", messages: [], tools: [] };

/**
 * Asks the server of `app` for the models of `provider` with a key, and
 * resolves to the status and the body of the answer.
 * @param {{ url: string }} app
 * @param {"anthropic" | "openai"} provider
 */
async function listModels(app, provider) {
  const response = await fetch(`${app.url}/api/assistant/models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, apiKey: "sk-test" }),
  });
  return { status: response.status, body: await response.json() };
}

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
  test.describe("watchErrors", () => {
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

    test("collects a timer error when console errors are allowed", async ({ context }) => {
      const { page, errorsOf } = await openWatched(context, { allowed: true });

      await throwLikeTheApp(page);

      expect(await errorsOf()).toEqual([expect.stringContaining("Couldn't run: a timer")]);
    });
  });

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

  test.describe("settleRequests", () => {
    test("waits for the handler of a failed request", async ({ consoleErrors, context, page }) => {
      consoleErrors.allowed = true; // The browser logs the request that fails.
      await context.addInitScript(trackRequests);
      await page.goto("/");
      const logs = [];
      page.on("console", (logged) => logs.push(logged.text()));
      const held = Promise.withResolvers();
      await context.route("**/api/health", held.resolve);
      await page.evaluate(() => {
        fetch("/api/health").catch(async () => {
          await null;
          // The page is busy, so the message reaches the test late.
          const end = performance.now() + 100;
          while (performance.now() < end);
          console.log("handled the failure");
        });
      });
      const route = await held.promise;
      await route.abort();

      await settleRequests(page);

      expect(logs).toContain("handled the failure");
    });
  });

  // Each test below is expected to fail, because the page fixture fails a test
  // on an error in the page. Any other failure would pass them too, so the
  // tests above check the errors that the fixture sees.

  test.describe("page fixture", () => {
    test("fails a test on an error thrown from a timer", async ({ page }) => {
      test.fail();
      await page.goto("/");

      await throwFromTimer(page, "Thrown from a timer");
    });

    test("fails a test on an uncaught error outside a timer", async ({ page }) => {
      test.fail();
      await page.goto("/");

      await throwFromMicrotask(page, "Thrown from a microtask");
    });

    test("fails a test on a timer error when console errors are allowed", async ({
      consoleErrors,
      page,
    }) => {
      test.fail();
      consoleErrors.allowed = true;
      await page.goto("/");

      await throwLikeTheApp(page);
    });
  });

  test.describe("network fixture", () => {
    test("fails a test on a failure log after up()", async ({ network, page }) => {
      test.fail();
      await page.goto("/");
      await network.down();
      await network.up();

      await page.evaluate(() => console.error("Couldn't load the health check"));
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

    test("answers one model for each provider", async ({ app }) => {
      expect(await listModels(app, "anthropic")).toEqual({
        status: 200,
        body: { models: [{ id: "claude-test", name: "Claude Test" }] },
      });
      expect(await listModels(app, "openai")).toEqual({
        status: 200,
        body: { models: [{ id: "gpt-test", name: "gpt-test" }] },
      });
    });

    test.describe(() => {
      test.use({ assistant: { script: [] } });

      // Expected to fail, as the tests of the page fixture above.
      test("fails a test whose assistant runs past its script", async ({ app }) => {
        test.fail();

        await app.assistant?.complete(REQUEST).catch(() => {});
      });
    });
  });
});

test.describe("e2e/assistant.js", () => {
  test.describe("scriptedProvider", () => {
    // These tests run in Node.js alone, with no browser: one project is enough.
    test.skip(({ browserName }) => browserName !== "chromium", "Runs only in Chromium.");

    test("rejects a call beyond its script", async () => {
      const provider = scriptedProvider([{ text: "Hello." }], () => null);
      await provider.complete(REQUEST);

      await expect(provider.complete(REQUEST)).rejects.toThrow(
        "The assistant made call 2, past the end of its script.",
      );
    });

    test("records a call beyond its script in overruns", async () => {
      const provider = scriptedProvider([], () => null);

      await provider.complete(REQUEST).catch(() => {});

      expect(provider.overruns).toEqual(["The assistant made call 1, past the end of its script."]);
    });
  });
});
