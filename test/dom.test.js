// Tests for withLoadState (public/dom.js). It only sets properties on the
// elements that it gets, so plain objects stand in for them.

import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
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

describe("withLoadState", () => {
  const error = new Error("offline");

  function failingLoad() {
    return load(async () => {
      throw error;
    });
  }

  test("shows the content and resolves to true when the load succeeds", async () => {
    assert.equal(await load(async () => {}), true);

    assert.equal(content[0].hidden, false);
    assert.equal(loadError.hidden, true);
    assert.equal(retryButton.disabled, false);
  });

  test("resolves to false and shows the load error when the load fails", async () => {
    quiet.expect(1);

    assert.equal(await failingLoad(), false);

    assert.equal(content[0].hidden, true);
    assert.equal(loadError.hidden, false);
  });

  test("enables Retry when the load fails", async () => {
    quiet.expect(1);

    await failingLoad();

    assert.equal(retryButton.disabled, false);
  });

  test("logs the error with its message when the load fails", async () => {
    quiet.expect(1);

    await failingLoad();

    assert.deepEqual(quiet.calls(), [["Couldn't load:", error]]);
  });
});
