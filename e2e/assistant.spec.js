// The assistant on a desktop, against the real server with a scripted
// provider: a week planned and applied, the window across pages, the mark of
// the button, the page behind the window, the focus, attachments, and what
// the window asks or shows before it loses or saves pending changes.

import {
  ask,
  assistantButton,
  assistantChecked,
  assistantWindow,
  attachFile,
  messageField,
  openAssistant,
  pendingCard,
  proposeMenus,
  SCHOOL_MENU,
  sendMessage,
  trackAssistantCheck,
} from "./assistant.js";
import { CURRENT_RANGE, CURRENT_WEEK } from "./catalog.js";
import { expect, test } from "./fixtures.js";
import { openWeek, slotButton } from "./meal-plan.js";
import { pageLink } from "./navigation.js";

const QUESTION = "Plan Monday's lunch and Tuesday's dinner.";
const REPLY = "Here's Monday's lunch and Tuesday's dinner.";

// The assistant proposes two menus of the current week, and then answers.
const PLAN = [
  proposeMenus(CURRENT_WEEK, [
    ["mon", "lunch", { Omelette: 2 }],
    ["tue", "dinner", { "Lentil soup": 1 }],
  ]),
  { text: REPLY },
];

/** Opens the meal plan on the current week, and asks for the plan. */
async function askForPlan(page) {
  await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);
  await ask(page, QUESTION, REPLY);
  await expect(pendingCard(page)).toBeVisible();
}

test.describe("assistant", () => {
  test.describe(() => {
    test.use({ assistant: { script: PLAN } });

    test("shows the menus in the grid after Apply without a reload", async ({ page }) => {
      await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);
      // A reload would lose this.
      await page.evaluate(() => {
        /** @type {any} */ (window).sameDocument = true;
      });
      await ask(page, QUESTION, REPLY);
      const card = pendingCard(page);
      await expect(card.getByRole("listitem")).toHaveText(["Week of Sep 212 slots"]);
      await card.getByRole("button", { name: "View details" }).click();
      await expect(card.getByText("Monday, Sep 21 · Lunch")).toBeVisible();
      await expect(card.getByText("Omelette × 2")).toBeVisible();

      await card.getByRole("button", { name: "Apply" }).click();

      await expect(slotButton(page, "Monday", "Lunch")).toHaveAccessibleName(
        "Monday, Lunch: Omelette × 2",
      );
      await expect(slotButton(page, "Tuesday", "Dinner")).toHaveAccessibleName(
        /^Tuesday, Dinner: Lentil soup/,
      );
      expect(
        await page.evaluate(() => /** @type {any} */ (window).sameDocument),
        "the page wasn't reloaded",
      ).toBe(true);
    });

    test("moves the focus to the message field after Apply", async ({ page }) => {
      await askForPlan(page);

      await pendingCard(page).getByRole("button", { name: "Apply" }).click();

      await expect(pendingCard(page)).toBeHidden();
      await expect(messageField(page)).toBeFocused();
    });

    test("moves the focus to the message field after Discard", async ({ page }) => {
      await askForPlan(page);

      await pendingCard(page).getByRole("button", { name: "Discard" }).click();

      await expect(pendingCard(page)).toBeHidden();
      await expect(messageField(page)).toBeFocused();
    });

    test("asks before New conversation discards the pending changes", async ({ page }) => {
      await askForPlan(page);

      await assistantWindow(page).getByRole("button", { name: "New conversation" }).click();

      await expect(
        page.getByRole("alertdialog", { name: "Start a new conversation?" }),
      ).toBeVisible();
      await expect(pendingCard(page)).toBeVisible();
    });
  });

  test.describe(() => {
    test.use({ assistant: { script: [{ text: REPLY }] } });

    test("keeps the conversation and the open window on the recipes page", async ({ page }) => {
      await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);
      await ask(page, QUESTION, REPLY);

      await pageLink(page, "Recipes").click();

      await expect(page).toHaveURL(/\/recipes\.html$/);
      const chat = assistantWindow(page);
      await expect(chat).toBeVisible();
      await expect(chat.getByText(QUESTION)).toBeVisible();
      await expect(chat.getByText(REPLY)).toBeVisible();
    });

    test("shows the mark on the button when the answer arrives while collapsed", async ({
      app,
      page,
    }) => {
      await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);
      const chat = await openAssistant(page);
      app.assistant.hold();
      await sendMessage(page, QUESTION);
      await expect(chat.getByText("Thinking…")).toBeVisible();
      await chat.getByRole("button", { name: "Collapse" }).click();
      await expect(chat).toBeHidden();

      app.assistant.release();

      const button = page.getByRole("button", { name: "Assistant, new activity", exact: true });
      await expect(button).toBeVisible();
      await expect(button.locator(".mark")).toBeVisible();
    });

    test("attaches a PDF and shows its name in the sent message", async ({ page }) => {
      await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);
      const chat = await openAssistant(page);
      await attachFile(page, SCHOOL_MENU);
      await expect(chat.getByRole("list", { name: "Attachments" })).toHaveText(
        new RegExp(`^${SCHOOL_MENU.name}`),
      );

      await sendMessage(page, QUESTION);

      await expect(chat.getByText(REPLY)).toBeVisible();
      await expect(
        chat.getByRole("log", { name: "Messages" }).getByRole("list", { name: "Attachments" }),
      ).toHaveText(SCHOOL_MENU.name);
    });
  });

  test.describe(() => {
    test.use({ assistant: { script: [new Error("The model is overloaded."), { text: REPLY }] } });

    test("moves the focus to the message field after Retry", async ({ page }) => {
      await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);
      await ask(page, QUESTION, "The assistant couldn't answer.");

      await assistantWindow(page).getByRole("button", { name: "Retry" }).click();

      await expect(assistantWindow(page).getByText(REPLY)).toBeVisible();
      await expect(messageField(page)).toBeFocused();
    });
  });

  test.describe(() => {
    test.use({ assistant: { script: [] } });

    test("keeps the meal plan usable while the window is open", async ({ page }) => {
      await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);
      await openAssistant(page);

      // The window floats in the lower right corner, far from Monday.
      await slotButton(page, "Monday", "Breakfast").click();

      await expect(page.getByRole("dialog", { name: "Breakfast" })).toBeVisible();
      await expect(assistantWindow(page)).toBeVisible();
    });

    test("keeps the toolbar as the only banner while the window is open", async ({ page }) => {
      await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);

      await openAssistant(page);

      await expect(page.getByRole("banner")).toHaveCount(1);
      await expect(page.getByRole("banner")).toHaveClass(/\btoolbar\b/);
    });

    test("focuses the message field on open, and the button on Escape", async ({ page }) => {
      await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);

      await openAssistant(page);

      await expect(messageField(page)).toBeFocused();

      await page.keyboard.press("Escape");

      await expect(assistantWindow(page)).toBeHidden();
      await expect(assistantButton(page)).toBeFocused();
    });
  });

  test.describe(() => {
    test.use({
      assistant: {
        script: [
          ({ app }) => ({
            toolCalls: [
              {
                name: "propose_recipe",
                input: {
                  id: app.recipes.Omelette.id,
                  ingredients: [{ ingredientId: app.ingredients.Egg.id, quantity: 2 }],
                },
              },
            ],
          }),
          { text: "The omelette now takes two eggs." },
        ],
      },
    });

    test("shows the problem when a recipe changed by hand before Apply", async ({
      app,
      consoleErrors,
      page,
    }) => {
      await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);
      await ask(page, "Add eggs to the omelette.", "The omelette now takes two eggs.");
      const card = pendingCard(page);
      await expect(card.getByRole("listitem")).toHaveText(["Changed recipeOmelette"]);
      await app.api.updateRecipe(app.recipes.Omelette.id, {
        ingredients: [{ ingredientId: app.ingredients.Milk.id, quantity: 50 }],
      });
      // The browser logs the 409 of the rejected Apply.
      consoleErrors.allowed = true;

      await card.getByRole("button", { name: "Apply" }).click();

      await expect(
        card.getByText("Omelette changed after the assistant proposed this."),
      ).toBeVisible();
    });
  });

  test("shows no button when the assistant is off", async ({ page }) => {
    await page.addInitScript(trackAssistantCheck);
    await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);

    await assistantChecked(page);

    await expect(assistantButton(page)).toHaveCount(0);
  });
});
