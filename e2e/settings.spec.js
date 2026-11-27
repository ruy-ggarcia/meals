// Settings against the real server: the saves, the model list of a key, the
// assistant's button and the phone's tab bar that a key changes, the settings
// that the server sets, the focus, the layout of the sheet, and the Settings
// button in each toolbar.

import { devices } from "@playwright/test";
import { assistantButton } from "./assistant.js";
import { expect, test } from "./fixtures.js";
import { openCatalog } from "./ingredients.js";
import { expectAbove, expectAfterOnLine, expectInsideViewport } from "./layout.js";
import { sectionsOf } from "./navigation.js";
import { openBook } from "./recipes.js";
import { byokSectionOf, openSettings, saveKey, settingsButton } from "./settings.js";

/** Marks the document of `page`, which a reload would lose. */
async function keepDocument(page) {
  await page.evaluate(() => {
    /** @type {any} */ (window).sameDocument = true;
  });
}

/** Checks that `page` shows the document that `keepDocument` marked, without a reload. */
async function expectSameDocument(page) {
  expect(
    await page.evaluate(() => /** @type {any} */ (window).sameDocument),
    "the page must not reload",
  ).toBe(true);
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

/**
 * Checks that the family preferences fill the rest of the Settings `dialog`:
 * its content ends with the BYOK section, right at the bottom of the dialog,
 * without scrolling, and the field is taller than its minimum.
 */
async function expectPreferencesFill(dialog) {
  const { scrolls, gap } = await dialog.locator(".sheet-content").evaluate((content) => {
    const padding = Number.parseFloat(getComputedStyle(content).paddingBottom);
    const last = content.lastElementChild.getBoundingClientRect().bottom;
    return {
      scrolls: content.scrollHeight > content.clientHeight,
      gap: content.getBoundingClientRect().bottom - padding - last,
    };
  });
  expect(scrolls, "the content of the dialog must not scroll").toBe(false);
  expect(Math.abs(gap), "the space below the BYOK section, in px").toBeLessThan(1);
  const field = await dialog.getByRole("textbox", { name: "Family preferences" }).boundingBox();
  expect(field.height, "the height of the field, more than its minimum").toBeGreaterThan(160);
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

  test("scrolls the load message of Settings into view on a scrolled page", async ({
    consoleErrors,
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 400 });
    await openBook(page);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    expect(await page.evaluate(() => window.scrollY), "the page scrolled down").toBeGreaterThan(0);
    await page.route("**/api/preferences", (route) => route.abort("connectionrefused"));
    // The failed load logs its error, as the browser does the failed request.
    consoleErrors.allowed = true;

    await settingsButton(page).click();

    const message = page
      .getByRole("alert")
      .filter({ hasText: "Couldn't load the settings. Try again." });
    await expect(message).toBeInViewport({ ratio: 1 });
    await expectAbove(page.getByRole("banner"), message);
  });

  // WebKit keeps the focus on the disabled button by itself, so there the
  // test passes without the page's help: Chromium and Firefox check that the
  // page gives the focus back.
  test("returns the focus to Settings after a failed load", async ({ consoleErrors, page }) => {
    await openBook(page);
    await page.route("**/api/preferences", (route) => route.abort("connectionrefused"));
    // The failed load logs its error, as the browser does the failed request.
    consoleErrors.allowed = true;
    await settingsButton(page).focus();

    await page.keyboard.press("Enter");

    await expect(page.getByText("Couldn't load the settings. Try again.")).toBeVisible();
    await expect(settingsButton(page)).toBeFocused();
  });

  test("fills the rest of a phone's sheet with the family preferences", async ({ page }) => {
    await useWidth(page, PHONE_WIDTHS[0]);
    await openBook(page);

    const dialog = await openSettings(page);

    await expectPreferencesFill(dialog);
  });

  test("fills the dialog with the family preferences on a wide screen", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openBook(page);

    const dialog = await openSettings(page);

    await expectPreferencesFill(dialog);
  });

  test("shows the assistant's button without a reload after a key is saved", async ({ page }) => {
    await openBook(page);
    await keepDocument(page);
    await expect(assistantButton(page)).toHaveCount(0);
    const dialog = await openSettings(page);

    await saveKey(dialog);

    await expect(assistantButton(page)).toBeVisible();
    await expectSameDocument(page);
  });

  test("says that a key is saved instead of showing it after a reload", async ({ page }) => {
    await openBook(page);
    await saveKey(await openSettings(page));
    // The save makes the page check the assistant again. A reload during that
    // check aborts it, which Firefox and WebKit log as an error.
    await expect(assistantButton(page)).toBeVisible();
    await page.reload();
    const answer = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === "/api/assistant/settings",
    );

    const section = byokSectionOf(await openSettings(page));

    await expect(section.getByText("A key is saved.")).toBeVisible();
    await expect(section.getByLabel("API key")).toBeHidden();
    await expect(section.getByRole("radio", { name: "OpenAI" })).toBeChecked();
    await expect(section.getByRole("combobox", { name: "Model" })).toBeEnabled();
    await expect(section.getByRole("combobox", { name: "Model" })).toHaveValue("gpt-test");
    expect(
      await (await answer).text(),
      "the answer of the server must not hold the key",
    ).not.toContain("sk-test");
  });

  test("moves a phone's tab bar without a reload when a key is saved", async ({ page }) => {
    await useWidth(page, PHONE_WIDTHS[2]);
    await openBook(page);
    await keepDocument(page);
    const tabBar = sectionsOf(page);

    await saveKey(await openSettings(page));

    await expect(assistantButton(page)).toBeVisible();
    // 20 px from the left edge, and as wide as the screen leaves with 20 px
    // on each side, the 56 px button, and 8 px of space before it.
    const screen = await page.evaluate(() => document.documentElement.clientWidth);
    await expect
      .poll(async () => {
        const { x, width } = await tabBar.boundingBox();
        return { x: Math.round(x), width: Math.round(width) };
      }, "the tab bar beside the button")
      .toEqual({ x: 20, width: screen - 104 });
    await expectAfterOnLine(tabBar, assistantButton(page));
    await expectSameDocument(page);
  });

  test("restores a phone's tab bar without a reload after Remove Key", async ({ page }) => {
    // A small Android phone, where the tab bar moves and narrows beside the
    // button.
    await useWidth(page, PHONE_WIDTHS[1]);
    await openBook(page);
    const tabBar = sectionsOf(page);
    const alone = await tabBar.boundingBox();
    await saveKey(await openSettings(page));
    await expect(assistantButton(page)).toBeVisible();
    await expect
      .poll(() => tabBar.boundingBox(), "the tab bar beside the button")
      .not.toEqual(alone);
    await keepDocument(page);
    const dialog = await openSettings(page);

    await byokSectionOf(dialog).getByRole("button", { name: "Remove Key" }).click();
    await dialog.getByRole("button", { name: "Done" }).click();

    await expect(dialog).toBeHidden();
    await expect(assistantButton(page)).toHaveCount(0);
    await expect.poll(() => tabBar.boundingBox(), "the tab bar without the button").toEqual(alone);
    await expectSameDocument(page);
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

  for (const width of PHONE_WIDTHS) {
    test(`places Today after the week arrows on a phone at ${width} px`, async ({ page }) => {
      await useWidth(page, width);

      await PAGES[0].open(page);

      const next = await page.getByRole("button", { name: "Next week" }).boundingBox();
      const today = await page.getByRole("button", { name: "Today", exact: true }).boundingBox();
      expect(
        today.x - (next.x + next.width),
        "the space between the right edge of Next week and the left edge of Today must be the toolbar's 8px",
      ).toBeCloseTo(8, 0);
      await expectToolbarFits(page);
    });
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

  test.describe("BYOK section", () => {
    test.use({ assistant: { script: [] } });

    test("shows the provider and the model read-only when the server sets them", async ({
      page,
    }) => {
      await openBook(page);

      const section = byokSectionOf(await openSettings(page));

      await expect(section.getByText("Set on the server.")).toBeVisible();
      await expect(section.getByRole("definition")).toHaveText(["Anthropic", "scripted"]);
      await expect(section.getByRole("textbox")).toHaveCount(0);
      await expect(section.getByRole("radio")).toHaveCount(0);
      await expect(section.getByRole("combobox")).toHaveCount(0);
    });
  });
});
