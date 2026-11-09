import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { sameMenu } from "../public/menus.js";
import { createSaves } from "../public/saves.js";
import { tick, useQuietConsole, within } from "./dom-helpers.js";

const quiet = useQuietConsole();

function menu(...recipeIds) {
  return { items: recipeIds.map((recipeId) => ({ recipeId, servings: 1 })) };
}

const EMPTY = menu();
const SOUP = menu("soup");
const SOUP_AND_BREAD = menu("soup", "bread");
const SOUP_BREAD_AND_FRUIT = menu("soup", "bread", "fruit");
const RICE = menu("rice");
const FISH = menu("fish");

// The fake servers of the test that runs.
let servers = [];

// A fake server: each PUT waits until the test answers it.
function fakeServer() {
  const requests = [];
  function fetch(url, options) {
    return new Promise((resolve, reject) => {
      const request = {
        url,
        method: options.method,
        body: JSON.parse(options.body),
        keepalive: options.keepalive === true,
        settled: false,
        ok: () => {
          request.settled = true;
          resolve({ ok: true, status: 200 });
        },
        fail: () => {
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
  // The request that carries `expected`.
  function requestWith(expected) {
    return requests.find((request) => sameMenu(request.body, expected));
  }
  // Answers each request that is still pending, until none is left.
  async function drain() {
    for (let pending = requests.filter((request) => !request.settled); pending.length > 0; ) {
      for (const request of pending) request.ok();
      await tick();
      pending = requests.filter((request) => !request.settled);
    }
  }
  const server = { fetch, requests, requestWith, drain };
  servers.push(server);
  return server;
}

// A test fails when a request is still pending at its end: the save would
// wait for its timer, and log an error in whichever test runs then. A test
// that failed already stops before it answers its requests, so the check
// leaves it alone: its own failure is the one to read.
afterEach((t) => {
  // The types of node:test don't have `passed` yet.
  const { passed } = /** @type {{ passed: boolean }} */ (/** @type {unknown} */ (t));
  const pending = servers
    .flatMap((server) => server.requests)
    .filter((request) => !request.settled);
  servers = [];
  if (!passed || pending.length === 0) return;
  const names = pending.map((request) => `${request.method} ${request.url}`).join(", ");
  throw new Error(
    `${pending.length} fake request(s) still pending when the test ended: ${names}. ` +
      "Answer or abort each request in the test.",
  );
});

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

// Flushes a slot that changed and a slot that didn't.
async function flushChangedAndUnchanged() {
  const { saves, server, menus } = setup();
  saves.loaded([["tue/lunch", RICE]]);
  menus.set("tue/lunch", RICE);
  menus.set(KEY, SOUP);

  saves.flush([KEY, "tue/lunch"]);
  await tick();
  return server;
}

// Fails the save of Soup over the saved empty menu, and discards it.
async function discardFailedSave() {
  quiet.expect(1);
  const { saves, server, menus, statuses } = setup();
  menus.set(KEY, SOUP);
  const failed = saves.queueSave(KEY);
  await tick();
  server.requests[0].fail();
  await failed;

  const discarded = saves.discard(KEY);
  menus.set(KEY, discarded);
  return { saves, server, menus, statuses, discarded };
}

describe("createSaves", () => {
  describe("loaded", () => {
    test("marks every slot as idle", () => {
      const { statuses } = setup();
      assert.equal(statuses.get(KEY), "idle");
    });

    test("copies the menu instead of keeping a reference", async () => {
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
  });

  describe("queueSave", () => {
    test("sends a PUT with the slot URL and the current menu", async () => {
      const { saves, server, menus } = setup();
      menus.set(KEY, SOUP);

      saves.queueSave(KEY);
      await tick();

      assert.equal(server.requests.length, 1);
      assert.equal(server.requests[0].url, "/api/mon/lunch");
      assert.equal(server.requests[0].method, "PUT");
      assert.deepEqual(server.requests[0].body, SOUP);
      await server.drain();
    });

    test("reports saving while the PUT runs, then saved when it succeeds", async () => {
      const { saves, server, menus, statuses } = setup();
      menus.set(KEY, SOUP);

      const done = saves.queueSave(KEY);
      await tick();
      assert.equal(statuses.get(KEY), "saving");

      server.requests[0].ok();
      await done;
      assert.equal(statuses.get(KEY), "saved");
    });

    test("sends only the menu items in the PUT body", async () => {
      const { saves, server, menus } = setup();
      menus.set(KEY, {
        items: [{ recipeId: "soup", servings: 1.5 }],
        extra: "not part of the menu",
      });

      saves.queueSave(KEY);
      await tick();

      assert.deepEqual(server.requests[0].body, { items: [{ recipeId: "soup", servings: 1.5 }] });
      await server.drain();
    });

    test("sends nothing when the menu is unchanged", async () => {
      const { saves, server } = setup();
      await saves.queueSave(KEY);
      assert.equal(server.requests.length, 0);
    });

    test("treats an equal menu in a new object as unchanged", async () => {
      const { saves, server, menus } = setup();
      menus.set(KEY, menu());
      await saves.queueSave(KEY);
      assert.equal(server.requests.length, 0);
    });

    test("does nothing for a slot that isn't loaded", async () => {
      const { saves, server } = setup();
      await saves.queueSave("wed/lunch");
      assert.equal(server.requests.length, 0);
    });

    test("ignores the menu that readMenu returns for an unloaded slot", async () => {
      const { saves, server, menus } = setup();
      menus.set("wed/lunch", SOUP); // for example, a slot element left over from a previous week
      saves.queueSave("wed/lunch");
      await tick();
      assert.equal(server.requests.length, 0);
    });

    test("saves a copy of the menu, not the shown object", async () => {
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
      await server.drain();
    });

    test("reports an error after a failed save", async () => {
      quiet.expect(1);
      const { saves, server, menus, statuses } = setup();
      menus.set(KEY, SOUP);

      const first = saves.queueSave(KEY);
      await tick();
      server.requests[0].fail();
      await first;

      assert.equal(statuses.get(KEY), "error");
    });

    test("sends the menu again and reports saved after a failed save", async () => {
      quiet.expect(1);
      const { saves, server, menus, statuses } = setup();
      menus.set(KEY, SOUP);
      const first = saves.queueSave(KEY);
      await tick();
      server.requests[0].fail();
      await first;

      const retry = saves.queueSave(KEY);
      await tick();
      assert.equal(server.requests.length, 2);
      server.requests[1].ok();
      await retry;

      assert.equal(statuses.get(KEY), "saved");
    });

    test("gives up after the timeout", async () => {
      quiet.expect(1);
      const { saves, menus, statuses } = setup({ timeoutMs: 20 });
      menus.set(KEY, SOUP);
      const done = saves.queueSave(KEY); // the fake server never answers
      await within(done, "the save never gave up"); // its timer also keeps Node.js running
      assert.equal(statuses.get(KEY), "error");
    });

    test("clears the error when the menu returns to the saved menu", async () => {
      quiet.expect(1);
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

    test("makes a newer save of a slot wait for the older one", async () => {
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
  });

  describe("flush", () => {
    test("sends a changed slot with keepalive", async () => {
      const server = await flushChangedAndUnchanged();

      assert.deepEqual(server.requests[0].body, SOUP);
      assert.equal(server.requests[0].keepalive, true);
      await server.drain();
    });

    test("skips an unchanged slot", async () => {
      const server = await flushChangedAndUnchanged();

      assert.deepEqual(
        server.requests.map((request) => request.url),
        ["/api/mon/lunch"],
      );
      await server.drain();
    });

    test("copies the menu instead of keeping a reference", async () => {
      const { saves, server, menus } = setup();
      const original = menu("soup");
      menus.set(KEY, original);
      saves.flush([KEY]);
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

    test("skips slots that were never loaded", async () => {
      const { saves, server, menus } = setup();
      menus.set("wed/lunch", FISH);
      saves.flush(["wed/lunch"]);
      await tick();
      assert.equal(server.requests.length, 0);
    });

    test("flushes the other slots when readMenu returns undefined for one", async () => {
      const { saves, server, menus } = setup();
      saves.loaded([["tue/lunch", EMPTY]]);
      menus.set("tue/lunch", RICE); // changed since it was loaded
      menus.delete(KEY); // KEY was loaded in setup(), but its menu vanished (for example, removed from the DOM)

      assert.doesNotThrow(() => saves.flush([KEY, "tue/lunch"]));
      await tick();

      assert.equal(server.requests.length, 1);
      assert.deepEqual(server.requests[0].body, RICE);
      await server.drain();
    });

    test("doesn't send a flushed menu again", async () => {
      const { saves, server, menus } = setup();
      menus.set(KEY, SOUP);
      saves.flush([KEY]);
      saves.flush([KEY]);
      await saves.queueSave(KEY);
      assert.equal(server.requests.length, 1);
      await server.drain();
    });

    test("skips a slot whose running save carries the same menu", async () => {
      const { saves, server, menus } = setup();
      menus.set(KEY, SOUP);
      saves.queueSave(KEY);
      await tick();
      saves.flush([KEY]);
      await tick();
      assert.equal(server.requests.length, 1);
      assert.equal(server.requests[0].keepalive, false);
      await server.drain();
    });

    test("sends the shown menu while an older save runs", async () => {
      const { saves, server, menus } = setup();
      menus.set(KEY, SOUP);
      saves.queueSave(KEY);
      await tick();
      menus.set(KEY, SOUP_AND_BREAD);
      saves.flush([KEY]);
      await tick();
      assert.equal(server.requests.length, 2);
      assert.deepEqual(server.requests[1].body, SOUP_AND_BREAD);
      assert.equal(server.requests[1].keepalive, true);
      await server.drain();
    });

    test("lets the next queueSave retry the menu after a failed flush", async () => {
      quiet.expect(1);
      const { saves, server, menus } = setup();
      menus.set(KEY, SOUP);
      saves.flush([KEY]);
      await tick();
      server.requests[0].fail();
      await tick();

      saves.queueSave(KEY);
      await tick();
      assert.equal(server.requests.length, 2);
      assert.deepEqual(server.requests[1].body, SOUP);
      await server.drain();
    });

    test("clears an earlier error of the slot after a successful flush", async () => {
      quiet.expect(1);
      const { saves, server, menus, statuses } = setup();
      menus.set(KEY, SOUP);
      const first = saves.queueSave(KEY);
      await tick();
      server.requests[0].fail();
      await first;

      saves.flush([KEY]);
      await tick();
      server.requests[1].ok();
      await tick();
      assert.equal(statuses.get(KEY), "idle");
    });

    test("marks the slot as an error and unsaved after a failed page-hide save", async () => {
      quiet.expect(1);
      const { saves, server, menus, statuses } = setup();
      menus.set(KEY, SOUP);
      saves.flush([KEY]);
      server.requests[0].fail();
      await saves.settle();
      assert.equal(statuses.get(KEY), "error");
      assert.deepEqual(saves.unsaved([KEY]), [KEY]);
    });

    test("gives up on a page-hide save after the timeout", async () => {
      quiet.expect(1);
      const { saves, menus, statuses } = setup({ timeoutMs: 20 });
      menus.set(KEY, SOUP);
      saves.flush([KEY]); // the fake server never answers
      await within(saves.settle(), "the page-hide save never gave up");
      assert.equal(statuses.get(KEY), "error");
    });

    test("doesn't mark a failed page-hide save when a newer save replaced it", async () => {
      quiet.expect(1);
      const { saves, server, menus, statuses } = setup();
      menus.set(KEY, SOUP);
      saves.flush([KEY]);
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

    test("doesn't mark a failed page-hide save while a newer save runs", async () => {
      quiet.expect(1);
      const { saves, server, menus, statuses } = setup();
      menus.set(KEY, SOUP);
      saves.flush([KEY]);
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

    test("keeps the error of a newer menu when a late page-hide save succeeds", async () => {
      quiet.expect(1);
      const { saves, server, menus, statuses } = setup();
      menus.set(KEY, SOUP);
      saves.flush([KEY]); // the page is hidden; this save is slow
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

    test("lets a later queueSave resend the menu after two page-hide failures", async () => {
      quiet.expect(2);
      const { saves, server, menus } = setup();
      menus.set(KEY, SOUP);
      saves.flush([KEY]);
      menus.set(KEY, SOUP_AND_BREAD);
      saves.flush([KEY]);
      server.requests[0].fail();
      server.requests[1].fail();
      await saves.settle();

      menus.set(KEY, SOUP); // the server never received it
      saves.queueSave(KEY);
      await tick();
      assert.equal(server.requests.length, 3);
      assert.deepEqual(server.requests[2].body, SOUP);
      await server.drain();
    });
  });

  describe("settle", () => {
    test("waits for queued saves and page-hide saves", async () => {
      const { saves, server, menus } = setup();
      saves.loaded([["tue/lunch", EMPTY]]);
      menus.set(KEY, SOUP);
      menus.set("tue/lunch", RICE);
      saves.queueSave(KEY);
      saves.flush(["tue/lunch"]);
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

    test("waits for page-hide saves that start while it waits", async () => {
      quiet.expect(1);
      const { saves, server, menus } = setup();
      saves.loaded([["tue/lunch", EMPTY]]);
      menus.set(KEY, SOUP);
      saves.queueSave(KEY);
      let settled = false;
      const done = saves.settle().then(() => {
        settled = true;
      });
      await tick();

      menus.set("tue/lunch", RICE);
      saves.flush([KEY, "tue/lunch"]); // the page is hidden during the wait
      server.requestWith(SOUP).ok();
      await tick();
      assert.equal(settled, false, "the page-hide save that started during the wait is pending");

      server.requestWith(RICE).fail();
      await done;
    });
  });

  describe("unsaved", () => {
    test("lists loaded slots whose menu differs from the saved menu", () => {
      const { saves, menus } = setup();
      saves.loaded([["tue/lunch", RICE]]);
      menus.set("tue/lunch", RICE);
      menus.set(KEY, SOUP);
      menus.set("wed/lunch", FISH); // never loaded
      assert.deepEqual(saves.unsaved([KEY, "tue/lunch", "wed/lunch"]), [KEY]);
    });

    test("skips a slot whose readMenu returns undefined", () => {
      const { saves, menus } = setup();
      menus.delete(KEY); // KEY was loaded in setup(), but its menu vanished (for example, removed from the DOM)
      assert.deepEqual(saves.unsaved([KEY]), []);
    });
  });

  describe("unconfirmed", () => {
    test("lists a slot whose save failed", async () => {
      quiet.expect(1);
      const { saves, server, menus } = setup();
      menus.set(KEY, SOUP);
      const failed = saves.queueSave(KEY);
      await tick();
      server.requests[0].fail();
      await failed;
      assert.deepEqual(saves.unconfirmed([KEY]), [KEY]);
    });

    test("lists a slot whose save is running", async () => {
      const { saves, server, menus } = setup();
      menus.set(KEY, SOUP);
      saves.queueSave(KEY);
      await tick();
      assert.deepEqual(saves.unconfirmed([KEY]), [KEY]);
      await server.drain();
    });

    test("lists a slot whose newer menu saves after an older one was confirmed", async () => {
      const { saves, server, menus } = setup();
      menus.set(KEY, SOUP);
      saves.queueSave(KEY);
      await tick();
      menus.set(KEY, SOUP_AND_BREAD);
      saves.queueSave(KEY);
      await tick();
      server.requests[0].ok();
      await tick();
      assert.deepEqual(saves.unconfirmed([KEY]), [KEY]);
      await server.drain();
    });

    test("lists a slot whose page-hide save is running", async () => {
      const { saves, server, menus } = setup();
      menus.set(KEY, SOUP);
      saves.flush([KEY]);
      assert.deepEqual(saves.unconfirmed([KEY]), [KEY]);
      await server.drain();
    });

    test("skips a slot that the server confirmed", async () => {
      const { saves, server, menus } = setup();
      menus.set(KEY, SOUP);
      const saved = saves.queueSave(KEY);
      await tick();
      server.requests[0].ok();
      await saved;
      assert.deepEqual(saves.unconfirmed([KEY]), []);
    });

    test("skips a slot that isn't loaded", () => {
      const { saves, menus } = setup();
      menus.set("wed/lunch", FISH);
      assert.deepEqual(saves.unconfirmed(["wed/lunch"]), []);
    });

    test("skips a slot whose readMenu returns undefined", () => {
      const { saves, menus } = setup();
      menus.delete(KEY);
      assert.deepEqual(saves.unconfirmed([KEY]), []);
    });

    test("skips a slot after discard", async () => {
      quiet.expect(1);
      const { saves, server, menus } = setup();
      menus.set(KEY, SOUP);
      const failed = saves.queueSave(KEY);
      await tick();
      server.requests[0].fail();
      await failed;

      menus.set(KEY, saves.discard(KEY));
      assert.deepEqual(saves.unconfirmed([KEY]), []);
    });
  });

  describe("discard", () => {
    test("returns a copy that shares nothing with the saved state", async () => {
      quiet.expect(1);
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

    test("returns the menu that the server confirmed after a failed save", async () => {
      const { discarded } = await discardFailedSave();

      assert.deepEqual(discarded, EMPTY);
    });

    test("clears the error after a failed save", async () => {
      const { statuses } = await discardFailedSave();

      assert.equal(statuses.get(KEY), "idle");
    });

    test("keeps every later save from sending the discarded menu", async () => {
      const { saves, server } = await discardFailedSave();

      await saves.queueSave(KEY); // for example, a later Done without changes
      saves.flush([KEY]);
      await tick();

      assert.equal(server.requests.length, 1, "only the failed save");
    });

    test("returns the menu the server has after two failed page-hide saves", async () => {
      quiet.expect(2);
      const { saves, server, menus } = setup();
      menus.set(KEY, SOUP);
      saves.flush([KEY]);
      menus.set(KEY, SOUP_AND_BREAD);
      saves.flush([KEY]);
      server.requests[0].fail();
      server.requests[1].fail();
      await saves.settle();

      assert.deepEqual(saves.discard(KEY), EMPTY);
    });

    test("returns the newer menu when an older page-hide save is confirmed later", async () => {
      quiet.expect(1);
      const { saves, server, menus } = setup();
      menus.set(KEY, SOUP);
      saves.flush([KEY]); // sent first, answered last
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

    test("returns the menu of a successful page-hide save", async () => {
      quiet.expect(1);
      const { saves, server, menus } = setup();
      menus.set(KEY, SOUP);
      saves.flush([KEY]);
      server.requests[0].ok();
      await saves.settle();

      menus.set(KEY, SOUP_AND_BREAD);
      const failed = saves.queueSave(KEY);
      await tick();
      server.requests[1].fail();
      await failed;
      assert.deepEqual(saves.discard(KEY), SOUP);
    });

    test("returns the menu of the older page-hide save when the newer one failed", async () => {
      quiet.expect(1);
      const { saves, server, menus } = setup();
      menus.set(KEY, SOUP);
      saves.flush([KEY]);
      menus.set(KEY, SOUP_AND_BREAD);
      saves.flush([KEY]);
      server.requests[1].fail();
      await tick();
      server.requests[0].ok();
      await saves.settle();

      menus.set(KEY, saves.discard(KEY));
      assert.deepEqual(menus.get(KEY), SOUP);
      await saves.queueSave(KEY); // the server has this menu, so nothing to send
      assert.equal(server.requests.length, 2);
    });
  });
});

// A week change waits for every pending save, then asks about unsaved slots.

// A slot is unconfirmed until the server confirmed the menu that it shows.
