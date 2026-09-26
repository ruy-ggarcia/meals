import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { sameMenu } from "../public/menus.js";
import { createSaves } from "../public/saves.js";

function menu(...recipeIds) {
  return { items: recipeIds.map((recipeId) => ({ recipeId, servings: 1 })) };
}

const EMPTY = menu();
const SOUP = menu("soup");
const SOUP_AND_BREAD = menu("soup", "bread");
const SOUP_BREAD_AND_FRUIT = menu("soup", "bread", "fruit");
const RICE = menu("rice");
const FISH = menu("fish");

// A fake server: each PUT waits until the test answers it.
function fakeServer() {
  const requests = [];
  function fetch(url, options) {
    return new Promise((resolve, reject) => {
      requests.push({
        url,
        method: options.method,
        body: JSON.parse(options.body),
        keepalive: options.keepalive === true,
        ok: () => resolve({ ok: true, status: 200 }),
        fail: () => reject(new TypeError("Network error")),
      });
      options.signal?.addEventListener("abort", () => reject(options.signal.reason));
    });
  }
  // The request that carries `expected`.
  function requestWith(expected) {
    return requests.find((request) => sameMenu(request.body, expected));
  }
  return { fetch, requests, requestWith };
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
  const menus = new Map(); // what each slot shows
  const statuses = new Map(); // the last status reported per slot
  const saves = createSaves({
    fetch: server.fetch,
    url: (key) => `/api/${key}`,
    readMenu: (key) => menus.get(key),
    onStatus: (key, state) => statuses.set(key, state),
    timeoutMs,
  });
  saves.loaded([[KEY, EMPTY]]);
  menus.set(KEY, EMPTY);
  return { saves, server, menus, statuses };
}

const KEY = "mon/lunch";

beforeEach(() => {
  mock.method(console, "error", () => {}); // failed saves log on purpose
});

afterEach(() => {
  mock.restoreAll();
});

test("loaded marks every slot as idle", () => {
  const { statuses } = setup();
  assert.equal(statuses.get(KEY), "idle");
});

test("loaded copies the menu, so mutating the object afterward doesn't change the saved state", async () => {
  const { saves, server, menus } = setup();
  const original = menu("soup");
  saves.loaded([["wed/lunch", original]]);
  original.items.push({ recipeId: "bread", servings: 1 }); // the caller reuses the object

  menus.set("wed/lunch", menu("soup")); // unchanged from what was loaded, before the mutation
  saves.queueSave("wed/lunch");
  await tick();

  assert.equal(
    server.requests.length,
    0,
    "loaded must not have kept a reference to the mutated menu",
  );
});

test("queueSave sends the current menu and marks the slot as saved", async () => {
  const { saves, server, menus, statuses } = setup();
  menus.set(KEY, SOUP);

  const done = saves.queueSave(KEY);
  await tick();
  assert.equal(statuses.get(KEY), "saving");
  assert.equal(server.requests.length, 1);
  assert.equal(server.requests[0].url, "/api/mon/lunch");
  assert.equal(server.requests[0].method, "PUT");
  assert.deepEqual(server.requests[0].body, SOUP);

  server.requests[0].ok();
  await done;
  assert.equal(statuses.get(KEY), "saved");
});

test("the PUT body holds exactly the menu items, nothing else the menu carries", async () => {
  const { saves, server, menus } = setup();
  menus.set(KEY, { items: [{ recipeId: "soup", servings: 1.5 }], extra: "not part of the menu" });

  saves.queueSave(KEY);
  await tick();

  assert.deepEqual(server.requests[0].body, { items: [{ recipeId: "soup", servings: 1.5 }] });
});

test("queueSave sends nothing when the menu is unchanged", async () => {
  const { saves, server } = setup();
  await saves.queueSave(KEY);
  assert.equal(server.requests.length, 0);
});

test("an equal menu in a new object counts as unchanged", async () => {
  const { saves, server, menus } = setup();
  menus.set(KEY, menu());
  await saves.queueSave(KEY);
  assert.equal(server.requests.length, 0);
});

test("queueSave does nothing for a slot that isn't loaded", async () => {
  const { saves, server } = setup();
  await saves.queueSave("wed/lunch");
  assert.equal(server.requests.length, 0);
});

test("queueSave does nothing for a slot that isn't loaded, even when readMenu returns a menu for it", async () => {
  const { saves, server, menus } = setup();
  menus.set("wed/lunch", SOUP); // for example, a slot element left over from a previous week
  saves.queueSave("wed/lunch");
  await tick();
  assert.equal(server.requests.length, 0);
});

test("changing a menu object after its save doesn't change what counts as saved", async () => {
  const { saves, server, menus } = setup();
  const shown = menu("soup");
  menus.set(KEY, shown);
  const first = saves.queueSave(KEY);
  await tick();
  server.requests[0].ok();
  await first;

  shown.items.push({ recipeId: "bread", servings: 1 }); // the caller reuses the object
  saves.queueSave(KEY);
  await tick();

  assert.equal(server.requests.length, 2);
  assert.deepEqual(server.requests[1].body, SOUP_AND_BREAD);
});

test("a failed save marks the slot as an error, and a retry saves it", async () => {
  const { saves, server, menus, statuses } = setup();
  menus.set(KEY, SOUP);

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
  const { saves, menus, statuses } = setup({ timeoutMs: 20 });
  menus.set(KEY, SOUP);
  const done = saves.queueSave(KEY); // the fake server never answers
  await sleep(50);
  await done;
  assert.equal(statuses.get(KEY), "error");
});

test("a retry with the menu the server already has clears the error", async () => {
  const { saves, server, menus, statuses } = setup();
  menus.set(KEY, SOUP);
  const first = saves.queueSave(KEY);
  await tick();
  server.requests[0].fail();
  await first;

  menus.set(KEY, EMPTY); // back to the saved menu
  await saves.queueSave(KEY);
  assert.equal(server.requests.length, 1);
  assert.equal(statuses.get(KEY), "idle");
});

test("saves of one slot run in order: a newer save waits for the older one", async () => {
  const { saves, server, menus } = setup();
  menus.set(KEY, SOUP);
  saves.queueSave(KEY);
  await tick();
  menus.set(KEY, SOUP_AND_BREAD);
  const second = saves.queueSave(KEY);
  await tick();
  assert.equal(server.requests.length, 1, "the second save waits");

  server.requests[0].ok();
  await tick();
  assert.equal(server.requests.length, 2);
  assert.deepEqual(server.requests[1].body, SOUP_AND_BREAD);
  server.requests[1].ok();
  await second;
});

test("flush sends each changed slot with keepalive and skips unchanged slots", async () => {
  const { saves, server, menus } = setup();
  saves.loaded([["tue/lunch", RICE]]);
  menus.set("tue/lunch", RICE);
  menus.set(KEY, SOUP);

  saves.flush([KEY, "tue/lunch"], { skipInFlight: false });
  await tick();
  assert.equal(server.requests.length, 1);
  assert.deepEqual(server.requests[0].body, SOUP);
  assert.equal(server.requests[0].keepalive, true);
});

test("flush copies the menu, so mutating it afterward doesn't change the saved state", async () => {
  const { saves, server, menus } = setup();
  const original = menu("soup");
  menus.set(KEY, original);
  saves.flush([KEY], { skipInFlight: false });
  await tick();
  server.requests[0].ok();
  await tick();

  original.items.push({ recipeId: "bread", servings: 1 }); // mutate after flush read it

  menus.set(KEY, menu("soup")); // unchanged from what flush saved, before the mutation
  saves.queueSave(KEY);
  await tick();

  assert.equal(
    server.requests.length,
    1,
    "flush must not have kept a reference to the mutated menu",
  );
});

test("flush skips slots that were never loaded", async () => {
  const { saves, server, menus } = setup();
  menus.set("wed/lunch", FISH);
  saves.flush(["wed/lunch"], { skipInFlight: false });
  await tick();
  assert.equal(server.requests.length, 0);
});

test("flush skips a loaded slot whose readMenu now returns undefined, and still flushes the other keys", async () => {
  const { saves, server, menus } = setup();
  saves.loaded([["tue/lunch", EMPTY]]);
  menus.set("tue/lunch", RICE); // changed since it was loaded
  menus.delete(KEY); // KEY was loaded in setup(), but its menu vanished (for example, removed from the DOM)

  assert.doesNotThrow(() => saves.flush([KEY, "tue/lunch"], { skipInFlight: false }));
  await tick();

  assert.equal(server.requests.length, 1);
  assert.deepEqual(server.requests[0].body, RICE);
});

test("a second flush and a later queueSave don't resend the flushed menu", async () => {
  const { saves, server, menus } = setup();
  menus.set(KEY, SOUP);
  saves.flush([KEY], { skipInFlight: true });
  saves.flush([KEY], { skipInFlight: false });
  await saves.queueSave(KEY);
  assert.equal(server.requests.length, 1);
});

test("flush with skipInFlight skips a slot whose queued save carries the same menu", async () => {
  const { saves, server, menus } = setup();
  menus.set(KEY, SOUP);
  saves.queueSave(KEY);
  await tick();
  saves.flush([KEY], { skipInFlight: true });
  await tick();
  assert.equal(server.requests.length, 1);
  assert.equal(server.requests[0].keepalive, false);
});

test("flush without skipInFlight resends a menu whose queued save is in flight", async () => {
  const { saves, server, menus } = setup();
  menus.set(KEY, SOUP);
  saves.queueSave(KEY);
  await tick();
  saves.flush([KEY], { skipInFlight: false }); // pagehide may cancel the queued save
  await tick();
  assert.equal(server.requests.length, 2);
  assert.deepEqual(server.requests[1].body, SOUP);
  assert.equal(server.requests[1].keepalive, true);
});

test("after a failed flush, the next queueSave retries the menu", async () => {
  const { saves, server, menus } = setup();
  menus.set(KEY, SOUP);
  saves.flush([KEY], { skipInFlight: false });
  await tick();
  server.requests[0].fail();
  await tick();

  saves.queueSave(KEY);
  await tick();
  assert.equal(server.requests.length, 2);
  assert.deepEqual(server.requests[1].body, SOUP);
});

test("a successful flush clears an earlier error of the slot", async () => {
  const { saves, server, menus, statuses } = setup();
  menus.set(KEY, SOUP);
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

// A week change waits for every pending save, then asks about unsaved slots.

test("settle waits for queued saves and page-hide saves", async () => {
  const { saves, server, menus } = setup();
  saves.loaded([["tue/lunch", EMPTY]]);
  menus.set(KEY, SOUP);
  menus.set("tue/lunch", RICE);
  saves.queueSave(KEY);
  saves.flush(["tue/lunch"], { skipInFlight: false });
  let settled = false;
  const done = saves.settle().then(() => {
    settled = true;
  });
  await tick();

  server.requestWith(SOUP).ok();
  await tick();
  assert.equal(settled, false, "the page-hide save is still pending");
  server.requestWith(RICE).ok();
  await done;
});

test("settle also waits for page-hide saves that start while it waits", async () => {
  const { saves, server, menus, statuses } = setup();
  saves.loaded([["tue/lunch", EMPTY]]);
  menus.set(KEY, SOUP);
  saves.queueSave(KEY);
  let settled = false;
  const done = saves.settle().then(() => {
    settled = true;
  });
  await tick();

  menus.set("tue/lunch", RICE);
  saves.flush([KEY, "tue/lunch"], { skipInFlight: true }); // the page is hidden during the wait
  server.requestWith(SOUP).ok();
  await tick();
  assert.equal(settled, false, "the page-hide save that started during the wait is pending");

  server.requestWith(RICE).fail();
  await done;
  assert.equal(statuses.get("tue/lunch"), "error");
  assert.deepEqual(saves.unsaved([KEY, "tue/lunch"]), ["tue/lunch"]);
});

test("a failed page-hide save marks the slot as an error and leaves it unsaved", async () => {
  const { saves, server, menus, statuses } = setup();
  menus.set(KEY, SOUP);
  saves.flush([KEY], { skipInFlight: false });
  server.requests[0].fail();
  await saves.settle();
  assert.equal(statuses.get(KEY), "error");
  assert.deepEqual(saves.unsaved([KEY]), [KEY]);
});

test("a page-hide save gives up after the timeout", async () => {
  const { saves, menus, statuses } = setup({ timeoutMs: 20 });
  menus.set(KEY, SOUP);
  saves.flush([KEY], { skipInFlight: false }); // the fake server never answers
  await sleep(50);
  await saves.settle();
  assert.equal(statuses.get(KEY), "error");
});

test("a failed page-hide save doesn't mark the slot when a newer save replaced its menu", async () => {
  const { saves, server, menus, statuses } = setup();
  menus.set(KEY, SOUP);
  saves.flush([KEY], { skipInFlight: false });
  menus.set(KEY, SOUP_AND_BREAD);
  const newer = saves.queueSave(KEY);
  await tick();
  server.requests[1].ok();
  await newer;

  server.requests[0].fail();
  await saves.settle();
  assert.equal(statuses.get(KEY), "saved");
  assert.deepEqual(saves.unsaved([KEY]), []);
});

test("a failed page-hide save doesn't mark the slot while a newer save runs", async () => {
  const { saves, server, menus, statuses } = setup();
  menus.set(KEY, SOUP);
  saves.flush([KEY], { skipInFlight: false });
  menus.set(KEY, SOUP_AND_BREAD);
  const newer = saves.queueSave(KEY);
  await tick();

  server.requests[0].fail();
  await tick();
  assert.equal(statuses.get(KEY), "saving");
  server.requests[1].ok();
  await newer;
  assert.equal(statuses.get(KEY), "saved");
});

test("unsaved lists loaded slots whose menu differs from the saved menu", () => {
  const { saves, menus } = setup();
  saves.loaded([["tue/lunch", RICE]]);
  menus.set("tue/lunch", RICE);
  menus.set(KEY, SOUP);
  menus.set("wed/lunch", FISH); // never loaded
  assert.deepEqual(saves.unsaved([KEY, "tue/lunch", "wed/lunch"]), [KEY]);
});

test("unsaved skips a loaded slot whose readMenu now returns undefined", () => {
  const { saves, menus } = setup();
  menus.delete(KEY); // KEY was loaded in setup(), but its menu vanished (for example, removed from the DOM)
  assert.deepEqual(saves.unsaved([KEY]), []);
});

test("discard returns a copy, so mutating it afterward doesn't change the saved state", async () => {
  const { saves, server, menus } = setup();
  menus.set(KEY, SOUP);
  const failed = saves.queueSave(KEY);
  await tick();
  server.requests[0].fail();
  await failed;

  const discarded = saves.discard(KEY);
  discarded.items.push({ recipeId: "bread", servings: 1 }); // mutate the returned menu

  menus.set(KEY, EMPTY); // the saved menu, before the mutation
  saves.queueSave(KEY);
  await tick();

  assert.equal(
    server.requests.length,
    1,
    "discard must not have returned a reference to the saved menu",
  );
});

test("discard returns the saved menu and clears the error, so no later save sends the discarded menu", async () => {
  const { saves, server, menus, statuses } = setup();
  menus.set(KEY, SOUP);
  const failed = saves.queueSave(KEY);
  await tick();
  server.requests[0].fail();
  await failed;

  menus.set(KEY, saves.discard(KEY));
  assert.deepEqual(menus.get(KEY), EMPTY);
  assert.equal(statuses.get(KEY), "idle");

  await saves.queueSave(KEY); // for example, a later Done without changes
  saves.flush([KEY], { skipInFlight: false });
  await tick();
  assert.equal(server.requests.length, 1);
});

test("a late successful page-hide save keeps the error of a newer menu that failed", async () => {
  const { saves, server, menus, statuses } = setup();
  menus.set(KEY, SOUP);
  saves.flush([KEY], { skipInFlight: false }); // the page is hidden; this save is slow
  menus.set(KEY, SOUP_AND_BREAD);
  const newer = saves.queueSave(KEY);
  await tick();
  server.requests[1].fail();
  await newer;
  assert.equal(statuses.get(KEY), "error");

  server.requests[0].ok();
  await saves.settle();
  assert.equal(statuses.get(KEY), "error", "the slot still has an unsaved menu");
});

test("when two page-hide saves of a slot fail, a later save sends the menu again", async () => {
  const { saves, server, menus } = setup();
  menus.set(KEY, SOUP);
  saves.flush([KEY], { skipInFlight: false });
  menus.set(KEY, SOUP_AND_BREAD);
  saves.flush([KEY], { skipInFlight: false });
  server.requests[0].fail();
  server.requests[1].fail();
  await saves.settle();

  menus.set(KEY, SOUP); // the server never received it
  saves.queueSave(KEY);
  await tick();
  assert.equal(server.requests.length, 3);
  assert.deepEqual(server.requests[2].body, SOUP);
});

test("when two page-hide saves of a slot fail, discard returns the menu the server has", async () => {
  const { saves, server, menus } = setup();
  menus.set(KEY, SOUP);
  saves.flush([KEY], { skipInFlight: false });
  menus.set(KEY, SOUP_AND_BREAD);
  saves.flush([KEY], { skipInFlight: false });
  server.requests[0].fail();
  server.requests[1].fail();
  await saves.settle();

  assert.deepEqual(saves.discard(KEY), EMPTY);
});

test("a page-hide save confirmed after a newer save doesn't replace the newer menu", async () => {
  const { saves, server, menus } = setup();
  menus.set(KEY, SOUP);
  saves.flush([KEY], { skipInFlight: false }); // sent first, answered last
  menus.set(KEY, SOUP_AND_BREAD);
  const newer = saves.queueSave(KEY);
  await tick();
  server.requests[1].ok();
  await newer;
  server.requests[0].ok();
  await saves.settle();

  menus.set(KEY, SOUP_BREAD_AND_FRUIT);
  const failed = saves.queueSave(KEY);
  await tick();
  server.requests[2].fail();
  await failed;
  assert.deepEqual(saves.discard(KEY), SOUP_AND_BREAD);
});

test("after a successful page-hide save, discard returns its menu", async () => {
  const { saves, server, menus } = setup();
  menus.set(KEY, SOUP);
  saves.flush([KEY], { skipInFlight: false });
  server.requests[0].ok();
  await saves.settle();

  menus.set(KEY, SOUP_AND_BREAD);
  const failed = saves.queueSave(KEY);
  await tick();
  server.requests[1].fail();
  await failed;
  assert.deepEqual(saves.discard(KEY), SOUP);
});

test("when an older page-hide save succeeds after a newer one failed, discard returns the older menu", async () => {
  const { saves, server, menus } = setup();
  menus.set(KEY, SOUP);
  saves.flush([KEY], { skipInFlight: false });
  menus.set(KEY, SOUP_AND_BREAD);
  saves.flush([KEY], { skipInFlight: false });
  server.requests[1].fail();
  await tick();
  server.requests[0].ok();
  await saves.settle();

  menus.set(KEY, saves.discard(KEY));
  assert.deepEqual(menus.get(KEY), SOUP);
  await saves.queueSave(KEY); // the server has this menu, so nothing to send
  assert.equal(server.requests.length, 2);
});
