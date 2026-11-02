// Tests for the harness in test/dom-helpers.js: a page leaves no global
// behind, whether its load fails or its test ends, or the next test would fail
// for the wrong reason.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  assertLoggedErrors,
  fakeFetch,
  loadDialog,
  loadPage,
  openPage,
  waitFor,
} from "./dom-helpers.js";

const GLOBALS = ["document", "fetch", "history", "location", "window"];

function snapshotOfGlobals() {
  return Object.fromEntries(GLOBALS.map((key) => [key, globalThis[key]]));
}

// Compares one global at a time: handing a happy-dom window to
// `assert.deepEqual` makes a failure hang while it diffs the whole window.
function assertGlobalsRestored(before) {
  for (const key of GLOBALS) {
    assert.ok(globalThis[key] === before[key], `${key} was left behind`);
  }
}

describe("loadPage", () => {
  test("restores the globals when the script fails to load", async () => {
    const before = snapshotOfGlobals();

    await assert.rejects(loadPage({ html: "index.html", script: "missing-script.js" }), {
      code: "ERR_MODULE_NOT_FOUND",
    });

    assertGlobalsRestored(before);
  });
});

describe("loadDialog", () => {
  test("restores the globals when the script fails to load", async () => {
    const before = snapshotOfGlobals();

    await assert.rejects(
      loadDialog({ html: "index.html", id: "slot-editor", script: "missing-script.js" }),
      { code: "ERR_MODULE_NOT_FOUND" },
    );

    assertGlobalsRestored(before);
  });
});

async function openRecipesPage() {
  const server = fakeFetch();
  const page = await loadPage({
    html: "recipes.html",
    script: "recipes.js",
    fetch: server.fetch,
  });
  return { page, server };
}

describe("cleanup", () => {
  test("leaves the globals that a later page installed after a second call", async (t) => {
    const first = await loadDialog({
      html: "index.html",
      id: "slot-editor",
      script: "slot-editor.js",
    });
    await first.cleanup();
    const second = await loadDialog({
      html: "index.html",
      id: "slot-editor",
      script: "slot-editor.js",
    });
    t.after(() => second.cleanup());

    await first.cleanup();

    assert.ok(
      /** @type {any} */ (globalThis).window === second.window,
      "the first cleanup replaced the later page",
    );
  });

  test("fails with the requests that are still pending", async () => {
    const before = snapshotOfGlobals();
    const { page, server } = await openRecipesPage();
    server.requestFor("GET", "/api/recipes").respond(200, { recipes: [] });

    await assert.rejects(page.cleanup(), {
      message:
        "1 fake request(s) still pending when the page was cleaned up: GET /api/ingredients. " +
        "Answer or abort each request in the test.",
    });

    assertGlobalsRestored(before);
  });

  test("passes when every request got an answer or was aborted", async () => {
    const { page, server } = await openRecipesPage();
    server.requestFor("GET", "/api/recipes").respond(200, { recipes: [] });
    server.requestFor("GET", "/api/ingredients").fail();

    await page.cleanup();
  });
});

describe("openPage", () => {
  test("cleans the page up when the test ends", async (t) => {
    const before = snapshotOfGlobals();

    await t.test("opens a page", async (inner) => {
      const server = fakeFetch();
      const page = await openPage(inner, {
        html: "recipes.html",
        script: "recipes.js",
        fetch: server.fetch,
      });
      assert.ok(/** @type {any} */ (globalThis).window === page.window, "the page is installed");
      for (const request of server.requests) request.respond(200, { recipes: [], ingredients: [] });
    });

    assertGlobalsRestored(before);
  });
});

describe("assertLoggedErrors", () => {
  test("passes when the errors are as many as expected", () => {
    assertLoggedErrors([], 0);
    assertLoggedErrors([["Couldn't save:", new Error("offline")]], 1);
  });

  test("fails with the logged arguments when an error is unexpected", () => {
    assert.throws(() => assertLoggedErrors([["Couldn't save:", new Error("offline")]], 0), {
      message: "Expected 0 console.error call(s), got 1:\n  Couldn't save: Error: offline",
    });
  });

  test("fails when an expected error isn't logged", () => {
    assert.throws(() => assertLoggedErrors([], 1), {
      message: "Expected 1 console.error call(s), got 0",
    });
  });
});

describe("waitFor", () => {
  test("returns when the predicate holds", async () => {
    let calls = 0;

    await waitFor(() => {
      calls += 1;
      return calls === 3;
    });

    assert.equal(calls, 3);
  });

  test("fails when the condition isn't met after the attempts", async () => {
    await assert.rejects(
      waitFor(() => false, { attempts: 2 }),
      {
        message: "waitFor: condition not met after 2 ticks",
      },
    );
  });

  test("adds the message of the caller, text or function, to the failure", async () => {
    await assert.rejects(
      waitFor(() => false, { attempts: 2, message: "two reloads" }),
      {
        message: "waitFor: condition not met after 2 ticks: two reloads",
      },
    );
    await assert.rejects(
      waitFor(() => false, { attempts: 2, message: () => "now 1 reload" }),
      {
        message: "waitFor: condition not met after 2 ticks: now 1 reload",
      },
    );
  });
});
