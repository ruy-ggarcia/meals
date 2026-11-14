// Settings, where the family edits the family preferences: the save against
// the real server, the focus, the layout of the sheet on a phone, and the
// Settings button at the end of each page's toolbar, which fits at every
// phone width, and beside the sidebar on an iPad upright.

import { devices } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { openCatalog } from "./ingredients.js";
import { expectInsideViewport } from "./layout.js";
import { openBook } from "./recipes.js";

/** The one Settings button of the page, at the end of its toolbar. */
function settingsButton(page) {
  return page.getByRole("button", { name: "Settings", exact: true });
}

/** Opens Settings with its button, and returns the dialog. */
async function openSettings(page) {
  await settingsButton(page).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Whether the boxes `a` and `b` share any area. */
function overlap(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** The box of the text of `locator`, not of its element, which may be wider. */
function textBoxOf(locator) {
  return locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const { x, y, width, height } = range.getBoundingClientRect();
    return { x, y, width, height };
  });
}

// The pages, each with how to open it until it has loaded.
const PAGES = [
  {
    name: "meal plan",
    async open(page) {
      await page.goto("/");
      await expect(page.getByRole("button", { name: /^Wednesday, Lunch:/ })).toBeVisible();
    },
  },
  { name: "recipe book", open: openBook },
  { name: "ingredient catalog", open: openCatalog },
];

// The widths of the phones: the narrowest that the app supports, a small
// Android phone, an iPhone 15, and a Pixel 7.
const PHONE_WIDTHS = [
  320,
  360,
  devices["iPhone 15"].viewport.width,
  devices["Pixel 7"].viewport.width,
];

/**
 * Checks that every control of the toolbar shows inside the viewport, and
 * that no two of them overlap.
 */
async function expectToolbarFits(page) {
  const controls = await page
    .getByRole("banner")
    .getByRole("button")
    .filter({ visible: true })
    .all();
  const boxes = [];
  for (const control of controls) {
    await expectInsideViewport(control);
    boxes.push({ control: String(control), box: await control.boundingBox() });
  }
  for (const [index, first] of boxes.entries()) {
    for (const second of boxes.slice(index + 1)) {
      expect(
        overlap(first.box, second.box),
        `${first.control} and ${second.control} must not overlap`,
      ).toBe(false);
    }
  }
}

/** Narrows the page to the `width` of a phone. */
async function useWidth(page, width) {
  await page.setViewportSize({ width, height: page.viewportSize().height });
}

test.describe("settings", () => {
  test("saves the family preferences and shows them after a reload", async ({ page }) => {
    await openBook(page);
    const dialog = await openSettings(page);

    await dialog.getByRole("textbox", { name: "Family preferences" }).fill("No fish on Fridays.");
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    const reopened = await openSettings(page);

    await expect(reopened.getByRole("textbox", { name: "Family preferences" })).toHaveValue(
      "No fish on Fridays.",
    );
  });

  test("moves the focus into the dialog and back to the button", async ({ page }) => {
    await openBook(page);

    const dialog = await openSettings(page);

    await expect(dialog.getByRole("heading", { name: "Settings" })).toBeFocused();

    await page.keyboard.press("Escape");

    await expect(dialog).toBeHidden();
    await expect(settingsButton(page)).toBeFocused();
  });

  test("opens from the meal plan of a phone after the week fails to load", async ({
    consoleErrors,
    page,
  }) => {
    await useWidth(page, PHONE_WIDTHS[0]);
    await page.route("**/api/weeks/*", (route) => route.abort("connectionrefused"));
    // The failed load logs its error, as the browser does the failed request.
    consoleErrors.allowed = true;
    await page.goto("/");
    await expect(
      page.getByRole("alert").filter({ hasText: "Couldn't load the meal plan." }),
    ).toBeVisible();

    await expect(settingsButton(page)).toHaveCount(1);
    await settingsButton(page).click();

    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  });

  test("keeps the load message of Settings off the day heading of a phone", async ({
    consoleErrors,
    page,
  }) => {
    await useWidth(page, PHONE_WIDTHS[0]);
    await PAGES[0].open(page);
    await page.route("**/api/preferences", (route) => route.abort("connectionrefused"));
    // The failed load logs its error, as the browser does the failed request.
    consoleErrors.allowed = true;

    await settingsButton(page).click();

    const message = page
      .getByRole("alert")
      .filter({ hasText: "Couldn't load the settings. Try again." });
    await expect(message).toBeVisible();
    const box = await message.boundingBox();
    for (const { name, text } of [
      { name: "day title", text: page.locator("#day-heading .day-title") },
      { name: "date", text: page.locator("#day-heading .day-date") },
    ]) {
      await expect(text).toBeVisible();
      expect(
        overlap(box, await textBoxOf(text)),
        `the load message and the text of the ${name} must not overlap`,
      ).toBe(false);
    }
  });

  test("fills the sheet of a phone with the field of the family preferences", async ({ page }) => {
    await useWidth(page, PHONE_WIDTHS[0]);
    await openBook(page);

    const dialog = await openSettings(page);

    const sheet = await dialog.boundingBox();
    const field = await dialog.getByRole("textbox", { name: "Family preferences" }).boundingBox();
    expect(
      field.height,
      `the height of the field must be more than half the sheet's ${sheet.height}px`,
    ).toBeGreaterThan(sheet.height / 2);
  });

  for (const { name, open } of PAGES) {
    test(`shows one Settings button on the ${name}, in the toolbar`, async ({ page }) => {
      await open(page);

      await expect(settingsButton(page)).toHaveCount(1);
      await expect(
        page.getByRole("banner").getByRole("button", { name: "Settings" }),
      ).toBeVisible();
    });
  }

  for (const width of PHONE_WIDTHS) {
    for (const { name, open } of PAGES) {
      test(`fits the toolbar of the ${name} with Settings at ${width} px`, async ({ page }) => {
        await useWidth(page, width);

        await open(page);

        await expectToolbarFits(page);
      });
    }
  }

  test("fits the meal plan's toolbar beside the sidebar on an iPad upright", async ({ page }) => {
    await page.setViewportSize(devices["iPad (gen 7)"].viewport);
    await page.addInitScript(() => window.localStorage.setItem("meals.sidebar", "shown"));

    await PAGES[0].open(page);

    await expect(page.getByRole("navigation", { name: "Sections" })).toBeVisible();
    await expectToolbarFits(page);
  });

  test("keeps the count and the hint in view on a phone in landscape", async ({ page }) => {
    await page.setViewportSize({ width: 734, height: 343 });
    await openBook(page);
    const dialog = await openSettings(page);

    await dialog.getByRole("textbox", { name: "Family preferences" }).fill("a".repeat(9500));

    await expect(dialog.getByText("500 characters left")).toBeVisible();
    await expectInsideViewport(dialog.getByText("500 characters left"));
    await expectInsideViewport(
      dialog.getByText("The assistant reads this text in every conversation."),
    );
  });
});
