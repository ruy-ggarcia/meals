// Tests for the assistant's window (public/assistant.js) against a real DOM
// built from the real pages, with a fake server. See test/dom-helpers.js for
// the harness.
//
// The window reads the conversation again a second after each answer while
// the assistant answers, and after a failed read during an answer. A test
// that leaves either state mocks setTimeout before the answer, so no read
// ever waits for real time, and no timer outlives the test. After that, it
// waits with settle(), because tick() waits on setTimeout too.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  assertFocus,
  fakeFetch,
  openPage,
  pressKey,
  tick,
  typeInto,
  useQuietConsole,
  waitFor,
} from "./dom-helpers.js";
import { addWithEditor, answerWeekLoad, slotButton, WEEK } from "./meal-plan-helpers.js";

const quiet = useQuietConsole();

const MB = 1024 * 1024;
const ID = "c1";
const CONVERSATION_URL = `/api/assistant/conversations/${ID}`;
const STORED = { "meals.assistant.conversation": ID };

const QUESTION = { role: "user", text: "Plan next week." };
const REPLY = { role: "assistant", text: "Fish on Tuesday,\nchicken on Friday." };
const PENDING = [
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

const PAGES = {
  "index.html": "app.js",
  "ingredients.html": "ingredients.js",
  "recipes.html": "recipes.js",
};

/** @type {ReturnType<typeof fakeFetch>} */
let server;
/** @type {any} */
let document;
/** @type {any} */
let window;
/** @type {any} */
let page;

/** A conversation as the server shows it: idle and empty unless `overrides` say otherwise. */
function conversation(overrides = {}) {
  return { id: ID, status: "idle", messages: [], pending: [], ...overrides };
}

/**
 * Opens `html` with the assistant on and `stored` in localStorage, and
 * answers the page's own loads. With `assistant: false`, the server says
 * that the assistant is off. `beforeScript(window)` runs after the storage
 * is filled.
 *
 * @param {import("node:test").TestContext} t
 * @param {{
 *   html?: string,
 *   stored?: Record<string, string>,
 *   assistant?: boolean,
 *   recipes?: any[],
 *   beforeScript?: (window: any) => void,
 * }} [options]
 */
async function openWithAssistant(
  t,
  { html = "recipes.html", stored = {}, assistant = true, recipes = [], beforeScript } = {},
) {
  server = fakeFetch({ assistant: "manual" });
  page = await openPage(t, {
    html,
    script: PAGES[html],
    fetch: server.fetch,
    url: html === "index.html" ? `http://localhost/#${WEEK}` : `http://localhost/${html}`,
    beforeScript: (pageWindow) => {
      for (const [key, value] of Object.entries(stored)) {
        pageWindow.localStorage.setItem(key, value);
      }
      beforeScript?.(pageWindow);
    },
  });
  ({ document, window } = page);
  await answer("GET", "/api/assistant", 200, { enabled: assistant });
  if (html === "index.html") {
    await waitFor(() => server.requestFor("GET", `/api/weeks/${WEEK}`) !== undefined);
    await answerWeekLoad(server, WEEK, { recipes });
  } else {
    await answer("GET", "/api/recipes", 200, { recipes });
    await answer("GET", "/api/ingredients", 200, { ingredients: [] });
  }
}

/** Opens `html` with a stored conversation, and answers its read with `view`. */
async function openConversation(t, view, options = {}) {
  await openWithAssistant(t, { ...options, stored: { ...STORED, ...options.stored } });
  await answer("GET", CONVERSATION_URL, 200, view);
}

/**
 * Waits until the page has sent `method` to `url` and nobody has answered it
 * yet, answers it with `status` and `body`, and waits a tick for the page to
 * react. The window reads the same URL many times, so an answered read never
 * counts.
 */
async function answer(method, url, status, body) {
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
async function settle() {
  for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** Mocks setTimeout for the rest of the test `t`. */
function mockTimers(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
}

function assistantButton() {
  return document.querySelector(".assistant-button");
}

function assistantWindow() {
  return document.querySelector(".assistant-window");
}

/** The control of the window whose accessible name is `name`. */
function control(name) {
  const found = [...assistantWindow().querySelectorAll("button")].find(
    (button) => (button.getAttribute("aria-label") ?? button.textContent.trim()) === name,
  );
  assert.ok(found, `the window has no button named ${name}`);
  return found;
}

function messageField() {
  return assistantWindow().querySelector("textarea");
}

function fileInput() {
  return assistantWindow().querySelector("input[type='file']");
}

function log() {
  return assistantWindow().querySelector("[role='log']");
}

function problemText() {
  return assistantWindow().querySelector("[role='alert']").textContent;
}

function pendingCard() {
  return [...assistantWindow().querySelectorAll("section")].find((section) =>
    section.textContent.includes("Pending changes"),
  );
}

function stored(key) {
  return window.localStorage.getItem(key);
}

function readCount() {
  return server.requests.filter(
    (request) => request.method === "GET" && request.url === CONVERSATION_URL,
  ).length;
}

/** A PDF of `size` bytes, as the file picker gives it. */
function pdf(name, size) {
  const bytes = new Uint8Array(size);
  bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
  return { file: new window.File([bytes], name, { type: "application/pdf" }), bytes };
}

/** Picks `files` with the file picker. */
function pick(files) {
  fileInput().files = files;
  fileInput().dispatchEvent(new window.Event("change", { bubbles: true }));
}

/** Types `text`, chooses Send, and waits for the message. Resolves to its request. */
async function send(text) {
  typeInto(window, messageField(), text);
  control("Send").click();
  const url = `${CONVERSATION_URL}/messages`;
  await waitFor(() => server.requestFor("POST", url) !== undefined, {
    message: () => `no message; the page sent ${requestList()}`,
  });
  return server.requestFor("POST", url);
}

describe("assistant window", () => {
  test("adds no button when the assistant is off", async (t) => {
    await openWithAssistant(t, { assistant: false });

    assert.equal(assistantButton(), null);
    assert.equal(assistantWindow(), null);
  });

  test("adds a button that controls the collapsed window", async (t) => {
    await openWithAssistant(t);

    assert.equal(assistantButton().getAttribute("aria-label"), "Assistant");
    assert.equal(assistantButton().getAttribute("aria-expanded"), "false");
    assert.equal(assistantButton().getAttribute("aria-controls"), assistantWindow().id);
    assert.equal(assistantWindow().hidden, true);
  });

  test("names the window Assistant without making it modal", async (t) => {
    await openWithAssistant(t);

    assert.equal(assistantWindow().getAttribute("role"), "dialog");
    assert.equal(assistantWindow().getAttribute("aria-label"), "Assistant");
    assert.equal(assistantWindow().getAttribute("aria-modal"), null);
  });

  test("opens with the button and focuses the message field", async (t) => {
    await openWithAssistant(t);

    assistantButton().click();

    assert.equal(assistantWindow().hidden, false);
    assert.equal(assistantButton().getAttribute("aria-expanded"), "true");
    assertFocus(document, messageField());
  });

  test("collapses with Collapse and focuses the button", async (t) => {
    await openWithAssistant(t);
    assistantButton().click();

    control("Collapse").click();

    assert.equal(assistantWindow().hidden, true);
    assert.equal(assistantButton().getAttribute("aria-expanded"), "false");
    assertFocus(document, assistantButton());
  });

  test("collapses on Escape inside the window", async (t) => {
    await openWithAssistant(t);
    assistantButton().click();

    pressKey(window, messageField(), "Escape");

    assert.equal(assistantWindow().hidden, true);
    assertFocus(document, assistantButton());
  });

  test("remembers that the window is open", async (t) => {
    await openWithAssistant(t);

    assistantButton().click();
    assert.equal(stored("meals.assistant.open"), "true");
    control("Collapse").click();
    assert.equal(stored("meals.assistant.open"), "false");
  });

  test("starts open when another page left it open", async (t) => {
    await openWithAssistant(t, { stored: { "meals.assistant.open": "true" } });

    assert.equal(assistantWindow().hidden, false);
    assert.equal(assistantButton().getAttribute("aria-expanded"), "true");
  });

  test("keeps the conversation when another page loads", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION, REPLY] }));

    assert.match(log().textContent, /Plan next week\./);
    assert.match(log().textContent, /Fish on Tuesday,\nchicken on Friday\./);
  });

  test("shows the names of the attachments of a message", async (t) => {
    const message = { ...QUESTION, attachments: ["school-menu.pdf", "photo.jpg"] };
    await openConversation(t, conversation({ messages: [message] }));

    const names = [...log().querySelectorAll("li")].map((item) => item.textContent);

    assert.deepEqual(names, ["school-menu.pdf", "photo.jpg"]);
  });

  test("shows an empty chat and forgets the conversation when it's gone", async (t) => {
    await openWithAssistant(t, { stored: { ...STORED, "meals.assistant.used": "1000" } });

    await answer("GET", CONVERSATION_URL, 404, { error: "Unknown conversation" });

    assert.equal(log().textContent, "");
    assert.equal(stored("meals.assistant.conversation"), null);
    assert.equal(stored("meals.assistant.used"), null);
  });

  test("starts a conversation before it sends the first message", async (t) => {
    await openWithAssistant(t);
    assistantButton().click();
    typeInto(window, messageField(), "Plan next week.");

    control("Send").click();
    await answer("POST", "/api/assistant/conversations", 201, { id: ID });

    const message = server.requestFor("POST", `${CONVERSATION_URL}/messages`);
    const { today: _, ...sent } = message.body;
    assert.deepEqual(sent, { text: "Plan next week.", attachments: [] });
    assert.equal(stored("meals.assistant.conversation"), ID);
    message.respond(202, {});
    await answer("GET", CONVERSATION_URL, 200, conversation());
  });

  test("starts a new conversation when the server lost the stored one", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION] }));
    assistantButton().click();

    const message = await send("Plan next week.");
    message.respond(404, { error: "Unknown conversation" });
    await answer("POST", "/api/assistant/conversations", 201, { id: "c2" });

    const resent = server.requestFor("POST", "/api/assistant/conversations/c2/messages");
    const { today: _, ...sent } = resent?.body ?? {};
    assert.deepEqual(sent, { text: "Plan next week.", attachments: [] });
    resent.respond(202, {});
    await answer("GET", "/api/assistant/conversations/c2", 200, conversation());
  });

  test("sends the week that the meal plan shows", async (t) => {
    await openConversation(t, conversation(), { html: "index.html" });
    assistantButton().click();

    const message = await send("Plan this week.");

    assert.equal(message.body.week, WEEK);
    message.respond(202, {});
    await answer("GET", CONVERSATION_URL, 200, conversation());
  });

  test("sends the browser's local date as today", async (t) => {
    await openConversation(t, conversation());
    assistantButton().click();
    t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 10, 16, 12).getTime() });

    const message = await send("Plan tomorrow.");

    assert.equal(message.body.today, "2026-11-16");
    message.respond(202, {});
    await answer("GET", CONVERSATION_URL, 200, conversation());
  });

  test("clears the message field after the message is sent", async (t) => {
    await openConversation(t, conversation());
    assistantButton().click();

    const message = await send("Plan next week.");
    message.respond(202, {});
    await answer("GET", CONVERSATION_URL, 200, conversation());

    assert.equal(messageField().value, "");
  });

  test("keeps the text typed while the message uploads", async (t) => {
    await openConversation(t, conversation());
    assistantButton().click();
    const message = await send("Plan next week.");

    typeInto(window, messageField(), "And the snacks.");
    message.respond(202, {});
    await answer("GET", CONVERSATION_URL, 200, conversation());

    assert.equal(messageField().value, "And the snacks.");
  });

  test("keeps the files picked while the message uploads", async (t) => {
    await openConversation(t, conversation());
    assistantButton().click();
    pick([pdf("a.pdf", 10).file]);
    const message = await send("Plan next week.");

    pick([pdf("b.pdf", 10).file]);
    message.respond(202, {});
    await answer("GET", CONVERSATION_URL, 200, conversation());

    const names = [...assistantWindow().querySelectorAll(".attachment-name")].map(
      (name) => name.textContent,
    );
    assert.deepEqual(names, ["b.pdf"]);
  });

  test("keeps the text and shows the message when the server rejects it", async (t) => {
    await openConversation(t, conversation());
    assistantButton().click();

    const message = await send("Plan next week.");
    message.respond(409, { error: "The assistant is still answering." });
    await answer("GET", CONVERSATION_URL, 200, conversation());

    assert.equal(problemText(), "The assistant is still answering.");
    assert.equal(messageField().value, "Plan next week.");
  });

  test("says that the message wasn't sent when the network fails", async (t) => {
    quiet.expect(1);
    await openConversation(t, conversation());
    assistantButton().click();

    const message = await send("Plan next week.");
    message.fail();
    await answer("GET", CONVERSATION_URL, 200, conversation());

    assert.equal(problemText(), "Couldn't send the message. Try again.");
  });

  test("sends with Enter", async (t) => {
    await openConversation(t, conversation());
    assistantButton().click();
    typeInto(window, messageField(), "Plan next week.");

    const event = pressKey(window, messageField(), "Enter");
    await answer("POST", `${CONVERSATION_URL}/messages`, 202, {});
    await answer("GET", CONVERSATION_URL, 200, conversation());

    assert.equal(event.defaultPrevented, true);
  });

  test("adds a line with Shift+Enter", async (t) => {
    await openConversation(t, conversation());
    assistantButton().click();
    typeInto(window, messageField(), "Plan next week.");

    const event = new window.KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    messageField().dispatchEvent(event);
    await tick();

    assert.equal(event.defaultPrevented, false);
    assert.equal(server.requestFor("POST", `${CONVERSATION_URL}/messages`), undefined);
  });

  test("leaves Enter to the input method while it composes", async (t) => {
    await openConversation(t, conversation());
    assistantButton().click();
    typeInto(window, messageField(), "Plan next week.");

    const event = new window.KeyboardEvent("keydown", {
      key: "Enter",
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    messageField().dispatchEvent(event);
    await tick();

    assert.equal(event.defaultPrevented, false);
    assert.equal(server.requestFor("POST", `${CONVERSATION_URL}/messages`), undefined);
  });

  test("sends a message with a 9 MB PDF through the upload timeout", async (t) => {
    await openConversation(t, conversation());
    const timeout = t.mock.method(AbortSignal, "timeout");
    assistantButton().click();
    const { file, bytes } = pdf("school-menu.pdf", 9 * MB);
    pick([file]);

    const message = await send("Plan next week.");

    assert.equal(timeout.mock.calls.at(-1).arguments[0], 120000);
    const [attachment] = message.body.attachments;
    assert.equal(attachment.name, "school-menu.pdf");
    assert.equal(attachment.mediaType, "application/pdf");
    assert.ok(
      attachment.data === Buffer.from(bytes).toString("base64"),
      "the data is the file in plain base64",
    );
    message.respond(202, {});
    await answer("GET", CONVERSATION_URL, 200, conversation());
  });

  test("shows the attached files as chips before it sends", async (t) => {
    await openWithAssistant(t);
    assistantButton().click();

    pick([pdf("a.pdf", 10).file, pdf("b.pdf", 10).file]);

    const chips = [...assistantWindow().querySelectorAll(".attachment-chip")];
    assert.deepEqual(
      chips.map((chip) => chip.querySelector(".attachment-name").textContent),
      ["a.pdf", "b.pdf"],
    );
  });

  test("removes an attached file with its chip", async (t) => {
    await openWithAssistant(t);
    assistantButton().click();
    pick([pdf("a.pdf", 10).file, pdf("b.pdf", 10).file]);

    control("Remove a.pdf").click();

    const names = [...assistantWindow().querySelectorAll(".attachment-name")].map(
      (name) => name.textContent,
    );
    assert.deepEqual(names, ["b.pdf"]);
  });

  test("rejects a sixth attachment before it sends", async (t) => {
    await openWithAssistant(t);
    assistantButton().click();
    pick(Array.from({ length: 5 }, (_, index) => pdf(`${index}.pdf`, 10).file));

    pick([pdf("5.pdf", 10).file]);

    assert.equal(problemText(), "A message holds at most 5 attachments.");
    assert.equal(assistantWindow().querySelectorAll(".attachment-chip").length, 5);
  });

  test("counts the files that the conversation sent toward its limit", async (t) => {
    await openConversation(t, conversation());
    assistantButton().click();
    pick([pdf("a.pdf", MB).file]);

    const message = await send("Plan next week.");
    message.respond(202, {});
    await answer("GET", CONVERSATION_URL, 200, conversation());

    assert.equal(stored("meals.assistant.used"), String(MB));
  });

  test("rejects a file beyond the 20 MB that the conversation used", async (t) => {
    await openConversation(t, conversation(), {
      stored: { "meals.assistant.used": String(19 * MB) },
    });
    assistantButton().click();

    pick([pdf("a.pdf", 2 * MB).file]);

    assert.equal(
      problemText(),
      "The attachments of a conversation total at most 20 MB. Start a new conversation to attach more.",
    );
  });

  test("frees the space for attachments with New conversation", async (t) => {
    await openConversation(t, conversation(), {
      stored: { "meals.assistant.used": String(19 * MB) },
    });
    assistantButton().click();
    control("New conversation").click();
    await answer("DELETE", CONVERSATION_URL, 204);

    pick([pdf("a.pdf", 2 * MB).file]);

    assert.equal(problemText(), "");
    assert.equal(assistantWindow().querySelectorAll(".attachment-chip").length, 1);
  });

  test("ends the list with Thinking… while the assistant answers", async (t) => {
    await openWithAssistant(t, { stored: STORED });
    mockTimers(t);

    server.requestFor("GET", CONVERSATION_URL).respond(200, conversation({ status: "working" }));
    await settle();

    assert.equal(log().lastElementChild.textContent, "Thinking…");
  });

  test("disables Send, Apply, and Discard while the assistant answers", async (t) => {
    await openWithAssistant(t, { stored: STORED });
    mockTimers(t);

    const view = conversation({ status: "working", messages: [QUESTION], pending: PENDING });
    server.requestFor("GET", CONVERSATION_URL).respond(200, view);
    await settle();

    assert.equal(control("Send").disabled, true);
    assert.equal(control("Apply").disabled, true);
    assert.equal(control("Discard").disabled, true);
  });

  test("reads again while collapsed until the turn ends", async (t) => {
    await openWithAssistant(t, { stored: STORED });
    mockTimers(t);
    server.requestFor("GET", CONVERSATION_URL).respond(200, conversation({ status: "working" }));
    await settle();

    t.mock.timers.tick(999);
    await settle();
    assert.equal(readCount(), 1, "no read before a second");
    t.mock.timers.tick(1);
    await settle();
    assert.equal(readCount(), 2, "a read after a second");
    server.requestFor("GET", CONVERSATION_URL).respond(200, conversation());
    await settle();
    t.mock.timers.tick(5000);
    await settle();

    assert.equal(readCount(), 2, "no read after the turn ended");
    assert.equal(assistantWindow().hidden, true);
  });

  test("reads again after a failed read while the assistant answers", async (t) => {
    await openWithAssistant(t, { stored: STORED });
    mockTimers(t);
    server.requestFor("GET", CONVERSATION_URL).respond(200, conversation({ status: "working" }));
    await settle();
    t.mock.timers.tick(1000);
    await settle();

    server.requestFor("GET", CONVERSATION_URL).fail();
    await settle();
    t.mock.timers.tick(1000);
    await settle();

    assert.equal(readCount(), 3);
    assert.equal(log().textContent, "Thinking…");
    assert.equal(problemText(), "");
    server.requestFor("GET", CONVERSATION_URL).respond(200, conversation());
    await settle();
  });

  test("reads again after a failed read that follows a sent message", async (t) => {
    await openConversation(t, conversation());
    assistantButton().click();
    const message = await send("Plan next week.");
    mockTimers(t);
    message.respond(202, {});
    await settle();

    server.requestFor("GET", CONVERSATION_URL).fail();
    await settle();
    t.mock.timers.tick(1000);
    await settle();

    assert.equal(readCount(), 3);
    server.requestFor("GET", CONVERSATION_URL).respond(200, conversation());
    await settle();
  });

  test("stops reading after a failed read while the assistant is idle", async (t) => {
    await openWithAssistant(t, { stored: STORED });
    mockTimers(t);

    server.requestFor("GET", CONVERSATION_URL).fail();
    await settle();
    t.mock.timers.tick(5000);
    await settle();

    assert.equal(readCount(), 1);
    assert.equal(log().textContent, "");
  });

  test("pauses reading while the page is hidden", async (t) => {
    await openWithAssistant(t, { stored: STORED });
    mockTimers(t);
    let visibility = "visible";
    Object.defineProperty(document, "visibilityState", { get: () => visibility });
    server.requestFor("GET", CONVERSATION_URL).respond(200, conversation({ status: "working" }));
    await settle();

    visibility = "hidden";
    document.dispatchEvent(new window.Event("visibilitychange"));
    t.mock.timers.tick(5000);
    await settle();
    assert.equal(readCount(), 1, "no read while hidden");
    visibility = "visible";
    document.dispatchEvent(new window.Event("visibilitychange"));
    await settle();

    assert.equal(readCount(), 2, "a read when shown again");
    server.requestFor("GET", CONVERSATION_URL).respond(200, conversation());
    await settle();
  });

  test("says that the assistant couldn't answer, with Retry", async (t) => {
    const message = { ...QUESTION, failed: true };
    await openConversation(
      t,
      conversation({ status: "failed", error: "provider", messages: [message] }),
    );

    assert.equal(
      log().lastElementChild.querySelector("p").textContent,
      "The assistant couldn't answer.",
    );
    assert.ok(control("Retry"));
  });

  test("says that the assistant took too long, with Retry", async (t) => {
    const message = { ...QUESTION, failed: true };
    await openConversation(
      t,
      conversation({ status: "failed", error: "limit", messages: [message] }),
    );

    assert.equal(
      log().lastElementChild.querySelector("p").textContent,
      "The assistant took too long.",
    );
    assert.ok(control("Retry"));
  });

  test("asks for a new conversation without Retry when it's too long", async (t) => {
    const message = { ...QUESTION, failed: true };
    const view = conversation({ status: "failed", error: "too_long", messages: [message] });
    await openConversation(t, view);

    assert.equal(
      log().lastElementChild.textContent,
      "This conversation is too long. Start a new conversation.",
    );
    assert.equal(log().querySelector("button"), null);
  });

  test("runs the failed message again with Retry", async (t) => {
    const message = { ...QUESTION, failed: true };
    await openConversation(
      t,
      conversation({ status: "failed", error: "provider", messages: [message] }),
    );
    assistantButton().click();

    control("Retry").click();
    await answer("POST", `${CONVERSATION_URL}/retry`, 202, {});
    await answer("GET", CONVERSATION_URL, 200, conversation({ messages: [QUESTION, REPLY] }));

    assert.match(log().textContent, /chicken on Friday/);
    assert.doesNotMatch(log().textContent, /couldn't answer/);
  });

  test("moves the focus to the message field after Retry", async (t) => {
    const message = { ...QUESTION, failed: true };
    await openConversation(
      t,
      conversation({ status: "failed", error: "provider", messages: [message] }),
    );
    assistantButton().click();

    control("Retry").focus();
    control("Retry").click();
    await answer("POST", `${CONVERSATION_URL}/retry`, 202, {});
    await answer("GET", CONVERSATION_URL, 200, conversation({ messages: [QUESTION, REPLY] }));

    assertFocus(document, messageField());
  });

  test("summarizes the pending changes on a card", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION, REPLY], pending: PENDING }));

    const lines = [...pendingCard().querySelectorAll(".pending-summary li")].map((line) => [
      line.querySelector(".pending-label").textContent,
      line.querySelector(".pending-detail").textContent,
    ]);

    assert.deepEqual(lines, [
      ["Week of Sep 21", "1 slot"],
      ["New recipe", "Pumpkin soup"],
    ]);
  });

  test("hides the card without pending changes", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION, REPLY] }));

    assert.equal(pendingCard().hidden, true);
  });

  test("shows each pending change with View details", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }));
    assistantButton().click();

    control("View details").click();

    const details = pendingCard().querySelector(".pending-details");
    assert.equal(details.hidden, false);
    assert.equal(control("View details").getAttribute("aria-expanded"), "true");
    assert.match(details.textContent, /Tuesday, Sep 22 · Dinner/);
    assert.match(details.textContent, /Grilled fish × 4/);
    assert.match(details.textContent, /Pumpkin: 200 g/);
  });

  test("applies the pending changes with Apply", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }));
    assistantButton().click();

    control("Apply").click();
    await answer("POST", `${CONVERSATION_URL}/apply`, 200, { applied: true });
    await answer("GET", CONVERSATION_URL, 200, conversation());
    await answer("GET", "/api/recipes", 200, { recipes: [] });
    await answer("GET", "/api/ingredients", 200, { ingredients: [] });

    assert.equal(pendingCard().hidden, true);
  });

  test("shows each problem on its pending change after a rejected Apply", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }));
    assistantButton().click();

    control("Apply").click();
    await answer("POST", `${CONVERSATION_URL}/apply`, 409, {
      error: "The pending changes couldn't be applied.",
      problems: [{ target: "recipe:r9", message: '"Pumpkin soup" already exists.' }],
    });

    const changes = [...pendingCard().querySelectorAll(".pending-change")];
    assert.equal(pendingCard().querySelector(".pending-details").hidden, false);
    assert.equal(changes[0].querySelector(".pending-problem"), null);
    assert.equal(
      changes[1].querySelector(".pending-problem").textContent,
      '"Pumpkin soup" already exists.',
    );
  });

  test("discards the pending changes with Discard", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }));
    assistantButton().click();

    control("Discard").click();
    await answer("POST", `${CONVERSATION_URL}/discard`, 200, {});
    await answer("GET", CONVERSATION_URL, 200, conversation());

    assert.equal(pendingCard().hidden, true);
  });

  test("moves the focus to the message field after Discard", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }));
    assistantButton().click();

    control("Discard").focus();
    control("Discard").click();
    await answer("POST", `${CONVERSATION_URL}/discard`, 200, {});
    await answer("GET", CONVERSATION_URL, 200, conversation());

    assertFocus(document, messageField());
  });

  test("moves the focus to the message field after Apply", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }));
    assistantButton().click();

    control("Apply").focus();
    control("Apply").click();
    await answer("POST", `${CONVERSATION_URL}/apply`, 200, { applied: true });
    await answer("GET", CONVERSATION_URL, 200, conversation());
    await answer("GET", "/api/recipes", 200, { recipes: [] });
    await answer("GET", "/api/ingredients", 200, { ingredients: [] });

    assertFocus(document, messageField());
  });

  test("keeps Apply and Discard disabled until the read after Apply", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }));
    assistantButton().click();

    control("Apply").click();
    await answer("POST", `${CONVERSATION_URL}/apply`, 200, { applied: true });
    await answer("GET", "/api/recipes", 200, { recipes: [] });
    await answer("GET", "/api/ingredients", 200, { ingredients: [] });
    assert.equal(control("Apply").disabled, true, "Apply before the read");
    assert.equal(control("Discard").disabled, true, "Discard before the read");
    await answer("GET", CONVERSATION_URL, 200, conversation({ pending: PENDING }));

    assert.equal(control("Apply").disabled, false, "Apply after the read");
    assert.equal(control("Discard").disabled, false, "Discard after the read");
  });

  test("keeps Apply and Discard disabled until the read after Discard", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }));
    assistantButton().click();

    control("Discard").click();
    await answer("POST", `${CONVERSATION_URL}/discard`, 200, {});
    assert.equal(control("Apply").disabled, true, "Apply before the read");
    assert.equal(control("Discard").disabled, true, "Discard before the read");
    await answer("GET", CONVERSATION_URL, 200, conversation({ pending: PENDING }));

    assert.equal(control("Apply").disabled, false, "Apply after the read");
    assert.equal(control("Discard").disabled, false, "Discard after the read");
  });

  test("reloads the recipes after Apply", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }));
    assistantButton().click();

    control("Apply").click();
    await answer("POST", `${CONVERSATION_URL}/apply`, 200, { applied: true });

    await answer("GET", "/api/recipes", 200, {
      recipes: [{ id: "r9", name: "Pumpkin soup", ingredients: [], archived: false }],
    });
    await answer("GET", "/api/ingredients", 200, { ingredients: [] });
    await answer("GET", CONVERSATION_URL, 200, conversation());
    assert.match(document.getElementById("active-recipes").textContent, /Pumpkin soup/);
  });

  test("reloads the ingredients after Apply", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }), { html: "ingredients.html" });
    assistantButton().click();

    control("Apply").click();
    await answer("POST", `${CONVERSATION_URL}/apply`, 200, { applied: true });

    await answer("GET", "/api/ingredients", 200, {
      ingredients: [{ id: "i1", name: "Pumpkin", unit: "g", measures: [], archived: false }],
    });
    await answer("GET", "/api/recipes", 200, { recipes: [] });
    await answer("GET", CONVERSATION_URL, 200, conversation());
    assert.match(document.getElementById("active-ingredients").textContent, /Pumpkin/);
  });

  test("reloads the displayed week after Apply on the meal plan", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }), { html: "index.html" });
    assistantButton().click();

    control("Apply").click();
    await answer("POST", `${CONVERSATION_URL}/apply`, 200, { applied: true });
    await answer("GET", CONVERSATION_URL, 200, conversation());

    const weekLoads = server.requests.filter((request) => request.url === `/api/weeks/${WEEK}`);
    assert.equal(weekLoads.length, 2);
    await answerWeekLoad(server, WEEK);
  });

  test("keeps an unsaved slot after Apply on the meal plan", async (t) => {
    quiet.expect(1);
    const recipes = [{ id: "r1", name: "Soup", ingredients: [], archived: false }];
    await openConversation(t, conversation({ pending: PENDING }), { html: "index.html", recipes });
    const save = await addWithEditor(page, server, "mon", "lunch", "Soup");
    save.fail();
    await tick();
    assistantButton().click();

    control("Apply").click();
    await answer("POST", `${CONVERSATION_URL}/apply`, 200, { applied: true });
    await answer("GET", CONVERSATION_URL, 200, conversation());

    const weekLoads = server.requests.filter((request) => request.url === `/api/weeks/${WEEK}`);
    assert.equal(weekLoads.length, 1);
    assert.match(slotButton(page, "mon", "lunch").textContent, /Soup/);
  });

  test("keeps the week while the slot editor is open after Apply", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }), { html: "index.html" });
    slotButton(page, "mon", "lunch").click();

    control("Apply").click();
    await answer("POST", `${CONVERSATION_URL}/apply`, 200, { applied: true });
    await answer("GET", CONVERSATION_URL, 200, conversation());

    const weekLoads = server.requests.filter((request) => request.url === `/api/weeks/${WEEK}`);
    assert.equal(weekLoads.length, 1);
  });

  test("ends the conversation with New conversation", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION, REPLY] }));
    assistantButton().click();

    control("New conversation").click();
    await answer("DELETE", CONVERSATION_URL, 204);

    assert.equal(log().textContent, "");
    assert.equal(stored("meals.assistant.conversation"), null);
  });

  test("asks before New conversation loses the pending changes", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }));
    assistantButton().click();

    control("New conversation").click();

    const alert = document.querySelector(".alert");
    assert.equal(alert.open, true);
    assert.equal(alert.querySelector(".alert-title").textContent, "Start a new conversation?");
    assert.equal(
      alert.querySelector(".alert-message").textContent,
      "The pending changes aren't saved. If you start a new conversation, they're lost.",
    );
    assert.equal(alert.querySelector(".keep").textContent, "Keep Conversation");
    assert.equal(alert.querySelector(".lose").textContent, "Discard and Start");
  });

  test("keeps the conversation with Keep Conversation", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }));
    assistantButton().click();
    control("New conversation").click();

    document.querySelector(".alert .keep").click();
    await tick();

    assert.equal(server.requestFor("DELETE", CONVERSATION_URL), undefined);
    assert.equal(pendingCard().hidden, false);
  });

  test("ends the conversation with Discard and Start", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }));
    assistantButton().click();
    control("New conversation").click();

    document.querySelector(".alert .lose").click();
    await answer("DELETE", CONVERSATION_URL, 204);

    assert.equal(pendingCard().hidden, true);
  });

  test("marks the button when a reply arrives while collapsed", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION, REPLY] }));

    assert.notEqual(assistantButton().querySelector(".mark"), null);
    assert.equal(assistantButton().getAttribute("aria-label"), "Assistant, new activity");
  });

  test("clears the mark when the window opens", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION, REPLY] }));

    assistantButton().click();
    control("Collapse").click();

    assert.equal(assistantButton().querySelector(".mark"), null);
    assert.equal(assistantButton().getAttribute("aria-label"), "Assistant");
    assert.equal(stored("meals.assistant.seen"), "1");
  });

  test("works with localStorage blocked", async (t) => {
    await openWithAssistant(t, {
      beforeScript: (pageWindow) => {
        Object.defineProperty(pageWindow, "localStorage", {
          get() {
            throw new Error("Storage is off");
          },
        });
      },
    });
    assistantButton().click();
    typeInto(window, messageField(), "Plan next week.");

    control("Send").click();
    await answer("POST", "/api/assistant/conversations", 201, { id: ID });
    await answer("POST", `${CONVERSATION_URL}/messages`, 202, {});
    await answer("GET", CONVERSATION_URL, 200, conversation({ messages: [QUESTION] }));

    assert.equal(assistantWindow().hidden, false);
    assert.match(log().textContent, /Plan next week\./);
  });
});
