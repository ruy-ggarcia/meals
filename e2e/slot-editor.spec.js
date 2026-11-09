// The slot editor on a desktop: the dialog where you pick the recipes and the
// servings of one meal.

import { CURRENT_WEEK } from "./catalog.js";
import { answerQuestions, reloadAndAsk } from "./dialogs.js";
import { expect, test } from "./fixtures.js";
import { expectFocusTrapped } from "./keyboard.js";
import { expectNoSidewaysScroll, expectWrapsInside } from "./layout.js";
import { holdSaves } from "./meal-plan.js";
import { editorOf, LONG_NAME, searchOf, watchClose } from "./slot-editor.js";

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

// How long the note stays, in milliseconds. Kept in sync with SAVED_BADGE_MS
// in public/app.js.
const SAVED_BADGE_MS = 3000;

/** Opens Monday's lunch with two salads, and lowers the servings of the Russian salad to half. */
async function openMondayWithHalfSalad(app, page) {
  const editor = await openMonday(app, page, [
    ["Russian salad", 1],
    ["Green salad", 2],
  ]);
  await editor.getByRole("button", { name: "Decrease servings of Russian salad" }).click();
  return editor;
}

/** The toolbar's note that the changes saved, which only a save shows. */
function savedNote(page) {
  return page.getByText("All changes saved", { exact: true }).filter({ visible: true });
}

test.describe("slot editor", () => {
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
    await expect(editor).toBeVisible();
  });

  test("shows the saved menu in the slot after Done", async ({ app, page }) => {
    const editor = await openMondayWithHalfSalad(app, page);

    await editor.getByRole("button", { name: "Done" }).click();

    await expect(editor).toBeHidden();
    const slot = page.getByRole("button", {
      name: "Monday, Lunch: Russian salad × 0.5, Green salad × 2",
    });
    await expect(slot).toContainText("Russian salad");
    await expect(slot).toContainText("×0.5");
    await expect(slot).toContainText("Green salad");
    await expect(slot).toContainText("×2");
  });

  test("focuses the slot after Done", async ({ app, page }) => {
    const editor = await openMondayWithHalfSalad(app, page);

    await editor.getByRole("button", { name: "Done" }).click();

    const slot = page.getByRole("button", {
      name: "Monday, Lunch: Russian salad × 0.5, Green salad × 2",
    });
    await expect(slot).toBeFocused();
  });

  test("saves the menu to the server with Done", async ({ app, page }) => {
    const editor = await openMondayWithHalfSalad(app, page);

    await editor.getByRole("button", { name: "Done" }).click();

    await expect
      .poll(() => savedMonday(app))
      .toEqual([
        { recipeId: app.recipes["Russian salad"].id, servings: 0.5 },
        { recipeId: app.recipes["Green salad"].id, servings: 2 },
      ]);
  });

  test("shows Saving… while the save runs, then All changes saved", async ({ app, page }) => {
    const editor = await openMondayWithHalfSalad(app, page);
    // Holds the save, so the test can see the toolbar while it's running.
    const held = await holdSaves(page);

    await editor.getByRole("button", { name: "Done" }).click();

    await expect(page.getByText("Saving…").filter({ visible: true })).toBeVisible();
    held.release();
    await expect(savedNote(page)).toBeVisible();
  });

  test("hides All changes saved after 3 seconds", async ({ app, page }) => {
    const editor = await openMondayWithHalfSalad(app, page);
    // The clock stops here, so the note stays until the test moves the clock.
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
    await editor.getByRole("button", { name: "Done" }).click();
    await expect(savedNote(page)).toBeVisible();

    await page.clock.runFor(SAVED_BADGE_MS - 1);

    await expect(savedNote(page)).toBeVisible();

    await page.clock.runFor(1);

    await expect(savedNote(page)).toBeHidden();
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

  test("clears the search with Escape instead of closing", async ({ app, page }) => {
    const editor = await openMonday(app, page);
    await editor.getByRole("option", { name: "Green salad" }).click();
    const search = searchOf(editor);
    await search.fill("sal");

    await search.press("Escape");

    await expect(search).toHaveValue("");
    await expect(editor).toBeVisible();
  });

  test("closes without saving on Escape", async ({ app, page }) => {
    const editor = await openMonday(app, page);
    await editor.getByRole("option", { name: "Green salad" }).click();
    const closed = await watchClose(page);

    await searchOf(editor).press("Escape");

    await expect(editor).toBeHidden();
    await closed();
    await expect(page.getByRole("button", { name: "Monday, Lunch: empty" })).toBeVisible();
    expect(await savedMonday(app)).toEqual([]);
  });

  test("closes with a click outside when nothing changed", async ({ app, page }) => {
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
  });

  test("wraps a long recipe name in the editor", async ({ app, page }) => {
    const editor = await openMonday(app, page);
    await searchOf(editor).fill("Supercali");

    await editor.getByRole("option", { name: LONG_NAME }).click();

    await expectWrapsInside(rowOf(editor, LONG_NAME).getByText(LONG_NAME, { exact: true }), editor);
    await expectNoSidewaysScroll(page);
  });

  test("wraps a long recipe name in the slot", async ({ app, page }) => {
    const editor = await openMonday(app, page);
    await searchOf(editor).fill("Supercali");
    await editor.getByRole("option", { name: LONG_NAME }).click();

    await editor.getByRole("button", { name: "Done" }).click();

    const slot = page.getByRole("button", { name: `Monday, Lunch: ${LONG_NAME} × 1` });
    await expectWrapsInside(slot.getByText(LONG_NAME, { exact: true }), slot);
    await expectNoSidewaysScroll(page);
  });

  test("asks before a reload loses its changes", async ({ app, page }) => {
    const editor = await openMonday(app, page);
    await editor.getByRole("option", { name: "Green salad" }).click();
    const kinds = answerQuestions(page);

    await reloadAndAsk(page);

    await expect.poll(() => kinds).toEqual(["beforeunload"]);
    await expect(editor).toBeVisible();
    await expect(rowOf(editor, "Green salad")).toBeVisible();
  });

  test("reloads without asking after Cancel", async ({ app, page }) => {
    const editor = await openMonday(app, page);
    await editor.getByRole("option", { name: "Green salad" }).click();
    await editor.getByRole("button", { name: "Cancel" }).click();
    await expect(editor).toBeHidden();
    const kinds = answerQuestions(page);

    await page.reload();

    await expect(page.getByRole("button", { name: "Monday, Lunch: empty" })).toBeVisible();
    expect(kinds, "dialogs that appeared").toEqual([]);
  });

  test("keeps the focus inside the dialog", async ({ app, page }) => {
    const editor = await openMonday(app, page, [
      ["Russian salad", 1],
      ["Green salad", 1],
    ]);

    // The editor has fewer controls than the presses, so this goes around it
    // more than once, in both directions. The title has the focus when the
    // editor opens, and Cancel comes before it, so only Shift+Tab reaches
    // Cancel at first.
    await expectFocusTrapped(page, editor, {
      names: ["Cancel", "Done", "Add recipe", "Remove Russian salad"],
      presses: 30,
    });
    await expect(editor).toBeVisible();
  });
});
