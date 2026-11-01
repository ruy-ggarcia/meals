// The slot editor on a desktop: the dialog where you pick the recipes and the
// servings of one meal.

import { CURRENT_WEEK } from "./catalog.js";
import { expect, test } from "./fixtures.js";
import { expectNoSidewaysScroll, expectWrapsInside } from "./layout.js";
import { editorOf, LONG_NAME, searchOf, watchClose } from "./slot-editor.js";

const ALL_RECIPES = [
  "<b>Bold</b> soup",
  "Gnocchi carbonara",
  "Green salad",
  "Lentil soup",
  "Omelette",
  "Russian salad",
  LONG_NAME,
];

/** The row of the recipe called `name` in the menu of the editor. */
function rowOf(editor, name) {
  return editor.getByRole("listitem").filter({ hasText: name });
}

/** The servings of a row, which read like `1` or `2.5`. */
function servingsOf(row) {
  return row.getByText(/^\d+(\.5)?$/);
}

/** The recipes of the list under Add recipe. */
function optionsOf(editor) {
  return editor.getByRole("option");
}

/** Gives Monday's lunch `menu`, a list of `[name, servings]`, and opens its editor. */
async function openMonday(app, page, menu = []) {
  if (menu.length > 0) {
    await app.api.saveSlot(
      CURRENT_WEEK,
      "mon",
      "lunch",
      menu.map(([name, servings]) => ({ recipeId: app.recipes[name].id, servings })),
    );
  }
  await page.goto("/");
  await page.getByRole("button", { name: /^Monday, Lunch:/ }).click();
  const editor = editorOf(page);
  await expect(editor).toBeVisible();
  return editor;
}

/** Clicks the dark area outside the editor. */
async function clickBackdrop(page) {
  await page.mouse.click(10, 10);
}

/** Reads what the server saved for Monday's lunch. */
async function savedMonday(app) {
  const week = await app.api.week(CURRENT_WEEK);
  return week.mon.lunch.items;
}

test("opens an empty slot with the recipes from A to Z", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Monday, Lunch: empty" }).click();

  const editor = editorOf(page);
  await expect(editor).toBeVisible();
  await expect(editor.getByRole("heading", { name: "Lunch" })).toBeVisible();
  await expect(editor.getByText("Monday, Sep 21", { exact: true })).toBeVisible();
  await expect(editor.getByText("Nothing planned. Add a recipe below.")).toBeVisible();
  await expect(optionsOf(editor)).toHaveText(ALL_RECIPES);
});

test("finds recipes by any part of the name, ignoring case and accents", async ({ app, page }) => {
  const editor = await openMonday(app, page);
  const search = searchOf(editor);

  await search.fill("SOUP");

  await expect(optionsOf(editor)).toHaveText(["<b>Bold</b> soup", "Lentil soup"]);

  await search.fill("omelétte");

  await expect(optionsOf(editor)).toHaveText(["Omelette"]);
});

test("adds the highlighted recipe with the arrow keys and Enter", async ({ app, page }) => {
  const editor = await openMonday(app, page);
  const search = searchOf(editor);
  await search.fill("salad");
  await expect(optionsOf(editor)).toHaveText(["Green salad", "Russian salad"]);

  await search.press("ArrowDown");
  await expect(editor.getByRole("option", { name: "Russian salad" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await search.press("Enter");

  const row = rowOf(editor, "Russian salad");
  await expect(row).toBeVisible();
  await expect(servingsOf(row)).toHaveText("1");
  await expect(search).toHaveValue("");
  await expect(editor.getByRole("option", { name: "Russian salad" })).toHaveCount(0);
  await expect(editor).toBeVisible();
});

test("adds a recipe from the list with a click", async ({ app, page }) => {
  const editor = await openMonday(app, page, [["Russian salad", 1]]);

  await editor.getByRole("option", { name: "Green salad" }).click();

  await expect(editor.getByRole("listitem")).toHaveText([/^Russian salad/, /^Green salad/]);
  await expect(servingsOf(rowOf(editor, "Green salad"))).toHaveText("1");
});

test("steps servings by halves", async ({ app, page }) => {
  const editor = await openMonday(app, page, [["Green salad", 1]]);
  const servings = servingsOf(rowOf(editor, "Green salad"));
  const more = editor.getByRole("button", { name: "Increase servings of Green salad" });
  const fewer = editor.getByRole("button", { name: "Decrease servings of Green salad" });

  await more.click();
  await expect(servings).toHaveText("1.5");
  await more.click();
  await expect(servings).toHaveText("2");
  await more.click();
  await expect(servings).toHaveText("2.5");
  await fewer.click();
  await expect(servings).toHaveText("2");
});

test("stops servings at a half and moves focus to plus", async ({ app, page }) => {
  const editor = await openMonday(app, page, [["Russian salad", 1]]);
  const fewer = editor.getByRole("button", { name: "Decrease servings of Russian salad" });

  await fewer.click();

  await expect(servingsOf(rowOf(editor, "Russian salad"))).toHaveText("0.5");
  await expect(fewer).toBeDisabled();
  await expect(
    editor.getByRole("button", { name: "Increase servings of Russian salad" }),
  ).toBeFocused();
});

test("saves the menu with Done and shows that it saved", async ({ app, page }) => {
  const editor = await openMonday(app, page, [
    ["Russian salad", 1],
    ["Green salad", 2],
  ]);
  await editor.getByRole("button", { name: "Decrease servings of Russian salad" }).click();
  // Holds the save, so the test can see the toolbar while it's running.
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/weeks/**", async (route) => {
    if (route.request().method() === "PUT") await held;
    await route.continue();
  });

  await editor.getByRole("button", { name: "Done" }).click();

  await expect(editor).toBeHidden();
  const slot = page.getByRole("button", {
    name: "Monday, Lunch: Russian salad × 0.5, Green salad × 2",
  });
  await expect(slot).toContainText("Russian salad");
  await expect(slot).toContainText("×0.5");
  await expect(slot).toContainText("Green salad");
  await expect(slot).toContainText("×2");
  await expect(slot).toBeFocused();
  await expect(page.getByText("Saving…").filter({ visible: true })).toBeVisible();
  release();
  const saved = page.getByText("All changes saved", { exact: true }).filter({ visible: true });
  await expect(saved).toBeVisible();
  await page.unroute("**/api/weeks/**");
  expect(await savedMonday(app)).toEqual([
    { recipeId: app.recipes["Russian salad"].id, servings: 0.5 },
    { recipeId: app.recipes["Green salad"].id, servings: 2 },
  ]);
  await page.clock.fastForward(3000);
  await expect(saved).toBeHidden();
});

test("stays open when a drag ends outside the editor", async ({ app, page }) => {
  const editor = await openMonday(app, page);
  const search = searchOf(editor);
  await search.fill("sal");
  const box = await search.boundingBox();

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(10, 10, { steps: 5 });
  await page.mouse.up();

  await expect(editor).toBeVisible();
  await expect(search).toHaveValue("sal");
});

test("clears the search with Escape before it closes the editor", async ({ app, page }) => {
  const editor = await openMonday(app, page);
  await editor.getByRole("option", { name: "Green salad" }).click();
  const search = searchOf(editor);
  await search.fill("sal");

  await search.press("Escape");

  await expect(search).toHaveValue("");
  await expect(editor).toBeVisible();

  const closed = await watchClose(page);
  await search.press("Escape");

  await expect(editor).toBeHidden();
  await closed();
  await expect(page.getByRole("button", { name: "Monday, Lunch: empty" })).toBeVisible();
  expect(await savedMonday(app)).toEqual([]);
});

test("closes an unchanged editor from outside", async ({ app, page }) => {
  const editor = await openMonday(app, page, [["Russian salad", 1]]);

  await clickBackdrop(page);

  await expect(editor).toBeHidden();
});

test("stays open with a change when you click outside", async ({ app, page }) => {
  const editor = await openMonday(app, page, [
    ["Russian salad", 0.5],
    ["Green salad", 2],
  ]);
  await editor.getByRole("button", { name: "Increase servings of Russian salad" }).click();

  await clickBackdrop(page);

  await expect(editor).toBeVisible();
  await expect(servingsOf(rowOf(editor, "Russian salad"))).toHaveText("1");

  await editor.getByRole("button", { name: "Cancel" }).click();

  await expect(editor).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Monday, Lunch: Russian salad × 0.5, Green salad × 2" }),
  ).toBeVisible();
});

test("says when no recipe matches", async ({ app, page }) => {
  const editor = await openMonday(app, page);

  await searchOf(editor).fill("xyz");

  await expect(optionsOf(editor)).toHaveCount(0);
  await expect(editor.getByRole("listbox")).toBeHidden();
  await expect(
    editor.getByText("No active recipes match. Add recipes on the Recipes page."),
  ).toBeVisible();
});

test("wraps a long recipe name in the slot and the editor", async ({ app, page }) => {
  const editor = await openMonday(app, page);
  await searchOf(editor).fill("Supercali");
  await editor.getByRole("option", { name: LONG_NAME }).click();

  await expectWrapsInside(rowOf(editor, LONG_NAME).getByText(LONG_NAME, { exact: true }), editor);
  await expectNoSidewaysScroll(page);

  await editor.getByRole("button", { name: "Done" }).click();

  const slot = page.getByRole("button", { name: `Monday, Lunch: ${LONG_NAME} × 1` });
  await expectWrapsInside(slot.getByText(LONG_NAME, { exact: true }), slot);
  await expectNoSidewaysScroll(page);
});

test("asks before a reload loses the editor's changes", async ({ app, page }) => {
  const editor = await openMonday(app, page);
  await editor.getByRole("option", { name: "Green salad" }).click();
  const kinds = [];
  page.on("dialog", async (dialog) => {
    kinds.push(dialog.type());
    await dialog.dismiss();
  });

  // A reload that the prompt cancels never finishes, so don't wait for it.
  await page.evaluate(() => {
    setTimeout(() => location.reload());
  });

  await expect.poll(() => kinds).toEqual(["beforeunload"]);
  await expect(editor).toBeVisible();
  await expect(rowOf(editor, "Green salad")).toBeVisible();
});

test("reloads without asking after Cancel", async ({ app, page }) => {
  const editor = await openMonday(app, page);
  await editor.getByRole("option", { name: "Green salad" }).click();
  await editor.getByRole("button", { name: "Cancel" }).click();
  await expect(editor).toBeHidden();
  const kinds = [];
  page.on("dialog", async (dialog) => {
    kinds.push(dialog.type());
    await dialog.dismiss();
  });

  await page.reload();

  await expect(page.getByRole("button", { name: "Monday, Lunch: empty" })).toBeVisible();
  expect(kinds, "dialogs that appeared").toEqual([]);
});

test("keeps focus inside the editor", async ({ app, page }) => {
  const editor = await openMonday(app, page, [
    ["Russian salad", 1],
    ["Green salad", 1],
  ]);
  const visited = new Set();

  // The editor has fewer controls than the presses, so this goes around it
  // more than once, in both directions. The title has the focus when the
  // editor opens, and Cancel comes before it, so only Shift+Tab reaches
  // Cancel at first.
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let press = 1; press <= 30; press += 1) {
      await page.keyboard.press(key);
      const focus = await page.evaluate(() => {
        const active = document.activeElement;
        const dialog = document.getElementById("slot-editor");
        // The browser's own interface can hold the focus: no element has it.
        if (active === null || active === document.body) return { outside: false, name: null };
        const name =
          active.getAttribute("aria-label") ??
          active.labels?.[0]?.textContent ??
          active.textContent.trim();
        return { outside: !dialog.contains(active), name };
      });
      expect(focus.outside, `${key} ${press} focused ${focus.name}`).toBe(false);
      if (focus.name !== null) visited.add(focus.name);
    }
  }

  expect([...visited]).toEqual(
    expect.arrayContaining(["Cancel", "Done", "Add recipe", "Remove Russian salad"]),
  );
  await expect(editor).toBeVisible();
});

test("moves focus to Done when the menu is full", async ({ app, page }) => {
  for (let index = 1; index <= 20; index += 1) {
    await app.api.createRecipe({ name: `Filler ${index}` });
  }
  const editor = await openMonday(app, page);
  const search = searchOf(editor);

  for (let count = 1; count <= 20; count += 1) {
    await search.fill("Filler");
    await search.press("Enter");
    await expect(editor.getByRole("listitem")).toHaveCount(count);
    if (count < 20) await expect(search).toBeFocused();
  }

  await expect(editor.getByRole("button", { name: "Done" })).toBeFocused();
  await expect(search).toBeDisabled();
});
