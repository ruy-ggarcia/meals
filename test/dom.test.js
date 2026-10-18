// Tests for withLoadState (public/dom.js). It only sets properties on the
// elements that it gets, so plain objects stand in for them.

import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { withLoadState } from "../public/dom.js";

let loadError;
let retryButton;
let content;

beforeEach(() => {
  mock.method(console, "error", () => {}); // a test fails the load on purpose
  loadError = { hidden: false };
  retryButton = { disabled: false };
  content = [{ hidden: true }];
});

afterEach(() => {
  mock.restoreAll();
});

function load(run) {
  return withLoadState({ loadError, retryButton, content, run, errorMessage: "Couldn't load:" });
}

test("withLoadState resolves to true and shows the content when the load succeeds", async () => {
  assert.equal(await load(async () => {}), true);

  assert.equal(content[0].hidden, false);
  assert.equal(loadError.hidden, true);
  assert.equal(retryButton.disabled, false);
});

test("withLoadState resolves to false and shows the load error when the load fails", async () => {
  const error = new Error("offline");

  assert.equal(
    await load(async () => {
      throw error;
    }),
    false,
  );

  assert.equal(content[0].hidden, true);
  assert.equal(loadError.hidden, false);
  assert.equal(retryButton.disabled, false);
  assert.deepEqual(console.error.mock.calls[0].arguments, ["Couldn't load:", error]);
});
