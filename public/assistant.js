// The assistant's window: a round button in the lower right corner of every
// page, and the chat that it opens. The window isn't modal, so the page
// behind it stays usable, and it keeps the conversation's identifier, whether
// it's open, and what it showed in localStorage, so the next page shows the
// same conversation. While the assistant answers, the window reads the
// conversation again every second.

import { askBeforeLosing } from "./alert.js";
import {
  attachmentProblem,
  displayedWeek,
  hasMark,
  pendingDetail,
  summarize,
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

const FAILURES = {
  limit: { text: "The assistant took too long.", retry: true },
  provider: { text: "The assistant couldn't answer.", retry: true },
  too_long: { text: "This conversation is too long. Start a new conversation.", retry: false },
};

const GONE = "This conversation has ended.";

/** A conversation that hasn't started. */
const EMPTY = { status: "idle", messages: [], pending: [] };

// static markup, never user text
const BUTTON_MARKUP =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 4c4.7 0 8.5 3.1 8.5 7s-3.8 7-8.5 7c-1 0-2-.1-2.9-.4L5 19.5l1.2-3.4C4.6 14.8 3.5 13 3.5 11c0-3.9 3.8-7 8.5-7z"/></svg>';

// static markup, never user text. The card of the pending changes takes its
// name from aria-label, not from aria-labelledby on its heading: Firefox
// crashed in testing when axe read the card's ariaLabelledByElements after
// the window showed pending changes.
const WINDOW_MARKUP = `
  <div class="assistant-header">
    <h2 class="assistant-title">Assistant</h2>
    <button type="button" class="new-conversation glass icon-button" aria-label="New conversation" title="New conversation">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14"/></svg>
    </button>
    <button type="button" class="collapse glass icon-button" aria-label="Collapse" title="Collapse">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 9l7 7 7-7"/></svg>
    </button>
  </div>
  <div class="assistant-messages" role="log" aria-label="Messages"></div>
  <section class="pending-card" aria-label="Pending changes" hidden>
    <h3 class="pending-title">Pending changes</h3>
    <ul class="pending-summary"></ul>
    <button type="button" class="view-details" aria-expanded="false" aria-controls="pending-details">View details</button>
    <ul id="pending-details" class="pending-details" hidden></ul>
    <div class="pending-actions">
      <button type="button" class="discard">Discard</button>
      <button type="button" class="apply">Apply</button>
    </div>
  </section>
  <div class="message-composer">
    <p class="assistant-problem" role="alert"></p>
    <ul class="attachment-chips" aria-label="Attachments" hidden></ul>
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

// The stored value of `key`, or null when there's none or the browser blocks
// storage.
function readStored(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

// Stores `value` under `key`, or removes the key for null.
function store(key, value) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, String(value));
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

// The message of a response's body, or `fallback`.
function errorOf(body, fallback) {
  return typeof body?.error === "string" ? body.error : fallback;
}

/** Builds the button and the window at the end of the page. */
function createWindow() {
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
  document.body.append(button, section);

  const part = (selector) => section.querySelector(selector);
  return {
    button,
    mark,
    section,
    newButton: /** @type {HTMLButtonElement} */ (part(".new-conversation")),
    collapseButton: /** @type {HTMLButtonElement} */ (part(".collapse")),
    log: /** @type {HTMLElement} */ (part(".assistant-messages")),
    card: /** @type {HTMLElement} */ (part(".pending-card")),
    summary: /** @type {HTMLElement} */ (part(".pending-summary")),
    detailsButton: /** @type {HTMLButtonElement} */ (part(".view-details")),
    details: /** @type {HTMLElement} */ (part(".pending-details")),
    discardButton: /** @type {HTMLButtonElement} */ (part(".discard")),
    applyButton: /** @type {HTMLButtonElement} */ (part(".apply")),
    problem: /** @type {HTMLElement} */ (part(".assistant-problem")),
    chips: /** @type {HTMLElement} */ (part(".attachment-chips")),
    attachButton: /** @type {HTMLButtonElement} */ (part(".attach")),
    input: /** @type {HTMLInputElement} */ (part(".attach-input")),
    field: /** @type {HTMLTextAreaElement} */ (part(".message-field")),
    sendButton: /** @type {HTMLButtonElement} */ (part(".send")),
  };
}

/** What a message shows, without its failed mark, which changes in place. */
function contentKey({ role, text, attachments }) {
  return JSON.stringify({ role, text, attachments });
}

/** One message of the conversation: its text, and the names of its attachments. */
function messageElement(message) {
  const element = createElement("div", `message from-${message.role}`);
  element.classList.toggle("failed", Boolean(message.failed));
  const text = createElement("p", "message-text");
  text.append(
    createElement("span", "visually-hidden", message.role === "user" ? "You: " : "Assistant: "),
    message.text,
  );
  element.append(text);
  if (message.attachments?.length > 0) {
    const list = createElement("ul", "message-attachments");
    list.setAttribute("aria-label", "Attachments");
    for (const name of message.attachments) list.append(createElement("li", undefined, name));
    element.append(list);
  }
  return element;
}

/** One pending change, as View details shows it, with its problem. */
function detailElement(view) {
  const { title, lines } = pendingDetail(view);
  const item = createElement("li", "pending-change");
  item.append(createElement("p", "pending-change-title", title));
  if (lines.length > 0) {
    const list = createElement("ul", "pending-change-lines");
    for (const line of lines) list.append(createElement("li", undefined, line));
    item.append(list);
  }
  if (view.problem) {
    const problem = createElement("p", "pending-problem");
    problem.append(createWarningIcon(), view.problem);
    item.append(problem);
  }
  return item;
}

/**
 * Adds the assistant's button and window to the page when the server says
 * that the assistant is on, and does nothing more when it's off.
 */
export async function setUpAssistant() {
  try {
    const { enabled } = await getJson("/api/assistant");
    if (!enabled) return;
  } catch (error) {
    console.error("Couldn't check the assistant:", error);
    return;
  }
  const parts = createWindow();
  const { button, section, log, field, input } = parts;

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
  let detailsOpen = false;
  /** True once the window opened or collapsed. */
  let toggled = false;
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

  const urlOf = (id) => `${CONVERSATIONS_URL}/${encodeURIComponent(id)}`;

  function showProblem(text) {
    parts.problem.textContent = text;
  }

  function stopReading() {
    reads += 1;
    clearTimeout(timer);
    timer = undefined;
    paused = false;
  }

  // The conversation ended, or the server doesn't know it: the window shows
  // an empty chat, and the next message starts a new conversation.
  function forgetConversation() {
    stopReading();
    conversationId = null;
    store(CONVERSATION_KEY, null);
    usedBytes = 0;
    store(USED_KEY, null);
    seen = 0;
    store(SEEN_KEY, null);
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
      // The window left the page, as when a test's page closes: stop.
      if (button.isConnected) read();
    }, POLL_MS);
  }

  // Reads the conversation and shows it, and reads it again while the
  // assistant answers. A failed read shows nothing: while the assistant
  // answers, the next one may work; otherwise, the next action reads again.
  async function read() {
    clearTimeout(timer);
    timer = undefined;
    if (conversationId === null) return;
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

  // The state of the answer that ends the log: "Thinking…", or why it failed.
  function stateElement() {
    if (view.status === "working") return createElement("p", "thinking", "Thinking…");
    if (view.status !== "failed") return null;
    const failure = FAILURES[view.error] ?? FAILURES.provider;
    const element = createElement("div", "turn-failure");
    element.append(createElement("p", undefined, failure.text));
    if (failure.retry) {
      const retry = createElement("button", "retry-turn", "Retry");
      retry.type = "button";
      retry.addEventListener("click", retryTurn);
      element.append(retry);
    }
    return element;
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
    if (changed) log.scrollTop = log.scrollHeight;
  }

  function renderCard() {
    const { pending } = view;
    parts.card.hidden = pending.length === 0;
    if (pending.length === 0) detailsOpen = false;
    parts.summary.replaceChildren(
      ...summarize(pending).map(({ label, detail }) => {
        const line = createElement("li", "pending-line");
        line.append(
          createElement("span", "pending-label", label),
          createElement("span", "pending-detail", detail),
        );
        return line;
      }),
    );
    parts.details.replaceChildren(...pending.map(detailElement));
    parts.details.hidden = !detailsOpen;
    parts.detailsButton.setAttribute("aria-expanded", String(detailsOpen));
  }

  function renderControls() {
    const working = view.status === "working";
    parts.sendButton.disabled = working || busy;
    parts.applyButton.disabled = working || busy || settling;
    parts.discardButton.disabled = working || busy || settling;
    parts.newButton.disabled = busy;
    for (const retry of /** @type {NodeListOf<HTMLButtonElement>} */ (
      log.querySelectorAll(".retry-turn")
    )) {
      retry.disabled = busy;
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
          field.focus();
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

  // Keeps the focus in the window when the card or the log hid or removed
  // the control that had it, or that started the request that just ended:
  // the focus moves to the message field. `active` is the element that had
  // the focus before the change.
  function keepFocus(active) {
    /** @type {HTMLElement | null} */
    let control = null;
    if (parts.card.contains(active) || log.contains(active)) control = active;
    else if (focusIsFree()) control = actionControl;
    actionControl = null;
    if (control === null) return;
    if (!isShown(control)) field.focus();
    else if (document.activeElement !== control) control.focus();
  }

  function render() {
    const active = document.activeElement;
    // The open window shows every reply, so none of them marks the button.
    if (open) {
      const replies = view.messages.filter((message) => message.role === "assistant").length;
      if (replies !== seen) {
        seen = replies;
        store(SEEN_KEY, seen);
      }
    }
    renderLog();
    renderCard();
    renderControls();
    renderButton();
    keepFocus(active);
  }

  function setBusy(value) {
    busy = value;
    renderControls();
  }

  function setOpen(value, { focus = true } = {}) {
    toggled = true;
    open = value;
    store(OPEN_KEY, value);
    section.hidden = !value;
    button.setAttribute("aria-expanded", String(value));
    render();
    if (value) log.scrollTop = log.scrollHeight;
    if (!focus) return;
    if (value) field.focus();
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
          mediaType: file.type,
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
        store(USED_KEY, usedBytes);
      } else {
        showProblem(errorOf(response.body, "Couldn't send the message. Try again."));
      }
    } catch (error) {
      console.error("Couldn't send the message:", error);
      showProblem("Couldn't send the message. Try again.");
    } finally {
      setBusy(false);
    }
    read();
  }

  // Posts `action` to the conversation. Resolves to the response, or to
  // undefined after a failure, which it shows. A conversation that the
  // server doesn't know anymore leaves an empty chat.
  async function post(action, failure) {
    if (busy || conversationId === null) return undefined;
    const active = /** @type {HTMLElement} */ (document.activeElement);
    actionControl = parts.card.contains(active) || log.contains(active) ? active : null;
    showProblem("");
    setBusy(true);
    let response;
    try {
      response = await sendJson("POST", `${urlOf(conversationId)}/${action}`, {});
    } catch (error) {
      console.error(`${failure}:`, error);
      showProblem(`${failure}. Try again.`);
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
    const response = await post("retry", "Couldn't retry");
    if (response === undefined) return;
    if (response.status === 202) answering = true;
    else showProblem(errorOf(response.body, "Couldn't retry. Try again."));
    read();
  }

  async function apply() {
    const response = await post("apply", "Couldn't apply the changes");
    if (response === undefined) return;
    if (response.status === 200) {
      // The page behind the window loads its data again.
      window.dispatchEvent(new window.Event("meals:data-changed"));
      settle();
      return;
    }
    showProblem(errorOf(response.body, "Couldn't apply the changes. Try again."));
    const problems = response.body?.problems;
    if (!Array.isArray(problems)) {
      read();
      return;
    }
    // Each problem shows on its pending change, which View details shows.
    view = {
      ...view,
      pending: view.pending.map((pending) => {
        const problem = problems.find((candidate) => candidate.target === pending.target);
        return problem ? { ...pending, problem: problem.message } : pending;
      }),
    };
    detailsOpen = true;
    render();
  }

  async function discard() {
    const response = await post("discard", "Couldn't discard the changes");
    if (response === undefined) return;
    if (response.status === 200) {
      settle();
      return;
    }
    showProblem(errorOf(response.body, "Couldn't discard the changes. Try again."));
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
    field.focus();
    if (ended === null) return;
    try {
      await sendJson("DELETE", urlOf(ended), undefined);
    } catch (error) {
      // The server ends it after 24 hours without activity anyway.
      console.error("Couldn't end the conversation:", error);
    }
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

  button.addEventListener("click", () => setOpen(!open));
  parts.collapseButton.addEventListener("click", () => setOpen(false));
  parts.newButton.addEventListener("click", startNewConversation);
  parts.detailsButton.addEventListener("click", () => {
    detailsOpen = !detailsOpen;
    renderCard();
  });
  parts.applyButton.addEventListener("click", apply);
  parts.discardButton.addEventListener("click", discard);
  parts.attachButton.addEventListener("click", () => input.click());
  input.addEventListener("change", attach);
  parts.sendButton.addEventListener("click", send);
  // Enter sends and Shift+Enter adds a line. While an input method composes
  // a character, Enter belongs to it.
  field.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) {
      return;
    }
    event.preventDefault();
    send();
  });
  section.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.isComposing) return;
    event.preventDefault();
    setOpen(false);
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

  // A window that starts open shows once the log holds the conversation, so
  // screen readers don't read every message as new.
  const startsOpen = readStored(OPEN_KEY) === "true";
  log.setAttribute("aria-busy", "true");
  render();
  read().finally(() => {
    log.removeAttribute("aria-busy");
    if (startsOpen && !toggled) setOpen(true, { focus: false });
  });
}
