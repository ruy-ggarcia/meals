// The harness of the tests of the assistant's window (public/assistant.js),
// which run against a real DOM built from the real pages, with a fake server.
// See test/dom-helpers.js for the page harness. The tests read the page of
// the running test through `server`, `document`, `window`, and `page`.

import assert from "node:assert/strict";
import { PRECISE_POINTER } from "../public/assistant.js";
import { fakeFetch, openPage, tick, typeInto, waitFor } from "./dom-helpers.js";
import { answerWeekLoad, WEEK } from "./meal-plan-helpers.js";

export const MB = 1024 * 1024;
export const ID = "c1";
export const CONVERSATION_URL = `/api/assistant/conversations/${ID}`;
export const STORED = { "meals.assistant.conversation": ID };

export const QUESTION = { role: "user", text: "Plan next week." };
export const REPLY = { role: "assistant", text: "Fish on Tuesday,\nchicken on Friday." };
export const NEXT_WEEK = "2026-09-28";
/**
 * The event of an apply that saved menus of WEEK, from Tuesday, and of
 * NEXT_WEEK, from Wednesday.
 */
export const APPLIED = {
  role: "event",
  kind: "applied",
  counts: { slots: 35, recipes: 4, ingredients: 6 },
  weeks: [
    { week: WEEK, day: "tue" },
    { week: NEXT_WEEK, day: "wed" },
  ],
};
/** The addresses of the links of APPLIED: the first changed day of each week. */
export const WEEK_LINK = "/#2026-09-21/tue";
export const NEXT_WEEK_LINK = "/#2026-09-28/wed";
export const DISCARDED = { role: "event", kind: "discarded" };
export const PENDING = [
  {
    target: `menu:${WEEK}/tue/dinner`,
    kind: "menu",
    week: WEEK,
    day: "tue",
    meal: "dinner",
    items: [{ name: "Grilled fish", servings: 4 }],
  },
  {
    target: "recipe:r9",
    kind: "recipe",
    action: "create",
    name: "Pumpkin soup",
    ingredients: [{ name: "Pumpkin", quantity: 200, unit: "g" }],
  },
];

export const PAGES = {
  "index.html": "app.js",
  "ingredients.html": "ingredients.js",
  "recipes.html": "recipes.js",
};

// The screens of the two layouts of the window: a phone, where it's a sheet,
// a phone in landscape, which is 500 px tall or less and gets the sheet too,
// and a desktop, where it floats above the page.
export const PHONE = { width: 393, height: 659 };
export const LANDSCAPE = { width: 734, height: 343 };
export const DESKTOP = { width: 1280, height: 720 };

/** @type {ReturnType<typeof fakeFetch>} */
export let server;
/** @type {any} */
export let document;
/** @type {any} */
export let window;
/** @type {any} */
export let page;

/** A conversation as the server shows it: idle and empty unless `overrides` say otherwise. */
export function conversation(overrides = {}) {
  return { id: ID, status: "idle", messages: [], pending: [], revision: 0, ...overrides };
}

/**
 * Opens `html` with the assistant on, `stored` in localStorage, and `session`
 * in sessionStorage, and answers the page's own loads. With `assistant:
 * false`, the server says that the assistant is off; with `answered: false`,
 * it answers nothing, so the page still waits to know whether the assistant
 * is on. The page has the size of `screen`, a desktop by default, and the
 * address `url`, `/#WEEK` for the meal plan by default. Its primary pointer is
 * `pointer`: "fine", such as a mouse, by default, or "coarse", such as a
 * finger on a phone. `beforeScript(window)` runs after the storage is filled.
 *
 * @param {import("node:test").TestContext} t
 * @param {{
 *   html?: string,
 *   stored?: Record<string, string>,
 *   session?: Record<string, string>,
 *   assistant?: boolean,
 *   answered?: boolean,
 *   url?: string,
 *   recipes?: any[],
 *   screen?: { width: number, height: number },
 *   pointer?: "fine" | "coarse",
 *   beforeScript?: (window: any) => void,
 * }} [options]
 */
export async function openWithAssistant(
  t,
  {
    html = "recipes.html",
    stored = {},
    session = {},
    assistant = true,
    answered = true,
    url = html === "index.html" ? `http://localhost/#${WEEK}` : `http://localhost/${html}`,
    recipes = [],
    screen = DESKTOP,
    pointer = "fine",
    beforeScript,
  } = {},
) {
  server = fakeFetch({ assistant: "manual" });
  page = await openPage(t, {
    html,
    script: PAGES[html],
    fetch: server.fetch,
    url,
    beforeScript: (pageWindow) => {
      pageWindow.happyDOM.setViewport(screen);
      usePointer(pageWindow, pointer);
      for (const [key, value] of Object.entries(stored)) {
        pageWindow.localStorage.setItem(key, value);
      }
      for (const [key, value] of Object.entries(session)) {
        pageWindow.sessionStorage.setItem(key, value);
      }
      beforeScript?.(pageWindow);
    },
  });
  ({ document, window } = page);
  if (!answered) return;
  await answer("GET", "/api/assistant", 200, { enabled: assistant });
  if (html === "index.html") {
    await waitFor(() => server.requestFor("GET", `/api/weeks/${WEEK}`) !== undefined);
    await answerWeekLoad(server, WEEK, { recipes });
  } else {
    await answer("GET", "/api/recipes", 200, { recipes });
    await answer("GET", "/api/ingredients", 200, { ingredients: [] });
  }
}

/** Makes `pointer` the primary pointer of `pageWindow`, as PRECISE_POINTER reports it. */
function usePointer(pageWindow, pointer) {
  const matchMedia = pageWindow.matchMedia.bind(pageWindow);
  pageWindow.matchMedia = (query) => {
    const list = matchMedia(query);
    if (query === PRECISE_POINTER) {
      Object.defineProperty(list, "matches", { value: pointer === "fine" });
    }
    return list;
  };
}

/** Opens `html` with a stored conversation, and answers its read with `view`. */
export async function openConversation(t, view, options = {}) {
  await openWithAssistant(t, { ...options, stored: { ...STORED, ...options.stored } });
  await answer("GET", CONVERSATION_URL, 200, view);
}

/**
 * Waits until the page has sent `method` to `url` and nobody has answered it
 * yet, answers it with `status` and `body`, and waits a tick for the page to
 * react. The window reads the same URL many times, so an answered read never
 * counts.
 */
export async function answer(method, url, status, body) {
  const unanswered = () => {
    const request = server.requestFor(method, url);
    return request !== undefined && !request.settled;
  };
  await waitFor(unanswered, {
    message: () => `no ${method} ${url} to answer; the page sent ${requestList()}`,
  });
  server.requestFor(method, url).respond(status, body);
  await tick();
}

/** The requests that the page sent, as `METHOD url` joined by commas. */
function requestList() {
  return server.requests.map((request) => `${request.method} ${request.url}`).join(", ");
}

/** Lets the page react to an answer while setTimeout is mocked. */
export async function settle() {
  for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** Mocks setTimeout for the rest of the test `t`. */
export function mockTimers(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
}

export function assistantButton() {
  return document.querySelector(".assistant-button");
}

export function assistantWindow() {
  return document.querySelector(".assistant-window");
}

/** The control of the window whose accessible name is `name`. */
export function control(name) {
  const found = [...assistantWindow().querySelectorAll("button")].find(
    (button) => (button.getAttribute("aria-label") ?? button.textContent.trim()) === name,
  );
  assert.ok(found, `the window has no button named ${name}`);
  return found;
}

/** The title of the window, Assistant. */
export function windowTitle() {
  return assistantWindow().querySelector("h2");
}

export function messageField() {
  return assistantWindow().querySelector("textarea");
}

function fileInput() {
  return assistantWindow().querySelector("input[type='file']");
}

export function log() {
  return assistantWindow().querySelector("[role='log']");
}

/** The problem that the composer shows, such as a message that wasn't sent. */
export function problemText() {
  return assistantWindow().querySelector(".message-composer [role='alert']").textContent;
}

/** The problem that the card of the pending changes shows above its actions. */
export function cardProblemText() {
  return pendingCard().querySelector("[role='alert']").textContent;
}

export function pendingCard() {
  return [...assistantWindow().querySelectorAll("section")].find((section) =>
    section.textContent.includes("Pending changes"),
  );
}

/** Whether `element` shows: neither it nor a container of it is hidden. */
export function isShown(element) {
  return element.closest("[hidden]") === null;
}

/** The pending changes of View details. */
export function detailItems() {
  return [...pendingCard().querySelectorAll(".pending-change")];
}

/** The elements of the page outside the assistant: the sidebar, the toolbar, and the page. */
function pageParts() {
  return [".sidebar", ".toolbar", ".page"].map((selector) => document.querySelector(selector));
}

/** The classes of the parts of the page that are inert. */
export function inertParts() {
  return pageParts()
    .filter((element) => element.inert)
    .map((element) => element.className);
}

/** The layer that dims the page behind the sheet. */
export function backdrop() {
  return document.querySelector(".assistant-backdrop");
}

/** Gives the page the size of `screen`, as when a phone turns or a window resizes. */
export function resize(screen) {
  window.happyDOM.setViewport(screen);
}

/**
 * A stand-in for `window.visualViewport`, the part of the page that the
 * screen shows, which the on-screen keyboard makes shorter. happy-dom has
 * none.
 */
export function fakeVisualViewport(pageWindow) {
  const viewport = new pageWindow.EventTarget();
  viewport.height = PHONE.height;
  viewport.offsetTop = 0;
  pageWindow.visualViewport = viewport;
  return viewport;
}

/** The size and offset of the sheet that the window's CSS variables set, or null without them. */
export function sheetViewport() {
  const height = assistantWindow().style.getPropertyValue("--assistant-viewport-height");
  const top = assistantWindow().style.getPropertyValue("--assistant-viewport-top");
  return height === "" && top === "" ? null : { height, top };
}

/**
 * Rejects Apply with a problem on the new recipe of PENDING, and answers the
 * read that follows with the problem on that pending change.
 */
export async function rejectApply() {
  const problem = '"Pumpkin soup" already exists.';
  control("Apply").focus();
  control("Apply").click();
  await answer("POST", `${CONVERSATION_URL}/apply`, 409, {
    error: "The pending changes couldn't be applied.",
    problems: [{ target: "recipe:r9", message: problem }],
  });
  await answer(
    "GET",
    CONVERSATION_URL,
    200,
    conversation({ pending: [PENDING[0], { ...PENDING[1], problem }] }),
  );
}

export function stored(key) {
  return window.localStorage.getItem(key);
}

export function storedForVisit(key) {
  return window.sessionStorage.getItem(key);
}

/** The window remembers for the visit that it's open. */
export const OPEN = { "meals.assistant.open": "true" };

export function readCount() {
  return server.requests.filter(
    (request) => request.method === "GET" && request.url === CONVERSATION_URL,
  ).length;
}

/** The rows of the log: each message, event, and state, by its text. */
export function logRows() {
  return [...log().children].map((row) => row.querySelector("p").textContent);
}

/** The links of the log that show, by their text and their address. */
export function shownWeekLinks() {
  return [...log().querySelectorAll("a")]
    .filter(isShown)
    .map((link) => [link.textContent, link.getAttribute("href")]);
}

/** The hint of the empty conversation and its examples. */
export function emptyState() {
  return assistantWindow().querySelector(".assistant-empty");
}

export function skipLink() {
  return [...document.querySelectorAll("a")].find(
    (link) => link.textContent === "Ask the assistant",
  );
}

/** Pending changes of `count` slots of WEEK. */
export function pendingSlots(count) {
  return ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].slice(0, count).map((day) => ({
    target: `menu:${WEEK}/${day}/dinner`,
    kind: "menu",
    week: WEEK,
    day,
    meal: "dinner",
    items: [{ name: "Grilled fish", servings: 4 }],
  }));
}

/** A PDF of `size` bytes, as the file picker gives it. */
export function pdf(name, size) {
  const bytes = new Uint8Array(size);
  bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
  return { file: new window.File([bytes], name, { type: "application/pdf" }), bytes };
}

/** Picks `files` with the file picker. */
export function pick(files) {
  fileInput().files = files;
  fileInput().dispatchEvent(new window.Event("change", { bubbles: true }));
}

/** Types `text`, chooses Send, and waits for the message. Resolves to its request. */
export async function send(text) {
  typeInto(window, messageField(), text);
  control("Send").click();
  const url = `${CONVERSATION_URL}/messages`;
  await waitFor(() => server.requestFor("POST", url) !== undefined, {
    message: () => `no message; the page sent ${requestList()}`,
  });
  return server.requestFor("POST", url);
}
