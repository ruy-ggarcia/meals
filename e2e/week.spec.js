// Week navigation: the week on screen, the week in the address, the history
// of the browser, and the sidebar.

import { CURRENT_RANGE, CURRENT_WEEK, NEXT_RANGE, NEXT_WEEK } from "./catalog.js";
import { expect, test } from "./fixtures.js";
import { expectWeek, nextWeekButton, previousWeekButton } from "./meal-plan.js";
import { sectionsOf } from "./navigation.js";

test.describe("week navigation", () => {
  test("opens the current week when the address has no week", async ({ page }) => {
    await page.goto("/");

    await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);
  });

  test("steps to the next week and back", async ({ page }) => {
    await page.goto("/");
    await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);

    await nextWeekButton(page).click();
    await expectWeek(page, NEXT_WEEK, NEXT_RANGE);

    await previousWeekButton(page).click();
    await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);
  });

  test("keeps a menu in its own week", async ({ page }) => {
    await page.goto("/");
    await nextWeekButton(page).click();
    await expectWeek(page, NEXT_WEEK, NEXT_RANGE);

    await page.getByRole("button", { name: "Monday, Lunch: empty" }).click();
    const editor = page.getByRole("dialog", { name: "Lunch" });
    await editor.getByRole("combobox", { name: "Add recipe" }).fill("Lentil");
    await editor.getByRole("option", { name: "Lentil soup" }).click();
    await editor.getByRole("button", { name: "Done" }).click();
    await expect(
      page.getByRole("button", { name: "Monday, Lunch: Lentil soup × 1" }),
    ).toBeVisible();

    await previousWeekButton(page).click();
    await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);
    await expect(page.getByRole("button", { name: "Monday, Lunch: empty" })).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText("Lentil soup");

    await nextWeekButton(page).click();
    await expectWeek(page, NEXT_WEEK, NEXT_RANGE);
    const slot = page.getByRole("button", { name: /^Monday, Lunch:/ });
    await expect(slot).toContainText("Lentil soup");
    await expect(slot).toContainText("×1");
  });

  test("stays on the week in the address after a reload", async ({ page }) => {
    await page.goto("/");
    await nextWeekButton(page).click();
    await expectWeek(page, NEXT_WEEK, NEXT_RANGE);

    await page.reload();

    await expectWeek(page, NEXT_WEEK, NEXT_RANGE);
  });

  test("opens the week in the address", async ({ page }) => {
    await page.goto("/#2026-12-28");

    await expectWeek(page, "2026-12-28", "Dec 28, 2026 – Jan 3, 2027");
  });

  test("goes back to the current week with Today", async ({ page }) => {
    await page.goto("/#2026-12-28");
    await expectWeek(page, "2026-12-28", "Dec 28, 2026 – Jan 3, 2027");

    await page.getByRole("button", { name: "Today" }).click();

    await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);
  });

  test("adds no history entry when you change weeks", async ({ page }) => {
    await page.goto("about:blank");
    await page.goto("/");
    await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);
    await nextWeekButton(page).click();
    await expectWeek(page, NEXT_WEEK, NEXT_RANGE);
    await nextWeekButton(page).click();
    await expectWeek(page, "2026-10-05", "Oct 5 – 11, 2026");

    // A hash typed into the address adds an entry.
    await page.goto("/#2026-12-28");
    await expectWeek(page, "2026-12-28", "Dec 28, 2026 – Jan 3, 2027");
    await page.goBack();
    await expectWeek(page, "2026-10-05", "Oct 5 – 11, 2026");

    await page.goBack();

    await expect(page).toHaveURL("about:blank");
  });

  test("restores the displayed week when the address gets an invalid week", async ({ page }) => {
    await page.goto("/");
    await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);

    await page.goto("/#hello");

    await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);
  });

  test("opens the current week when the address has no valid week", async ({ page }) => {
    await page.goto("/#hello");

    await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);
  });
});

test.describe("sidebar", () => {
  test("hides the sidebar and widens the page", async ({ page }) => {
    await page.goto("/");
    const sidebar = sectionsOf(page);
    const grid = page.getByRole("main");
    const { width } = await grid.boundingBox();

    await page.getByRole("button", { name: "Hide sidebar" }).click();

    await expect(sidebar).toBeHidden();
    await expect.poll(async () => (await grid.boundingBox()).width).toBeGreaterThan(width);
  });

  test("remembers a hidden sidebar after a reload", async ({ page }) => {
    await page.goto("/");
    const sidebar = sectionsOf(page);

    await page.getByRole("button", { name: "Hide sidebar" }).click();
    await expect(sidebar).toBeHidden();
    await page.reload();

    await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);
    await expect(sidebar).toBeHidden();
  });

  test("remembers a shown sidebar when the window is medium", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Hide sidebar" }).click();
    await page.getByRole("button", { name: "Show sidebar" }).click();
    await expect(sectionsOf(page)).toBeVisible();

    await page.setViewportSize({ width: 800, height: page.viewportSize().height });
    await page.reload();

    await expectWeek(page, CURRENT_WEEK, CURRENT_RANGE);
    await expect(sectionsOf(page)).toBeVisible();
  });
});
