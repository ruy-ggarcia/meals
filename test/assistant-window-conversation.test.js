// Tests for the conversation in the assistant's window (public/assistant.js):
// the messages and the rows of an apply or a discard, the empty
// conversation, sending, attachments, reading while the assistant answers,
// failures, and New conversation. See test/assistant-window-helpers.js for
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
  APPLIED,
  answer,
  assistantButton,
  assistantWindow,
  CONVERSATION_URL,
  control,
  conversation,
  DISCARDED,
  document,
  emptyState,
  ID,
  isShown,
  log,
  logRows,
  MB,
  messageField,
  mockTimers,
  NEXT_WEEK,
  NEXT_WEEK_LINK,
  openConversation,
  openWithAssistant,
  PENDING,
  PHONE,
  page,
  pdf,
  pendingCard,
  pick,
  problemText,
  QUESTION,
  REPLY,
  readCount,
  STORED,
  send,
  server,
  settle,
  shownWeekLinks,
  stored,
  WEEK_LINK,
  window,
  windowTitle,
} from "./assistant-window-helpers.js";
import { assertFocus, pressKey, tick, typeInto, useQuietConsole, waitFor } from "./dom-helpers.js";
import { addWithEditor, answerWeekLoad, WEEK } from "./meal-plan-helpers.js";

const quiet = useQuietConsole();

/**
 * Sends `text` to the stored conversation, which the server has lost, and to
 * the new conversation that the window starts then, which the server loses
 * too.
 */
async function sendToTwoLostConversations(text) {
  const message = await send(text);
  message.respond(404, { error: "Unknown conversation: c1" });
  await answer("POST", "/api/assistant/conversations", 201, { id: "c2" });
  await answer("POST", "/api/assistant/conversations/c2/messages", 404, {
    error: "Unknown conversation: c2",
  });
  await answer("GET", "/api/assistant/conversations/c2", 404, {
    error: "Unknown conversation: c2",
  });
}

describe("assistant window", () => {
  test("keeps the message nodes when only a failed mark changes", async (t) => {
    const failed = { ...QUESTION, failed: true };
    await openConversation(
      t,
      conversation({ status: "failed", error: "provider", messages: [failed] }),
    );
    assistantButton().click();
    const before = log().querySelector(".message");

    const message = await send("Use fish.");
    message.respond(202, {});
    const next = [QUESTION, { role: "user", text: "Use fish." }];
    await answer("GET", CONVERSATION_URL, 200, conversation({ messages: next }));

    const nodes = [...log().querySelectorAll(".message")];
    assert.equal(nodes.length, 2);
    assert.ok(nodes[0] === before, "the first message got a new node");
    assert.equal(nodes[0].classList.contains("failed"), false);
  });

  test("keeps the conversation when another page loads", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION, REPLY] }));

    assert.match(log().textContent, /Plan next week\./);
    assert.match(log().textContent, /Fish on Tuesday,\nchicken on Friday\./);
  });

  test("shows what Apply saved in a row where it happened", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION, REPLY, APPLIED, QUESTION] }));

    assert.deepEqual(logRows(), [
      "You: Plan next week.",
      "Assistant: Fish on Tuesday,\nchicken on Friday.",
      "Applied: 35 slots, 4 recipes, and 6 ingredients.",
      "You: Plan next week.",
    ]);
  });

  test("shows a row after Discard", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION, REPLY, DISCARDED] }));

    assert.equal(logRows().at(-1), "Discarded the pending changes.");
  });

  test("links an applied row to each week on another page", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION, APPLIED] }));
    assistantButton().click();

    assert.deepEqual(shownWeekLinks(), [
      ["Show the week of Sep 21", WEEK_LINK],
      ["Show the week of Sep 28", NEXT_WEEK_LINK],
    ]);
  });

  test("leaves out the link to the week that the meal plan shows", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION, APPLIED] }), {
      html: "index.html",
    });
    assistantButton().click();

    assert.deepEqual(shownWeekLinks(), [["Show the week of Sep 28", NEXT_WEEK_LINK]]);
  });

  test("updates the week links when the meal plan changes the week", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION, APPLIED] }), {
      html: "index.html",
    });
    assistantButton().click();

    window.location.hash = `#${NEXT_WEEK}`;
    await waitFor(() => server.requestFor("GET", `/api/weeks/${NEXT_WEEK}`) !== undefined);
    await answerWeekLoad(server, NEXT_WEEK);

    assert.deepEqual(shownWeekLinks(), [["Show the week of Sep 21", WEEK_LINK]]);
  });

  test("updates the week links when the meal plan announces its week", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION, APPLIED] }), {
      html: "index.html",
    });
    assistantButton().click();

    window.dispatchEvent(
      new window.CustomEvent("meals:week-shown", { detail: { week: NEXT_WEEK } }),
    );

    assert.deepEqual(shownWeekLinks(), [["Show the week of Sep 21", WEEK_LINK]]);
  });

  test("keeps the week links when you stay on a week with an unsaved slot", async (t) => {
    quiet.expect(1);
    const recipes = [{ id: "r1", name: "Soup", ingredients: [], archived: false }];
    await openConversation(t, conversation({ messages: [QUESTION, APPLIED] }), {
      html: "index.html",
      recipes,
    });
    const save = await addWithEditor(page, server, "mon", "lunch", "Soup");
    save.fail();
    await tick();
    assistantButton().click();
    const alert = document.getElementById("leave-alert");

    log().querySelector(`a[href="${NEXT_WEEK_LINK}"]`).click();
    await waitFor(() => alert.open);
    alert.querySelector(".stay").click();
    await tick();

    assert.equal(document.getElementById("grid").dataset.week, WEEK);
    assert.deepEqual(shownWeekLinks(), [["Show the week of Sep 28", NEXT_WEEK_LINK]]);
  });

  test("moves the focus to the message field when the focused week link hides", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION, APPLIED] }), {
      html: "index.html",
    });
    assistantButton().click();
    const link = log().querySelector(`a[href="${NEXT_WEEK_LINK}"]`);
    link.focus();

    link.click();
    await waitFor(() => server.requestFor("GET", `/api/weeks/${NEXT_WEEK}`) !== undefined);
    await answerWeekLoad(server, NEXT_WEEK);

    assertFocus(document, messageField());
  });

  test("focuses the title after a week link hides when the pointer is coarse", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION, APPLIED] }), {
      html: "index.html",
      pointer: "coarse",
    });
    assistantButton().click();
    const link = log().querySelector(`a[href="${NEXT_WEEK_LINK}"]`);
    link.focus();

    link.click();
    await waitFor(() => server.requestFor("GET", `/api/weeks/${NEXT_WEEK}`) !== undefined);
    await answerWeekLoad(server, NEXT_WEEK);

    assertFocus(document, windowTitle());
  });

  test("changes only the hash with a week link on the meal plan at /index.html", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION, APPLIED] }), {
      html: "index.html",
      url: `http://localhost/index.html#${WEEK}`,
    });
    assistantButton().click();

    log().querySelector(`a[href="${NEXT_WEEK_LINK}"]`).click();
    await waitFor(() => server.requestFor("GET", `/api/weeks/${NEXT_WEEK}`) !== undefined);
    await answerWeekLoad(server, NEXT_WEEK);

    assert.equal(window.location.pathname, "/index.html");
    assert.equal(document.getElementById("grid").dataset.week, NEXT_WEEK);
  });

  test("collapses the sheet with a week link", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION, APPLIED] }), {
      html: "index.html",
      screen: PHONE,
    });
    assistantButton().click();

    log().querySelector(`a[href="${NEXT_WEEK_LINK}"]`).click();
    await waitFor(() => server.requestFor("GET", `/api/weeks/${NEXT_WEEK}`) !== undefined);
    await answerWeekLoad(server, NEXT_WEEK);

    assert.equal(assistantWindow().hidden, true);
  });

  test("selects the first changed day of the week with a week link", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION, APPLIED] }), {
      html: "index.html",
      screen: PHONE,
    });
    assistantButton().click();

    log().querySelector(`a[href="${NEXT_WEEK_LINK}"]`).click();
    await waitFor(() => server.requestFor("GET", `/api/weeks/${NEXT_WEEK}`) !== undefined);
    await answerWeekLoad(server, NEXT_WEEK);

    assert.equal(document.getElementById("grid").dataset.selectedDay, "wed");
    assert.equal(window.location.hash, `#${NEXT_WEEK}`);
  });

  test("selects Monday with a week link whose first changed day is Monday", async (t) => {
    const applied = { ...APPLIED, weeks: [{ week: NEXT_WEEK, day: "mon" }] };
    await openConversation(t, conversation({ messages: [QUESTION, applied] }), {
      html: "index.html",
      screen: PHONE,
    });
    document.querySelector('#day-bar button[data-day="thu"]').click();
    assistantButton().click();

    log().querySelector(".week-link").click();
    await waitFor(() => server.requestFor("GET", `/api/weeks/${NEXT_WEEK}`) !== undefined);
    await answerWeekLoad(server, NEXT_WEEK);

    assert.equal(document.getElementById("grid").dataset.selectedDay, "mon");
  });

  test("keeps the window open with a week link on a wide screen", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION, APPLIED] }), {
      html: "index.html",
    });
    assistantButton().click();

    log().querySelector(`a[href="${NEXT_WEEK_LINK}"]`).click();
    await waitFor(() => server.requestFor("GET", `/api/weeks/${NEXT_WEEK}`) !== undefined);
    await answerWeekLoad(server, NEXT_WEEK);

    assert.equal(assistantWindow().hidden, false);
  });

  test("shows a reply without the bold markers of its text", async (t) => {
    const reply = { role: "assistant", text: "**Monday:** fish." };
    await openConversation(t, conversation({ messages: [QUESTION, reply] }));

    assert.equal(logRows()[1], "Assistant: Monday: fish.");
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

  test("keeps another tab's new conversation when its own is gone", async (t) => {
    await openWithAssistant(t, { stored: { ...STORED, "meals.assistant.used": "1000" } });
    // Another tab started a new conversation, and stored it.
    window.localStorage.setItem("meals.assistant.conversation", "c2");
    window.localStorage.setItem("meals.assistant.used", "2000");
    window.localStorage.setItem("meals.assistant.seen", "1");

    await answer("GET", CONVERSATION_URL, 404, { error: "Unknown conversation" });

    assert.equal(stored("meals.assistant.conversation"), "c2");
    assert.equal(stored("meals.assistant.used"), "2000");
    assert.equal(stored("meals.assistant.seen"), "1");
  });

  test("shows a hint and examples in an empty conversation", async (t) => {
    await openWithAssistant(t);
    assistantButton().click();

    assert.equal(isShown(emptyState()), true);
    assert.equal(
      emptyState().querySelector("p").textContent,
      "Ask for a week of menus, a recipe, or changes to your ingredients. Nothing is saved until you apply it.",
    );
    assert.deepEqual(
      [...emptyState().querySelectorAll("button")].map((button) => button.textContent),
      ["Plan next week's menus", "Suggest a dinner for tonight", "Add a recipe for lentil stew"],
    );
  });

  test("hides the hint once the conversation has a message", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION] }));
    assistantButton().click();

    assert.equal(isShown(emptyState()), false);
  });

  test("shows the hint again after New conversation", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION, REPLY] }));
    assistantButton().click();

    control("New conversation").click();
    await answer("DELETE", CONVERSATION_URL, 204);

    assert.equal(isShown(emptyState()), true);
  });

  test("fills the empty message field with an example and focuses it", async (t) => {
    await openWithAssistant(t);
    assistantButton().click();
    control("Collapse").focus();

    control("Suggest a dinner for tonight").click();

    assert.equal(messageField().value, "Suggest a dinner for tonight");
    assertFocus(document, messageField());
  });

  test("focuses the title after an example when the pointer is coarse", async (t) => {
    await openWithAssistant(t, { pointer: "coarse" });
    assistantButton().click();
    control("Collapse").focus();

    control("Suggest a dinner for tonight").click();

    assert.equal(messageField().value, "Suggest a dinner for tonight");
    assertFocus(document, windowTitle());
  });

  test("sends nothing when an example is chosen", async (t) => {
    await openWithAssistant(t);
    assistantButton().click();

    control("Plan next week's menus").click();
    await tick();

    assert.deepEqual(
      server.requests.filter((request) => request.method === "POST"),
      [],
    );
  });

  test("keeps the typed text when an example is chosen", async (t) => {
    await openWithAssistant(t);
    assistantButton().click();
    typeInto(window, messageField(), "Fish on Friday.");

    control("Add a recipe for lentil stew").click();

    assert.equal(messageField().value, "Fish on Friday.");
    assertFocus(document, messageField());
  });

  test("shows a file icon by each attachment of a sent message", async (t) => {
    const message = { ...QUESTION, attachments: ["school-menu.pdf", "photo.jpg"] };
    await openConversation(t, conversation({ messages: [message] }));

    const items = [...log().querySelectorAll("li")];

    assert.equal(items.length, 2);
    for (const item of items) {
      assert.equal(item.querySelector(".file-icon svg")?.getAttribute("aria-hidden"), "true");
    }
  });

  test("reads no conversation without a stored one", async (t) => {
    await openWithAssistant(t);

    assistantButton().click();
    await tick();

    const reads = server.requests.filter((request) =>
      request.url.startsWith("/api/assistant/conversations"),
    );
    assert.deepEqual(reads, []);
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

  test("resends the attachments after the server lost the conversation", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION] }));
    assistantButton().click();
    pick([pdf("school-menu.pdf", 100).file]);

    const message = await send("Plan around the school menu.");
    message.respond(404, { error: "Unknown conversation: c1" });
    await answer("POST", "/api/assistant/conversations", 201, { id: "c2" });

    const resent = server.requestFor("POST", "/api/assistant/conversations/c2/messages");
    assert.deepEqual(resent?.body.attachments, message.body.attachments);
    assert.equal(message.body.attachments.length, 1);
    resent.respond(202, {});
    await answer("GET", "/api/assistant/conversations/c2", 200, conversation());
  });

  test("keeps the text when the new conversation is lost too", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION] }));
    assistantButton().click();

    await sendToTwoLostConversations("Plan next week.");

    assert.equal(messageField().value, "Plan next week.");
  });

  test("says the assistant couldn't answer when the new conversation is lost", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION] }));
    assistantButton().click();

    await sendToTwoLostConversations("Plan next week.");

    assert.equal(problemText(), "The assistant couldn't answer.");
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

  test("shows the server's message when it rejects a message as invalid", async (t) => {
    await openConversation(t, conversation());
    assistantButton().click();

    const message = await send("Plan next week.");
    message.respond(400, { error: '"menu.gif" isn\'t a PDF, a JPEG, or a PNG.' });
    await answer("GET", CONVERSATION_URL, 200, conversation());

    assert.equal(problemText(), '"menu.gif" isn\'t a PDF, a JPEG, or a PNG.');
  });

  // Express names a body over its limit in its own words, which mean
  // nothing to the family.
  test("says Couldn't send the message. Try again. when it's too large", async (t) => {
    await openConversation(t, conversation());
    assistantButton().click();

    const message = await send("Plan next week.");
    message.respond(413, { error: "request entity too large" });
    await answer("GET", CONVERSATION_URL, 200, conversation());

    assert.equal(problemText(), "Couldn't send the message. Try again.");
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
    assert.deepEqual(Object.keys(attachment), ["name", "data"]);
    assert.equal(attachment.name, "school-menu.pdf");
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

  test("focuses the message field after removing a file", async (t) => {
    await openWithAssistant(t);
    assistantButton().click();
    pick([pdf("a.pdf", 10).file]);

    control("Remove a.pdf").click();

    assertFocus(document, messageField());
  });

  test("focuses the title after removing a file when the pointer is coarse", async (t) => {
    await openWithAssistant(t, { pointer: "coarse" });
    assistantButton().click();
    pick([pdf("a.pdf", 10).file]);

    control("Remove a.pdf").click();

    assertFocus(document, windowTitle());
  });

  test("rejects a sixth attachment before it sends", async (t) => {
    await openWithAssistant(t);
    assistantButton().click();
    pick(Array.from({ length: 5 }, (_, index) => pdf(`${index}.pdf`, 10).file));

    pick([pdf("5.pdf", 10).file]);

    assert.equal(problemText(), "A message holds at most 5 attachments.");
    assert.equal(assistantWindow().querySelectorAll(".attachment-chip").length, 5);
  });

  test("shows a problem of the message field with a warning icon", async (t) => {
    await openWithAssistant(t);
    assistantButton().click();
    pick(Array.from({ length: 6 }, (_, index) => pdf(`${index}.pdf`, 10).file));

    const problem = assistantWindow().querySelector(".message-composer [role='alert']");

    assert.equal(problem.textContent, "A message holds at most 5 attachments.");
    assert.notEqual(problem.querySelector(".warning-icon"), null);
  });

  test("clears the warning icon with the problem of the message field", async (t) => {
    await openWithAssistant(t);
    assistantButton().click();
    pick(Array.from({ length: 6 }, (_, index) => pdf(`${index}.pdf`, 10).file));

    pick([pdf("a.pdf", 10).file]);

    const problem = assistantWindow().querySelector(".message-composer [role='alert']");
    assert.equal(problem.childNodes.length, 0);
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

  test("keeps another tab's count of sent bytes when it sends a file", async (t) => {
    await openConversation(t, conversation());
    // Another tab started a new conversation, and stored it.
    window.localStorage.setItem("meals.assistant.conversation", "c2");
    window.localStorage.setItem("meals.assistant.used", "2000");
    assistantButton().click();
    pick([pdf("a.pdf", MB).file]);

    const message = await send("Plan next week.");
    message.respond(202, {});
    await answer("GET", CONVERSATION_URL, 200, conversation());

    assert.equal(stored("meals.assistant.used"), "2000");
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

  test("disables Send, New conversation, Apply, and Discard while sending", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION, REPLY], pending: PENDING }));
    assistantButton().click();

    const message = await send("Plan next week.");

    for (const name of ["Send", "New conversation", "Apply", "Discard"]) {
      assert.equal(control(name).disabled, true, `${name} while the message sends`);
    }
    message.respond(202, {});
    await answer("GET", CONVERSATION_URL, 200, conversation({ messages: [QUESTION, REPLY] }));
  });

  // A browser moves the focus off a disabled control at a time of its own, to
  // <body>, so the focus must leave Send before Send turns off.
  test("moves the focus from Send to the message field while sending", async (t) => {
    await openConversation(t, conversation());
    assistantButton().click();
    control("Send").focus();

    const message = await send("Plan next week.");

    assertFocus(document, messageField());
    message.respond(202, {});
    await answer("GET", CONVERSATION_URL, 200, conversation());
  });

  test("moves the focus from Send to the title when the pointer is coarse", async (t) => {
    await openConversation(t, conversation(), { pointer: "coarse" });
    assistantButton().click();
    control("Send").focus();

    const message = await send("Plan next week.");

    assertFocus(document, windowTitle());
    message.respond(202, {});
    await answer("GET", CONVERSATION_URL, 200, conversation());
  });

  // As in Safari, which doesn't focus a button that you click.
  test("focuses the message field after a click on Send that focuses nothing", async (t) => {
    await openConversation(t, conversation());
    assistantButton().click();
    document.activeElement.blur();

    const message = await send("Plan next week.");
    message.respond(202, {});
    await answer("GET", CONVERSATION_URL, 200, conversation());

    assertFocus(document, messageField());
  });

  test("moves the focus from Send to the message field once Thinking… shows", async (t) => {
    await openWithAssistant(t, { stored: STORED });
    mockTimers(t);
    assistantButton().click();
    control("Send").focus();

    server.requestFor("GET", CONVERSATION_URL).respond(200, conversation({ status: "working" }));
    await settle();

    assertFocus(document, messageField());
  });

  test("disables Send, New conversation, Apply, and Discard while Apply runs", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION, REPLY], pending: PENDING }));
    assistantButton().click();

    control("Apply").click();

    for (const name of ["Send", "New conversation", "Apply", "Discard"]) {
      assert.equal(control(name).disabled, true, `${name} while Apply runs`);
    }
    await answer("POST", `${CONVERSATION_URL}/apply`, 200, { applied: true });
    await answer("GET", CONVERSATION_URL, 200, conversation({ messages: [QUESTION, REPLY] }));
    await answer("GET", "/api/recipes", 200, { recipes: [] });
    await answer("GET", "/api/ingredients", 200, { ingredients: [] });
  });

  test("disables Retry while Retry runs", async (t) => {
    const message = { ...QUESTION, failed: true };
    await openConversation(
      t,
      conversation({ status: "failed", error: "provider", messages: [message] }),
    );
    assistantButton().click();

    control("Retry").click();

    assert.equal(control("Retry").disabled, true);
    await answer("POST", `${CONVERSATION_URL}/retry`, 202, {});
    await answer("GET", CONVERSATION_URL, 200, conversation({ messages: [QUESTION, REPLY] }));
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

  test("shows the answer of the latest read when an earlier one answers last", async (t) => {
    await openWithAssistant(t, { stored: STORED });
    const earlier = server.requestFor("GET", CONVERSATION_URL);
    assistantButton().click();
    const message = await send("Plan next week.");
    message.respond(202, {});
    await waitFor(() => readCount() === 2);

    await answer("GET", CONVERSATION_URL, 200, conversation({ messages: [QUESTION, REPLY] }));
    earlier.respond(200, conversation());
    await tick();

    assert.deepEqual(logRows(), [
      "You: Plan next week.",
      "Assistant: Fish on Tuesday,\nchicken on Friday.",
    ]);
  });

  test("ignores a read in flight after New conversation", async (t) => {
    await openWithAssistant(t, { stored: STORED });
    const inFlight = server.requestFor("GET", CONVERSATION_URL);
    assistantButton().click();

    control("New conversation").click();
    await answer("DELETE", CONVERSATION_URL, 204);
    inFlight.respond(200, conversation({ messages: [QUESTION, REPLY] }));
    await tick();

    assert.equal(log().textContent, "");
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

  test("shows a warning icon in the row of a failed answer", async (t) => {
    const message = { ...QUESTION, failed: true };
    await openConversation(
      t,
      conversation({ status: "failed", error: "provider", messages: [message] }),
    );

    assert.notEqual(log().lastElementChild.querySelector(".warning-icon"), null);
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

  test("offers New conversation without Retry when it's too long", async (t) => {
    const message = { ...QUESTION, failed: true };
    const view = conversation({ status: "failed", error: "too_long", messages: [message] });
    await openConversation(t, view);

    const row = log().lastElementChild;
    assert.equal(
      row.querySelector("p").textContent,
      "This conversation is too long. Start a new conversation.",
    );
    assert.deepEqual(
      [...row.querySelectorAll("button")].map((button) => button.textContent),
      ["New conversation"],
    );
  });

  test("starts a new conversation from the row of a too long one", async (t) => {
    const message = { ...QUESTION, failed: true };
    const view = conversation({ status: "failed", error: "too_long", messages: [message] });
    await openConversation(t, view);
    assistantButton().click();

    log().querySelector("button").click();
    await answer("DELETE", CONVERSATION_URL, 204);

    assert.equal(log().textContent, "");
    assertFocus(document, messageField());
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

  test("focuses the title after Retry when the pointer is coarse", async (t) => {
    const message = { ...QUESTION, failed: true };
    await openConversation(
      t,
      conversation({ status: "failed", error: "provider", messages: [message] }),
      { pointer: "coarse" },
    );
    assistantButton().click();

    control("Retry").focus();
    control("Retry").click();
    await answer("POST", `${CONVERSATION_URL}/retry`, 202, {});
    await answer("GET", CONVERSATION_URL, 200, conversation({ messages: [QUESTION, REPLY] }));

    assertFocus(document, windowTitle());
  });

  test("ends the conversation with New conversation", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION, REPLY] }));
    assistantButton().click();

    control("New conversation").click();
    await answer("DELETE", CONVERSATION_URL, 204);

    assert.equal(log().textContent, "");
    assert.equal(stored("meals.assistant.conversation"), null);
  });

  test("focuses the message field after New conversation", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION, REPLY] }));
    assistantButton().click();

    control("New conversation").click();
    await answer("DELETE", CONVERSATION_URL, 204);

    assertFocus(document, messageField());
  });

  test("focuses the title after New conversation when the pointer is coarse", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION, REPLY] }), {
      pointer: "coarse",
    });
    assistantButton().click();

    control("New conversation").click();
    await answer("DELETE", CONVERSATION_URL, 204);

    assertFocus(document, windowTitle());
  });

  test("shows the empty conversation after New conversation in the details", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION, REPLY], pending: PENDING }));
    assistantButton().click();
    control("View details").click();

    control("New conversation").click();
    document.querySelector(".alert .lose").click();
    await answer("DELETE", CONVERSATION_URL, 204);

    assert.equal(isShown(pendingCard()), false);
    assert.equal(isShown(control("Back")), false);
    assert.equal(isShown(emptyState()), true);
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
});
