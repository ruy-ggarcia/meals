// The phone checks on fields the app really has: the search field of the slot
// editor opens the keyboard only when you tap it, and doesn't zoom the page.

import { expect, test } from "./fixtures.js";
import { expectKeyboardClosed, expectKeyboardOpen, expectNoZoomOnFocus } from "./phone.js";

test("opens the keyboard only for the search field of the slot editor", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Wednesday, Lunch: empty" }).tap();
  const editor = page.getByRole("dialog", { name: "Lunch" });
  const search = editor.getByRole("combobox", { name: "Add recipe" });
  await expect(search).toBeVisible();

  await expectKeyboardClosed(page);
  await expectNoZoomOnFocus(search);

  await search.tap();

  await expectKeyboardOpen(search);
});
