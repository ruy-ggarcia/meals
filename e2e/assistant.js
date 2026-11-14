// What the specs of the assistant share: a provider that answers from a
// script, so no browser test calls a real one, and how to find and drive the
// assistant's button and window.

import { expect } from "@playwright/test";

/** @typedef {import("../server/assistant/providers/errors.js").Provider} Provider */
/** @typedef {import("../server/assistant/providers/errors.js").Message} Message */
/** @typedef {import("../server/assistant/providers/errors.js").Tool} Tool */

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
 * `hold()` makes the calls wait before they answer, until `release()`, so a
 * test can act while the assistant answers. A waiting call rejects when its
 * signal aborts, as when the server stops. A call beyond the script rejects
 * and is recorded in `overruns`, which the fixture checks after the test.
 *
 * @param {Step[]} steps
 * @param {() => any} appOf Returns the test's app, for the steps that are functions.
 * @returns {Provider & { hold(): void, release(): void, overruns: string[] }}
 */
export function scriptedProvider(steps, appOf) {
  let calls = 0;
  /** @type {PromiseWithResolvers<void> | null} */
  let gate = null;
  /** @type {string[]} */
  const overruns = [];

  /** Resolves when `gate` opens, and rejects with the reason of `signal` when it aborts. */
  function waitForRelease(signal) {
    if (gate === null) return Promise.resolve();
    const opened = gate.promise;
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const abort = () => reject(signal?.reason);
      signal?.addEventListener("abort", abort, { once: true });
      opened.then(() => {
        signal?.removeEventListener("abort", abort);
        resolve(undefined);
      });
    });
  }

  return {
    name: "anthropic",
    model: "scripted",
    overruns,
    hold() {
      gate ??= Promise.withResolvers();
    },
    release() {
      gate?.resolve();
      gate = null;
    },
    async complete(request) {
      calls += 1;
      const call = calls;
      const step = steps[call - 1];
      if (step === undefined) {
        const message = `The script has ${steps.length} steps, but the assistant made call ${call}.`;
        overruns.push(message);
        throw new Error(message);
      }
      await waitForRelease(request.signal);
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

/**
 * Runs in a page before its scripts: keeps, in `assistantChecked`, a promise
 * that resolves once the page has read whether the assistant is on, and the
 * code that waits for the answer has run.
 */
export function trackAssistantCheck() {
  /** @type {any} */
  const target = window;
  const read = Promise.withResolvers();
  target.assistantChecked = read.promise.then(
    // A message from another task, after all promise handlers have run.
    () =>
      new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = resolve;
        channel.port2.postMessage(null);
      }),
  );
  const json = Response.prototype.json;
  Response.prototype.json = function () {
    const parsed = json.call(this);
    if (new URL(this.url).pathname === "/api/assistant") parsed.then(read.resolve, read.resolve);
    return parsed;
  };
}

/** Resolves once `page`, which runs `trackAssistantCheck`, has read whether the assistant is on. */
export async function assistantChecked(page) {
  await page.evaluate(() => /** @type {any} */ (window).assistantChecked);
}
