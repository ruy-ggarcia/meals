import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { createSaves } from "../public/saves.js";

// A fake server: each PUT waits until the test answers it.
function fakeServer() {
  const requests = [];
  function fetch(url, options) {
    return new Promise((resolve, reject) => {
      requests.push({
        url,
        text: JSON.parse(options.body).text,
        keepalive: options.keepalive === true,
        ok: () => resolve({ ok: true, status: 200 }),
        fail: () => reject(new TypeError("Network error")),
      });
      options.signal?.addEventListener("abort", () => reject(options.signal.reason));
    });
  }
  return { fetch, requests };
}

// Lets pending promise callbacks run.
function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Waits with a timer that keeps Node.js running: AbortSignal.timeout doesn't.
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setup({ timeoutMs = 1000 } = {}) {
  const server = fakeServer();
  const texts = new Map(); // what each cell shows
  const statuses = new Map(); // the last status reported per cell
  const saves = createSaves({
    fetch: server.fetch,
    url: (key) => `/api/${key}`,
    readText: (key) => texts.get(key),
    onStatus: (key, state) => statuses.set(key, state),
    timeoutMs,
  });
  saves.loaded([["mon/lunch", ""]]);
  texts.set("mon/lunch", "");
  return { saves, server, texts, statuses };
}

const KEY = "mon/lunch";

beforeEach(() => {
  mock.method(console, "error", () => {}); // failed saves log on purpose
});

afterEach(() => {
  mock.restoreAll();
});

test("loaded marks every cell as idle", () => {
  const { statuses } = setup();
  assert.equal(statuses.get(KEY), "idle");
});

test("queueSave sends the current text and marks the cell as saved", async () => {
  const { saves, server, texts, statuses } = setup();
  texts.set(KEY, "Soup");

  const done = saves.queueSave(KEY);
  await tick();
  assert.equal(statuses.get(KEY), "saving");
  assert.equal(server.requests.length, 1);
  assert.equal(server.requests[0].url, "/api/mon/lunch");
  assert.equal(server.requests[0].text, "Soup");

  server.requests[0].ok();
  await done;
  assert.equal(statuses.get(KEY), "saved");
});

test("queueSave sends nothing when the text is unchanged", async () => {
  const { saves, server } = setup();
  await saves.queueSave(KEY);
  assert.equal(server.requests.length, 0);
});

test("a failed save marks the cell as an error, and a retry saves it", async () => {
  const { saves, server, texts, statuses } = setup();
  texts.set(KEY, "Soup");

  const first = saves.queueSave(KEY);
  await tick();
  server.requests[0].fail();
  await first;
  assert.equal(statuses.get(KEY), "error");

  const retry = saves.queueSave(KEY);
  await tick();
  assert.equal(server.requests.length, 2);
  server.requests[1].ok();
  await retry;
  assert.equal(statuses.get(KEY), "saved");
});

test("a save gives up after the timeout", async () => {
  const { saves, texts, statuses } = setup({ timeoutMs: 20 });
  texts.set(KEY, "Soup");
  const done = saves.queueSave(KEY); // the fake server never answers
  await sleep(50);
  await done;
  assert.equal(statuses.get(KEY), "error");
});

test("a retry with the text the server already has clears the error", async () => {
  const { saves, server, texts, statuses } = setup();
  texts.set(KEY, "Soup");
  const first = saves.queueSave(KEY);
  await tick();
  server.requests[0].fail();
  await first;

  texts.set(KEY, ""); // back to the saved text
  await saves.queueSave(KEY);
  assert.equal(server.requests.length, 1);
  assert.equal(statuses.get(KEY), "idle");
});

test("saves of one cell run in order: a newer save waits for the older one", async () => {
  const { saves, server, texts } = setup();
  texts.set(KEY, "Soup");
  saves.queueSave(KEY);
  await tick();
  texts.set(KEY, "Soup and bread");
  const second = saves.queueSave(KEY);
  await tick();
  assert.equal(server.requests.length, 1, "the second save waits");

  server.requests[0].ok();
  await tick();
  assert.equal(server.requests.length, 2);
  assert.equal(server.requests[1].text, "Soup and bread");
  server.requests[1].ok();
  await second;
});

test("flush sends each changed cell with keepalive and skips unchanged cells", async () => {
  const { saves, server, texts } = setup();
  saves.loaded([["tue/lunch", "Rice"]]);
  texts.set("tue/lunch", "Rice");
  texts.set(KEY, "Soup");

  saves.flush([KEY, "tue/lunch"], { skipInFlight: false });
  await tick();
  assert.equal(server.requests.length, 1);
  assert.equal(server.requests[0].text, "Soup");
  assert.equal(server.requests[0].keepalive, true);
});

test("flush skips cells that were never loaded", async () => {
  const { saves, server, texts } = setup();
  texts.set("wed/lunch", "Fish");
  saves.flush(["wed/lunch"], { skipInFlight: false });
  await tick();
  assert.equal(server.requests.length, 0);
});

test("a second flush and a later queueSave don't resend the flushed text", async () => {
  const { saves, server, texts } = setup();
  texts.set(KEY, "Soup");
  saves.flush([KEY], { skipInFlight: true });
  saves.flush([KEY], { skipInFlight: false });
  await saves.queueSave(KEY);
  assert.equal(server.requests.length, 1);
});

test("flush with skipInFlight skips a cell whose queued save carries the same text", async () => {
  const { saves, server, texts } = setup();
  texts.set(KEY, "Soup");
  saves.queueSave(KEY);
  await tick();
  saves.flush([KEY], { skipInFlight: true });
  await tick();
  assert.equal(server.requests.length, 1);
  assert.equal(server.requests[0].keepalive, false);
});

test("flush without skipInFlight resends a text whose queued save is in flight", async () => {
  const { saves, server, texts } = setup();
  texts.set(KEY, "Soup");
  saves.queueSave(KEY);
  await tick();
  saves.flush([KEY], { skipInFlight: false }); // pagehide may cancel the queued save
  await tick();
  assert.equal(server.requests.length, 2);
  assert.equal(server.requests[1].text, "Soup");
  assert.equal(server.requests[1].keepalive, true);
});

test("after a failed flush, the next queueSave retries the text", async () => {
  const { saves, server, texts } = setup();
  texts.set(KEY, "Soup");
  saves.flush([KEY], { skipInFlight: false });
  await tick();
  server.requests[0].fail();
  await tick();

  saves.queueSave(KEY);
  await tick();
  assert.equal(server.requests.length, 2);
  assert.equal(server.requests[1].text, "Soup");
});

test("a successful flush clears an earlier error of the cell", async () => {
  const { saves, server, texts, statuses } = setup();
  texts.set(KEY, "Soup");
  const first = saves.queueSave(KEY);
  await tick();
  server.requests[0].fail();
  await first;

  saves.flush([KEY], { skipInFlight: false });
  await tick();
  server.requests[1].ok();
  await tick();
  assert.equal(statuses.get(KEY), "idle");
});

// A week change waits for every pending save, then asks about unsaved cells.

test("settle waits for queued saves and page-hide saves", async () => {
  const { saves, server, texts } = setup();
  saves.loaded([["tue/lunch", ""]]);
  texts.set(KEY, "Soup");
  texts.set("tue/lunch", "Rice");
  saves.queueSave(KEY);
  saves.flush(["tue/lunch"], { skipInFlight: false });
  let settled = false;
  const done = saves.settle().then(() => {
    settled = true;
  });
  await tick();

  server.requests.find((request) => request.text === "Soup").ok();
  await tick();
  assert.equal(settled, false, "the page-hide save is still pending");
  server.requests.find((request) => request.text === "Rice").ok();
  await done;
});

test("settle also waits for page-hide saves that start while it waits", async () => {
  const { saves, server, texts, statuses } = setup();
  saves.loaded([["tue/lunch", ""]]);
  texts.set(KEY, "Soup");
  saves.queueSave(KEY);
  let settled = false;
  const done = saves.settle().then(() => {
    settled = true;
  });
  await tick();

  texts.set("tue/lunch", "Rice");
  saves.flush([KEY, "tue/lunch"], { skipInFlight: true }); // the page is hidden during the wait
  server.requests.find((request) => request.text === "Soup").ok();
  await tick();
  assert.equal(settled, false, "the page-hide save that started during the wait is pending");

  server.requests.find((request) => request.text === "Rice").fail();
  await done;
  assert.equal(statuses.get("tue/lunch"), "error");
  assert.deepEqual(saves.unsaved([KEY, "tue/lunch"]), ["tue/lunch"]);
});

test("a failed page-hide save marks the cell as an error and leaves it unsaved", async () => {
  const { saves, server, texts, statuses } = setup();
  texts.set(KEY, "Soup");
  saves.flush([KEY], { skipInFlight: false });
  server.requests[0].fail();
  await saves.settle();
  assert.equal(statuses.get(KEY), "error");
  assert.deepEqual(saves.unsaved([KEY]), [KEY]);
});

test("a page-hide save gives up after the timeout", async () => {
  const { saves, texts, statuses } = setup({ timeoutMs: 20 });
  texts.set(KEY, "Soup");
  saves.flush([KEY], { skipInFlight: false }); // the fake server never answers
  await sleep(50);
  await saves.settle();
  assert.equal(statuses.get(KEY), "error");
});

test("a failed page-hide save doesn't mark the cell when a newer save replaced its text", async () => {
  const { saves, server, texts, statuses } = setup();
  texts.set(KEY, "Soup");
  saves.flush([KEY], { skipInFlight: false });
  texts.set(KEY, "Soup and bread");
  const newer = saves.queueSave(KEY);
  await tick();
  server.requests[1].ok();
  await newer;

  server.requests[0].fail();
  await saves.settle();
  assert.equal(statuses.get(KEY), "saved");
  assert.deepEqual(saves.unsaved([KEY]), []);
});

test("a failed page-hide save doesn't mark the cell while a newer save runs", async () => {
  const { saves, server, texts, statuses } = setup();
  texts.set(KEY, "Soup");
  saves.flush([KEY], { skipInFlight: false });
  texts.set(KEY, "Soup and bread");
  const newer = saves.queueSave(KEY);
  await tick();

  server.requests[0].fail();
  await tick();
  assert.equal(statuses.get(KEY), "saving");
  server.requests[1].ok();
  await newer;
  assert.equal(statuses.get(KEY), "saved");
});

test("unsaved lists loaded cells whose text differs from the saved text", () => {
  const { saves, texts } = setup();
  saves.loaded([["tue/lunch", "Rice"]]);
  texts.set("tue/lunch", "Rice");
  texts.set(KEY, "Soup");
  texts.set("wed/lunch", "Fish"); // never loaded
  assert.deepEqual(saves.unsaved([KEY, "tue/lunch", "wed/lunch"]), [KEY]);
});

test("discard returns the saved text and clears the error, so no later save sends the discarded text", async () => {
  const { saves, server, texts, statuses } = setup();
  texts.set(KEY, "Soup");
  const failed = saves.queueSave(KEY);
  await tick();
  server.requests[0].fail();
  await failed;

  texts.set(KEY, saves.discard(KEY));
  assert.equal(texts.get(KEY), "");
  assert.equal(statuses.get(KEY), "idle");

  await saves.queueSave(KEY); // for example, the window gets focus back
  saves.flush([KEY], { skipInFlight: false });
  await tick();
  assert.equal(server.requests.length, 1);
});
