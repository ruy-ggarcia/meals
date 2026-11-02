// Tests for the page shell that every page shares: the section links, the
// sidebar that wide screens show, and the icons and the web app manifest.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, describe, test } from "node:test";
import { Window } from "happy-dom";
import { fakeFetch, loadPage, tick } from "./dom-helpers.js";
import { blankWeek } from "./meal-plan-helpers.js";

const PAGES = [
  ["index.html", "app.js", "/"],
  ["recipes.html", "recipes.js", "/recipes.html"],
  ["ingredients.html", "ingredients.js", "/ingredients.html"],
];

async function loadMarkup(html) {
  const markup = await readFile(new URL(`../public/${html}`, import.meta.url), "utf8");
  const window = new Window({ url: "http://localhost/" });
  window.document.write(markup.replace(/<script[^>]*><\/script>/g, ""));
  return window;
}

let page;

/** `loadPage` with the answers of an empty meal plan, recipe book, and catalog. */
async function loadAnswered(options) {
  const server = fakeFetch();
  const loaded = await loadPage({ ...options, fetch: server.fetch });
  for (const request of server.requests) {
    request.respond(
      200,
      request.url.startsWith("/api/weeks/") ? blankWeek() : { recipes: [], ingredients: [] },
    );
  }
  await tick();
  return loaded;
}

afterEach(async () => {
  await page?.cleanup();
  page = undefined;
});

test("each page links to the three sections, in order, and marks its own as the current page", async () => {
  for (const [html, , own] of PAGES) {
    const window = await loadMarkup(html);

    const links = [...window.document.querySelectorAll(".page-links a")].map((link) => [
      link.getAttribute("href"),
      link.querySelector(".page-name").textContent,
      link.getAttribute("aria-current"),
    ]);

    assert.deepEqual(
      links,
      [
        ["/", "Meal plan", own === "/" ? "page" : null],
        ["/recipes.html", "Recipes", own === "/recipes.html" ? "page" : null],
        ["/ingredients.html", "Ingredients", own === "/ingredients.html" ? "page" : null],
      ],
      html,
    );
    await window.happyDOM.close();
  }
});

test("each page links the app icon, the Home Screen icon, and the web app manifest", async () => {
  for (const [html] of PAGES) {
    const window = await loadMarkup(html);
    const href = (selector) => window.document.querySelector(selector)?.getAttribute("href");

    assert.equal(href('link[rel="icon"][type="image/svg+xml"]'), "/icons/favicon.svg", html);
    assert.equal(href('link[rel="icon"][type="image/png"]'), "/icons/favicon-32.png", html);
    assert.equal(href('link[rel="apple-touch-icon"]'), "/icons/apple-touch-icon.png", html);
    assert.equal(href('link[rel="manifest"]'), "/manifest.webmanifest", html);
    assert.equal(
      /** @type {any} */ (window.document.querySelector('meta[name="apple-mobile-web-app-title"]'))
        ?.content,
      "Meals",
      html,
    );
    await window.happyDOM.close();
  }
});

describe("sidebar", () => {
  test("switches with Hide sidebar and Show sidebar on every page", async () => {
    for (const [html, script] of PAGES) {
      page = await loadAnswered({ html, script });
      const { document } = page;
      const root = document.documentElement;
      // No choice yet: the width of the screen decides.
      assert.equal(root.dataset.sidebar, undefined, html);

      document.querySelector(".hide-sidebar").click();
      assert.equal(root.dataset.sidebar, "hidden", html);

      document.querySelector(".show-sidebar").click();
      assert.equal(root.dataset.sidebar, "shown", html);
      await page.cleanup();
    }
    page = undefined;
  });

  test("stores the choice in localStorage on every page", async () => {
    for (const [html, script] of PAGES) {
      page = await loadAnswered({ html, script });
      const { document, window } = page;

      document.querySelector(".hide-sidebar").click();
      assert.equal(window.localStorage.getItem("meals.sidebar"), "hidden", html);

      document.querySelector(".show-sidebar").click();
      assert.equal(window.localStorage.getItem("meals.sidebar"), "shown", html);
      await page.cleanup();
    }
    page = undefined;
  });
});

test("a page opens with the sidebar choice that another page remembered", async () => {
  for (const [html, script] of PAGES) {
    page = await loadAnswered({
      html,
      script,
      beforeScript: (window) => window.localStorage.setItem("meals.sidebar", "hidden"),
    });

    assert.equal(page.document.documentElement.dataset.sidebar, "hidden", html);
    await page.cleanup();
  }
  page = undefined;
});

test("a page without storage still opens, and the sidebar still switches", async () => {
  page = await loadAnswered({
    html: "recipes.html",
    script: "recipes.js",
    beforeScript: (window) => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new Error("Storage is off");
        },
      });
    },
  });

  page.document.querySelector(".hide-sidebar").click();

  assert.equal(page.document.documentElement.dataset.sidebar, "hidden");
});

describe("manifest.webmanifest", () => {
  async function readManifest() {
    const file = new URL("../public/manifest.webmanifest", import.meta.url);
    return JSON.parse(await readFile(file, "utf8"));
  }

  test("names the app Meals", async () => {
    assert.equal((await readManifest()).name, "Meals");
  });

  test("displays the app standalone", async () => {
    assert.equal((await readManifest()).display, "standalone");
  });
});
