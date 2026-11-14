// Tests for the assistant's window (public/assistant.js), its button, and its
// skip link: opening and collapsing, the sheet on phones, what the window
// remembers, and the mark of the button. See test/assistant-window-helpers.js
// for the harness.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  answer,
  assistantButton,
  assistantWindow,
  backdrop,
  CONVERSATION_URL,
  control,
  conversation,
  DESKTOP,
  document,
  fakeVisualViewport,
  ID,
  inertParts,
  LANDSCAPE,
  log,
  messageField,
  OPEN,
  openConversation,
  openWithAssistant,
  PAGES,
  PHONE,
  QUESTION,
  REPLY,
  resize,
  STORED,
  server,
  sheetViewport,
  skipLink,
  stored,
  storedForVisit,
  window,
  windowTitle,
} from "./assistant-window-helpers.js";
import { assertFocus, pressKey, typeInto, useQuietConsole } from "./dom-helpers.js";
import { WEEK } from "./meal-plan-helpers.js";

const quiet = useQuietConsole();

/** Marks the root as the server does while the assistant is on. */
function markEnabled(pageWindow) {
  pageWindow.document.documentElement.setAttribute("data-assistant-enabled", "");
}

/** Whether the root has the mark that says that the assistant is on. */
function isMarkedEnabled() {
  return document.documentElement.hasAttribute("data-assistant-enabled");
}

/** Fails the page's check of the assistant, and answers the page's own loads. */
async function failCheck() {
  server.requestFor("GET", "/api/assistant").fail();
  await answer("GET", "/api/recipes", 200, { recipes: [] });
  await answer("GET", "/api/ingredients", 200, { ingredients: [] });
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

  test("adds the skip link Ask the assistant first in the page", async (t) => {
    await openWithAssistant(t);

    const first = document.body.firstElementChild;
    assert.ok(first === skipLink(), `the page starts with ${first?.outerHTML.slice(0, 80)}`);
  });

  test("adds no skip link when the assistant is off", async (t) => {
    await openWithAssistant(t, { assistant: false });

    assert.ok(skipLink() === undefined, "the page has a skip link");
  });

  test("opens the window with the skip link and focuses the message field", async (t) => {
    await openWithAssistant(t);

    skipLink().click();

    assert.equal(assistantWindow().hidden, false);
    assertFocus(document, messageField());
  });

  // A press on a button or in the field keeps the browser's default: a
  // button takes its own focus, and the field keeps a long press and a
  // selection. A press on an icon lands on its path.
  for (const [where, target] of /** @type {[string, () => Element][]} */ ([
    ["the icon of Attach files", () => control("Attach files").querySelector("path")],
    ["the icon of Send", () => control("Send").querySelector("path")],
    ["the message field", () => messageField()],
  ])) {
    test(`leaves the default of a press on ${where}`, async (t) => {
      await openWithAssistant(t);
      assistantButton().click();

      const init = { bubbles: true, cancelable: true };
      for (const event of [
        new window.PointerEvent("pointerdown", init),
        new window.MouseEvent("mousedown", init),
      ]) {
        target().dispatchEvent(event);
        assert.equal(event.defaultPrevented, false, `the ${event.type} must keep its default`);
      }
    });
  }

  test("focuses the message field with the skip link while the window is open", async (t) => {
    await openWithAssistant(t);
    assistantButton().click();
    control("Collapse").focus();

    skipLink().click();

    assert.equal(assistantWindow().hidden, false);
    assertFocus(document, messageField());
  });

  test("focuses the title after Ask the assistant when the pointer is coarse", async (t) => {
    await openWithAssistant(t, { pointer: "coarse" });

    skipLink().click();

    assert.equal(assistantWindow().hidden, false);
    assertFocus(document, windowTitle());
  });

  test("focuses the title again with the skip link when the pointer is coarse", async (t) => {
    await openWithAssistant(t, { pointer: "coarse" });
    assistantButton().click();
    control("Collapse").focus();

    skipLink().click();

    assertFocus(document, windowTitle());
  });

  test("leaves the hash of the page as it is after the skip link", async (t) => {
    await openWithAssistant(t, { html: "index.html" });

    skipLink().click();

    assert.equal(window.location.hash, `#${WEEK}`);
  });

  test("opens with the button and focuses the message field", async (t) => {
    await openWithAssistant(t);

    assistantButton().click();

    assert.equal(assistantWindow().hidden, false);
    assert.equal(assistantButton().getAttribute("aria-expanded"), "true");
    assertFocus(document, messageField());
  });

  test("opens with the button and focuses the title when the pointer is coarse", async (t) => {
    await openWithAssistant(t, { pointer: "coarse" });

    assistantButton().click();

    assertFocus(document, windowTitle());
  });

  // A tap on the field itself focuses it with the browser's default, which
  // happy-dom doesn't have: e2e/assistant.mobile.spec.js checks it.
  test("focuses the field with a tap in its pill when the pointer is coarse", async (t) => {
    await openWithAssistant(t, { pointer: "coarse" });
    assistantButton().click();

    assistantWindow()
      .querySelector(".message-row")
      .dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, cancelable: true }));

    assertFocus(document, messageField());
  });

  test("hides the button while the window is open", async (t) => {
    await openWithAssistant(t);

    assistantButton().click();

    assert.equal(assistantButton().hidden, true);
    assert.equal(assistantButton().getAttribute("aria-expanded"), "true");
  });

  test("shows the button again when the window collapses", async (t) => {
    await openWithAssistant(t);
    assistantButton().click();

    pressKey(window, messageField(), "Escape");

    assert.equal(assistantButton().hidden, false);
    assert.equal(assistantButton().getAttribute("aria-expanded"), "false");
  });

  test("collapses with Collapse", async (t) => {
    await openWithAssistant(t);
    assistantButton().click();

    control("Collapse").click();

    assert.equal(assistantWindow().hidden, true);
    assert.equal(assistantButton().getAttribute("aria-expanded"), "false");
  });

  test("collapses on Escape inside the window", async (t) => {
    await openWithAssistant(t);
    assistantButton().click();

    pressKey(window, messageField(), "Escape");

    assert.equal(assistantWindow().hidden, true);
  });

  test("marks the root open before the check when another page left it open", async (t) => {
    await openWithAssistant(t, { session: OPEN, answered: false });

    assert.equal(server.requestFor("GET", "/api/assistant")?.settled, false);
    assert.equal(document.documentElement.dataset.assistant, "open");
    await answer("GET", "/api/assistant", 200, { enabled: true });
    await answer("GET", "/api/recipes", 200, { recipes: [] });
    await answer("GET", "/api/ingredients", 200, { ingredients: [] });
  });

  test("leaves the root unmarked when the window was collapsed", async (t) => {
    await openWithAssistant(t, { session: { "meals.assistant.open": "false" } });

    assert.equal(document.documentElement.dataset.assistant, undefined);
  });

  test("clears the mark of the root when the assistant is off", async (t) => {
    await openWithAssistant(t, { assistant: false, session: OPEN });

    assert.equal(document.documentElement.dataset.assistant, undefined);
  });

  test("marks the root while the window is open", async (t) => {
    await openWithAssistant(t);

    assistantButton().click();
    assert.equal(document.documentElement.dataset.assistant, "open");
    control("Collapse").click();
    assert.equal(document.documentElement.dataset.assistant, undefined);
  });

  test("marks the root enabled when the check finds the assistant on", async (t) => {
    await openWithAssistant(t);

    assert.equal(isMarkedEnabled(), true);
  });

  test("removes the server's mark of the root when the check finds it off", async (t) => {
    await openWithAssistant(t, { assistant: false, beforeScript: markEnabled });

    assert.equal(isMarkedEnabled(), false);
  });

  test("removes the server's mark of the root when the check fails", async (t) => {
    quiet.expect(1);
    await openWithAssistant(t, { answered: false, beforeScript: markEnabled });

    await failCheck();

    assert.equal(isMarkedEnabled(), false);
  });

  test("adds no button when the check fails", async (t) => {
    quiet.expect(1);
    await openWithAssistant(t, { answered: false });

    await failCheck();

    assert.ok(assistantButton() === null, "the page has a button");
    assert.ok(assistantWindow() === null, "the page has a window");
  });

  test("gives back the room of a window left open when the check fails", async (t) => {
    quiet.expect(1);
    await openWithAssistant(t, { session: OPEN, answered: false });
    const root = document.documentElement;
    assert.equal(root.dataset.assistantRoom, "", "the page made no room before the check");

    await failCheck();

    assert.equal(root.dataset.assistant, undefined);
    assert.equal(root.dataset.assistantRoom, undefined);
    assert.equal(root.style.getPropertyValue("--assistant-width"), "");
  });

  test("logs that it couldn't check the assistant when the check fails", async (t) => {
    quiet.expect(1);
    await openWithAssistant(t, { answered: false });

    await failCheck();

    assert.equal(quiet.calls()[0][0], "Couldn't check the assistant:");
  });

  test("makes the page inert while the sheet is open on a phone", async (t) => {
    await openWithAssistant(t, { screen: PHONE });

    assistantButton().click();

    assert.deepEqual(inertParts(), ["sidebar", "toolbar", "page"]);
    assert.equal(assistantButton().inert, false);
    assert.equal(assistantWindow().inert, false);
  });

  test("makes the skip link inert while the sheet is open", async (t) => {
    await openWithAssistant(t, { screen: PHONE });

    assistantButton().click();

    assert.equal(skipLink().inert, true);
  });

  test("makes the page inert while the sheet is open on a short screen", async (t) => {
    await openWithAssistant(t, { screen: LANDSCAPE });

    assistantButton().click();

    assert.deepEqual(inertParts(), ["sidebar", "toolbar", "page"]);
  });

  test("leaves the page usable while the window is open on a wide screen", async (t) => {
    await openWithAssistant(t);

    assistantButton().click();

    assert.deepEqual(inertParts(), []);
  });

  test("leaves the dialogs of the page usable while the sheet is open", async (t) => {
    await openWithAssistant(t, { screen: PHONE });

    assistantButton().click();

    const dialogs = [...document.querySelectorAll("dialog")];
    assert.ok(dialogs.length > 0, "the page has dialogs");
    assert.deepEqual(
      dialogs.filter((dialog) => dialog.inert).map((dialog) => dialog.id),
      [],
    );
  });

  test("keeps the meal plan's live regions announcing while the sheet is open", async (t) => {
    await openWithAssistant(t, { html: "index.html", screen: PHONE });

    assistantButton().click();

    const regions = [...document.querySelectorAll("body > [aria-live]")];
    assert.ok(regions.length > 0, "the meal plan has a live region in its body");
    assert.deepEqual(
      regions.filter((region) => region.inert).map((region) => region.id),
      [],
    );
  });

  test("makes the page usable again when the sheet collapses", async (t) => {
    await openWithAssistant(t, { screen: PHONE });
    assistantButton().click();

    control("Collapse").click();

    assert.deepEqual(inertParts(), []);
  });

  test("makes the page usable when the open sheet gets a wide screen", async (t) => {
    await openWithAssistant(t, { screen: PHONE });
    assistantButton().click();

    resize(DESKTOP);

    assert.deepEqual(inertParts(), []);
    assert.equal(assistantWindow().hidden, false);
  });

  test("makes the page inert when the open window gets a phone screen", async (t) => {
    await openWithAssistant(t);
    assistantButton().click();

    resize(PHONE);

    assert.deepEqual(inertParts(), ["sidebar", "toolbar", "page"]);
  });

  test("makes the page usable when it unloads with the sheet open", async (t) => {
    await openWithAssistant(t, { screen: PHONE });
    assistantButton().click();

    window.dispatchEvent(new window.Event("pagehide"));

    assert.deepEqual(inertParts(), []);
  });

  test("makes the page inert again when it shows again with the sheet open", async (t) => {
    await openWithAssistant(t, { screen: PHONE });
    assistantButton().click();
    window.dispatchEvent(new window.Event("pagehide"));

    window.dispatchEvent(new window.Event("pageshow"));

    assert.deepEqual(inertParts(), ["sidebar", "toolbar", "page"]);
  });

  test("dims the page behind the sheet", async (t) => {
    await openWithAssistant(t, { screen: PHONE });
    assert.equal(backdrop().hidden, true, "the page is dimmed before the sheet opens");

    assistantButton().click();

    assert.equal(backdrop().hidden, false);
  });

  test("leaves the page undimmed behind the window on a wide screen", async (t) => {
    await openWithAssistant(t);

    assistantButton().click();

    assert.equal(backdrop().hidden, true);
  });

  test("collapses the sheet with a click on the dimmed page", async (t) => {
    await openWithAssistant(t, { screen: PHONE });
    assistantButton().click();

    backdrop().click();

    assert.equal(assistantWindow().hidden, true);
    assert.equal(backdrop().hidden, true);
    assertFocus(document, assistantButton());
  });

  test("follows the visible viewport while the sheet is open", async (t) => {
    /** @type {any} */
    let viewport;
    await openWithAssistant(t, {
      screen: PHONE,
      beforeScript: (pageWindow) => {
        viewport = fakeVisualViewport(pageWindow);
      },
    });
    assistantButton().click();
    assert.deepEqual(sheetViewport(), { height: "659px", top: "0px" });

    // The keyboard opens, and the browser scrolls the visible part.
    viewport.height = 368;
    viewport.dispatchEvent(new window.Event("resize"));
    assert.deepEqual(sheetViewport(), { height: "368px", top: "0px" });
    viewport.offsetTop = 120;
    viewport.dispatchEvent(new window.Event("scroll"));
    assert.deepEqual(sheetViewport(), { height: "368px", top: "120px" });
  });

  test("stops following the visible viewport when the sheet collapses", async (t) => {
    /** @type {any} */
    let viewport;
    await openWithAssistant(t, {
      screen: PHONE,
      beforeScript: (pageWindow) => {
        viewport = fakeVisualViewport(pageWindow);
      },
    });
    assistantButton().click();

    control("Collapse").click();
    viewport.height = 368;
    viewport.dispatchEvent(new window.Event("resize"));

    assert.equal(sheetViewport(), null);
  });

  test("leaves the window to the layout viewport on a wide screen", async (t) => {
    await openWithAssistant(t, { beforeScript: fakeVisualViewport });

    assistantButton().click();

    assert.equal(sheetViewport(), null);
  });

  test("sizes the sheet by the layout viewport without visualViewport", async (t) => {
    await openWithAssistant(t, { screen: PHONE });

    assistantButton().click();

    assert.equal(window.visualViewport, undefined, "happy-dom has a visualViewport");
    assert.equal(sheetViewport(), null);
  });

  test("remembers for the visit that the window is open", async (t) => {
    await openWithAssistant(t);

    assistantButton().click();
    assert.equal(storedForVisit("meals.assistant.open"), "true");
    control("Collapse").click();
    assert.equal(storedForVisit("meals.assistant.open"), "false");
  });

  test("starts open when another page of the visit left it open", async (t) => {
    await openWithAssistant(t, { session: OPEN });

    assert.equal(assistantWindow().hidden, false);
    assert.equal(assistantButton().getAttribute("aria-expanded"), "true");
  });

  test("fills the log before it shows the window that starts open", async (t) => {
    await openWithAssistant(t, { stored: STORED, session: OPEN });
    assert.equal(assistantWindow().hidden, true, "the window shows before the read");
    assert.equal(log().getAttribute("aria-busy"), "true");

    await answer("GET", CONVERSATION_URL, 200, conversation({ messages: [QUESTION, REPLY] }));

    assert.equal(assistantWindow().hidden, false);
    assert.equal(log().getAttribute("aria-busy"), null);
    assert.equal(log().querySelectorAll(".message").length, 2);
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

  test("keeps another tab's count of shown replies when the window opens", async (t) => {
    await openConversation(t, conversation({ messages: [QUESTION, REPLY] }));
    // Another tab started a new conversation, and stored it.
    window.localStorage.setItem("meals.assistant.conversation", "c2");
    window.localStorage.setItem("meals.assistant.seen", "3");

    assistantButton().click();

    assert.equal(stored("meals.assistant.seen"), "3");
  });

  for (const html of Object.keys(PAGES)) {
    test(`asks the browser to resize ${html} for the on-screen keyboard`, async (t) => {
      await openWithAssistant(t, { html });

      const viewport = document.querySelector('meta[name="viewport"]').getAttribute("content");

      assert.match(viewport, /(^|,\s*)interactive-widget=resizes-content(,|$)/);
    });
  }

  test("opens the window with sessionStorage blocked", async (t) => {
    await openWithAssistant(t, {
      beforeScript: (pageWindow) => {
        Object.defineProperty(pageWindow, "sessionStorage", {
          get() {
            throw new Error("Storage is off");
          },
        });
      },
    });

    assistantButton().click();

    assert.equal(assistantWindow().hidden, false);
  });

  test("sends a message and shows it with localStorage blocked", async (t) => {
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
