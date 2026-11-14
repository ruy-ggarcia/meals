// What the accessibility specs share: the states that axe checks, and the
// check itself. Each state opens a page or a dialog with enough data to show
// every kind of control.

import AxeBuilder from "@axe-core/playwright";
import {
  assistantButton,
  assistantWindow,
  attachFile,
  largePlan,
  openAssistant,
  pendingCard,
  proposeMenus,
  SCHOOL_MENU,
  sendMessage,
} from "./assistant.js";
import { CURRENT_WEEK } from "./catalog.js";
import { expect, test } from "./fixtures.js";
import {
  giveOnionMeasures,
  editorOf as ingredientEditorOf,
  useMediumOnions,
} from "./ingredients.js";
import { openBook, editorOf as recipeEditorOf } from "./recipes.js";
import { byokSectionOf, openSettings, saveKey } from "./settings.js";
import { editorOf as slotEditorOf } from "./slot-editor.js";

/** The rules of the WCAG 2.1 levels A and AA. */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * The appearances that the system can switch between.
 * @type {("light" | "dark")[]}
 */
export const SCHEMES = ["light", "dark"];

/**
 * Plans Monday's lunch and Tuesday's dinner, and gives the recipes
 * ingredients and measures, so every page has rows, details, and totals.
 */
export async function plan(app) {
  const onion = await giveOnionMeasures(app);
  await useMediumOnions(app, onion);
  await app.api.updateRecipe(app.recipes.Omelette.id, {
    ingredients: [
      { ingredientId: app.ingredients.Egg.id, quantity: 2 },
      { ingredientId: app.ingredients.Milk.id, quantity: 50 },
    ],
  });
  await app.api.saveSlot(CURRENT_WEEK, "mon", "lunch", [
    { recipeId: app.recipes.Omelette.id, servings: 2 },
    { recipeId: app.recipes["Russian salad"].id, servings: 1.5 },
  ]);
  await app.api.saveSlot(CURRENT_WEEK, "tue", "dinner", [
    { recipeId: app.recipes["Lentil soup"].id, servings: 1 },
  ]);
}

/** Opens the meal plan, and waits until Monday's lunch shows its menu. */
async function openMealPlan(page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Wednesday, Lunch:/ })).toBeVisible();
  // A phone shows one day, and starts on today. Its layout is the one with
  // the day bar, which the page shows together with the grid that the test
  // waited for, so reading it doesn't wait.
  const dayBar = page.getByRole("navigation", { name: "Day" });
  if (await dayBar.isVisible()) {
    await dayBar.getByRole("button", { name: "Monday, September 21" }).click();
  }
  await expect(page.getByRole("button", { name: /^Monday, Lunch: Omelette/ })).toBeVisible();
}

/**
 * @typedef {object} State
 * @property {string} title
 * @property {"alertdialog" | "dialog"} [role]
 * @property {{ script: import("./assistant.js").Step[] }} [assistant] The
 *   script of the assistant, which turns it on.
 * @property {string} [behind] The title of the state of the page behind the
 *   window, whose known violations axe finds too while the page isn't inert.
 * @property {(fixtures: { app?: any, network?: any, page: import("@playwright/test").Page }) => Promise<void>} open
 */

/**
 * The states that axe checks. Each has a `title`, an `open` that leaves the
 * state on screen, and for a dialog, its `role`.
 * @type {State[]}
 */
export const STATES = [
  {
    title: "meal plan",
    async open({ page }) {
      await openMealPlan(page);
    },
  },
  {
    title: "slot editor",
    role: "dialog",
    async open({ page }) {
      await openMealPlan(page);
      await page.getByRole("button", { name: /^Monday, Lunch:/ }).click();
      await expect(slotEditorOf(page)).toBeVisible();
    },
  },
  {
    title: "alert about an unsaved meal",
    role: "alertdialog",
    async open({ network, page }) {
      await openMealPlan(page);
      await network.down();
      await page.getByRole("button", { name: /^Monday, Dinner:/ }).click();
      const editor = page.getByRole("dialog", { name: "Dinner" });
      await editor.getByRole("option", { name: "Green salad" }).click();
      await editor.getByRole("button", { name: "Done" }).click();
      await expect(editor).toBeHidden();
      await page.getByRole("button", { name: "Next week" }).click();
      await expect(page.getByRole("alertdialog", { name: "1 meal wasn't saved" })).toBeVisible();
    },
  },
  {
    title: "shopping list",
    role: "dialog",
    async open({ page }) {
      await openMealPlan(page);
      await page.getByRole("button", { name: "Shopping list" }).click();
      await expect(page.getByRole("dialog", { name: "Shopping list" })).toBeVisible();
    },
  },
  {
    title: "recipe book",
    async open({ page }) {
      await page.goto("/recipes.html");
      await expect(page.getByRole("button", { name: "Edit Omelette", exact: true })).toBeVisible();
    },
  },
  {
    title: "recipe editor",
    role: "dialog",
    async open({ page }) {
      await page.goto("/recipes.html");
      await page.getByRole("button", { name: "Edit Omelette", exact: true }).click();
      await expect(recipeEditorOf(page, "Edit recipe")).toBeVisible();
    },
  },
  {
    title: "ingredient catalog",
    async open({ page }) {
      await page.goto("/ingredients.html");
      await expect(page.getByRole("button", { name: "Edit Onion", exact: true })).toBeVisible();
    },
  },
  {
    title: "ingredient editor",
    role: "dialog",
    async open({ page }) {
      await page.goto("/ingredients.html");
      await page.getByRole("button", { name: "Edit Onion", exact: true }).click();
      await expect(ingredientEditorOf(page, "Edit ingredient")).toBeVisible();
    },
  },
  {
    title: "settings",
    role: "dialog",
    async open({ page }) {
      await openBook(page);
      await openSettings(page);
    },
  },
  {
    title: "settings with a saved key and its models",
    role: "dialog",
    async open({ page }) {
      await openBook(page);
      await saveKey(await openSettings(page));
      // The save turns the assistant on, and the page shows its button.
      await expect(assistantButton(page)).toBeVisible();
      const section = byokSectionOf(await openSettings(page));
      await expect(section.getByText("A key is saved.")).toBeVisible();
      // The list of the saved key has arrived.
      await expect(section.getByRole("combobox", { name: "Model" })).toBeEnabled();
    },
  },
];

const REPLY = "Here's a plan for the week.";

/**
 * The states that need the assistant on: the assistant's window, open on the
 * meal plan, and Settings with the assistant's settings of the server. Each
 * turns the assistant on with a script. They aren't in `STATES`, whose
 * states the specs also check with the assistant off.
 * @type {State[]}
 */
const ASSISTANT_STATES = [
  {
    title: "settings with the settings of the server",
    role: "dialog",
    assistant: { script: [] },
    async open({ page }) {
      await openBook(page);
      const dialog = await openSettings(page);
      await expect(dialog.getByText("Set on the server.")).toBeVisible();
    },
  },
  {
    title: "assistant window",
    role: "dialog",
    behind: "meal plan",
    assistant: { script: [{ text: REPLY }] },
    async open({ page }) {
      await openMealPlan(page);
      const chat = await openAssistant(page);
      // A sent message with an attachment, and a file attached to the next one.
      await attachFile(page, SCHOOL_MENU);
      await sendMessage(page, "Plan the week around the school menu.");
      await expect(chat.getByText(REPLY)).toBeVisible();
      await attachFile(page, SCHOOL_MENU);
      await expect(chat.getByRole("button", { name: `Remove ${SCHOOL_MENU.name}` })).toBeVisible();
    },
  },
  {
    title: "assistant window with pending changes",
    role: "dialog",
    behind: "meal plan",
    assistant: {
      script: [
        proposeMenus(CURRENT_WEEK, [["wed", "dinner", { Omelette: 2, "Green salad": 1 }]]),
        { text: REPLY },
      ],
    },
    async open({ page }) {
      await openMealPlan(page);
      await openAssistant(page);
      await sendMessage(page, "Plan Wednesday's dinner.");
      await expect(assistantWindow(page).getByText(REPLY)).toBeVisible();
      await pendingCard(page).getByRole("button", { name: "View details" }).click();
      await expect(pendingCard(page).getByText("Omelette × 2")).toBeVisible();
    },
  },
  {
    title: "assistant window with an applied row and a failed answer",
    role: "dialog",
    behind: "meal plan",
    assistant: {
      script: [
        // Tuesday's dinner keeps one recipe with 1 serving, so the slots
        // behind the window break the same rules as before.
        proposeMenus(CURRENT_WEEK, [["tue", "dinner", { Omelette: 1 }]]),
        { text: REPLY },
        new Error("The model is overloaded."),
      ],
    },
    async open({ page }) {
      await openMealPlan(page);
      const chat = await openAssistant(page);
      await sendMessage(page, "Plan Tuesday's dinner.");
      await expect(chat.getByText(REPLY)).toBeVisible();
      await pendingCard(page).getByRole("button", { name: "Apply" }).click();
      await expect(chat.getByText("Applied: 1 slot.")).toBeVisible();
      await sendMessage(page, "Plan Thursday's dinner.");
      await expect(chat.getByRole("button", { name: "Retry" })).toBeVisible();
    },
  },
  {
    title: "assistant window with the details of a large plan",
    role: "dialog",
    behind: "meal plan",
    assistant: { script: largePlan(CURRENT_WEEK, REPLY) },
    async open({ page }) {
      await openMealPlan(page);
      await openAssistant(page);
      await sendMessage(page, "Plan the whole week, with new recipes.");
      await expect(assistantWindow(page).getByText(REPLY)).toBeVisible();
      await pendingCard(page).getByRole("button", { name: "View details" }).click();
      await expect(pendingCard(page).getByRole("button", { name: "Back" })).toBeFocused();
    },
  },
];

/**
 * Describes the element of an axe `node` by its tag and classes, such as
 * `button.slot-empty`, or by axe's selector if its HTML doesn't start with a
 * tag.
 */
function elementOf(node) {
  const match = node.html.match(/^<([\w-]+)([^>]*)>/);
  if (match === null) return String(node.target);
  const [, tag, attributes] = match;
  const classes =
    attributes
      .match(/\sclass="([^"]*)"/)?.[1]
      .split(/\s+/)
      .filter(Boolean) ?? [];
  return [tag, ...classes].join(".");
}

/**
 * Runs axe on the open `page`, and returns what it found as `rule element
 * ×count` lines, sorted. A selector of axe holds the text of a recipe or a
 * day, so the lines name the element by its tag and classes, and count the
 * elements that break the rule.
 */
export async function violationsOf(page) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const counts = new Map();
  for (const violation of violations) {
    for (const node of violation.nodes) {
      const line = `${violation.id} ${elementOf(node)}`;
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
  }
  return [...counts].map(([line, count]) => `${line} ×${count}`).sort();
}

/**
 * Defines a test for each state and appearance: axe finds exactly the
 * violations in the list that `known(project)` returns for the project, a map
 * from the title of a state to its lines (see `violationsOf`), per appearance.
 * A state of the assistant's window also expects the lines of the page behind
 * it, which axe checks too, unless `inertBehindWindow` says that the window
 * is a sheet over an inert page, as on a phone: axe skips an inert page.
 *
 * @param {(project: string) => Record<string, Record<string, string[]>>} [known]
 * @param {{ inertBehindWindow?: boolean }} [options]
 */
export function defineAxeTests(known = () => ({}), { inertBehindWindow = false } = {}) {
  test.describe("accessibility", () => {
    for (const state of [...STATES, ...ASSISTANT_STATES]) {
      test.describe(state.title, () => {
        if (state.assistant) test.use({ assistant: state.assistant });
        for (const scheme of SCHEMES) {
          test(`finds only the known violations when the appearance is ${scheme}`, async ({
            app,
            network,
            page,
          }, testInfo) => {
            await plan(app);
            await page.emulateMedia({ colorScheme: scheme });
            await state.open({ app, network, page });

            const lines = known(testInfo.project.name);
            const behind = inertBehindWindow ? undefined : state.behind;
            const expected = [
              ...(lines[behind]?.[scheme] ?? []),
              ...(lines[state.title]?.[scheme] ?? []),
            ].sort();
            expect(await violationsOf(page)).toEqual(expected);
          });
        }
      });
    }
  });
}
