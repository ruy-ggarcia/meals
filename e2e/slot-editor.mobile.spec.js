// The slot editor on a phone: a sheet that fills the screen, and a keyboard
// that opens only when you tap the search field.

import { CURRENT_WEEK } from "./catalog.js";
import { expect, test } from "./fixtures.js";
import { expectNoSidewaysScroll, expectWrapsInside } from "./layout.js";
import { switchAway } from "./page-visibility.js";
import {
  expectFillsScreen,
  expectKeyboardClosed,
  expectKeyboardOpen,
  expectNoZoomOnFocus,
} from "./phone.js";
import { editorOf, LONG_NAME, searchOf, watchClose } from "./slot-editor.js";

// The empty space below the last control that the tap needs, in pixels: a tap
// in less could land on the control.
const MIN_EMPTY_SPACE = 20;

/** Gives Wednesday's lunch `names` with one serving each. */
async function planWednesday(app, names) {
  await app.api.saveSlot(
    CURRENT_WEEK,
    "wed",
    "lunch",
    names.map((name) => ({ recipeId: app.recipes[name].id, servings: 1 })),
  );
}

/** Taps Wednesday's lunch, the slot of today, and returns its editor. */
async function openWednesday(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /^Wednesday, Lunch:/ }).tap();
  const editor = editorOf(page);
  await expect(editor).toBeVisible();
  return editor;
}

test.describe("slot editor", () => {
  test("fills the screen below the status bar", async ({ page }) => {
    const editor = await openWednesday(page);

    await expectFillsScreen(editor);
  });

  test("opens without the keyboard", async ({ page }) => {
    await openWednesday(page);

    await expectKeyboardClosed(page);
  });

  test("removes a recipe without the keyboard", async ({ app, page }) => {
    await planWednesday(app, ["Lentil soup", "Omelette"]);
    const editor = await openWednesday(page);

    await editor.getByRole("button", { name: "Remove Lentil soup" }).tap();

    await expect(editor.getByRole("listitem")).toHaveText([/^Omelette/]);
    await expectKeyboardClosed(page);
  });

  test("opens the keyboard for Add recipe without zooming", async ({ page }) => {
    const editor = await openWednesday(page);
    const search = searchOf(editor);
    await expectNoZoomOnFocus(search);

    await search.tap();

    await expectKeyboardOpen(search);
  });

  test("stays open when you tap its empty area", async ({ page }) => {
    const editor = await openWednesday(page);
    const search = searchOf(editor);
    await search.fill("sal");
    const box = await editor.boundingBox();
    // The list of matches is the last control of the editor.
    const options = await editor.getByRole("listbox", { name: "Recipes" }).boundingBox();
    const below = options.y + options.height;
    const bottom = box.y + box.height;
    expect(
      bottom - below,
      `the empty space below the last control must be more than ${MIN_EMPTY_SPACE}px, so the tap lands on the editor and not on a control`,
    ).toBeGreaterThan(MIN_EMPTY_SPACE);

    // The middle of the empty area below the last control.
    await page.touchscreen.tap(box.x + box.width / 2, (below + bottom) / 2);

    await expect(editor).toBeVisible();
    await expect(search).toHaveValue("sal");
  });

  test("stays open when you switch away and back", async ({ page }) => {
    const editor = await openWednesday(page);
    await editor.getByRole("option", { name: "Green salad" }).tap();

    await switchAway(page);

    await expect(editor).toBeVisible();
    await expect(editor.getByRole("listitem")).toHaveText([/^Green salad/]);

    await editor.getByRole("button", { name: "Cancel" }).tap();

    await expect(editor).toBeHidden();
  });

  // In Chrome, the Back gesture of Android sends a modal dialog the same
  // cancel request that Escape sends.
  test("closes without saving on Back", async ({ app, page }) => {
    const editor = await openWednesday(page);
    await editor.getByRole("option", { name: "Green salad" }).tap();
    await expect(editor.getByRole("listitem")).toHaveText([/^Green salad/]);

    const closed = await watchClose(page);
    await page.keyboard.press("Escape");

    await expect(editor).toBeHidden();
    await closed();
    await expect(page.getByRole("button", { name: "Wednesday, Lunch: empty" })).toBeVisible();
    const week = await app.api.week(CURRENT_WEEK);
    expect(week.wed.lunch.items).toEqual([]);
  });

  test("wraps a long recipe name in the editor", async ({ page }) => {
    const editor = await openWednesday(page);
    await searchOf(editor).fill("Supercali");

    await editor.getByRole("option", { name: LONG_NAME }).tap();

    const nameInEditor = editor.getByRole("listitem").getByText(LONG_NAME, { exact: true });
    await expectWrapsInside(nameInEditor, editor);
    await expectNoSidewaysScroll(page);
  });

  test("wraps a long recipe name in the slot", async ({ page }) => {
    const editor = await openWednesday(page);
    await searchOf(editor).fill("Supercali");
    await editor.getByRole("option", { name: LONG_NAME }).tap();

    await editor.getByRole("button", { name: "Done" }).tap();

    const slot = page.getByRole("button", { name: `Wednesday, Lunch: ${LONG_NAME} × 1` });
    await expectWrapsInside(slot.getByText(LONG_NAME, { exact: true }), slot);
    await expectNoSidewaysScroll(page);
  });
});
