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
// open). loadPage() installs a stub that throws when a test doesn't expect
// it to be called; a test that needs it replaces it with
// `mock.method(window, "confirm", () => true)` (or `false`), same as it
// would mock any other method.
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

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";

const PUBLIC_DIR = path.join(fileURLToPath(new URL(".", import.meta.url)), "..", "public");

let nextInstanceId = 0;

/**
 * Waits a tick for pending promise callbacks and happy-dom's own timers to
 * run. Uses a real (zero-delay) timer rather than `setImmediate`: app.js
 * chains `requestAnimationFrame` into a `setTimeout`, and happy-dom's
 * `requestAnimationFrame` schedules through the "check" phase too, so a
 * `setImmediate`-only tick can keep re-entering "check" without ever letting
 * Node's "timers" phase turn -- a zero-delay `setTimeout` always crosses it.
 */
export function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Waits until `predicate()` is true, ticking in between, for tests that drive
 * the page only through DOM events and so have no promise of their own to
 * await. Throws after `attempts` ticks (default 50) rather than hanging.
 */
export async function waitFor(predicate, { attempts = 50 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;
    await tick();
  }
  throw new Error(`waitFor: condition not met after ${attempts} ticks`);
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
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    fetch: fetch ?? NO_FETCH_STUB,
  };
  const previous = {};
  for (const key of Object.keys(globals)) previous[key] = globalThis[key];
  Object.assign(globalThis, globals);

  return async function cleanup() {
    await window.happyDOM.close(); // cancels any pending happy-dom timer, such as a stray hashchange
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  };
}

/**
 * Loads `html` (a file name under public/, such as "index.html"), installs
 * the globals `script` (a file name under public/, such as "app.js") reads
 * at the top level, and imports `script` fresh. `fetch` stands in for the
 * network; a request the test doesn't expect rejects with a clear message.
 *
 * Returns `{ window, document, cleanup }`. Always call `cleanup()`, even if
 * the test throws (for example from `afterEach`), so globals and timers
 * never leak into the next test.
 */
export async function loadPage({ html, script, fetch, url = "http://localhost/" }) {
  const markup = await readFile(path.join(PUBLIC_DIR, html), "utf8");
  // The page's own <script type="module"> tag is stripped: the test imports
  // the module itself, fresh, below, instead of letting happy-dom load it.
  const withoutScript = markup.replace(/<script type="module" src="[^"]+"><\/script>\n?/, "");

  const window = new Window({ url });
  window.document.write(withoutScript);
  const { document } = window;

  const cleanup = installGlobals(window, fetch);
  await import(`../public/${script}?instance=${nextInstanceId++}`);

  return { window, document, cleanup };
}

/**
 * Builds a document holding only the `<dialog id="ID">` markup from the real
 * public/HTML, installs the globals a dialog module needs, with `fetch` for
 * the network, and imports public/SCRIPT fresh.
 *
 * Returns `{ window, document, dialog, module, cleanup }`. Always call
 * `cleanup()`.
 */
export async function loadDialog({ html, id, script, fetch }) {
  const markup = await readFile(path.join(PUBLIC_DIR, html), "utf8");
  const dialogMarkup = markup.match(new RegExp(`<dialog id="${id}"[\\s\\S]*?</dialog>`))[0];

  const window = new Window({ url: "http://localhost/" });
  window.document.write(`<!doctype html><html><body>${dialogMarkup}</body></html>`);
  const { document } = window;

  const cleanup = installGlobals(window, fetch);
  const module = await import(`../public/${script}?instance=${nextInstanceId++}`);

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
 * `request.respond(status, body)` or rejects it with `request.fail()`.
 */
export function fakeFetch() {
  const requests = [];

  function fetch(url, options = {}) {
    return new Promise((resolve, reject) => {
      const request = {
        url,
        method: options.method ?? "GET",
        body: options.body === undefined ? undefined : JSON.parse(options.body),
        respond(status, body = {}) {
          resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
        },
        fail() {
          reject(new TypeError("Network error"));
        },
      };
      requests.push(request);
      options.signal?.addEventListener("abort", () => reject(options.signal.reason));
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

  return { fetch, requests, requestFor };
}
