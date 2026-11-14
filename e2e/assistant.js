// What the specs of the assistant share: a provider that answers from a
// script, so no browser test calls a real one, and how to find and drive the
// assistant's button and window.

import { expect } from "@playwright/test";

/** @typedef {import("../server/assistant/providers/types.js").Provider} Provider */
/** @typedef {import("../server/assistant/providers/types.js").Message} Message */
/** @typedef {import("../server/assistant/providers/types.js").Tool} Tool */

/**
 * What a step of a script answers: text, calls of the tools, or both. A call
 * without an `id` gets one.
 * @typedef {{ text?: string, toolCalls?: { id?: string, name: string, input: any }[] }} ScriptedAnswer
 */

/**
 * @typedef {{ system: string, messages: Message[], tools: Tool[], signal?: AbortSignal }} ProviderRequest
 */

/**
 * A step of a script: an answer, an `Error` to reject with, or a function
 * that gets the test's app and the request, and returns an answer. The app
 * holds the seeded recipes and ingredients, which the tool calls name by id.
 * @typedef {ScriptedAnswer | Error | ((context: { app: any, request: ProviderRequest }) => ScriptedAnswer)} Step
 */

/**
 * A provider that answers each call with the next step of `steps`, in place
 * of a model. The tools that its answers call run on the server for real, on
 * the test's data, so the pending changes that they stage are real ones.
 *
 * A call beyond the script rejects and is recorded in `overruns`, which the
 * fixture checks after the test.
 *
 * @param {Step[]} steps
 * @param {() => any} appOf Returns the test's app, for the steps that are functions.
 * @returns {Provider & { overruns: string[] }}
 */
export function scriptedProvider(steps, appOf) {
  let calls = 0;
  /** @type {string[]} */
  const overruns = [];

  return {
    name: "anthropic",
    model: "scripted",
    overruns,
    async complete(request) {
      calls += 1;
      const call = calls;
      const step = steps[call - 1];
      if (step === undefined) {
        const message = `The assistant made call ${call}, past the end of its script.`;
        overruns.push(message);
        throw new Error(message);
      }
      if (step instanceof Error) throw step;
      const answer = typeof step === "function" ? step({ app: appOf(), request }) : step;
      return {
        text: answer.text ?? "",
        toolCalls: (answer.toolCalls ?? []).map((toolCall, index) => ({
          id: `call-${call}-${index + 1}`,
          ...toolCall,
        })),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
}

/**
 * The step that proposes the menus of `slots` of `week`: each slot is a day,
 * a meal, and the recipe names with their servings, such as `["mon",
 * "lunch", { Omelette: 2 }]`.
 * @param {string} week
 * @param {[string, string, Record<string, number>][]} slots
 * @returns {Step}
 */
export function proposeMenus(week, slots) {
  return ({ app }) => ({
    toolCalls: [
      {
        name: "propose_menus",
        input: {
          menus: slots.map(([day, meal, servingsByName]) => ({
            week,
            day,
            meal,
            items: Object.entries(servingsByName).map(([name, servings]) => ({
              recipeId: app.recipes[name].id,
              servings,
            })),
          })),
        },
      },
    ],
  });
}

// A word of 63 letters, with no place to break a line, so only a name that
// wraps anywhere stays inside the details.
export const LONG_INGREDIENT = `Superlong${"saffronthreads".repeat(3)}fromlamancha`;

// The new ingredients and recipes of the large plan. Long names, so they wrap.
const LARGE_PLAN_INGREDIENTS = [
  { name: "Zucchini", unit: "g", measures: [{ name: "medium", amount: 250 }] },
  { name: "Goat cheese log", unit: "g", measures: [{ name: "slice", amount: 25 }] },
  {
    name: "Roasted piquillo peppers in a jar",
    unit: "g",
    measures: [{ name: "jar", amount: 225 }],
  },
  { name: "Frozen skinless hake loins", unit: "g", measures: [{ name: "loin", amount: 150 }] },
  { name: LONG_INGREDIENT, unit: "g", measures: [] },
  { name: "Ground turkey breast", unit: "g", measures: [] },
];
const LARGE_PLAN_RECIPES = [
  "Zucchini cream soup with goat cheese and whole wheat croutons",
  "Oven-roasted chicken with sliced potatoes and piquillo peppers",
  "Hake in green sauce with clams",
  "Turkey meatballs in homemade tomato sauce",
];
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const MEALS = ["breakfast", "snack_am", "lunch", "snack_pm", "dinner"];

/** The ids that the calls of `tool` returned in the tool results of `messages`. */
function proposedIds(messages, tool) {
  return messages.flatMap((message) =>
    message.role === "tool"
      ? message.results
          .filter((result) => result.name === tool && !result.isError)
          .map((result) => JSON.parse(result.output).id)
      : [],
  );
}

/**
 * The steps of a large plan of `week`, which then answers `reply`: 6 new
 * ingredients, one of them named `LONG_INGREDIENT`, 4 new recipes with 9 or
 * 10 lines each, and the menus of all 35 slots, with 1 to 4 recipes each.
 * The recipes use the new ingredients and the seeded ones, and the menus
 * the new recipes and the seeded ones.
 * @param {string} week
 * @param {string} reply
 * @returns {Step[]}
 */
export function largePlan(week, reply) {
  return [
    {
      toolCalls: LARGE_PLAN_INGREDIENTS.map((input) => ({ name: "propose_ingredient", input })),
    },
    ({ app, request }) => {
      const pool = [
        ...proposedIds(request.messages, "propose_ingredient"),
        ...Object.values(app.ingredients).map((ingredient) => ingredient.id),
      ];
      return {
        toolCalls: LARGE_PLAN_RECIPES.map((name, index) => ({
          name: "propose_recipe",
          input: {
            name,
            // Each ingredient once: a recipe can't repeat one.
            ingredients: pool.slice(0, 9 + (index % 2)).map((ingredientId, line) => ({
              ingredientId,
              quantity: [150, 0.5, 20, 1, 75.25][line % 5],
            })),
          },
        })),
      };
    },
    ({ app, request }) => {
      const pool = [
        ...proposedIds(request.messages, "propose_recipe"),
        ...Object.values(app.recipes).map((recipe) => recipe.id),
      ];
      const slots = DAYS.flatMap((day) => MEALS.map((meal) => ({ day, meal })));
      const menus = slots.map(({ day, meal }, slot) => ({
        week,
        day,
        meal,
        // 1 to 4 recipes, each once: the pool holds 11 recipes, and steps of
        // 7 don't come back to the first one within 4 items.
        items: Array.from({ length: (slot % 4) + 1 }, (_, item) => ({
          recipeId: pool[(slot * 3 + item * 7) % pool.length],
          servings: [1, 2, 2.5, 4][(slot + item) % 4],
        })),
      }));
      return { toolCalls: [{ name: "propose_menus", input: { menus } }] };
    },
    { text: reply },
  ];
}

/** The round button that opens and collapses the window, with or without its mark. */
export function assistantButton(page) {
  return page.getByRole("button", { name: /^Assistant(, new activity)?$/ });
}

/** The assistant's window. */
export function assistantWindow(page) {
  return page.getByRole("dialog", { name: "Assistant", exact: true });
}

/** The message field of the window. */
export function messageField(page) {
  return assistantWindow(page).getByRole("textbox", { name: "Message" });
}

/** The card of the pending changes in the window. */
export function pendingCard(page) {
  return assistantWindow(page).getByRole("region", { name: "Pending changes" });
}

/** Opens the window with its button, and returns the window. */
export async function openAssistant(page) {
  await assistantButton(page).click();
  const chat = assistantWindow(page);
  await expect(chat).toBeVisible();
  return chat;
}

/** Sends `text` from the open window with Enter. */
export async function sendMessage(page, text) {
  await messageField(page).fill(text);
  await messageField(page).press("Enter");
}

/**
 * Opens the window, sends `text`, and waits until the window shows `reply`,
 * the text of the assistant's answer.
 */
export async function ask(page, text, reply) {
  const chat = await openAssistant(page);
  await sendMessage(page, text);
  await expect(chat.getByText(reply)).toBeVisible();
  return chat;
}

/** A small PDF: the server knows a PDF by its first bytes. */
export const SCHOOL_MENU = {
  name: "school-menu.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4\n% Fish on Tuesday.\n%%EOF\n", "latin1"),
};

/** Attaches `file` through Attach files and the browser's file chooser. */
export async function attachFile(page, file) {
  const chooser = page.waitForEvent("filechooser");
  await assistantWindow(page).getByRole("button", { name: "Attach files" }).click();
  await (await chooser).setFiles(file);
}
