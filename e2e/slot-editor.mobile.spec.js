// The slot editor on a phone: a sheet that fills the screen, and a keyboard
// that opens only when you tap the search field.

import { CURRENT_WEEK } from "./catalog.js";
import { expect, test } from "./fixtures.js";
import { expectNoSidewaysScroll, expectWrapsInside } from "./layout.js";
import { switchAway } from "./page-visibility.js";
import { expectKeyboardClosed, expectKeyboardOpen, expectNoZoomOnFocus } from "./phone.js";
import { editorOf, LONG_NAME, searchOf, watchClose } from "./slot-editor.js";

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

/** The inset of the status bar, which a browser without a notch reports as 0. */
function safeTopOf(page) {
  return page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.paddingTop = "var(--safe-top)";
    document.body.append(probe);
    const inset = Number.parseFloat(getComputedStyle(probe).paddingTop);
    probe.remove();
    return inset;
  });
}

test("opens the editor without the keyboard", async ({ page }) => {
  const editor = await openWednesday(page);

  // The editor rises into place, so wait for the box it ends with.
  const { width, height } = page.viewportSize();
  const safeTop = await safeTopOf(page);
  await expect
    .poll(async () => {
      const box = await editor.boundingBox();
      return { x: box.x, width: box.width, bottom: box.y + box.height };
    })
    .toEqual({ x: 0, width, bottom: height });
  const box = await editor.boundingBox();
  expect(box.y, "top edge").toBeGreaterThanOrEqual(safeTop);
  expect(box.height, "height").toBeGreaterThanOrEqual(height - safeTop - 20);
  await expectKeyboardClosed(page);
});

test("removes a recipe without the keyboard", async ({ app, page }) => {
  await planWednesday(app, ["Lentil soup", "Omelette"]);
  const editor = await openWednesday(page);

  await editor.getByRole("button", { name: "Remove Lentil soup" }).tap();

  await expect(editor.getByRole("listitem")).toHaveText([/^Omelette/]);
  await expectKeyboardClosed(page);

  await editor.getByRole("button", { name: "Cancel" }).tap();

  await expect(editor).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Wednesday, Lunch: Lentil soup × 1, Omelette × 1" }),
  ).toBeVisible();
});

test("opens the keyboard for Add recipe without zooming", async ({ page }) => {
  const editor = await openWednesday(page);
  const search = searchOf(editor);
  await expectNoZoomOnFocus(search);

  await search.tap();

  await expectKeyboardOpen(search);
  await expect.poll(() => page.evaluate(() => window.visualViewport.scale)).toBe(1);
});

test("stays open when you tap inside the editor", async ({ page }) => {
  const editor = await openWednesday(page);
  const search = searchOf(editor);
  await search.fill("sal");
  const box = await editor.boundingBox();

  // An empty area below the buttons, near the bottom of the editor.
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height - 40);

  await expect(editor).toBeVisible();
  await expect(search).toHaveValue("sal");
});

test("keeps the editor when you switch away and back", async ({ page }) => {
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
test("closes the editor without saving on Back", async ({ app, page }) => {
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

test("wraps a long recipe name on a phone", async ({ page }) => {
  const editor = await openWednesday(page);
  await searchOf(editor).fill("Supercali");
  await editor.getByRole("option", { name: LONG_NAME }).tap();

  const nameInEditor = editor.getByRole("listitem").getByText(LONG_NAME, { exact: true });
  await expectWrapsInside(nameInEditor, editor);
  await expectNoSidewaysScroll(page);

  await editor.getByRole("button", { name: "Done" }).tap();

  const slot = page.getByRole("button", { name: `Wednesday, Lunch: ${LONG_NAME} × 1` });
  await expectWrapsInside(slot.getByText(LONG_NAME, { exact: true }), slot);
  await expectNoSidewaysScroll(page);
});
