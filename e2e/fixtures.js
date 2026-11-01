// The fixtures of the browser tests. Each test gets its own server, on a free
// port and with a new data directory, seeded through the API. Its page starts
// at the fixed date, and the test fails on an error in the page.

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
    const errors = [];
    page.on("pageerror", (error) => errors.push(`Uncaught error: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error" && !consoleErrors.allowed) {
        errors.push(`Console error: ${message.text()}`);
      }
    });
    await page.clock.install({ time: NOW });
    await use(page);
    expect(errors, "errors in the page").toEqual([]);
  },
});

export { expect };
