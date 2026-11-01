// What the accessibility specs share: the states that axe checks, and the
// check itself. Each state opens a page or a dialog with enough data to show
// every kind of control.

import AxeBuilder from "@axe-core/playwright";
import { CURRENT_WEEK } from "./catalog.js";
import { expect, test } from "./fixtures.js";
import {
  giveOnionMeasures,
  editorOf as ingredientEditorOf,
  useMediumOnions,
} from "./ingredients.js";
import { editorOf as recipeEditorOf } from "./recipes.js";
import { editorOf as slotEditorOf } from "./slot-editor.js";

/** The rules of the WCAG 2.1 levels A and AA. */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** The width under which the app shows the layout of a phone. */
const PHONE_WIDTH = 700;

/** The appearances that the system can switch between. */
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
  // A phone shows one day, and starts on today.
  if (page.viewportSize().width < PHONE_WIDTH) {
    await page
      .getByRole("navigation", { name: "Day" })
      .getByRole("button", { name: "Monday, September 21" })
      .click();
  }
  await expect(page.getByRole("button", { name: /^Monday, Lunch: Omelette/ })).toBeVisible();
}

/**
 * The states that axe checks. Each has a `title`, an `open` that leaves the
 * state on screen, and for a dialog, its `role`.
 */
export const STATES = [
  {
    title: "the meal plan",
    async open({ page }) {
      await openMealPlan(page);
    },
  },
  {
    title: "the slot editor",
    role: "dialog",
    async open({ page }) {
      await openMealPlan(page);
      await page.getByRole("button", { name: /^Monday, Lunch:/ }).click();
      await expect(slotEditorOf(page)).toBeVisible();
    },
  },
  {
    title: "the alert about an unsaved meal",
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
    title: "the shopping list",
    role: "dialog",
    async open({ page }) {
      await openMealPlan(page);
      await page.getByRole("button", { name: "Shopping list" }).click();
      await expect(page.getByRole("dialog", { name: "Shopping list" })).toBeVisible();
    },
  },
  {
    title: "the recipe book",
    async open({ page }) {
      await page.goto("/recipes.html");
      await expect(page.getByRole("button", { name: "Edit Omelette", exact: true })).toBeVisible();
    },
  },
  {
    title: "the recipe editor",
    role: "dialog",
    async open({ page }) {
      await page.goto("/recipes.html");
      await page.getByRole("button", { name: "Edit Omelette", exact: true }).click();
      await expect(recipeEditorOf(page, "Edit recipe")).toBeVisible();
    },
  },
  {
    title: "the ingredient catalog",
    async open({ page }) {
      await page.goto("/ingredients.html");
      await expect(page.getByRole("button", { name: "Edit Onion", exact: true })).toBeVisible();
    },
  },
  {
    title: "the ingredient editor",
    role: "dialog",
    async open({ page }) {
      await page.goto("/ingredients.html");
      await page.getByRole("button", { name: "Edit Onion", exact: true }).click();
      await expect(ingredientEditorOf(page, "Edit ingredient")).toBeVisible();
    },
  },
];

/**
 * Describes the element of an axe `node` by its tag and classes, such as
 * `button.slot-empty`, or by axe's selector if its HTML doesn't start with a
 * tag.
 */
function describe(node) {
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
      const line = `${violation.id} ${describe(node)}`;
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
  }
  return [...counts].map(([line, count]) => `${line} ×${count}`).sort();
}

/**
 * Defines a test for each state and appearance: axe finds exactly the
 * violations in the list that `known(project)` returns for the project, a map
 * from the title of a state to its lines (see `violationsOf`), per appearance.
 */
export function defineAxeTests(form, known = () => ({})) {
  for (const state of STATES) {
    for (const scheme of SCHEMES) {
      test(`finds only the known accessibility violations in ${state.title} on ${form} in the ${scheme} appearance`, async ({
        app,
        network,
        page,
      }, testInfo) => {
        await plan(app);
        await page.emulateMedia({ colorScheme: scheme });
        await state.open({ app, network, page });

        const expected = known(testInfo.project.name)[state.title]?.[scheme] ?? [];
        expect(await violationsOf(page)).toEqual(expected);
      });
    }
  }
}
