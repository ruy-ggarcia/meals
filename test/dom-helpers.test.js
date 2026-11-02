// Tests for the harness in test/dom-helpers.js: a load that fails must leave
// no global behind, or the next test would fail for the wrong reason.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadDialog, loadPage } from "./dom-helpers.js";

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
});
