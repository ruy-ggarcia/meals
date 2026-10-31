import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Window } from "happy-dom";

const PAGES = [
  ["index.html", ["/recipes.html", "/ingredients.html"]],
  ["recipes.html", ["/", "/ingredients.html"]],
  ["ingredients.html", ["/", "/recipes.html"]],
];

async function loadMarkup(html) {
  const markup = await readFile(new URL(`../public/${html}`, import.meta.url), "utf8");
  const window = new Window({ url: "http://localhost/" });
  window.document.write(markup.replace(/<script[^>]*><\/script>/g, ""));
  return window;
}

test("each page links to the other two, in the order Meal plan, Recipes, Ingredients", async () => {
  for (const [html, links] of PAGES) {
    const window = await loadMarkup(html);

    const hrefs = [...window.document.querySelectorAll(".page-links a")].map((link) =>
      link.getAttribute("href"),
    );

    assert.deepEqual(hrefs, links, html);
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
