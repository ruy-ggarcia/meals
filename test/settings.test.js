// Tests for Settings (public/settings.js), where the family edits the family
// preferences, against a real DOM built from the real pages. See
// test/dom-helpers.js for the harness.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  assertFocus,
  dispatchBeforeUnload,
  fakeFetch,
  openPage,
  pointerdown,
  respondTo,
  tick,
  typeInto,
  useQuietConsole,
  waitFor,
} from "./dom-helpers.js";
import { openMealPlan } from "./meal-plan-helpers.js";

const quiet = useQuietConsole();

const SAVED = "No fish on Fridays.";

let server;
let document;
let window;

/**
 * Opens the recipe book, with `fetchOptions` for the fake server, and
 * answers its load with an empty book.
 *
 * @param {import("node:test").TestContext} t
 * @param {Parameters<typeof fakeFetch>[0]} [fetchOptions]
 */
async function openRecipeBook(t, fetchOptions) {
  server = fakeFetch(fetchOptions);
  ({ document, window } = await openPage(t, {
    html: "recipes.html",
    script: "recipes.js",
    fetch: server.fetch,
  }));
  await respondTo(server, "GET", "/api/recipes", 200, { recipes: [] });
  await respondTo(server, "GET", "/api/ingredients", 200, { ingredients: [] });
}

/** The Settings button of the toolbar, which wide screens show. */
function settingsButton() {
  return document.querySelector(".toolbar .open-settings");
}

/** The Settings button on the line of the large title, which phones show. */
function titleLineButton() {
  return document.querySelector(".title-line .open-settings");
}

/** The dialogs named Settings. */
function settingsDialogs() {
  return [...document.querySelectorAll("dialog")].filter(
    (dialog) =>
      document.getElementById(dialog.getAttribute("aria-labelledby"))?.textContent === "Settings",
  );
}

/** The dialog named Settings, or undefined. */
function settingsDialog() {
  return settingsDialogs()[0];
}

/** The field that the label Family preferences names. */
function preferencesField() {
  const label = [...document.querySelectorAll("label")].find(
    (element) => element.textContent === "Family preferences",
  );
  return document.getElementById(label.htmlFor);
}

function query(selector) {
  return settingsDialog().querySelector(selector);
}

/** Opens Settings with the gear, and answers the load with `text`. */
async function openSettings(text = SAVED) {
  settingsButton().click();
  await respondTo(server, "GET", "/api/preferences", 200, { text });
}

/** Opens Settings, types `text`, and chooses Done. */
async function saveText(text) {
  await openSettings();
  typeInto(window, preferencesField(), text);
  query(".done").click();
  await waitFor(() => server.requestFor("PUT", "/api/preferences") !== undefined);
}

/** The line that says the assistant isn't set up, shown or not. */
function assistantLine() {
  return [...settingsDialog().querySelectorAll("p")].find(
    (element) => element.textContent === "The assistant isn't set up on this server.",
  );
}

describe("settings", () => {
  test("disables the button while the settings load", async (t) => {
    await openRecipeBook(t);

    settingsButton().click();

    assert.equal(settingsButton().disabled, true);
    await respondTo(server, "GET", "/api/preferences", 200, { text: SAVED });
    assert.equal(settingsButton().disabled, false);
  });

  test("opens the dialog with the saved family preferences", async (t) => {
    await openRecipeBook(t);

    await openSettings();

    assert.equal(settingsDialog().open, true);
    assert.equal(preferencesField().value, SAVED);
  });

  test("limits the family preferences to 10000 characters", async (t) => {
    await openRecipeBook(t);

    await openSettings();

    assert.equal(preferencesField().maxLength, 10000);
  });

  test("tells what the assistant uses the family preferences for", async (t) => {
    await openRecipeBook(t);

    await openSettings();

    assert.match(
      settingsDialog().textContent,
      /The assistant reads this text in every conversation\./,
    );
  });

  test("shows a message and opens nothing when the load fails", async (t) => {
    quiet.expect(1);
    await openRecipeBook(t);

    settingsButton().click();
    await waitFor(() => server.requestFor("GET", "/api/preferences") !== undefined);
    server.requestFor("GET", "/api/preferences").fail();
    await tick();

    assert.equal(
      document.querySelector(".toolbar [role='alert']").textContent,
      "Couldn't load the settings. Try again.",
    );
    assert.equal(settingsDialog()?.open ?? false, false);
  });

  test("enables the button again when the load fails", async (t) => {
    quiet.expect(1);
    await openRecipeBook(t);

    settingsButton().click();
    await waitFor(() => server.requestFor("GET", "/api/preferences") !== undefined);
    server.requestFor("GET", "/api/preferences").fail();
    await tick();

    assert.equal(settingsButton().disabled, false);
  });

  test("clears the load message when the next open succeeds", async (t) => {
    quiet.expect(1);
    await openRecipeBook(t);
    settingsButton().click();
    await waitFor(() => server.requestFor("GET", "/api/preferences") !== undefined);
    server.requestFor("GET", "/api/preferences").fail();
    await tick();

    await openSettings();

    assert.equal(document.querySelector(".toolbar [role='alert']").textContent, "");
  });

  test("reuses the dialog on the next open", async (t) => {
    await openRecipeBook(t);
    await openSettings();
    query(".cancel").click();

    await openSettings("Lunch at school on weekdays.");

    assert.equal(settingsDialogs().length, 1);
    assert.equal(preferencesField().value, "Lunch at school on weekdays.");
  });

  test("saves the changed text with Done", async (t) => {
    await openRecipeBook(t);

    await saveText("No pork.");

    assert.deepEqual(server.requestFor("PUT", "/api/preferences").body, { text: "No pork." });
    await respondTo(server, "PUT", "/api/preferences", 200, { text: "No pork." });
  });

  test("closes after the save", async (t) => {
    await openRecipeBook(t);
    await saveText("No pork.");

    await respondTo(server, "PUT", "/api/preferences", 200, { text: "No pork." });

    assert.equal(settingsDialog().open, false);
  });

  test("closes with Done without a request when nothing changed", async (t) => {
    await openRecipeBook(t);
    await openSettings();

    query(".done").click();
    await tick();

    assert.equal(settingsDialog().open, false);
    assert.equal(server.requestFor("PUT", "/api/preferences"), undefined);
  });

  test("disables the controls while it saves", async (t) => {
    await openRecipeBook(t);

    await saveText("No pork.");

    assert.equal(preferencesField().disabled, true);
    assert.equal(query(".cancel").disabled, true);
    assert.equal(query(".done").disabled, true);
    await respondTo(server, "PUT", "/api/preferences", 200, { text: "No pork." });
  });

  test("stays open on Escape while it saves", async (t) => {
    await openRecipeBook(t);
    await saveText("No pork.");

    const cancel = new window.Event("cancel", { cancelable: true });
    settingsDialog().dispatchEvent(cancel);

    assert.equal(cancel.defaultPrevented, true);
    await respondTo(server, "PUT", "/api/preferences", 200, { text: "No pork." });
  });

  test("shows a message and stays open when the save fails", async (t) => {
    quiet.expect(1);
    await openRecipeBook(t);
    await saveText("No pork.");

    server.requestFor("PUT", "/api/preferences").fail();
    await tick();

    assert.equal(settingsDialog().open, true);
    assert.equal(query("[role='status']").textContent, "Couldn't save the settings. Try again.");
  });

  test("enables the controls again when the save fails", async (t) => {
    quiet.expect(1);
    await openRecipeBook(t);
    await saveText("No pork.");

    server.requestFor("PUT", "/api/preferences").fail();
    await tick();

    assert.equal(preferencesField().disabled, false);
    assert.equal(query(".done").disabled, false);
  });

  test("shows a message when the server rejects the save", async (t) => {
    quiet.expect(1);
    await openRecipeBook(t);
    await saveText("No pork.");

    await respondTo(server, "PUT", "/api/preferences", 400, { error: "Too long." });

    assert.equal(settingsDialog().open, true);
    assert.equal(query("[role='status']").textContent, "Couldn't save the settings. Try again.");
  });

  test("closes without saving with Cancel", async (t) => {
    await openRecipeBook(t);
    await openSettings();
    typeInto(window, preferencesField(), "No pork.");

    query(".cancel").click();

    assert.equal(settingsDialog().open, false);
    assert.equal(server.requestFor("PUT", "/api/preferences"), undefined);
  });

  test("closes without saving with Escape", async (t) => {
    await openRecipeBook(t);
    await openSettings();
    typeInto(window, preferencesField(), "No pork.");

    settingsDialog().close(); // what Escape does to a modal dialog

    assert.equal(server.requestFor("PUT", "/api/preferences"), undefined);
    assertFocus(document, settingsButton());
  });

  test("closes on a backdrop click without changes", async (t) => {
    await openRecipeBook(t);
    await openSettings();

    pointerdown(window, settingsDialog());
    settingsDialog().click();

    assert.equal(settingsDialog().open, false);
  });

  test("stays open on a backdrop click with changes", async (t) => {
    await openRecipeBook(t);
    await openSettings();
    typeInto(window, preferencesField(), "No pork.");

    pointerdown(window, settingsDialog());
    settingsDialog().click();

    assert.equal(settingsDialog().open, true);
  });

  test("prevents leaving on beforeunload only while Settings has changes", async (t) => {
    await openRecipeBook(t);
    await openSettings();
    assert.equal(dispatchBeforeUnload(window).defaultPrevented, false);
    typeInto(window, preferencesField(), "No pork.");
    assert.equal(dispatchBeforeUnload(window).defaultPrevented, true);
    query(".cancel").click();
    assert.equal(dispatchBeforeUnload(window).defaultPrevented, false);
  });

  test("says that the assistant isn't set up when it's off", async (t) => {
    await openRecipeBook(t);

    await openSettings();

    assert.equal(assistantLine().hidden, false);
  });

  test("hides the line about the assistant when it's on", async (t) => {
    await openRecipeBook(t, { assistant: "manual" });

    settingsButton().click();
    await respondTo(server, "GET", "/api/assistant", 200, { enabled: true });
    await respondTo(server, "GET", "/api/preferences", 200, { text: SAVED });

    assert.equal(settingsDialog().open, true);
    assert.equal(assistantLine().hidden, true);
  });

  test("opens without the line about the assistant when its check fails", async (t) => {
    quiet.expect(1);
    await openRecipeBook(t, { assistant: "manual" });

    settingsButton().click();
    await waitFor(() => server.requestFor("GET", "/api/assistant") !== undefined);
    server.requestFor("GET", "/api/assistant").fail();
    await respondTo(server, "GET", "/api/preferences", 200, { text: SAVED });

    assert.equal(settingsDialog().open, true);
    assert.equal(assistantLine().hidden, true);
  });

  test("checks the assistant on each open", async (t) => {
    await openRecipeBook(t, { assistant: "manual" });
    settingsButton().click();
    await respondTo(server, "GET", "/api/assistant", 200, { enabled: true });
    await respondTo(server, "GET", "/api/preferences", 200, { text: SAVED });
    query(".cancel").click();

    settingsButton().click();
    await respondTo(server, "GET", "/api/assistant", 200, { enabled: false });
    await respondTo(server, "GET", "/api/preferences", 200, { text: SAVED });

    assert.equal(assistantLine().hidden, false);
  });

  test("returns the focus to the button after closing", async (t) => {
    await openRecipeBook(t);
    await openSettings();

    query(".cancel").click();

    assertFocus(document, settingsButton());
  });

  test("opens from the button on the line of the title", async (t) => {
    await openRecipeBook(t);

    titleLineButton().click();
    await respondTo(server, "GET", "/api/preferences", 200, { text: SAVED });

    assert.equal(settingsDialog().open, true);
  });

  test("returns the focus to the button on the line of the title that opened it", async (t) => {
    await openRecipeBook(t);
    titleLineButton().click();
    await respondTo(server, "GET", "/api/preferences", 200, { text: SAVED });

    query(".cancel").click();

    assertFocus(document, titleLineButton());
  });

  test("shows the load message next to the button that was clicked", async (t) => {
    quiet.expect(1);
    await openRecipeBook(t);

    titleLineButton().click();
    await waitFor(() => server.requestFor("GET", "/api/preferences") !== undefined);
    server.requestFor("GET", "/api/preferences").fail();
    await tick();

    assert.equal(
      document.querySelector(".title-line [role='alert']").textContent,
      "Couldn't load the settings. Try again.",
    );
    assert.equal(document.querySelector(".toolbar [role='alert']").textContent, "");
  });

  test("puts a button on the line of the day title on the meal plan", async (t) => {
    ({
      page: { document },
    } = await openMealPlan(t));

    const line = document.querySelector("#day-heading .day-title").parentElement;

    assert.equal(line.querySelector("button").getAttribute("aria-label"), "Settings");
  });

  test("shows the button on the meal plan after Shopping list", async (t) => {
    ({
      page: { document },
    } = await openMealPlan(t));

    const buttons = [...document.querySelectorAll(".toolbar button")];

    assert.equal(buttons.at(-1).getAttribute("aria-label"), "Settings");
    assert.equal(buttons.at(-2).id, "shopping-list");
  });

  test("shows the button on the ingredients page", async (t) => {
    server = fakeFetch();
    ({ document } = await openPage(t, {
      html: "ingredients.html",
      script: "ingredients.js",
      fetch: server.fetch,
    }));
    await respondTo(server, "GET", "/api/ingredients", 200, { ingredients: [] });
    await respondTo(server, "GET", "/api/recipes", 200, { recipes: [] });

    const buttons = [...document.querySelectorAll(".toolbar button")];

    assert.equal(buttons.at(-1).getAttribute("aria-label"), "Settings");
  });
});
