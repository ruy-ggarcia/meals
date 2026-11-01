// The fixtures of the browser tests. Each test gets its own server, on a free
// port and with a new data directory, seeded through the API. Its pages start
// at the fixed date, and the test fails on an error in a page. A test can
// also make the API fail, as if the server were stopped or paused.

import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base, expect } from "@playwright/test";
import { silentLogger } from "../server/logger.js";
import { start } from "../server/start.js";
import { createApi } from "./api.js";
import { INGREDIENTS, NOW, RECIPE_NAMES } from "./catalog.js";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

/** Adds the catalog through `api`, and returns the recipes and the ingredients by name. */
async function seedCatalog(api) {
  const recipes = {};
  for (const name of RECIPE_NAMES) recipes[name] = await api.createRecipe({ name });
  const ingredients = {};
  for (const fields of INGREDIENTS) ingredients[fields.name] = await api.createIngredient(fields);
  return { recipes, ingredients };
}

/**
 * Runs in a page before its scripts, and after the script of `page.clock`:
 * makes the signal of `AbortSignal.timeout`, which the app puts on each
 * request, never abort. The clock of the page runs in real time, so the app
 * gives up on a request after 5 real seconds, and a test that holds a request
 * across several steps would race with the time of a loaded machine.
 */
export function neverTimeOut() {
  AbortSignal.timeout = () => new AbortController().signal;
}

/**
 * Starts the fake clock of `page` at the fixed date, and unless
 * `requestTimeout` is "real", stops the app from giving up on a request.
 */
async function startClock(page, requestTimeout) {
  await page.clock.install({ time: NOW });
  if (requestTimeout === "never") await page.addInitScript(neverTimeOut);
}

/** Whether `url` is a request to the API, which `network` can make fail. */
function isApiRequest(url) {
  return url.pathname.startsWith("/api/");
}

/** Whether `text` is a console error that a server failure causes. */
function isFailureLog(text) {
  // The browser's message about a request that failed, and the app's own.
  return text.startsWith("Failed to load resource") || text.startsWith("Couldn't ");
}

/**
 * The name and the message of the Error object that `message` logs as its
 * only argument, such as `Error: Thrown`, or null if it logs something else.
 */
async function loggedError(message) {
  const args = message.args();
  try {
    if (args.length !== 1) return null;
    // The page may be gone, for example after a reload: then the text decides.
    return await args[0]
      .evaluate((value) => (value instanceof Error ? `${value.name}: ${value.message}` : null))
      .catch(() => null);
  } finally {
    await Promise.all(args.map((arg) => arg.dispose().catch(() => {})));
  }
}

/**
 * Runs in every page of the context before its scripts: keeps the requests
 * that `fetch` started and that haven't settled, for `settleRequests`.
 */
export function trackRequests() {
  const pending = new Set();
  /** @type {any} */ (window).pendingRequests = pending;
  const original = window.fetch;
  window.fetch = function (...args) {
    const request = original.apply(this, args);
    pending.add(request);
    const forget = () => pending.delete(request);
    request.then(forget, forget);
    return request;
  };
}

/**
 * Resolves once the requests that `page` started have settled and the code
 * that waits for them has run, including the handlers that log their failure.
 * The page logs in that order, and the browser reports its console messages in
 * the order they were logged, so the messages are reported by the time this
 * resolves. A page that is gone, or that navigates, has nothing left to log.
 */
export async function settleRequests(page) {
  await page
    .evaluate(async () => {
      await Promise.allSettled([.../** @type {any} */ (window).pendingRequests]);
      // A message from another task, after all promise handlers have run.
      await new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = resolve;
        channel.port2.postMessage(null);
      });
    })
    .catch(() => {});
}

/**
 * Starts to collect the errors of `page` that fail a test: uncaught errors,
 * and console errors. While `consoleErrors.allowed` is set, the console
 * errors that a server failure causes don't count. A console error that logs
 * only an Error object always counts: that's how the fake clock reports an
 * error thrown from a timer. Returns a function that resolves to the errors.
 */
export function watchErrors(page, consoleErrors) {
  const errors = [];
  const pending = [];
  page.on("pageerror", (error) => errors.push(`Uncaught error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // What the test allowed when the page logged the error.
    const { allowed } = consoleErrors;
    const text = message.text();
    pending.push(
      loggedError(message).then((thrown) => {
        if (thrown === null && allowed && isFailureLog(text)) return;
        // Firefox logs only `Error` for an Error object, so add its message.
        const shown = thrown === null || text.includes(thrown) ? text : `${text} (${thrown})`;
        errors.push(`Console error: ${shown}`);
      }),
    );
  });
  return async () => {
    await Promise.all(pending);
    return errors;
  };
}

/**
 * @typedef {object} Fixtures
 * @property {"catalog" | "empty"} seed
 * @property {"never" | "real"} requestTimeout
 * @property {{
 *   url: string,
 *   port: number,
 *   dataDir: string,
 *   api: ReturnType<typeof createApi>,
 *   recipes: Record<string, any>,
 *   ingredients: Record<string, any>,
 * }} app
 * @property {{ allowed: boolean }} consoleErrors
 * @property {() => Promise<import("@playwright/test").Page>} newPage
 * @property {{ down(): Promise<void>, stall(): Promise<void>, up(): Promise<void> }} network
 */

/**
 * @type {import("@playwright/test").Fixtures<
 *   Fixtures,
 *   {},
 *   import("@playwright/test").PlaywrightTestArgs &
 *     import("@playwright/test").PlaywrightTestOptions,
 *   import("@playwright/test").PlaywrightWorkerArgs &
 *     import("@playwright/test").PlaywrightWorkerOptions
 * >}
 */
const fixtures = {
  // "catalog" seeds the recipes and the ingredients of catalog.js, and
  // "empty" seeds nothing.
  seed: ["catalog", { option: true }],

  // "never" makes the requests of the app never time out, so a test can hold
  // a request as long as it needs. "real" leaves the timeout of the app, 5
  // seconds of real time, for a test that checks how the app gives up.
  requestTimeout: ["never", { option: true }],

  app: async ({ seed }, use) => {
    const dataDir = await mkdtemp(join(tmpdir(), "meals-e2e-"));
    try {
      // Only this machine can reach the server, not the network.
      const server = await start({
        dataDir,
        host: "127.0.0.1",
        logger: silentLogger,
        port: 0,
        version,
      });
      try {
        const url = `http://127.0.0.1:${server.port}`;
        const api = createApi(url);
        const seeded =
          seed === "catalog" ? await seedCatalog(api) : { recipes: {}, ingredients: {} };
        await use({ url, port: server.port, dataDir, api, ...seeded });
      } finally {
        await server.stop();
      }
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  },

  baseURL: async ({ app }, use) => {
    await use(app.url);
  },

  // `network` sets `allowed` while it makes the API fail, because the app logs
  // a console error when a load or a save fails.
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads the fixtures from the pattern.
  consoleErrors: async ({}, use) => {
    await use({ allowed: false });
  },

  page: async ({ consoleErrors, page, requestTimeout }, use) => {
    const errorsOf = watchErrors(page, consoleErrors);
    await startClock(page, requestTimeout);
    await use(page);
    expect(await errorsOf(), "errors in the page").toEqual([]);
  },

  // Opens another page in the context of `page`, such as a second tab, or
  // the app again after its tab closed. It starts at the fixed date, and the
  // test fails on an error in it, as in `page`.
  newPage: async ({ consoleErrors, context, requestTimeout }, use) => {
    const watched = [];
    await use(async () => {
      const page = await context.newPage();
      watched.push(watchErrors(page, consoleErrors));
      await startClock(page, requestTimeout);
      return page;
    });
    for (const errorsOf of watched) expect(await errorsOf(), "errors in the page").toEqual([]);
  },

  // Makes the requests of the context's pages to the API fail, while the
  // static files keep loading. `down()` refuses each request, as a stopped
  // server does. `stall()` holds each request without an answer, as a paused
  // server does, until the app gives up, so it needs `requestTimeout: "real"`.
  // `up()` aborts the held requests and lets the new ones through. The app
  // logs console errors when its requests fail, so `down()` and `stall()`
  // allow the failure logs. `up()` stops allowing them once every page has
  // settled the requests that failed and run the handlers of their failure,
  // so a failure log after `up()` fails the test, and the log of a request
  // that `up()` aborts never does. A test that doesn't call `up()` allows
  // them until it ends.
  network: async ({ consoleErrors, context, requestTimeout }, use) => {
    // The pages keep their pending requests, so `up()` can wait for them.
    await context.addInitScript(trackRequests);
    // "down" or "stalled" while the route below is in place.
    let state;
    const held = [];
    async function handle(route) {
      // A request that reaches the route while `up()` removes it goes through.
      if (state === undefined) return route.fallback();
      if (state === "down") await route.abort("connectionrefused");
      else held.push(route);
    }
    // Only a failing API has a route, so a working one answers each request
    // as the server does, with no detour through the test.
    async function fail(next) {
      if (next === "stalled" && requestTimeout !== "real") {
        throw new Error('network.stall() needs test.use({ requestTimeout: "real" })');
      }
      consoleErrors.allowed = true;
      const routed = state !== undefined;
      state = next;
      if (!routed) await context.route(isApiRequest, handle);
    }
    // Removes the route, and aborts the held requests. Their failure logs may
    // come after this.
    async function release() {
      if (state === undefined) return false;
      state = undefined;
      await context.unroute(isApiRequest, handle);
      // The app may have given up on a held request already.
      await Promise.all(held.splice(0).map((route) => route.abort().catch(() => {})));
      return true;
    }
    async function up() {
      if (!(await release())) return;
      await Promise.all(context.pages().map(settleRequests));
      consoleErrors.allowed = false;
    }
    await use({ down: () => fail("down"), stall: () => fail("stalled"), up });
    // The test may end while the page still logs: the page fixture decides.
    await release();
  },
};

export const test = base.extend(fixtures);

export { expect };
