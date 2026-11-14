// Settings, where the family edits the family preferences: the save against
// the real server, the focus, and where each page puts its Settings button:
// in the toolbar on wide screens, and on the line of the large title on
// phones.

import { devices } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { openCatalog } from "./ingredients.js";
import { expectInsideViewport } from "./layout.js";
import { openBook } from "./recipes.js";

/** The one Settings button that the page shows at its width. */
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

// The pages, each with how to open it until it has loaded. The meal plan
// opens on the week of Nov 30 – Dec 6, whose short range between the week
// buttons is one of the widest.
const PAGES = [
  {
    name: "meal plan",
    async open(page) {
      await page.goto("/#2026-11-30");
      await expect(page.getByRole("button", { name: /^Wednesday, Lunch:/ })).toBeVisible();
    },
  },
  { name: "recipe book", open: openBook },
  { name: "ingredient catalog", open: openCatalog },
];

// The widths of the phones: the narrowest that the app supports, an iPhone
// 15, and a Pixel 7.
const PHONES = [
  { label: "360 px", width: 360 },
  { label: "the width of an iPhone 15", width: devices["iPhone 15"].viewport.width },
  { label: "the width of a Pixel 7", width: devices["Pixel 7"].viewport.width },
];

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

  test("returns the focus to the button on the title line of a phone", async ({ page }) => {
    await useWidth(page, PHONES[0].width);
    await openBook(page);
    const dialog = await openSettings(page);

    await dialog.getByRole("button", { name: "Cancel" }).click();

    await expect(dialog).toBeHidden();
    await expect(
      page.locator(".title-line").getByRole("button", { name: "Settings" }),
    ).toBeFocused();
  });

  for (const { name, open } of PAGES) {
    test(`shows one Settings button on the ${name}, in the toolbar when wide`, async ({ page }) => {
      await open(page);

      await expect(settingsButton(page)).toHaveCount(1);
      await expect(
        page.getByRole("banner").getByRole("button", { name: "Settings" }),
      ).toBeVisible();

      await useWidth(page, PHONES[0].width);

      await expect(settingsButton(page)).toHaveCount(1);
      await expect(
        page.locator(".title-line").getByRole("button", { name: "Settings" }),
      ).toBeVisible();
    });
  }

  for (const { label, width } of PHONES) {
    for (const { name, open } of PAGES) {
      test(`keeps the toolbar and Settings of the ${name} apart at ${label}`, async ({ page }) => {
        await useWidth(page, width);

        await open(page);

        const gear = settingsButton(page);
        await expect(gear).toBeVisible();
        const title = page.locator(".title-line").getByRole("heading");
        await expect(title).not.toHaveText("");
        const controls = await page
          .getByRole("banner")
          .getByRole("button")
          .filter({ visible: true })
          .all();
        expect(controls.length, "visible buttons in the toolbar").toBeGreaterThan(0);
        const boxes = [];
        for (const control of [...controls, gear]) {
          await expectInsideViewport(control);
          boxes.push({ control: String(control), box: await control.boundingBox() });
        }
        boxes.push({ control: `the text of ${title}`, box: await textBoxOf(title) });
        for (const [index, first] of boxes.entries()) {
          for (const second of boxes.slice(index + 1)) {
            expect(
              overlap(first.box, second.box),
              `${first.control} and ${second.control} must not overlap`,
            ).toBe(false);
          }
        }
      });
    }
  }
});
