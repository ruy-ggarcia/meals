import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Window } from "happy-dom";

const PAGES = [
  ["index.html", ["/recipes.html", "/ingredients.html"]],
  ["recipes.html", ["/", "/ingredients.html"]],
  ["ingredients.html", ["/", "/recipes.html"]],
];

test("each page links to the other two, in the order Meal plan, Recipes, Ingredients", async () => {
  for (const [html, links] of PAGES) {
    const markup = await readFile(new URL(`../public/${html}`, import.meta.url), "utf8");
    const window = new Window({ url: "http://localhost/" });
    window.document.write(markup.replace(/<script[^>]*><\/script>/g, ""));

    const hrefs = [...window.document.querySelectorAll(".page-links a")].map((link) =>
      link.getAttribute("href"),
    );

    assert.deepEqual(hrefs, links, html);
    await window.happyDOM.close();
  }
});
