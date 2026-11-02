// Tests for withLoadState (public/dom.js). It only sets properties on the
// elements that it gets, so plain objects stand in for them.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { withLoadState } from "../public/dom.js";
import { useQuietConsole } from "./dom-helpers.js";

const quiet = useQuietConsole();

let loadError;
let retryButton;
let content;

beforeEach(() => {
  loadError = { hidden: false };
  retryButton = { disabled: false };
  content = [{ hidden: true }];
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
  quiet.expect(1);
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
  assert.deepEqual(quiet.calls(), [["Couldn't load:", error]]);
});
