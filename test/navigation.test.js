// Tests for the page shell that every page shares: the section links, the
// sidebar that wide screens show, and the icons and the web app manifest.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, test } from "node:test";
import { Window } from "happy-dom";
import { fakeFetch, loadPage } from "./dom-helpers.js";

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
      window.document.querySelector('meta[name="apple-mobile-web-app-title"]')?.content,
      "Meals",
      html,
    );
    await window.happyDOM.close();
  }
});

test("Hide sidebar and Show sidebar switch the sidebar on every page, and the choice is remembered", async () => {
  for (const [html, script] of PAGES) {
    page = await loadPage({ html, script, fetch: fakeFetch().fetch });
    const { document, window } = page;
    const root = document.documentElement;
    // No choice yet: the width of the screen decides.
    assert.equal(root.dataset.sidebar, undefined, html);

    document.querySelector(".hide-sidebar").click();
    assert.equal(root.dataset.sidebar, "hidden", html);
    assert.equal(window.localStorage.getItem("meals.sidebar"), "hidden", html);

    document.querySelector(".show-sidebar").click();
    assert.equal(root.dataset.sidebar, "shown", html);
    assert.equal(window.localStorage.getItem("meals.sidebar"), "shown", html);
    await page.cleanup();
  }
  page = undefined;
});

test("a page opens with the sidebar choice that another page remembered", async () => {
  for (const [html, script] of PAGES) {
    page = await loadPage({
      html,
      script,
      fetch: fakeFetch().fetch,
      beforeScript: (window) => window.localStorage.setItem("meals.sidebar", "hidden"),
    });

    assert.equal(page.document.documentElement.dataset.sidebar, "hidden", html);
    await page.cleanup();
  }
  page = undefined;
});

test("a page without storage still opens, and the sidebar still switches", async () => {
  page = await loadPage({
    html: "recipes.html",
    script: "recipes.js",
    fetch: fakeFetch().fetch,
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
