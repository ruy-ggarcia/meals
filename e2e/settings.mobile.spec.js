// Settings on a phone: the fields that take text, which a tap focuses without
// zooming the page.

import { expect, test } from "./fixtures.js";
import { expectNoZoomOnFocus } from "./phone.js";
import { openBook } from "./recipes.js";
import { byokSectionOf, openSettings } from "./settings.js";

test.describe("settings", () => {
  test("keeps Family preferences at a size that doesn't zoom the page", async ({ page }) => {
    await openBook(page);
    const field = (await openSettings(page)).getByRole("textbox", { name: "Family preferences" });

    await field.tap();

    await expectNoZoomOnFocus(field);
  });

  test("keeps the API key field at a size that doesn't zoom the page", async ({ page }) => {
    await openBook(page);
    const field = byokSectionOf(await openSettings(page)).getByLabel("API key");

    await field.tap();

    await expectNoZoomOnFocus(field);
  });

  test("keeps the Model list at a size that doesn't zoom the page", async ({ page }) => {
    await openBook(page);
    const section = byokSectionOf(await openSettings(page));
    await section.getByRole("radio", { name: "OpenAI" }).check();
    const key = section.getByLabel("API key");
    await key.fill("sk-test");
    // The list of the key's models arrives once the field loses the focus.
    await key.blur();
    const list = section.getByRole("combobox", { name: "Model" });
    await expect(list).toBeEnabled();

    await list.tap();

    await expectNoZoomOnFocus(list);
  });
});
