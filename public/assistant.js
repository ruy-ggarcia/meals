// The assistant's window: a round button in the lower right corner of every
// page, and the chat that it opens. On a wide screen, the window isn't modal,
// so the page behind it stays usable. On a phone, and on any screen 500 px
// tall or less, it's a sheet over the dimmed page, which is inert while the
// sheet is open. The window keeps the conversation's identifier, how many
// replies it showed, and the bytes of the files it sent in localStorage, so
// the next page shows the same conversation, and whether it's open in
// sessionStorage, so it stays open across the pages of one visit, but a new
// visit starts collapsed. A skip link, the first stop of the keyboard, opens
// it. While the assistant answers, the window reads the conversation again
// every second.

import { askBeforeLosing } from "./alert.js";
import {
  attachmentProblem,
  displayedWeek,
  eventText,
  groupPending,
  hasMark,
  isMealPlan,
  pendingDetail,
  problemCount,
  summarize,
  summaryLine,
  weekLinkText,
  withoutBold,
} from "./assistant-view.js";
import { dateIdOf } from "./dates.js";
import { createElement, createWarningIcon, focusIsFree } from "./dom.js";
import { getJson, sendJson, UPLOAD_TIMEOUT_MS } from "./http.js";

const CONVERSATION_KEY = "meals.assistant.conversation";
const OPEN_KEY = "meals.assistant.open";
const SEEN_KEY = "meals.assistant.seen";
const USED_KEY = "meals.assistant.used";

const CONVERSATIONS_URL = "/api/assistant/conversations";
const POLL_MS = 1000;

// The media queries of styles.css that make the window a sheet: either one
// does.
const SHEET_QUERIES = ["(max-width: 699.98px)", "(max-height: 500px)"];

// A primary pointer that's precise, such as a mouse or a trackpad, unlike a
// finger on a phone or a tablet.
export const PRECISE_POINTER = "(pointer: fine)";

// The page makes room for the open window, as it does for the sidebar, when
// the grid of the meal plan keeps its minimum width beside the window: the
// grid's 780 px, the page's padding of 12 px and 16 px, and the window's
// margin of 16 px. The window takes what's left, from 360 px up to its full
// 400 px. Narrower, it floats over the page.
const ROOM = { grid: 780, padding: 12 + 16, margin: 16, narrowest: 360, widest: 400 };

// Discard asks first when it would lose more pending changes than this.
const DISCARD_WITHOUT_ASKING = 3;

// What the row of a failed answer says, and the button that it offers.
const FAILURES = {
  limit: { text: "The assistant took too long.", action: "retry" },
  provider: { text: "The assistant couldn't answer.", action: "retry" },
  too_long: { text: "This conversation is too long. Start a new conversation.", action: "new" },
};

const EXAMPLES = [
  "Plan next week's menus",
  "Suggest a dinner for tonight",
  "Add a recipe for lentil stew",
];

const GONE = "This conversation has ended.";

/**
 * The card's error after an Apply that failed when part of the changes may
 * be saved. The server marks that failure with the code partly_saved.
 */
const PARTLY_SAVED =
  "Some changes may already be saved. Check the meal plan before you apply again, or select Discard.";

/** A conversation that hasn't started. */
const EMPTY = { status: "idle", messages: [], pending: [] };

// static markup, never user text: a page with a folded corner.
const FILE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M13.5 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z"/><path d="M13.5 3.5V9H19"/></svg>';

// static markup, never user text
const BUTTON_MARKUP =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 4c4.7 0 8.5 3.1 8.5 7s-3.8 7-8.5 7c-1 0-2-.1-2.9-.4L5 19.5l1.2-3.4C4.6 14.8 3.5 13 3.5 11c0-3.9 3.8-7 8.5-7z"/></svg>';

// static markup, never user text. The card of the pending changes takes its
// name from aria-label, not from aria-labelledby on its heading: Firefox
// crashed in testing when axe read the card's ariaLabelledByElements after
// the window showed pending changes.
//
// The card has two views. In the conversation, it shows the summary, which
// scrolls when it doesn't fit, above its footer, or on a short screen, the
// summary in one line. View details replaces the conversation with the
// details, grouped under the lines of the summary, which scroll below the
// card's header, with Back, and above the same footer. The footer, with the
// error of Apply or Discard and the two buttons, stays in view in both while
// the window has room for it. The details take the focus themselves, so the
// keyboard can scroll them when no change in them can take it.
const WINDOW_MARKUP = `
  <div class="assistant-header">
    <h2 class="assistant-title" tabindex="-1">Assistant</h2>
    <button type="button" class="new-conversation glass icon-button" aria-label="New conversation" title="New conversation">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M11 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V13"/><path d="M17.6 3.9a2.1 2.1 0 0 1 3 3L12.5 15l-4 1 1-4z"/></svg>
    </button>
    <button type="button" class="collapse glass icon-button" aria-label="Collapse" title="Collapse">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 9l7 7 7-7"/></svg>
    </button>
  </div>
  <div class="assistant-empty">
    <p class="assistant-hint">Ask for a week of menus, a recipe, or changes to your ingredients. Nothing is saved until you apply it.</p>
    <ul class="assistant-examples" aria-label="Examples"></ul>
  </div>
  <div class="assistant-messages" role="log" aria-label="Messages"></div>
  <section class="pending-card" aria-label="Pending changes" aria-describedby="pending-problem-count" hidden>
    <div class="pending-header">
      <button type="button" class="details-back" hidden>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 5l-7 7 7 7"/></svg>Back
      </button>
      <h3 class="pending-title">Pending changes</h3>
      <p id="pending-problem-count" class="pending-problem-count"></p>
    </div>
    <div class="pending-body">
      <ul class="pending-summary"></ul>
      <p class="pending-line"></p>
      <button type="button" class="view-details">View details</button>
    </div>
    <ul class="pending-details" tabindex="0" aria-label="Pending changes details" hidden></ul>
    <div class="pending-footer">
      <p class="pending-error" role="alert"></p>
      <div class="pending-actions">
        <button type="button" class="discard">Discard</button>
        <button type="button" class="apply">Apply</button>
      </div>
    </div>
  </section>
  <div class="message-composer">
    <div class="composer-notes">
      <p class="assistant-problem" role="alert"></p>
      <ul class="attachment-chips" aria-label="Attachments" hidden></ul>
    </div>
    <div class="message-row">
      <button type="button" class="attach icon-button" aria-label="Attach files" title="Attach files">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M19 11.5l-7.4 7.4a4.5 4.5 0 0 1-6.4-6.4l7.8-7.8a3 3 0 0 1 4.2 4.2l-7.8 7.8a1.5 1.5 0 0 1-2.1-2.1l7.1-7.1"/></svg>
      </button>
      <input type="file" class="attach-input" multiple accept="application/pdf,image/jpeg,image/png" hidden>
      <textarea class="message-field" aria-label="Message" placeholder="Message" rows="1"></textarea>
      <button type="button" class="send icon-button" aria-label="Send" title="Send">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 19V5M6 11l6-6 6 6"/></svg>
      </button>
    </div>
  </div>`;

// The value of `key` in `area`, localStorage or sessionStorage, or null when
// there's none or the browser blocks storage.
function readStored(key, area = "localStorage") {
  try {
    return window[area].getItem(key);
  } catch {
    return null;
  }
}

// Stores `value` under `key` in `area`, or removes the key for null.
function store(key, value, area = "localStorage") {
  try {
    if (value === null) window[area].removeItem(key);
    else window[area].setItem(key, String(value));
  } catch {
    // The value lasts until the page closes.
  }
}

// A stored count, or 0 when there's none.
function readCount(key) {
  const count = Number(readStored(key));
  return Number.isFinite(count) && count > 0 ? count : 0;
}

// The content of `file` as plain base64, as the server reads it.
function base64Of(file) {
  return new Promise((resolve, reject) => {
    const reader = new window.FileReader();
    reader.addEventListener("load", () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    });
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

// The message of a response that the server rejected, or `fallback`. The
// server writes the message of a 400 or a 409 for the family; any other
// message, such as a 500's or Express's 413, means nothing to them.
function errorOf({ status, body }, fallback) {
  const forFamily = status === 400 || status === 409;
  return forFamily && typeof body?.error === "string" ? body.error : fallback;
}

/**
 * Builds the skip link at the start of the page, and the button, the layer
 * that dims the page behind the sheet, and the window at its end.
 */
function createWindow() {
  // The skip link leads to the window, but its click opens the window
  // instead: the meal plan keeps its week in the hash.
  const skipLink = createElement("a", "skip-link", "Ask the assistant");
  skipLink.href = "#assistant-window";
  document.body.prepend(skipLink);

  const button = createElement("button", "assistant-button glass");
  button.type = "button";
  button.setAttribute("aria-label", "Assistant");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", "assistant-window");
  button.innerHTML = BUTTON_MARKUP;
  const mark = createElement("span", "mark");
  mark.setAttribute("aria-hidden", "true");

  const section = createElement("section", "assistant-window");
  section.id = "assistant-window";
  section.setAttribute("role", "dialog");
  section.setAttribute("aria-label", "Assistant");
  section.hidden = true;
  section.innerHTML = WINDOW_MARKUP;
  const backdrop = createElement("div", "assistant-backdrop");
  backdrop.hidden = true;
  document.body.append(button, backdrop, section);

  const part = (selector) => section.querySelector(selector);
  const examples = part(".assistant-examples");
  for (const example of EXAMPLES) {
    const exampleButton = createElement("button", "example", example);
    exampleButton.type = "button";
    const item = createElement("li");
    item.append(exampleButton);
    examples.append(item);
  }
  return {
    skipLink,
    button,
    mark,
    backdrop,
    section,
    title: /** @type {HTMLElement} */ (part(".assistant-title")),
    newButton: /** @type {HTMLButtonElement} */ (part(".new-conversation")),
    collapseButton: /** @type {HTMLButtonElement} */ (part(".collapse")),
    empty: /** @type {HTMLElement} */ (part(".assistant-empty")),
    examples: /** @type {HTMLElement} */ (examples),
    log: /** @type {HTMLElement} */ (part(".assistant-messages")),
    card: /** @type {HTMLElement} */ (part(".pending-card")),
    backButton: /** @type {HTMLButtonElement} */ (part(".details-back")),
    problemCount: /** @type {HTMLElement} */ (part(".pending-problem-count")),
    cardBody: /** @type {HTMLElement} */ (part(".pending-body")),
    summary: /** @type {HTMLElement} */ (part(".pending-summary")),
    line: /** @type {HTMLElement} */ (part(".pending-line")),
    detailsButton: /** @type {HTMLButtonElement} */ (part(".view-details")),
    details: /** @type {HTMLElement} */ (part(".pending-details")),
    cardProblem: /** @type {HTMLElement} */ (part(".pending-error")),
    discardButton: /** @type {HTMLButtonElement} */ (part(".discard")),
    applyButton: /** @type {HTMLButtonElement} */ (part(".apply")),
    composer: /** @type {HTMLElement} */ (part(".message-composer")),
    problem: /** @type {HTMLElement} */ (part(".assistant-problem")),
    chips: /** @type {HTMLElement} */ (part(".attachment-chips")),
    messageRow: /** @type {HTMLElement} */ (part(".message-row")),
    attachButton: /** @type {HTMLButtonElement} */ (part(".attach")),
    input: /** @type {HTMLInputElement} */ (part(".attach-input")),
    field: /** @type {HTMLTextAreaElement} */ (part(".message-field")),
    sendButton: /** @type {HTMLButtonElement} */ (part(".send")),
  };
}

/**
 * The width of a classic scrollbar, which takes width from the page, or 0
 * where scrollbars overlay the page, as on phones. It counts whether or not
 * the page scrolls now, so the room for the window doesn't come and go as
 * the page's height changes.
 */
function scrollbarWidth() {
  const probe = createElement("div");
  probe.style.cssText =
    "position: absolute; top: -100px; width: 100px; height: 50px; overflow: scroll";
  document.body.append(probe);
  const width = probe.offsetWidth - probe.clientWidth;
  probe.remove();
  return width;
}

/**
 * Says whether the page makes room for the open window, with the root's
 * `data-assistant-room`, and how wide the window is then, with
 * `--assistant-width`, from the width of the page beside the sidebar.
 * @param {HTMLElement} root
 * @param {number} scrollbar
 */
function fitRoom(root, scrollbar) {
  const sidebar = Number.parseFloat(
    window.getComputedStyle(root).getPropertyValue("--sidebar-space"),
  );
  const width =
    window.innerWidth -
    scrollbar -
    (Number.isFinite(sidebar) ? sidebar : 0) -
    ROOM.padding -
    ROOM.grid -
    ROOM.margin;
  if (width < ROOM.narrowest) {
    delete root.dataset.assistantRoom;
    root.style.removeProperty("--assistant-width");
  } else {
    root.dataset.assistantRoom = "";
    root.style.setProperty("--assistant-width", `${Math.min(width, ROOM.widest)}px`);
  }
}

/** What a message or an event shows, without the failed mark, which changes in place. */
function contentKey(message) {
  const { failed: _, ...content } = message;
  return JSON.stringify(content);
}

/**
 * The row of an apply or a discard: what happened, and after an apply, a
 * link to each week that it changed, which leads to the first day whose
 * menu changed, so a phone shows that day. The links to the week that the
 * meal plan shows are hidden: `showWeekLinks` updates them.
 */
function eventElement(event) {
  const element = createElement("div", "assistant-event");
  element.append(createElement("p", undefined, eventText(event)));
  for (const changed of event.weeks ?? []) {
    const link = createElement("a", "week-link", weekLinkText(changed.week));
    link.href = `/#${changed.week}/${changed.day}`;
    link.dataset.week = changed.week;
    element.append(link);
  }
  return element;
}

/**
 * One message of the conversation: its text, and the names of its
 * attachments. A reply shows without the bold markers of its text.
 */
function messageElement(message) {
  if (message.role === "event") return eventElement(message);
  const element = createElement("div", `message from-${message.role}`);
  element.classList.toggle("failed", Boolean(message.failed));
  const text = createElement("p", "message-text");
  text.append(
    createElement("span", "visually-hidden", message.role === "user" ? "You: " : "Assistant: "),
    message.role === "assistant" ? withoutBold(message.text) : message.text,
  );
  element.append(text);
  if (message.attachments?.length > 0) {
    const list = createElement("ul", "message-attachments");
    list.setAttribute("aria-label", "Attachments");
    for (const name of message.attachments) {
      const icon = createElement("span", "file-icon");
      icon.innerHTML = FILE_ICON;
      const item = createElement("li");
      item.append(icon, name);
      list.append(item);
    }
    element.append(list);
  }
  return element;
}

/**
 * One pending change, as View details shows it, with its problem right below
 * its title, so the problem shows where the details open, even when the
 * change's lines don't fit.
 */
function detailElement(view) {
  const { title, lines } = pendingDetail(view);
  const item = createElement("li", "pending-change");
  // A change with a problem takes the focus when the details open on it.
  if (view.problem) item.tabIndex = -1;
  item.append(createElement("p", "pending-change-title", title));
  if (view.problem) {
    const problem = createElement("p", "pending-problem");
    problem.append(createWarningIcon(), view.problem);
    item.append(problem);
  }
  if (lines.length > 0) {
    const list = createElement("ul", "pending-change-lines");
    for (const line of lines) list.append(createElement("li", undefined, line));
    item.append(list);
  }
  return item;
}

/** A group of the details: its line of the summary, and its pending changes. */
function groupElement({ heading, changes }) {
  const group = createElement("li", "pending-group");
  const list = createElement("ul", "pending-group-changes");
  list.append(...changes.map(detailElement));
  group.append(createElement("h4", "pending-group-title", heading), list);
  return group;
}

/**
 * Turns the assistant on or off on the page, as `enabled` says. Until
 * setUpAssistant has checked the server, it does nothing.
 * @type {(enabled: boolean) => void}
 */
let turnAssistant = () => {};

/**
 * Marks the root `data-assistant-enabled` while the assistant is on, or
 * removes the mark, so styles.css gives the phone's tab bar its place beside
 * the button. The server marks each page that it serves, for the first
 * paint; the page keeps the mark in step with the checks that follow.
 * @param {boolean} enabled
 */
function markEnabled(enabled) {
  document.documentElement.toggleAttribute("data-assistant-enabled", enabled);
}

/**
 * Asks the server whether the assistant is on, and resolves to its answer, or
 * to undefined when the check fails, which it logs.
 * @returns {Promise<boolean | undefined>}
 */
export async function checkAssistant() {
  try {
    return (await getJson("/api/assistant")).enabled;
  } catch (error) {
    console.error("Couldn't check the assistant:", error);
    return undefined;
  }
}

/**
 * Asks the server again whether the assistant is on, and adds or shows the
 * button, the skip link, and the window, or hides them, and marks the root,
 * without a reload, as after Settings saves the assistant's settings.
 * Resolves to whether the assistant is on. A failed check changes nothing,
 * and resolves to undefined.
 * @returns {Promise<boolean | undefined>}
 */
export async function refreshAssistant() {
  const enabled = await checkAssistant();
  if (enabled !== undefined) {
    markEnabled(enabled);
    turnAssistant(enabled);
  }
  return enabled;
}

/**
 * Adds the assistant's button and window to the page when the server says
 * that the assistant is on, and does nothing more when it's off.
 * refreshAssistant() can turn it on or off later.
 */
export async function setUpAssistant() {
  // From some width, the page makes room for the open window, which the
  // root's `data-assistant` attribute says is open. A window that another
  // page left open sets it now, as the page starts, so the page makes room
  // from its first paint and doesn't shift sideways when the window shows.
  const root = document.documentElement;
  const startsOpen = readStored(OPEN_KEY, "sessionStorage") === "true";
  const scrollbar = scrollbarWidth();
  const fit = () => fitRoom(root, scrollbar);
  if (startsOpen) {
    fit();
    root.dataset.assistant = "open";
  }
  // The assistant is off, or nobody knows: the page keeps all its room.
  const leave = () => {
    delete root.dataset.assistant;
    delete root.dataset.assistantRoom;
    root.style.removeProperty("--assistant-width");
  };
  // A failed check leaves the assistant off.
  const enabled = (await checkAssistant()) ?? false;
  markEnabled(enabled);
  if (!enabled) {
    leave();
    // The page adds the window when Settings turns the assistant on, and
    // until then, never.
    await new Promise((resolve) => {
      turnAssistant = (on) => {
        if (on) resolve(undefined);
      };
    });
  }
  // A window that another page left open opens again only on a page that
  // found the assistant on when it started.
  const opensAtStart = startsOpen && enabled;
  fit();
  // A window that resizes, and a sidebar that shows or hides, change the
  // room for the window.
  window.addEventListener("resize", fit);
  new window.MutationObserver(fit).observe(root, { attributeFilter: ["data-sidebar"] });
  const parts = createWindow();
  const { skipLink, button, backdrop, section, log, field, input } = parts;

  /** The identifier of the conversation, or null before the first message. */
  let conversationId = readStored(CONVERSATION_KEY);
  /** The conversation as the server last showed it. */
  let view = EMPTY;
  let open = false;
  /** How many replies of the assistant the open window has shown. */
  let seen = readCount(SEEN_KEY);
  /** The bytes of the files that this conversation sent, which count toward its limit. */
  let usedBytes = readCount(USED_KEY);
  /** The files that go with the next message. */
  let attached = [];
  /** True while a request of a button runs, so two never overlap. */
  let busy = false;
  /** True from a saved Apply or Discard until a read shows what it left. */
  let settling = false;
  /** The control of the card or the log whose request runs, or null. */
  let actionControl = null;
  /** True while the details of the pending changes replace the conversation. */
  let detailsOpen = false;
  /** The pending changes that the card shows, as JSON, so it rebuilds only when they change. */
  let shownPending = "";
  /**
   * True while the card shows the error of a rejected Apply, which belongs
   * to the problems that the Apply found, not to how a read describes the
   * changes: it stays while a pending change shows a problem.
   */
  let errorOfProblems = false;
  /** True once the window opened or collapsed. */
  let toggled = false;
  /** False while Settings has turned the assistant off. */
  let active = true;
  /** The timer of the next read, while the assistant answers. */
  let timer;
  /** True when the page was hidden while the window waited to read again. */
  let paused = false;
  /**
   * True from a message or a Retry that the server accepted until a read
   * shows the conversation: the assistant answers, whatever `view` says.
   */
  let answering = false;
  /** Counts the reads, so only the answer of the latest one shows. */
  let reads = 0;
  /** What the log shows: the node of each message with its content key. */
  let shownMessages = [];
  /** The row that ends the log, "Thinking…" or a failure, and its state. */
  let stateRow = null;
  let shownState = "";
  /** True while the window is open as a sheet, over the dimmed and inert page. */
  let sheetOpen = false;
  /**
   * The week that the meal plan shows, which it announces with
   * `meals:week-shown`, or undefined on the other pages.
   */
  let shownWeek = displayedWeek(location);

  const urlOf = (id) => `${CONVERSATIONS_URL}/${encodeURIComponent(id)}`;

  // Stores the count `value` of this window's conversation under `key`,
  // unless another tab has stored a conversation of its own since.
  function storeCount(key, value) {
    if (readStored(CONVERSATION_KEY) === conversationId) store(key, value);
  }

  /**
   * Shows `text` above the message field, with a warning icon, or nothing for
   * "".
   */
  function showProblem(text) {
    if (text === "") {
      parts.problem.replaceChildren();
    } else {
      parts.problem.replaceChildren(createWarningIcon(), createElement("span", undefined, text));
    }
  }

  /**
   * Shows `text` above Apply and Discard, as the error of either, and with
   * `ofProblems`, as the error of a rejected Apply.
   */
  function showCardProblem(text, { ofProblems = false } = {}) {
    parts.cardProblem.textContent = text;
    errorOfProblems = ofProblems;
  }

  function stopReading() {
    reads += 1;
    clearTimeout(timer);
    timer = undefined;
    paused = false;
  }

  // The conversation ended, or the server doesn't know it: the window shows
  // an empty chat, and the next message starts a new conversation. What
  // another tab stored of a conversation that it started stays.
  function forgetConversation() {
    stopReading();
    if (readStored(CONVERSATION_KEY) === conversationId) {
      store(CONVERSATION_KEY, null);
      store(USED_KEY, null);
      store(SEEN_KEY, null);
    }
    conversationId = null;
    usedBytes = 0;
    seen = 0;
    view = EMPTY;
    settling = false;
    answering = false;
    detailsOpen = false;
  }

  // Reads the conversation again in a second. A hidden page waits until it's
  // shown.
  function readLater() {
    if (document.visibilityState === "hidden") {
      paused = true;
      return;
    }
    timer = setTimeout(() => {
      timer = undefined;
      read();
    }, POLL_MS);
  }

  // Reads the conversation and shows it, and reads it again while the
  // assistant answers. A failed read shows nothing: while the assistant
  // answers, the next one may work; otherwise, the next action reads again.
  async function read() {
    clearTimeout(timer);
    timer = undefined;
    if (conversationId === null || !active) return;
    reads += 1;
    const current = reads;
    let next;
    try {
      next = await getJson(urlOf(conversationId));
    } catch (error) {
      if (current !== reads) return;
      if (error.status === 404) {
        forgetConversation();
        render();
      } else if (answering || view.status === "working") {
        readLater();
      }
      return;
    }
    if (current !== reads) return;
    view = next;
    settling = false;
    answering = false;
    render();
    if (view.status === "working") readLater();
  }

  function renderButton() {
    const marked = hasMark({ open, messages: view.messages, seen, pending: view.pending });
    button.setAttribute("aria-label", marked ? "Assistant, new activity" : "Assistant");
    if (marked) button.append(parts.mark);
    else parts.mark.remove();
  }

  // The state of the answer that ends the log: "Thinking…", or why it failed,
  // with Retry, or with New conversation when the conversation is too long.
  function stateElement() {
    if (view.status === "working") return createElement("p", "thinking", "Thinking…");
    if (view.status !== "failed") return null;
    const failure = FAILURES[view.error] ?? FAILURES.provider;
    const element = createElement("div", "turn-failure");
    const text = createElement("p");
    text.append(createWarningIcon(), failure.text);
    element.append(text);
    const retry = failure.action === "retry";
    const action = createElement("button", "failure-action", retry ? "Retry" : "New conversation");
    action.type = "button";
    action.addEventListener("click", retry ? retryTurn : startNewConversation);
    element.append(action);
    return element;
  }

  // Hides the links of the applied rows to the week that the meal plan
  // shows, and shows the others. A link that hides while it has the focus,
  // as after you follow it, moves the focus as the window does when it opens.
  function showWeekLinks() {
    for (const link of /** @type {NodeListOf<HTMLAnchorElement>} */ (
      log.querySelectorAll(".week-link")
    )) {
      const hide = link.dataset.week === shownWeek;
      if (hide && document.activeElement === link) focusWindow();
      link.hidden = hide;
    }
  }

  // Changes only what changed in the log, so screen readers announce only
  // new messages: a message whose failed mark changes keeps its node, and a
  // new one goes before the row of the answer's state.
  function renderLog() {
    const { messages } = view;
    const state = `${view.status}:${view.error ?? ""}`;
    let changed = state !== shownState || shownMessages.length > messages.length;
    for (const { node } of shownMessages.slice(messages.length)) node.remove();
    shownMessages = messages.map((message, index) => {
      const key = contentKey(message);
      const shown = shownMessages[index];
      if (shown?.key === key) {
        shown.node.classList.toggle("failed", Boolean(message.failed));
        return shown;
      }
      changed = true;
      const node = messageElement(message);
      if (shown) shown.node.replaceWith(node);
      else log.insertBefore(node, stateRow);
      return { key, node };
    });
    if (state !== shownState) {
      stateRow?.remove();
      stateRow = stateElement();
      if (stateRow) log.append(stateRow);
      shownState = state;
    }
    if (!changed) return;
    showWeekLinks();
    log.scrollTop = log.scrollHeight;
  }

  // Shows the card while the conversation has pending changes, in the view
  // that `detailsOpen` picks. The summary and the details rebuild only when
  // the pending changes change, so the details keep their scroll position
  // and the change that has the focus. The error of Apply or Discard belongs
  // to the changes it was about, so other changes clear it. The server
  // clears the problems of a rejected Apply when the pending changes change,
  // so its error goes with them.
  function renderCard() {
    const { pending } = view;
    parts.card.hidden = pending.length === 0;
    if (pending.length === 0) detailsOpen = false;
    const key = JSON.stringify(pending);
    if (key !== shownPending) {
      shownPending = key;
      parts.problemCount.textContent = problemCount(pending);
      parts.summary.replaceChildren(
        ...summarize(pending).map((line) => createElement("li", undefined, line)),
      );
      parts.line.textContent = summaryLine(pending);
      parts.details.replaceChildren(...groupPending(pending).map(groupElement));
      if (!errorOfProblems || !pending.some((change) => change.problem)) showCardProblem("");
    }
    log.hidden = detailsOpen;
    parts.empty.hidden = detailsOpen || view.messages.length > 0;
    parts.composer.hidden = detailsOpen;
    parts.cardBody.hidden = detailsOpen;
    parts.backButton.hidden = !detailsOpen;
    parts.details.hidden = !detailsOpen;
    section.classList.toggle("showing-details", detailsOpen);
  }

  // Replaces the conversation with the details, from their start, or at the
  // first change with a problem, which takes the focus. Without one, the
  // focus goes to Back.
  function openDetails() {
    detailsOpen = true;
    renderCard();
    parts.details.scrollTop = 0;
    const problem = /** @type {HTMLElement | null} */ (
      parts.details.querySelector(".pending-change[tabindex]")
    );
    if (problem === null) {
      parts.backButton.focus();
      return;
    }
    // Only the details scroll: scrollIntoView would scroll the window and the
    // page too. A whole pixel, rounded down, so the browser's rounding never
    // puts the change's top edge above the top of the details.
    const offset = problem.getBoundingClientRect().top - parts.details.getBoundingClientRect().top;
    parts.details.scrollTop = Math.floor(offset);
    problem.focus({ preventScroll: true });
  }

  // Shows the conversation again, with the focus on View details.
  function closeDetails() {
    detailsOpen = false;
    renderCard();
    parts.detailsButton.focus();
  }

  function renderControls() {
    const working = view.status === "working";
    // A browser moves the focus off a disabled control to <body> at a time
    // of its own, which can come after Send turned on and off again, so the
    // focus leaves Send first, as when the window opens.
    if ((working || busy) && document.activeElement === parts.sendButton) focusWindow();
    parts.sendButton.disabled = working || busy;
    parts.applyButton.disabled = working || busy || settling;
    parts.discardButton.disabled = working || busy || settling;
    parts.newButton.disabled = busy;
    for (const action of /** @type {NodeListOf<HTMLButtonElement>} */ (
      log.querySelectorAll(".failure-action")
    )) {
      action.disabled = busy;
    }
  }

  function renderChips() {
    parts.chips.hidden = attached.length === 0;
    parts.chips.replaceChildren(
      ...attached.map((file) => {
        const chip = createElement("li", "attachment-chip");
        const remove = createElement("button", "remove-attachment", "×");
        remove.type = "button";
        remove.setAttribute("aria-label", `Remove ${file.name}`);
        remove.addEventListener("click", () => {
          attached = attached.filter((candidate) => candidate !== file);
          renderChips();
          focusWindow();
        });
        chip.append(createElement("span", "attachment-name", file.name), remove);
        return chip;
      }),
    );
  }

  /** Whether `element` is in the page and not hidden. */
  function isShown(element) {
    return element.isConnected && element.closest("[hidden]") === null;
  }

  /** Whether `element` is in the card or the log, whose content changes. */
  function inCardOrLog(element) {
    return parts.card.contains(element) || log.contains(element);
  }

  // Keeps the focus in the window when the card or the log hid or removed
  // the control that had it, or that started the request that just ended:
  // the focus moves as when the window opens, or to Back while the details
  // replace the conversation. `active` is the element that had the focus
  // before the change, and `held` says whether the card or the log held it
  // then: a removed element isn't in them anymore.
  function keepFocus(active, held = inCardOrLog(active)) {
    /** @type {HTMLElement | null} */
    let control = null;
    if (held) control = active;
    else if (focusIsFree()) control = actionControl;
    actionControl = null;
    if (control === null) return;
    if (isShown(control)) {
      if (document.activeElement !== control) control.focus();
    } else if (detailsOpen) parts.backButton.focus();
    else focusWindow();
  }

  function render() {
    const active = document.activeElement;
    const held = inCardOrLog(active);
    // The open window shows every reply, so none of them marks the button.
    if (open) {
      const replies = view.messages.filter((message) => message.role === "assistant").length;
      if (replies !== seen) {
        seen = replies;
        storeCount(SEEN_KEY, seen);
      }
    }
    renderLog();
    renderCard();
    renderControls();
    renderButton();
    keepFocus(active, held);
  }

  function setBusy(value) {
    busy = value;
    renderControls();
  }

  // Moves the focus into the window, wherever the window moves it on its
  // own, as when it opens, without opening an on-screen keyboard: to the
  // message field with a precise pointer, and otherwise to the title, so the
  // keyboard opens only when you tap the field.
  function focusWindow() {
    (window.matchMedia(PRECISE_POINTER).matches ? field : parts.title).focus();
  }

  /** Whether the screen gets the sheet: a phone, or a screen 500 px tall or less. */
  function isSheetScreen() {
    return SHEET_QUERIES.some((query) => window.matchMedia(query).matches);
  }

  // Sizes the sheet by the part of the page that the screen shows, which the
  // on-screen keyboard makes shorter, so the keyboard never covers the
  // message field or pushes the header off screen.
  function fitVisibleViewport() {
    const { height, offsetTop } = window.visualViewport;
    section.style.setProperty("--assistant-viewport-height", `${height}px`);
    section.style.setProperty("--assistant-viewport-top", `${offsetTop}px`);
  }

  // Follows the visible part of the page while the sheet is open. Without
  // visualViewport, the sheet takes the size of the page's viewport.
  function followVisibleViewport(follow) {
    const viewport = window.visualViewport;
    if (!viewport) return;
    if (follow) {
      viewport.addEventListener("resize", fitVisibleViewport);
      viewport.addEventListener("scroll", fitVisibleViewport);
      fitVisibleViewport();
    } else {
      viewport.removeEventListener("resize", fitVisibleViewport);
      viewport.removeEventListener("scroll", fitVisibleViewport);
      section.style.removeProperty("--assistant-viewport-height");
      section.style.removeProperty("--assistant-viewport-top");
    }
  }

  // Makes the open sheet modal, or the page usable again: while the sheet is
  // open, the page behind it is dimmed and inert, so it takes no taps,
  // scrolling, or focus. Only the elements in the page when the sheet opens
  // become inert; an element added later, such as the alert that New
  // conversation adds, stays usable. The modal dialogs stay out of it too:
  // they open above the sheet, and an inert dialog would take no input, so
  // the question of New conversation could never be answered. So do the
  // live regions, such as the meal plan's announcements of its saves: an
  // inert one says nothing, and a save can still fail behind the sheet.
  function setSheetOpen(value) {
    if (value === sheetOpen) return;
    sheetOpen = value;
    backdrop.hidden = !value;
    for (const element of document.body.children) {
      if (element === button || element === backdrop || element === section) continue;
      if (element.localName === "dialog" || element.hasAttribute("aria-live")) continue;
      /** @type {HTMLElement} */ (element).inert = value;
    }
    followVisibleViewport(value);
  }

  /** Makes the open window a sheet when the screen gets one, and the collapsed window none. */
  function renderSheet() {
    setSheetOpen(open && isSheetScreen());
  }

  // Opens or collapses the window. A collapsed window opens on the
  // conversation, even when it collapsed from the details. The button is
  // hidden while the window is open, which Collapse and Escape close, and
  // shows again, with the focus, when it collapses.
  function setOpen(value, { focus = true } = {}) {
    toggled = true;
    open = value;
    if (!value) detailsOpen = false;
    store(OPEN_KEY, value, "sessionStorage");
    if (value) root.dataset.assistant = "open";
    else delete root.dataset.assistant;
    section.hidden = !value;
    button.hidden = value;
    button.setAttribute("aria-expanded", String(value));
    renderSheet();
    render();
    if (value) log.scrollTop = log.scrollHeight;
    if (!focus) return;
    if (value) focusWindow();
    else button.focus();
  }

  // Sends `body` as a message, and starts a conversation first when there's
  // none. Resolves to the response of the message, or of the start.
  async function postMessage(body) {
    if (conversationId === null) {
      const created = await sendJson("POST", CONVERSATIONS_URL, {});
      if (created.status !== 201) return created;
      conversationId = created.body.id;
      store(CONVERSATION_KEY, conversationId);
    }
    return sendJson("POST", `${urlOf(conversationId)}/messages`, body, {
      timeoutMs: UPLOAD_TIMEOUT_MS,
    });
  }

  async function send() {
    const text = field.value.trim();
    if (busy || view.status === "working" || (text === "" && attached.length === 0)) return;
    const typed = field.value;
    showProblem("");
    setBusy(true);
    const files = attached;
    try {
      const attachments = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          data: await base64Of(file),
        })),
      );
      const week = displayedWeek(location);
      // The server has no time zone: the browser's date is the family's.
      const today = dateIdOf(new Date());
      const body = { text, attachments, ...(week && { week }), today };
      let response = await postMessage(body);
      // The server doesn't know the conversation anymore, for example after
      // a restart: the message starts a new one.
      if (response.status === 404) {
        forgetConversation();
        render();
        response = await postMessage(body);
      }
      if (response.status === 202) {
        answering = true;
        // What the user typed or attached during the upload stays for the
        // next message.
        if (field.value === typed) field.value = "";
        attached = attached.filter((file) => !files.includes(file));
        renderChips();
        usedBytes += files.reduce((sum, file) => sum + file.size, 0);
        storeCount(USED_KEY, usedBytes);
      } else if (response.status === 404) {
        // The new conversation is gone too: the server's message names it,
        // which means nothing to the family.
        showProblem(FAILURES.provider.text);
      } else {
        showProblem(errorOf(response, "Couldn't send the message. Try again."));
      }
    } catch (error) {
      console.error("Couldn't send the message:", error);
      showProblem("Couldn't send the message. Try again.");
    } finally {
      setBusy(false);
    }
    // A click that doesn't focus Send, as in Safari, leaves the focus on
    // <body>.
    if (focusIsFree()) focusWindow();
    read();
  }

  // Posts `action` to the conversation, with `body`. Resolves to the
  // response, or to undefined after a failure, which `show` shows. A
  // conversation that the server doesn't know anymore leaves an empty chat.
  async function post(action, failure, show, body = {}) {
    if (busy || conversationId === null) return undefined;
    const active = /** @type {HTMLElement} */ (document.activeElement);
    actionControl = inCardOrLog(active) ? active : null;
    show("");
    setBusy(true);
    let response;
    try {
      response = await sendJson("POST", `${urlOf(conversationId)}/${action}`, body);
    } catch (error) {
      console.error(`${failure}:`, error);
      show(`${failure}. Try again.`);
    }
    setBusy(false);
    if (response?.status === 404) {
      forgetConversation();
      render();
      showProblem(GONE);
      return undefined;
    }
    // After a failure, nothing changed: the focus stays on the control.
    if (response === undefined) keepFocus(active);
    return response;
  }

  // Keeps Apply and Discard disabled until a read shows what a saved Apply
  // or Discard left, so they never act twice on the same pending changes.
  function settle() {
    settling = true;
    renderControls();
    read();
  }

  async function retryTurn() {
    const response = await post("retry", "Couldn't retry", showProblem);
    if (response === undefined) return;
    if (response.status === 202) answering = true;
    else showProblem(errorOf(response, "Couldn't retry. Try again."));
    read();
  }

  // Applies the pending changes that the card shows: the server refuses
  // them when they changed since the last read.
  async function apply() {
    const response = await post("apply", "Couldn't apply the changes", showCardProblem, {
      revision: view.revision,
    });
    if (response === undefined) return;
    const partlySaved = response.body?.code === "partly_saved";
    // The page behind the window loads its data again, to show what was
    // saved, even after a failure that may have saved part of it.
    if (response.status === 200 || partlySaved) {
      window.dispatchEvent(new window.Event("meals:data-changed"));
    }
    if (response.status === 200) {
      settle();
      return;
    }
    const error = partlySaved
      ? PARTLY_SAVED
      : errorOf(response, "Couldn't apply the changes. Try again.");
    if (!Array.isArray(response.body?.problems)) {
      // The error shows after the read, which would clear it when the
      // pending changes changed, as they do when the server refuses them.
      await read();
      showCardProblem(error);
      return;
    }
    // The read shows each problem on its pending change, and the details
    // open at the first one.
    showCardProblem(error, { ofProblems: true });
    await read();
    openDetails();
  }

  // Discards the pending changes, and asks first when there are more than a
  // few, as a whole plan is easy to lose with one tap next to Apply.
  async function discard() {
    if (view.pending.length > DISCARD_WITHOUT_ASKING) {
      const lose = await askBeforeLosing({
        title: "Discard the pending changes?",
        message: "The assistant's changes aren't saved. If you discard them, they're lost.",
        keep: "Keep Changes",
        lose: "Discard",
      });
      if (!lose) return;
    }
    const response = await post("discard", "Couldn't discard the changes", showCardProblem);
    if (response === undefined) return;
    if (response.status === 200) {
      settle();
      return;
    }
    showCardProblem(errorOf(response, "Couldn't discard the changes. Try again."));
    read();
  }

  // Ends the conversation, which cancels an answer in progress and loses the
  // pending changes, and shows an empty chat. The text and the files of the
  // next message stay.
  async function startNewConversation() {
    if (busy) return;
    if (view.pending.length > 0) {
      const lose = await askBeforeLosing({
        title: "Start a new conversation?",
        message: "The pending changes aren't saved. If you start a new conversation, they're lost.",
        keep: "Keep Conversation",
        lose: "Discard and Start",
      });
      if (!lose) return;
    }
    const ended = conversationId;
    forgetConversation();
    showProblem("");
    render();
    focusWindow();
    if (ended === null) return;
    try {
      await sendJson("DELETE", urlOf(ended), undefined);
    } catch (error) {
      // The server ends it after 24 hours without activity anyway.
      console.error("Couldn't end the conversation:", error);
    }
  }

  // Shows the week of a link of an applied row, on the day of the link. The
  // meal plan, at `/` or `/index.html`, changes only its hash, so it changes
  // the week itself without a reload; the other pages load the meal plan.
  // The sheet collapses, so the week shows. A click that opens a new tab or
  // window keeps the browser's default.
  function showWeek(event) {
    const link = /** @type {HTMLElement} */ (event.target).closest(".week-link");
    if (link === null) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    if (isMealPlan(location)) {
      event.preventDefault();
      location.hash = /** @type {HTMLAnchorElement} */ (link).hash;
    }
    if (sheetOpen) setOpen(false);
  }

  // Puts the text of an example in the message field, unless it holds text,
  // and moves the focus as when the window opens. Nothing is sent until you
  // send it.
  function useExample(event) {
    const example = /** @type {HTMLElement} */ (event.target).closest(".example");
    if (example === null) return;
    if (field.value.trim() === "") field.value = example.textContent;
    focusWindow();
  }

  function attach() {
    const picked = [...input.files];
    input.value = "";
    if (picked.length === 0) return;
    const next = [...attached, ...picked];
    const problem = attachmentProblem(next, usedBytes);
    showProblem(problem ?? "");
    if (problem) return;
    attached = next;
    renderChips();
  }

  // A tap anywhere in the field's pill, other than on its buttons, focuses
  // the field: the space above and below the field's line is the row's. A
  // tap on the field itself keeps the browser's default, so a long press or
  // a selection in it still works.
  function focusFieldFromRow(/** @type {Event} */ event) {
    const target = /** @type {Element} */ (event.target);
    if (target === field || target.closest("button") !== null) return;
    // Otherwise the browser moves the focus from the field to the page.
    event.preventDefault();
    field.focus();
  }

  button.addEventListener("click", () => setOpen(!open));
  skipLink.addEventListener("click", (event) => {
    event.preventDefault();
    if (open) focusWindow();
    else setOpen(true);
  });
  parts.examples.addEventListener("click", useExample);
  log.addEventListener("click", showWeek);
  parts.collapseButton.addEventListener("click", () => setOpen(false));
  backdrop.addEventListener("click", () => setOpen(false));
  // A phone that turns, or a window that resizes, can change the layout of
  // the open window.
  window.addEventListener("resize", renderSheet);
  // A page that unloads leaves nothing inert, and a page that the browser
  // shows again from its cache makes the open sheet modal again.
  window.addEventListener("pagehide", () => setSheetOpen(false));
  window.addEventListener("pageshow", renderSheet);
  parts.newButton.addEventListener("click", startNewConversation);
  parts.detailsButton.addEventListener("click", openDetails);
  parts.backButton.addEventListener("click", closeDetails);
  parts.applyButton.addEventListener("click", apply);
  parts.discardButton.addEventListener("click", discard);
  parts.attachButton.addEventListener("click", () => input.click());
  window.addEventListener("meals:week-shown", (event) => {
    shownWeek = /** @type {CustomEvent} */ (event).detail.week;
    showWeekLinks();
  });
  input.addEventListener("change", attach);
  parts.sendButton.addEventListener("click", send);
  parts.messageRow.addEventListener("pointerdown", focusFieldFromRow);
  // Chromium moves a tap to a nearby element that listens for mouse buttons,
  // such as the log above, unless the element under the finger listens for
  // them too. A canceled pointerdown has no mousedown after it.
  parts.messageRow.addEventListener("mousedown", focusFieldFromRow);
  // Enter sends and Shift+Enter adds a line. While an input method composes
  // a character, Enter belongs to it.
  field.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) {
      return;
    }
    event.preventDefault();
    send();
  });
  // Escape goes Back from the details first, and then collapses the window.
  section.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.isComposing) return;
    event.preventDefault();
    if (detailsOpen) closeDetails();
    else setOpen(false);
  });
  // A hidden page doesn't read: it reads once when it's shown again.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      if (timer === undefined) return;
      clearTimeout(timer);
      timer = undefined;
      paused = true;
    } else if (paused) {
      paused = false;
      read();
    }
  });

  // Settings turns the assistant off or on again. Off, the window collapses
  // and stops reading, and the button and the skip link leave the page, so
  // the rules of styles.css that make room for the button stop applying; on
  // again, they come back to their places, and the window reads the
  // conversation.
  turnAssistant = (on) => {
    if (on === active) return;
    active = on;
    if (on) {
      document.body.prepend(skipLink);
      backdrop.before(button);
      read();
      return;
    }
    if (open) setOpen(false, { focus: false });
    stopReading();
    skipLink.remove();
    button.remove();
  };

  // A window that starts open shows once the log holds the conversation, so
  // screen readers don't read every message as new.
  log.setAttribute("aria-busy", "true");
  render();
  read().finally(() => {
    log.removeAttribute("aria-busy");
    if (opensAtStart && !toggled) setOpen(true, { focus: false });
  });
}
