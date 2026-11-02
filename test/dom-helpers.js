// Test harness for the page scripts (app.js, recipes.js, and the dialog
// modules). It builds a document from the page's own HTML, installs the
// globals those scripts read, and imports the script fresh so its top-level
// `document.getElementById(...)` calls succeed against that document.
//
// DOM library: happy-dom, which implements `showModal()`, `close()`, the
// `close` event, and `open`, which the slot editor needs.
//
// Known gap vs. real browsers: happy-dom doesn't implement `window.confirm`
// at all (it's browser chrome, like the dialogs `alert()` and `prompt()`
// open). The pages ask in their own dialogs instead, so loadPage() installs
// a stub that throws if a page ever calls it.
//
// Known gap vs. real browsers: happy-dom's `history.replaceState` fires a
// "hashchange" event when the new URL's hash differs from the old one; real
// browsers never fire "hashchange" from the History API, only from an actual
// navigation. `app.js`'s `syncHash()` calls `replaceState` after most week
// changes, so a test that changes weeks may see one extra, harmless,
// re-entrant call into the app's "hashchange" listener a tick later -- by
// then the requested week is already loaded, so that call finds nothing to
// do. Awaiting `tick()` before a final assertion lets it happen and settle
// instead of leaking into a later test.
//
// Known gap vs. real browsers: happy-dom's synthetic `element.click()` never
// moves focus, unlike a real click, which focuses a focusable target before
// its "click" event fires. A test of code that depends on that focus move
// calls `element.focus()` itself right before `element.click()`.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, mock } from "node:test";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { Window } from "happy-dom";

const PUBLIC_DIR = path.join(fileURLToPath(new URL(".", import.meta.url)), "..", "public");

let nextInstanceId = 0;

/**
 * Waits a tick for pending promise callbacks and happy-dom's own timers to
 * run. Uses a real (zero-delay) timer rather than `setImmediate`: a
 * zero-delay `setTimeout` always lets Node's "timers" phase turn, which a
 * `setImmediate`-only tick can keep from happening.
 */
export function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * `text` with every space, such as the thin spaces that `Intl` puts around
 * the dash of a date range, replaced by a plain space.
 *
 * @param {string} text
 */
export function plain(text) {
  return text.replace(/\s/g, " ");
}

/**
 * Waits for `promise` and returns its value. Rejects with an error that has
 * `message` if `promise` doesn't settle within `ms` milliseconds, so a
 * regression fails the test at once instead of waiting for the test timeout.
 * The timer never outlives the wait.
 *
 * @param {Promise<any>} promise
 * @param {string} message
 * @param {number} [ms]
 */
export async function within(promise, message, ms = 2000) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Waits until `predicate()` is true, ticking in between, for tests that drive
 * the page only through DOM events and so have no promise of their own to
 * await. Throws after `attempts` ticks (default 50) rather than hanging. The
 * error ends with `message`, or with the text that it returns, so a test can
 * say what it waited for, such as the requests it saw.
 *
 * @param {() => boolean} predicate
 * @param {{ attempts?: number, message?: string | (() => string) }} [options]
 */
export async function waitFor(predicate, { attempts = 50, message } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;
    await tick();
  }
  const detail = typeof message === "function" ? message() : message;
  throw new Error(
    `waitFor: condition not met after ${attempts} ticks${detail ? `: ${detail}` : ""}`,
  );
}

// The name a screen reader would announce for `element`, best-effort: an
// aria-label, the text of the elements aria-labelledby points to, an
// associated <label for>, the element's own text, or its placeholder.
function accessibleName(element) {
  const ariaLabel = element.getAttribute?.("aria-label");
  if (ariaLabel) return ariaLabel;
  const labelledBy = element.getAttribute?.("aria-labelledby");
  if (labelledBy) {
    const doc = element.ownerDocument;
    const text = labelledBy
      .split(/\s+/)
      .map((id) => doc?.getElementById(id)?.textContent?.trim())
      .filter(Boolean)
      .join(" ");
    if (text) return text;
  }
  if (element.id) {
    const label = element.ownerDocument?.querySelector(`label[for="${element.id}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }
  const text = element.textContent?.trim();
  if (text) return text;
  return element.getAttribute?.("placeholder") ?? undefined;
}

// A short, readable description of `element` for a failed focus assertion:
// its tag, ID, classes, and accessible name, such as `<button#save.primary
// "Save">`. Never handed to node:assert, which would try to diff the whole
// DOM element and hang.
function describeElement(element) {
  if (!element) return "nothing";
  const tag = element.tagName ? element.tagName.toLowerCase() : String(element);
  const id = element.id ? `#${element.id}` : "";
  const classes = element.classList
    ? [...element.classList].map((name) => `.${name}`).join("")
    : "";
  const name = accessibleName(element);
  return `<${tag}${id}${classes}>${name ? ` "${name}"` : ""}`;
}

/**
 * Asserts that `element` has focus in `document`, failing with a short,
 * readable message (tag, ID, classes, and accessible name of the element
 * that's actually focused, and of the one expected) instead of handing DOM
 * elements to `assert.equal`, which hangs trying to diff them.
 */
export function assertFocus(document, element, message) {
  const actual = document.activeElement;
  if (actual === element) return;
  const detail = `focus is on ${describeElement(actual)}, expected ${describeElement(element)}`;
  assert.fail(message ? `${message}: ${detail}` : detail);
}

const NO_FETCH_STUB = async (url) => {
  throw new Error(`This test's fetch stub doesn't expect a request to ${url}.`);
};

// Installs the globals a page script needs on globalThis, remembering what
// was there before so cleanup() can restore it exactly.
function installGlobals(window, fetch) {
  window.confirm = () => {
    throw new Error("This test didn't expect window.confirm to be called.");
  };
  const globals = {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    CSS: window.CSS,
    location: window.location,
    history: window.history,
    fetch: fetch ?? NO_FETCH_STUB,
  };
  const previous = {};
  for (const key of Object.keys(globals)) previous[key] = globalThis[key];
  Object.assign(globalThis, globals);

  let cleaned = false;
  return async function cleanup() {
    if (cleaned) return; // a second call must not undo the globals of a later page
    cleaned = true;
    await window.happyDOM.close(); // cancels any pending happy-dom timer, such as a stray hashchange
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
    // A request that nobody answers times out in the app after 5 seconds, and
    // logs an error in whichever test runs then.
    const pending = fetch?.pending?.() ?? [];
    if (pending.length > 0) {
      const names = pending.map((request) => `${request.method} ${request.url}`).join(", ");
      throw new Error(
        `${pending.length} fake request(s) still pending when the page was cleaned up: ${names}. ` +
          "Answer or abort each request in the test.",
      );
    }
  };
}

/**
 * Loads `html` (a file name under public/, such as "index.html"), installs
 * the globals `script` (a file name under public/, such as "app.js") reads
 * at the top level, and imports `script` fresh. `fetch` stands in for the
 * network; a request the test doesn't expect rejects with a clear message.
 * `beforeScript(window)` runs before the import, for state the script reads
 * when it starts, such as localStorage.
 *
 * Returns `{ window, document, cleanup }`. Always call `cleanup()`, even if
 * the test throws (for example from `afterEach`), so globals and timers
 * never leak into the next test.
 *
 * @param {{
 *   html: string,
 *   script: string,
 *   fetch?: any,
 *   url?: string,
 *   beforeScript?: (window: any) => unknown,
 * }} options
 */
export async function loadPage({
  html,
  script,
  fetch,
  url = "http://localhost/",
  beforeScript = () => {},
}) {
  const markup = await readFile(path.join(PUBLIC_DIR, html), "utf8");
  // The page's own <script type="module"> tag is stripped: the test imports
  // the module itself, fresh, below, instead of letting happy-dom load it.
  const withoutScript = markup.replace(/<script type="module" src="[^"]+"><\/script>\n?/, "");

  const window = new Window({ url });
  window.document.write(withoutScript);
  const { document } = window;

  const cleanup = installGlobals(window, fetch);
  try {
    beforeScript(window);
    await import(`../public/${script}?instance=${nextInstanceId++}`);
  } catch (error) {
    await cleanup().catch(() => {}); // the caller never gets `cleanup`, so nothing else restores the globals
    throw error;
  }

  return { window, document, cleanup };
}

/**
 * `loadPage` for a test: registers `page.cleanup()` with `t.after()`, so the
 * page is cleaned up after the test, whether it passes or fails, and a page
 * that a test opens never depends on a hook that another test's failure could
 * skip. Takes the options of `loadPage`.
 *
 * @param {import("node:test").TestContext} t
 * @param {Parameters<typeof loadPage>[0]} options
 */
export async function openPage(t, options) {
  const page = await loadPage(options);
  t.after(() => page.cleanup());
  return page;
}

/**
 * Builds a document holding only the `<dialog id="ID">` markup from the real
 * public/HTML, installs the globals a dialog module needs, with `fetch` for
 * the network, and imports public/SCRIPT fresh.
 *
 * Returns `{ window, document, dialog, module, cleanup }`. Always call
 * `cleanup()`.
 *
 * @param {{ html: string, id: string, script: string, fetch?: any }} options
 */
export async function loadDialog({ html, id, script, fetch }) {
  const markup = await readFile(path.join(PUBLIC_DIR, html), "utf8");
  const dialogMarkup = markup.match(new RegExp(`<dialog id="${id}"[\\s\\S]*?</dialog>`))[0];

  const window = new Window({ url: "http://localhost/" });
  window.document.write(`<!doctype html><html><body>${dialogMarkup}</body></html>`);
  const { document } = window;

  const cleanup = installGlobals(window, fetch);
  let module;
  try {
    module = await import(`../public/${script}?instance=${nextInstanceId++}`);
  } catch (error) {
    await cleanup().catch(() => {}); // the caller never gets `cleanup`, so nothing else restores the globals
    throw error;
  }

  return { window, document, dialog: document.getElementById(id), module, cleanup };
}

/**
 * The slot editor from the real public/index.html: `loadDialog` plus
 * `editor`, which is `createSlotEditor` applied to the dialog.
 */
export async function loadSlotEditorDialog() {
  const loaded = await loadDialog({
    html: "index.html",
    id: "slot-editor",
    script: "slot-editor.js",
  });
  return { ...loaded, editor: loaded.module.createSlotEditor(loaded.dialog) };
}

/**
 * A controllable fake fetch, modeled on test/saves.test.js's fakeServer():
 * each call is recorded and left pending until the test resolves it with
 * `request.respond(status, body)` or rejects it with `request.fail()`, or the
 * app aborts it. The cleanup of a page fails the test when a request is still
 * pending (`fetch.pending()` lists them).
 */
export function fakeFetch() {
  const requests = [];

  function fetch(url, options = {}) {
    return new Promise((resolve, reject) => {
      const request = {
        url,
        method: options.method ?? "GET",
        body: options.body === undefined ? undefined : JSON.parse(options.body),
        settled: false,
        respond(status, body = {}) {
          request.settled = true;
          resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
        },
        fail() {
          request.settled = true;
          reject(new TypeError("Network error"));
        },
      };
      requests.push(request);
      options.signal?.addEventListener("abort", () => {
        request.settled = true;
        reject(options.signal.reason);
      });
    });
  }

  // The most recent request matching `method` and `url` (a string or a predicate).
  function requestFor(method, url) {
    return [...requests]
      .reverse()
      .find(
        (request) =>
          request.method === method &&
          (typeof url === "function" ? url(request.url) : request.url === url),
      );
  }

  /** The requests that nobody has answered, failed, or aborted. */
  fetch.pending = () => requests.filter((request) => !request.settled);

  return { fetch, requests, requestFor };
}

/**
 * Sets the value of `element` and dispatches the `input` event that typing
 * sends, so the page reacts as it does to a person typing.
 *
 * @param {any} window The window of the page.
 * @param {any} element
 * @param {string} value
 */
export function typeInto(window, element, value) {
  element.value = value;
  element.dispatchEvent(new window.Event("input", { bubbles: true }));
}

/**
 * Dispatches a `keydown` of `key` on `element`, and returns the event, so a
 * test can check whether the page prevented its default.
 *
 * @param {any} window The window of the page.
 * @param {any} element
 * @param {string} key
 */
export function pressKey(window, element, key) {
  const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  return event;
}

/**
 * Dispatches a `pointerdown` on `element`, which the dialogs read to tell a
 * click outside from a click inside.
 *
 * @param {any} window The window of the page.
 * @param {any} element
 */
export function pointerdown(window, element) {
  element.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }));
}

/**
 * Dispatches a `beforeunload` on `window`, and returns the event. A page that
 * asks before it closes calls `preventDefault()` on it.
 *
 * @param {any} window The window of the page.
 */
export function dispatchBeforeUnload(window) {
  const event = new window.Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

/**
 * Waits until the page has sent `method` to `url`, answers it with `status`
 * and `body`, and waits a tick for the page to react.
 *
 * @param {ReturnType<typeof fakeFetch>} server
 * @param {string} method
 * @param {string} url
 * @param {number} status
 * @param {unknown} [body]
 */
export async function respondTo(server, method, url, status, body) {
  await waitFor(() => server.requestFor(method, url) !== undefined, {
    message: () => `no ${method} ${url}; the page sent ${requestList(server)}`,
  });
  server.requestFor(method, url).respond(status, body);
  await tick();
}

/** The requests that the page sent, as `METHOD url` joined by commas. */
function requestList(server) {
  return server.requests.map((request) => `${request.method} ${request.url}`).join(", ") || "none";
}

/**
 * The setup of a catalog page, the recipe book and the ingredient catalog,
 * which load two lists and, before an editor opens, load them again. The
 * `collections` are the names of the two lists, the page's own first, as in
 * `["recipes", "ingredients"]`: each is both the path of its request,
 * `/api/recipes`, and the key of its answer, `{ recipes }`.
 *
 * `open(t, lists)` loads the page and answers its two requests with `lists`,
 * an object that holds an array for each collection. It resolves to `{ page,
 * server, served }`, where `served` is `lists`. `clickAndReload(button,
 * fresh)` clicks New or Edit and answers the reload with `fresh`, by default
 * with `served`. `reloadRequests()` waits for the reload and returns its
 * requests by collection, and `requestUrls()` lists the requests so far.
 *
 * @param {{ html: string, script: string, collections: [string, string] }} options
 */
export function catalogPage({ html, script, collections }) {
  const [own, other] = collections;
  /** @type {ReturnType<typeof fakeFetch>} */
  let server;
  /** @type {Record<string, unknown[]>} */
  let served;

  const requestUrls = () => server.requests.map((request) => request.url).join(", ");

  function answer(requests, lists) {
    for (const name of collections) requests[name].respond(200, { [name]: lists[name] });
  }

  async function open(t, lists) {
    server = fakeFetch();
    served = lists;
    const page = await openPage(t, { html, script, fetch: server.fetch });
    await tick();
    answer(
      Object.fromEntries(
        collections.map((name) => [name, server.requestFor("GET", `/api/${name}`)]),
      ),
      lists,
    );
    await tick();
    return { page, server, served };
  }

  // Waits for the reload that New and Edit send before the editor opens.
  async function reloadRequests() {
    await waitFor(
      () => server.requests.filter((request) => request.url === `/api/${own}`).length === 2,
      {
        message: () => `the page sent ${requestUrls()}, not a load and a reload of the ${own}`,
      },
    );
    return Object.fromEntries(
      [own, other].map((name) => [name, server.requestFor("GET", `/api/${name}`)]),
    );
  }

  // Clicks New or Edit, and answers the reload with `fresh`, or else with the
  // data that the page loaded with.
  async function clickAndReload(button, fresh = served) {
    button.click();
    answer(await reloadRequests(), fresh);
    await tick();
  }

  return { open, clickAndReload, reloadRequests, requestUrls };
}

/**
 * Asserts that the calls to `console.error` in `calls` (each an array of the
 * logged arguments) are as many as `expected`, and fails with the logged
 * arguments, so an error that nobody expected is easy to find.
 *
 * @param {unknown[][]} calls
 * @param {number} expected
 */
export function assertLoggedErrors(calls, expected) {
  if (calls.length === expected) return;
  const describe = (/** @type {unknown} */ arg) =>
    typeof arg === "string" ? arg : arg instanceof Error ? String(arg) : inspect(arg);
  const logged = calls.map((args) => `  ${args.map(describe).join(" ")}`).join("\n");
  assert.fail(
    `Expected ${expected} console.error call(s), got ${calls.length}${logged ? `:\n${logged}` : ""}`,
  );
}

/**
 * Silences `console.error` in every test of the file (or of the enclosing
 * `describe`), and fails the test that logs an error nobody expected, like
 * the browser tests do. A test that makes the app log on purpose, for
 * example by failing a request, calls `expect(count)` with the number of
 * errors it provokes. Call `useQuietConsole()` once at the top of a test
 * file.
 *
 * @returns {{ expect: (count: number) => void, calls: () => unknown[][] }}
 */
export function useQuietConsole() {
  /** @type {unknown[][]} */
  let calls = [];
  let expected = 0;
  /** @type {any} */
  let spy;

  beforeEach(() => {
    calls = [];
    expected = 0;
    spy = mock.method(console, "error", (/** @type {unknown[]} */ ...args) => {
      // Node reports an experimental feature, such as the mock timers, through
      // console.error, unless the run disables the warning. That's not the page.
      const [first] = args;
      if (typeof first === "string" && /^\(node:\d+\) ExperimentalWarning/.test(first)) return;
      calls.push(args);
    });
  });

  afterEach(() => {
    spy.mock.restore();
    assertLoggedErrors(calls, expected);
  });

  return {
    expect(count) {
      expected = count;
    },
    calls: () => calls,
  };
}
