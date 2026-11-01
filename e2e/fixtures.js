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

export const test = base.extend({
  // "catalog" seeds the recipes and the ingredients of catalog.js, and
  // "empty" seeds nothing.
  seed: ["catalog", { option: true }],

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

  // A test that simulates a server failure sets `allowed`, because the app
  // logs a console error when a load or a save fails.
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads the fixtures from the pattern.
  consoleErrors: async ({}, use) => {
    await use({ allowed: false });
  },

  page: async ({ consoleErrors, page }, use) => {
    const errorsOf = watchErrors(page, consoleErrors);
    await page.clock.install({ time: NOW });
    await use(page);
    expect(await errorsOf(), "errors in the page").toEqual([]);
  },

  // Opens another page in the context of `page`, such as a second tab, or
  // the app again after its tab closed. It starts at the fixed date, and the
  // test fails on an error in it, as in `page`.
  newPage: async ({ consoleErrors, context }, use) => {
    const watched = [];
    await use(async () => {
      const page = await context.newPage();
      watched.push(watchErrors(page, consoleErrors));
      await page.clock.install({ time: NOW });
      return page;
    });
    for (const errorsOf of watched) expect(await errorsOf(), "errors in the page").toEqual([]);
  },

  // Makes the requests of the context's pages to the API fail, while the
  // static files keep loading. `down()` refuses each request, as a stopped
  // server does. `stall()` holds each request without an answer, as a paused
  // server does, until the app gives up. `up()` aborts the held requests and
  // lets the new ones through. The app logs console errors when its requests
  // fail, so `down()` and `stall()` allow them.
  network: async ({ consoleErrors, context }, use) => {
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
      consoleErrors.allowed = true;
      const routed = state !== undefined;
      state = next;
      if (!routed) await context.route(isApiRequest, handle);
    }
    async function up() {
      if (state === undefined) return;
      state = undefined;
      await context.unroute(isApiRequest, handle);
      // The app may have given up on a held request already.
      await Promise.all(held.splice(0).map((route) => route.abort().catch(() => {})));
    }
    await use({ down: () => fail("down"), stall: () => fail("stalled"), up });
    await up();
  },
});

export { expect };
