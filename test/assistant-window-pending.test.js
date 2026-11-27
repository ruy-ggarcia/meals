// Tests for the card of the pending changes in the assistant's window
// (public/assistant.js): the summary, View details, Apply, and Discard. See
// test/assistant-window-helpers.js for the harness.
//
// The window reads the conversation again a second after each answer while
// the assistant answers, and after a failed read during an answer. A test
// that leaves either state mocks setTimeout before the answer, so no read
// ever waits for real time, and no timer outlives the test. After that, it
// waits with settle(), because tick() waits on setTimeout too.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  answer,
  assistantButton,
  assistantWindow,
  CONVERSATION_URL,
  cardProblemText,
  control,
  conversation,
  detailItems,
  document,
  isShown,
  log,
  messageField,
  mockTimers,
  NEXT_WEEK,
  openConversation,
  openWithAssistant,
  PENDING,
  page,
  pendingCard,
  pendingSlots,
  problemText,
  QUESTION,
  REPLY,
  rejectApply,
  STORED,
  send,
  server,
  settle,
  window,
  windowTitle,
} from "./assistant-window-helpers.js";
import { assertFocus, pressKey, tick, useQuietConsole, waitFor } from "./dom-helpers.js";
import { addWithEditor, answerWeekLoad, slotButton, WEEK } from "./meal-plan-helpers.js";

const quiet = useQuietConsole();

describe("assistant window", () => {
  test("summarizes the pending changes on a card", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION, REPLY], pending: PENDING }));

    const lines = [...pendingCard().querySelectorAll(".pending-summary li")].map(
      (line) => line.textContent,
    );

    assert.deepEqual(lines, ["Week of Sep 21: 1 slot", "1 new recipe"]);
  });

  test("summarizes the pending changes in one line for short screens", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION, REPLY], pending: PENDING }));

    const line = pendingCard().querySelector(".pending-line");

    assert.equal(line.textContent, "1 slot, 1 new recipe");
  });

  test("heads each group of the details with its line of the summary", async (t) => {
    const pending = [PENDING[1], PENDING[0]];
    await openConversation(t, conversation({ pending }));
    assistantButton().click();

    control("View details").click();

    const groups = [...pendingCard().querySelectorAll(".pending-group")].map((group) => [
      group.querySelector("h4").textContent,
      [...group.querySelectorAll(".pending-change-title")].map((title) => title.textContent),
    ]);
    assert.deepEqual(groups, [
      ["Week of Sep 21: 1 slot", ["Tuesday, Sep 22 · Dinner"]],
      ["1 new recipe", ["New recipe: Pumpkin soup"]],
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
    assert.equal(isShown(details), true);
    assert.match(details.textContent, /Tuesday, Sep 22 · Dinner/);
    assert.match(details.textContent, /Grilled fish × 4/);
    assert.match(details.textContent, /Pumpkin: 200 g/);
  });

  test("shows the details in place of the conversation", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION, REPLY], pending: PENDING }));
    assistantButton().click();

    control("View details").click();

    assert.equal(isShown(log()), false, "the log shows");
    assert.equal(isShown(messageField()), false, "the message field shows");
    assert.equal(isShown(pendingCard().querySelector(".pending-summary")), false);
    assert.equal(isShown(control("View details")), false);
  });

  test("keeps Discard and Apply in the details", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }));
    assistantButton().click();

    control("View details").click();

    assert.equal(isShown(control("Discard")), true);
    assert.equal(isShown(control("Apply")), true);
  });

  test("shows Back only in the details", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }));
    assistantButton().click();
    assert.equal(isShown(control("Back")), false, "Back shows in the conversation");

    control("View details").click();

    assert.equal(isShown(control("Back")), true);
  });

  test("moves the focus to Back when the details open", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }));
    assistantButton().click();

    control("View details").focus();
    control("View details").click();

    assertFocus(document, control("Back"));
  });

  test("returns to the conversation with Back and focuses View details", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION, REPLY], pending: PENDING }));
    assistantButton().click();
    control("View details").click();

    control("Back").click();

    assert.equal(isShown(log()), true, "the log is hidden");
    assert.equal(isShown(messageField()), true, "the message field is hidden");
    assert.equal(isShown(pendingCard().querySelector(".pending-details")), false);
    assertFocus(document, control("View details"));
  });

  test("goes Back on Escape in the details", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }));
    assistantButton().click();
    control("View details").click();

    pressKey(window, control("Back"), "Escape");

    assert.equal(assistantWindow().hidden, false);
    assert.equal(isShown(messageField()), true);
    assertFocus(document, control("View details"));
  });

  test("collapses on a second Escape after the details", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }));
    assistantButton().click();
    control("View details").click();
    pressKey(window, control("Back"), "Escape");

    pressKey(window, control("View details"), "Escape");

    assert.equal(assistantWindow().hidden, true);
    assertFocus(document, assistantButton());
  });

  test("opens on the conversation after it collapsed from the details", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }));
    assistantButton().click();
    control("View details").click();
    control("Collapse").click();

    assistantButton().click();

    assert.equal(isShown(messageField()), true);
    assertFocus(document, messageField());
  });

  test("shows the conversation when the details lose their changes", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }));
    assistantButton().click();
    control("View details").click();

    control("Discard").click();
    await answer("POST", `${CONVERSATION_URL}/discard`, 200, {});
    await answer("GET", CONVERSATION_URL, 200, conversation());

    assert.equal(pendingCard().hidden, true);
    assert.equal(isShown(log()), true);
    assertFocus(document, messageField());
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

  test("sends the revision of the pending changes that it shows with Apply", async (t) => {
    await openConversation(t, conversation({ pending: PENDING, revision: 3 }));
    assistantButton().click();

    control("Apply").click();
    await answer("POST", `${CONVERSATION_URL}/apply`, 200, { applied: true });
    await answer("GET", CONVERSATION_URL, 200, conversation({ revision: 4 }));
    await answer("GET", "/api/recipes", 200, { recipes: [] });
    await answer("GET", "/api/ingredients", 200, { ingredients: [] });

    assert.deepEqual(server.requestFor("POST", `${CONVERSATION_URL}/apply`).body, {
      revision: 3,
    });
  });

  test("shows the new pending changes after they changed before Apply", async (t) => {
    await openConversation(t, conversation({ pending: PENDING, revision: 3 }));
    assistantButton().click();

    control("Apply").click();
    await answer("POST", `${CONVERSATION_URL}/apply`, 409, {
      error: "The pending changes changed. Review them again.",
    });
    await answer(
      "GET",
      CONVERSATION_URL,
      200,
      conversation({ pending: [PENDING[1]], revision: 4 }),
    );

    const lines = [...pendingCard().querySelectorAll(".pending-summary li")].map(
      (line) => line.textContent,
    );
    assert.deepEqual(lines, ["1 new recipe"]);
    assert.equal(cardProblemText(), "The pending changes changed. Review them again.");
  });

  test("shows each problem on its pending change after a rejected Apply", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }));
    assistantButton().click();

    await rejectApply();

    const changes = detailItems();
    assert.equal(isShown(pendingCard().querySelector(".pending-details")), true);
    assert.equal(changes[0].querySelector(".pending-problem"), null);
    assert.equal(
      changes[1].querySelector(".pending-problem").textContent,
      '"Pumpkin soup" already exists.',
    );
  });

  test("shows the problem of a pending change right below its title", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }));
    assistantButton().click();

    await rejectApply();

    const parts = [...detailItems()[1].children].map((child) => child.className);
    assert.deepEqual(parts, ["pending-change-title", "pending-problem", "pending-change-lines"]);
  });

  test("says how many changes have a problem after a rejected Apply", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }));
    assistantButton().click();

    await rejectApply();

    const count = pendingCard().querySelector(".pending-problem-count");
    assert.equal(count.textContent, "1 change has a problem");
    assert.equal(pendingCard().getAttribute("aria-describedby"), count.id);
  });

  test("shows the error of a rejected Apply in the card", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }));
    assistantButton().click();

    await rejectApply();

    assert.equal(cardProblemText(), "The pending changes couldn't be applied.");
    const error = pendingCard().querySelector("[role='alert']");
    const actions = control("Apply").parentElement;
    assert.ok(
      error.compareDocumentPosition(actions) & window.Node.DOCUMENT_POSITION_FOLLOWING,
      "the error isn't above Discard and Apply",
    );
    assert.equal(problemText(), "");
  });

  test("keeps the error of a rejected Apply while its problem shows", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }));
    assistantButton().click();
    await rejectApply();
    control("Back").click();

    const message = await send("Why?");
    message.respond(202, {});
    // The server describes the failed change again, with lines that the
    // stored data changed, and keeps its problem.
    const redescribed = {
      ...PENDING[1],
      ingredients: [{ name: "Butternut pumpkin", quantity: 200, unit: "g" }],
      problem: '"Pumpkin soup" already exists.',
    };
    await answer(
      "GET",
      CONVERSATION_URL,
      200,
      conversation({ pending: [PENDING[0], redescribed] }),
    );

    assert.equal(cardProblemText(), "The pending changes couldn't be applied.");
  });

  test("clears the error of a rejected Apply when its problem clears", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }));
    assistantButton().click();
    await rejectApply();
    control("Back").click();

    const message = await send("Why?");
    message.respond(202, {});
    await answer("GET", CONVERSATION_URL, 200, conversation({ pending: PENDING }));

    assert.equal(cardProblemText(), "");
  });

  test("says that some changes may be saved after Apply fails partway", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }));
    assistantButton().click();

    control("Apply").click();
    await answer("POST", `${CONVERSATION_URL}/apply`, 500, {
      error: "Internal server error",
      code: "partly_saved",
    });
    await answer("GET", "/api/recipes", 200, { recipes: [] });
    await answer("GET", "/api/ingredients", 200, { ingredients: [] });
    await answer("GET", CONVERSATION_URL, 200, conversation({ pending: PENDING }));

    assert.equal(
      cardProblemText(),
      "Some changes may already be saved. Check the meal plan before you apply again, or select Discard.",
    );
  });

  // The server writes its message for the family only for a 400 or a 409.
  test("says Couldn't apply the changes. Try again. after another failed Apply", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }));
    assistantButton().click();

    control("Apply").click();
    await answer("POST", `${CONVERSATION_URL}/apply`, 500, { error: "Internal server error" });
    await answer("GET", CONVERSATION_URL, 200, conversation({ pending: PENDING }));

    assert.equal(cardProblemText(), "Couldn't apply the changes. Try again.");
  });

  test("focuses the first change with a problem after a rejected Apply", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }));
    assistantButton().click();

    await rejectApply();

    assertFocus(document, detailItems()[1]);
  });

  test("opens View details at the first change with a problem", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }));
    assistantButton().click();
    await rejectApply();
    control("Back").click();

    control("View details").click();

    assertFocus(document, detailItems()[1]);
  });

  test("shows the problems that the conversation recorded", async (t) => {
    const pending = [PENDING[0], { ...PENDING[1], problem: '"Pumpkin soup" already exists.' }];
    await openConversation(t, conversation({ pending }));

    assert.equal(
      pendingCard().querySelector(".pending-problem-count").textContent,
      "1 change has a problem",
    );
  });

  test("moves the focus to Back when the focused change of the details goes", async (t) => {
    const pending = [PENDING[0], { ...PENDING[1], problem: '"Pumpkin soup" already exists.' }];
    await openWithAssistant(t, { stored: STORED });
    mockTimers(t);
    const view = conversation({ status: "working", messages: [QUESTION], pending });
    server.requestFor("GET", CONVERSATION_URL).respond(200, view);
    await settle();
    assistantButton().click();
    control("View details").click();
    assertFocus(document, detailItems()[1], "before the read");

    t.mock.timers.tick(1000);
    await settle();
    server
      .requestFor("GET", CONVERSATION_URL)
      .respond(200, conversation({ messages: [QUESTION, REPLY], pending: [PENDING[0]] }));
    await settle();

    assertFocus(document, control("Back"));
  });

  test("lets the keyboard reach the details to scroll them", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }));
    assistantButton().click();

    control("View details").click();

    const details = pendingCard().querySelector(".pending-details");
    assert.equal(details.tabIndex, 0);
    assert.equal(details.getAttribute("aria-label"), "Pending changes details");
  });

  test("discards the pending changes with Discard", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }));
    assistantButton().click();

    control("Discard").click();
    await answer("POST", `${CONVERSATION_URL}/discard`, 200, {});
    await answer("GET", CONVERSATION_URL, 200, conversation());

    assert.equal(pendingCard().hidden, true);
  });

  test("discards three pending changes without asking", async (t) => {
    await openConversation(t, conversation({ pending: pendingSlots(3) }));
    assistantButton().click();

    control("Discard").click();

    assert.equal(document.querySelector(".alert"), null);
    await answer("POST", `${CONVERSATION_URL}/discard`, 200, {});
    await answer("GET", CONVERSATION_URL, 200, conversation());
  });

  test("asks before Discard loses more than three pending changes", async (t) => {
    await openConversation(t, conversation({ pending: pendingSlots(4) }));
    assistantButton().click();

    control("Discard").click();

    const alert = document.querySelector(".alert");
    assert.equal(alert.open, true);
    assert.equal(alert.querySelector(".alert-title").textContent, "Discard the pending changes?");
    assert.equal(
      alert.querySelector(".alert-message").textContent,
      "The assistant's changes aren't saved. If you discard them, they're lost.",
    );
    assert.equal(alert.querySelector(".keep").textContent, "Keep Changes");
    assert.equal(alert.querySelector(".lose").textContent, "Discard");
  });

  test("keeps the pending changes with Keep Changes", async (t) => {
    await openConversation(t, conversation({ pending: pendingSlots(4) }));
    assistantButton().click();
    control("Discard").click();

    document.querySelector(".alert .keep").click();
    await tick();

    assert.equal(server.requestFor("POST", `${CONVERSATION_URL}/discard`), undefined);
    assert.equal(pendingCard().hidden, false);
  });

  test("discards the pending changes with Discard in the alert", async (t) => {
    await openConversation(t, conversation({ pending: pendingSlots(4) }));
    assistantButton().click();
    control("Discard").click();

    document.querySelector(".alert .lose").click();
    await answer("POST", `${CONVERSATION_URL}/discard`, 200, {});
    await answer("GET", CONVERSATION_URL, 200, conversation());

    assert.equal(pendingCard().hidden, true);
  });

  test("focuses the title after Discard when the pointer is coarse", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }), { pointer: "coarse" });
    assistantButton().click();

    control("Discard").focus();
    control("Discard").click();
    await answer("POST", `${CONVERSATION_URL}/discard`, 200, {});
    await answer("GET", CONVERSATION_URL, 200, conversation());

    assertFocus(document, windowTitle());
  });

  test("focuses the title after Apply when the pointer is coarse", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }), { pointer: "coarse" });
    assistantButton().click();

    control("Apply").focus();
    control("Apply").click();
    await answer("POST", `${CONVERSATION_URL}/apply`, 200, { applied: true });
    await answer("GET", CONVERSATION_URL, 200, conversation());
    await answer("GET", "/api/recipes", 200, { recipes: [] });
    await answer("GET", "/api/ingredients", 200, { ingredients: [] });

    assertFocus(document, windowTitle());
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

  test("reloads the recipes after Apply fails partway", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }));
    assistantButton().click();

    control("Apply").click();
    await answer("POST", `${CONVERSATION_URL}/apply`, 500, {
      error: "Internal server error",
      code: "partly_saved",
    });

    await answer("GET", "/api/recipes", 200, {
      recipes: [{ id: "r9", name: "Pumpkin soup", ingredients: [], archived: false }],
    });
    await answer("GET", "/api/ingredients", 200, { ingredients: [] });
    await answer("GET", CONVERSATION_URL, 200, conversation({ pending: PENDING }));
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

  test("reloads the week after Apply when a week change was running", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }), { html: "index.html" });
    document.getElementById("next-week").click();
    await waitFor(() => server.requestFor("GET", `/api/weeks/${NEXT_WEEK}`) !== undefined);

    control("Apply").click();
    await answer("POST", `${CONVERSATION_URL}/apply`, 200, { applied: true });
    await answer("GET", CONVERSATION_URL, 200, conversation());
    await answerWeekLoad(server, NEXT_WEEK);

    const weekLoads = server.requests.filter(
      (request) => request.url === `/api/weeks/${NEXT_WEEK}`,
    );
    assert.equal(weekLoads.length, 2);
    await answerWeekLoad(server, NEXT_WEEK);
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

  test("keeps the week while the shopping list is open after Apply", async (t) => {
    await openConversation(t, conversation({ pending: PENDING }), { html: "index.html" });
    control("Apply").click();
    document.getElementById("shopping-list").click();

    await answer("POST", `${CONVERSATION_URL}/apply`, 200, { applied: true });
    await answer("GET", CONVERSATION_URL, 200, conversation());

    const weekLoads = server.requests.filter((request) => request.url === `/api/weeks/${WEEK}`);
    assert.equal(weekLoads.length, 1);
  });
});
