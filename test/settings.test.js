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

/** The assistant's settings before any save. */
const NO_SETTINGS = { provider: null, model: null, keySaved: false, source: "settings" };

/** Saved settings of the assistant, with a key. */
const WITH_KEY = {
  provider: "anthropic",
  model: "claude-test",
  keySaved: true,
  source: "settings",
};

/** The settings that `chooseOpenAI` saves. */
const OPENAI = { provider: "openai", model: "gpt-test", keySaved: true, source: "settings" };

/** The settings that the environment variables set on the server. */
const FROM_SERVER = {
  provider: "openai",
  model: "gpt-test",
  keySaved: true,
  source: "environment",
};

/** The models that the key of WITH_KEY lists, newest first. */
const ANTHROPIC_MODELS = [
  { id: "claude-next", name: "Claude Next" },
  { id: "claude-test", name: "Claude Test" },
];

/** The models that the key of `chooseOpenAI` lists. */
const OPENAI_MODELS = [{ id: "gpt-test", name: "gpt-test" }];

const SETTINGS_URL = "/api/assistant/settings";
const MODELS_URL = "/api/assistant/models";

/** What the server answers to a key that the provider rejects. */
const REJECTED = "The provider didn't accept this key.";

let server;
let document;
let window;
/** Whether the test answers the page's checks of the assistant itself. */
let manualAssistant;

/**
 * Opens the recipe book, with `fetchOptions` for the fake server, and
 * answers its load with an empty book.
 *
 * @param {import("node:test").TestContext} t
 * @param {Parameters<typeof fakeFetch>[0]} [fetchOptions]
 */
async function openRecipeBook(t, fetchOptions) {
  server = fakeFetch(fetchOptions);
  manualAssistant = fetchOptions?.assistant === "manual";
  ({ document, window } = await openPage(t, {
    html: "recipes.html",
    script: "recipes.js",
    fetch: server.fetch,
  }));
  await respondTo(server, "GET", "/api/recipes", 200, { recipes: [] });
  await respondTo(server, "GET", "/api/ingredients", 200, { ingredients: [] });
}

/** The Settings button, at the end of the toolbar. */
function settingsButton() {
  return document.querySelector(".toolbar .open-settings");
}

/** The alert in the page's content that says why Settings didn't open. */
function loadMessage() {
  return document.querySelector(".page .settings-message[role='alert']");
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

/** The count of the characters left, which is empty while many remain. */
function charactersLeft() {
  return query(".characters-left");
}

/**
 * Waits until the page sends `method` `url` and nobody has answered it yet,
 * and answers it with `status` and `body`.
 */
async function answerPending(method, url, status, body) {
  (await unansweredRequest(method, url)).respond(status, body);
  await tick();
}

/**
 * Waits until the page sends `method` `url` and nobody has answered it yet,
 * and returns the oldest such request.
 */
async function unansweredRequest(method, url) {
  const unanswered = () =>
    server.requests.find(
      (request) => request.method === method && request.url === url && !request.settled,
    );
  await waitFor(() => unanswered() !== undefined, {
    message: () => `no unanswered ${method} ${url}`,
  });
  return unanswered();
}

/**
 * Waits until the page asks whether the assistant is on and nobody has
 * answered yet, and answers `enabled`.
 */
async function answerAssistantCheck(enabled) {
  await answerPending("GET", "/api/assistant", 200, { enabled });
}

/**
 * Opens Settings with the gear, answers the load of the family preferences
 * and the assistant's settings, and fails the check of the assistant.
 */
async function openSettingsWithFailedCheck() {
  settingsButton().click();
  await respondTo(server, "GET", "/api/preferences", 200, { text: SAVED });
  await respondTo(server, "GET", SETTINGS_URL, 200, NO_SETTINGS);
  (await unansweredRequest("GET", "/api/assistant")).fail();
  await tick();
}

/** Answers the oldest unanswered request for a model list with `models`. */
async function answerModels(models) {
  await answerPending("POST", MODELS_URL, 200, { models });
}

/** The requests for a model list that the page sent, as their bodies. */
function modelRequests() {
  return server.requests
    .filter((request) => request.method === "POST" && request.url === MODELS_URL)
    .map((request) => request.body);
}

/**
 * Opens Settings with the gear, and answers the load with `text` and the
 * assistant's `settings`. A test that answers the assistant's checks gets
 * `enabled` as the answer of the open's check. With a saved key, the check
 * of the key answers `models`, unless they're null: then the test answers
 * it.
 *
 * @param {string} [text]
 * @param {Record<string, any>} [settings]
 * @param {{ enabled?: boolean, models?: object[] | null }} [options]
 */
async function openSettings(
  text = SAVED,
  settings = NO_SETTINGS,
  { enabled = false, models = ANTHROPIC_MODELS } = {},
) {
  settingsButton().click();
  await respondTo(server, "GET", "/api/preferences", 200, { text });
  await respondTo(server, "GET", SETTINGS_URL, 200, settings);
  if (manualAssistant) await answerAssistantCheck(enabled);
  if (settings.keySaved && settings.source === "settings" && models !== null) {
    await answerModels(models);
  }
}

/** The control that the label `text` names in Settings. */
function labeled(text) {
  const label = [...settingsDialog().querySelectorAll("label")].find(
    (element) => element.textContent === text,
  );
  return settingsDialog().querySelector(`#${label.htmlFor}`);
}

/** The radio button of `name` under Provider. */
function providerRadio(name) {
  const fieldset = [...settingsDialog().querySelectorAll("fieldset")].find(
    (element) => element.querySelector("legend")?.textContent === "Provider",
  );
  const label = [...fieldset.querySelectorAll("label")].find(
    (element) => element.textContent === name,
  );
  return label.querySelector("input[type='radio']");
}

/** The button of Settings whose text is `name`. */
function settingsControl(name) {
  return [...settingsDialog().querySelectorAll("button")].find(
    (button) => button.textContent === name,
  );
}

/** Whether `element` shows: neither it nor a container of it is hidden. */
function isShown(element) {
  return element.closest("[hidden]") === null;
}

/** The section of Settings named `name`: Assistant or BYOK. */
function section(name) {
  return [...settingsDialog().querySelectorAll("section")].find(
    (element) => element.getAttribute("aria-label") === name,
  );
}

/** The texts of the paragraphs that the BYOK section shows. */
function byokTexts() {
  return [...section("BYOK").querySelectorAll("p")]
    .filter((paragraph) => isShown(paragraph) && paragraph.textContent !== "")
    .map((paragraph) => paragraph.textContent);
}

/** The message at the end of the BYOK section about its save. */
function byokMessage() {
  return [...section("BYOK").querySelectorAll("[role='status']")].at(-1);
}

/** The message under the family preferences about their save. */
function preferencesMessage() {
  return section("Assistant").querySelector("[role='status']");
}

/** The hint of the Assistant section that the assistant is off, or undefined. */
function offHint() {
  return [...section("Assistant").querySelectorAll("p")].find(
    (paragraph) => paragraph.textContent === "Needs a valid API key to turn on.",
  );
}

/** The texts of the options of Model. */
function modelOptions() {
  return [...labeled("Model").options].map((option) => option.textContent);
}

/** The text of the option that Model has selected. */
function selectedModel() {
  const model = labeled("Model");
  return model.options[model.selectedIndex]?.textContent;
}

/** Selects the option of Model whose value is `id`, as a person does. */
function chooseModel(id) {
  labeled("Model").value = id;
  labeled("Model").dispatchEvent(new window.Event("change", { bubbles: true }));
}

/** Types `key` in the API key field and leaves it, which sends `change`. */
function enterKey(key) {
  typeInto(window, labeled("API key"), key);
  labeled("API key").dispatchEvent(new window.Event("change", { bubbles: true }));
}

/**
 * Pastes `key` in the API key field: a `paste`, and then the `input` that
 * inserts it.
 */
function pasteKey(key) {
  const field = labeled("API key");
  field.dispatchEvent(new window.Event("paste", { bubbles: true }));
  field.value = key;
  field.dispatchEvent(
    new window.InputEvent("input", { bubbles: true, inputType: "insertFromPaste" }),
  );
}

/**
 * Chooses OpenAI, enters the key `sk-test`, and answers its check with the
 * model `gpt-test`, which Model then selects.
 */
async function chooseOpenAI() {
  providerRadio("OpenAI").click();
  enterKey("sk-test");
  await answerModels(OPENAI_MODELS);
}

/** Opens Settings, types `text`, and chooses Done. */
async function saveText(text) {
  await openSettings();
  typeInto(window, preferencesField(), text);
  query(".done").click();
  await waitFor(() => server.requestFor("PUT", "/api/preferences") !== undefined);
}

describe("settings", () => {
  test("disables the button while the settings load", async (t) => {
    await openRecipeBook(t);

    settingsButton().click();

    assert.equal(settingsButton().disabled, true);
    await respondTo(server, "GET", "/api/preferences", 200, { text: SAVED });
    await respondTo(server, "GET", SETTINGS_URL, 200, NO_SETTINGS);
    assert.equal(settingsButton().disabled, false);
  });

  test("opens the dialog with the saved family preferences", async (t) => {
    await openRecipeBook(t);

    await openSettings();

    assert.equal(settingsDialog().open, true);
    assert.equal(preferencesField().value, SAVED);
  });

  test("shows the family preferences in the Assistant section", async (t) => {
    await openRecipeBook(t);

    await openSettings();

    assert.equal(section("Assistant").contains(preferencesField()), true);
  });

  test("shows the Assistant section before the BYOK section", async (t) => {
    await openRecipeBook(t);

    await openSettings();

    const sections = [...settingsDialog().querySelectorAll("section")];
    assert.deepEqual(
      sections.map((element) => element.getAttribute("aria-label")),
      ["Assistant", "BYOK"],
    );
  });

  test("shows Provider, API key, and Model in this order under BYOK", async (t) => {
    await openRecipeBook(t);

    await openSettings();

    const controls = [...section("BYOK").querySelectorAll("input, select")];
    assert.deepEqual(
      [providerRadio("Anthropic"), labeled("API key"), labeled("Model")].map((control) =>
        controls.indexOf(control),
      ),
      [0, 2, 3],
    );
  });

  test("says Needs a valid API key to turn on. while the assistant is off", async (t) => {
    await openRecipeBook(t, { assistant: "manual" });

    await openSettings(SAVED, NO_SETTINGS, { enabled: false });

    assert.equal(isShown(offHint()), true);
  });

  test("hides Needs a valid API key to turn on. while the assistant is on", async (t) => {
    await openRecipeBook(t, { assistant: "manual" });

    await openSettings(SAVED, WITH_KEY, { enabled: true });

    assert.equal(isShown(offHint()), false);
  });

  test("opens with the family preferences when the assistant's check fails", async (t) => {
    quiet.expect(1);
    await openRecipeBook(t, { assistant: "manual" });

    await openSettingsWithFailedCheck();

    assert.equal(settingsDialog().open, true);
    assert.equal(preferencesField().value, SAVED);
    assert.equal(loadMessage().textContent, "");
  });

  test("hides Needs a valid API key to turn on. when the check fails", async (t) => {
    quiet.expect(1);
    await openRecipeBook(t, { assistant: "manual" });

    await openSettingsWithFailedCheck();

    assert.equal(isShown(offHint()), false);
  });

  test("limits the family preferences to 10000 characters", async (t) => {
    await openRecipeBook(t);

    await openSettings();

    assert.equal(preferencesField().maxLength, 10000);
  });

  test("shows no count of the characters left while 1000 or more remain", async (t) => {
    await openRecipeBook(t);
    await openSettings();

    typeInto(window, preferencesField(), "a".repeat(9000));

    assert.equal(charactersLeft().textContent, "");
  });

  test("shows the characters left when fewer than 1000 remain", async (t) => {
    await openRecipeBook(t);
    await openSettings();

    typeInto(window, preferencesField(), "a".repeat(9001));

    assert.equal(charactersLeft().textContent, "999 characters left");
  });

  test("says 1 character left when 1 remains", async (t) => {
    await openRecipeBook(t);
    await openSettings();

    typeInto(window, preferencesField(), "a".repeat(9999));

    assert.equal(charactersLeft().textContent, "1 character left");
  });

  test("shows the characters left of the saved text when it opens", async (t) => {
    await openRecipeBook(t);

    await openSettings("a".repeat(9990));

    assert.equal(charactersLeft().textContent, "10 characters left");
  });

  test("announces the characters left politely", async (t) => {
    await openRecipeBook(t);

    await openSettings();

    assert.equal(charactersLeft().getAttribute("aria-live"), "polite");
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
    await respondTo(server, "GET", SETTINGS_URL, 200, NO_SETTINGS);

    assert.equal(loadMessage().textContent, "Couldn't load the settings. Try again.");
    assert.equal(settingsDialog()?.open ?? false, false);
  });

  test("enables the button again when the load fails", async (t) => {
    quiet.expect(1);
    await openRecipeBook(t);

    settingsButton().click();
    await waitFor(() => server.requestFor("GET", "/api/preferences") !== undefined);
    server.requestFor("GET", "/api/preferences").fail();
    await respondTo(server, "GET", SETTINGS_URL, 200, NO_SETTINGS);

    assert.equal(settingsButton().disabled, false);
  });

  test("clears the load message when the next open succeeds", async (t) => {
    quiet.expect(1);
    await openRecipeBook(t);
    settingsButton().click();
    await waitFor(() => server.requestFor("GET", "/api/preferences") !== undefined);
    server.requestFor("GET", "/api/preferences").fail();
    await respondTo(server, "GET", SETTINGS_URL, 200, NO_SETTINGS);

    await openSettings();

    assert.equal(loadMessage().textContent, "");
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

  test("opens nothing when the assistant's settings fail to load", async (t) => {
    quiet.expect(1);
    await openRecipeBook(t);

    settingsButton().click();
    await respondTo(server, "GET", "/api/preferences", 200, { text: SAVED });
    server.requestFor("GET", SETTINGS_URL).fail();
    await tick();

    assert.equal(loadMessage().textContent, "Couldn't load the settings. Try again.");
    assert.equal(settingsDialog()?.open ?? false, false);
  });

  test("offers Anthropic and OpenAI under Provider", async (t) => {
    await openRecipeBook(t);

    await openSettings();

    assert.equal(providerRadio("Anthropic").value, "anthropic");
    assert.equal(providerRadio("OpenAI").value, "openai");
  });

  test("chooses no provider before the assistant's first save", async (t) => {
    await openRecipeBook(t);

    await openSettings();

    assert.equal(providerRadio("Anthropic").checked, false);
    assert.equal(providerRadio("OpenAI").checked, false);
  });

  test("shows the saved provider and model", async (t) => {
    await openRecipeBook(t);

    await openSettings(SAVED, WITH_KEY);

    assert.equal(providerRadio("Anthropic").checked, true);
    assert.equal(labeled("Model").value, "claude-test");
  });

  test("makes Model a list", async (t) => {
    await openRecipeBook(t);

    await openSettings();

    assert.equal(labeled("Model").tagName, "SELECT");
  });

  test("makes API key a password field without autocomplete", async (t) => {
    await openRecipeBook(t);

    await openSettings();

    assert.equal(labeled("API key").type, "password");
    assert.equal(labeled("API key").getAttribute("autocomplete"), "off");
  });

  test("shows the empty API key field without a saved key", async (t) => {
    await openRecipeBook(t);

    await openSettings();

    assert.equal(isShown(labeled("API key")), true);
    assert.deepEqual(byokTexts(), []);
  });

  test("never fills the API key field from a response", async (t) => {
    await openRecipeBook(t);

    await openSettings(SAVED, { ...NO_SETTINGS, apiKey: "sk-from-a-response" });

    assert.equal(labeled("API key").value, "");
  });

  test("says that a key is saved instead of showing the API key field", async (t) => {
    await openRecipeBook(t);

    await openSettings(SAVED, WITH_KEY);

    assert.equal(isShown(labeled("API key")), false);
    assert.deepEqual(byokTexts(), ["A key is saved."]);
    assert.equal(isShown(settingsControl("Replace Key")), true);
    assert.equal(isShown(settingsControl("Remove Key")), true);
  });

  test("shows the empty API key field and focuses it with Replace Key", async (t) => {
    await openRecipeBook(t);
    await openSettings(SAVED, WITH_KEY);

    settingsControl("Replace Key").click();

    assert.equal(isShown(labeled("API key")), true);
    assert.equal(labeled("API key").value, "");
    assertFocus(document, labeled("API key"));
  });

  test("says that Done removes the key after Remove Key", async (t) => {
    await openRecipeBook(t);
    await openSettings(SAVED, WITH_KEY);

    settingsControl("Remove Key").click();

    assert.deepEqual(byokTexts(), ["Done removes the key."]);
    assert.equal(isShown(settingsControl("Remove Key")), false);
    assertFocus(document, settingsControl("Keep Key"));
  });

  test("keeps the key with Keep Key", async (t) => {
    await openRecipeBook(t);
    await openSettings(SAVED, WITH_KEY);
    settingsControl("Remove Key").click();

    settingsControl("Keep Key").click();

    assert.deepEqual(byokTexts(), ["A key is saved."]);
    assert.equal(isShown(settingsControl("Keep Key")), false);
    assertFocus(document, settingsControl("Remove Key"));
  });

  test("leaves the key status as it is when Settings opens again", async (t) => {
    await openRecipeBook(t);
    await openSettings(SAVED, WITH_KEY);
    settingsControl("Cancel").click();
    // A live region speaks when its text is set, even to the same text.
    const status = section("BYOK").querySelector(".key-status");
    const changes = [];
    const observer = new window.MutationObserver((records) => changes.push(...records));
    observer.observe(status, { childList: true, characterData: true, subtree: true });

    await openSettings(SAVED, WITH_KEY);

    changes.push(...observer.takeRecords());
    observer.disconnect();
    assert.equal(changes.length, 0, "changes of the key status");
    assert.equal(status.textContent, "A key is saved.");
  });

  test("shows the provider and model read-only when set on the server", async (t) => {
    await openRecipeBook(t);

    await openSettings(SAVED, FROM_SERVER);

    assert.match(section("BYOK").textContent, /Provider\s*OpenAI/);
    assert.match(section("BYOK").textContent, /Model\s*gpt-test/);
    assert.deepEqual([...section("BYOK").querySelectorAll("input, select")].filter(isShown), []);
  });

  test("says Set on the server when the server sets the assistant up", async (t) => {
    await openRecipeBook(t);

    await openSettings(SAVED, FROM_SERVER);

    assert.deepEqual(byokTexts(), ["Set on the server."]);
  });

  test("shows the fields again after a server's settings on the next open", async (t) => {
    await openRecipeBook(t);
    await openSettings(SAVED, FROM_SERVER);
    query(".cancel").click();

    await openSettings(SAVED, NO_SETTINGS);

    assert.deepEqual(byokTexts(), []);
    assert.equal(isShown(labeled("Model")), true);
  });

  test("asks for the models of the saved key when it opens", async (t) => {
    await openRecipeBook(t);

    await openSettings(SAVED, WITH_KEY);

    assert.deepEqual(modelRequests(), [{ provider: "anthropic" }]);
  });

  test("asks for no models when it opens without a saved key", async (t) => {
    await openRecipeBook(t);

    await openSettings();
    await tick();

    assert.deepEqual(modelRequests(), []);
  });

  test("asks for no models when the server sets the assistant up", async (t) => {
    await openRecipeBook(t);

    await openSettings(SAVED, FROM_SERVER);
    await tick();

    assert.deepEqual(modelRequests(), []);
  });

  test("asks for the models of a key after the API key field changes", async (t) => {
    await openRecipeBook(t);
    await openSettings();
    providerRadio("OpenAI").click();

    enterKey("sk-test");

    assert.deepEqual(modelRequests(), [{ provider: "openai", apiKey: "sk-test" }]);
    await answerModels(OPENAI_MODELS);
  });

  test("asks for the models of a key after it's pasted", async (t) => {
    await openRecipeBook(t);
    await openSettings();
    providerRadio("OpenAI").click();

    pasteKey("sk-test");

    assert.deepEqual(modelRequests(), [{ provider: "openai", apiKey: "sk-test" }]);
    await answerModels(OPENAI_MODELS);
  });

  test("asks for no models while a key is typed", async (t) => {
    await openRecipeBook(t);
    await openSettings();
    providerRadio("OpenAI").click();

    typeInto(window, labeled("API key"), "sk-test");
    await tick();

    assert.deepEqual(modelRequests(), []);
  });

  test("asks for no models while typing after a paste that changed nothing", async (t) => {
    await openRecipeBook(t);
    await openSettings();
    providerRadio("OpenAI").click();
    // A paste of an empty clipboard sends no input.
    labeled("API key").dispatchEvent(new window.Event("paste", { bubbles: true }));

    typeInto(window, labeled("API key"), "s");
    await tick();

    assert.deepEqual(modelRequests(), []);
  });

  test("sends one check for a paste and the change after it", async (t) => {
    await openRecipeBook(t);
    await openSettings();
    providerRadio("OpenAI").click();
    pasteKey("sk-test");

    labeled("API key").dispatchEvent(new window.Event("change", { bubbles: true }));
    await tick();

    assert.equal(modelRequests().length, 1);
    await answerModels(OPENAI_MODELS);
  });

  test("sends the check again on a change after it failed", async (t) => {
    quiet.expect(1);
    await openRecipeBook(t);
    await openSettings();
    providerRadio("OpenAI").click();
    enterKey("sk-test");
    await answerPending("POST", MODELS_URL, 502, {});

    labeled("API key").dispatchEvent(new window.Event("change", { bubbles: true }));

    assert.equal(modelRequests().length, 2);
    await answerModels(OPENAI_MODELS);
  });

  test("asks for the models of a pasted key without spaces or line breaks", async (t) => {
    await openRecipeBook(t);
    await openSettings();
    providerRadio("OpenAI").click();

    pasteKey("  sk-test \t\n");

    assert.deepEqual(modelRequests(), [{ provider: "openai", apiKey: "sk-test" }]);
    await answerModels(OPENAI_MODELS);
  });

  test("asks for no models when a key is entered without a provider", async (t) => {
    await openRecipeBook(t);
    await openSettings();

    enterKey("sk-test");
    await tick();

    assert.deepEqual(modelRequests(), []);
  });

  test("asks for the models of the entered key when the provider changes", async (t) => {
    await openRecipeBook(t);
    await openSettings();
    enterKey("sk-test");

    providerRadio("OpenAI").click();

    assert.deepEqual(modelRequests(), [{ provider: "openai", apiKey: "sk-test" }]);
    await answerModels(OPENAI_MODELS);
  });

  test("disables Model until a list arrives", async (t) => {
    await openRecipeBook(t);
    await openSettings(SAVED, WITH_KEY, { models: null });

    assert.equal(labeled("Model").disabled, true);
    await answerModels(ANTHROPIC_MODELS);
    assert.equal(labeled("Model").disabled, false);
  });

  test("disables Model without a key", async (t) => {
    await openRecipeBook(t);

    await openSettings();

    assert.equal(labeled("Model").disabled, true);
  });

  test("fills Model with the names of the models in the list's order", async (t) => {
    await openRecipeBook(t);

    await openSettings(SAVED, WITH_KEY);

    assert.deepEqual(modelOptions(), ["Claude Next", "Claude Test"]);
  });

  test("selects the newest model of a key without a saved model", async (t) => {
    await openRecipeBook(t);
    await openSettings();
    providerRadio("Anthropic").click();

    enterKey("sk-ant-test");
    await answerModels(ANTHROPIC_MODELS);

    assert.equal(labeled("Model").value, "claude-next");
  });

  test("shows a saved model that the list lacks as not available", async (t) => {
    await openRecipeBook(t);

    await openSettings(SAVED, WITH_KEY, { models: [{ id: "claude-next", name: "Claude Next" }] });

    assert.equal(selectedModel(), "claude-test (not available)");
    assert.deepEqual(modelOptions(), ["claude-test (not available)", "Claude Next"]);
  });

  test("fills Model only with the answer of the newest check", async (t) => {
    await openRecipeBook(t);
    await openSettings();
    providerRadio("Anthropic").click();
    enterKey("sk-test");
    providerRadio("OpenAI").click();
    const [older, newer] = server.requests.filter((request) => request.url === MODELS_URL);

    newer.respond(200, { models: OPENAI_MODELS });
    await tick();
    older.respond(200, { models: ANTHROPIC_MODELS });
    await tick();

    assert.deepEqual(modelOptions(), ["gpt-test"]);
  });

  test("keeps Model disabled when an older check answers first", async (t) => {
    await openRecipeBook(t);
    await openSettings();
    providerRadio("Anthropic").click();
    enterKey("sk-test");
    providerRadio("OpenAI").click();
    const [older] = server.requests.filter((request) => request.url === MODELS_URL);

    older.respond(200, { models: ANTHROPIC_MODELS });
    await tick();

    assert.equal(labeled("Model").disabled, true);
    await answerModels(OPENAI_MODELS);
  });

  test("ignores a check that answers after Settings closes", async (t) => {
    await openRecipeBook(t);
    await openSettings(SAVED, WITH_KEY, { models: null });
    query(".cancel").click();
    await openSettings();

    await answerModels(ANTHROPIC_MODELS);

    assert.equal(labeled("Model").disabled, true);
  });

  test("says This key has no models that can chat. for an empty list", async (t) => {
    await openRecipeBook(t);

    await openSettings(SAVED, WITH_KEY, { models: [] });

    assert.deepEqual(byokTexts(), ["A key is saved.", "This key has no models that can chat."]);
    assert.equal(labeled("Model").disabled, true);
  });

  test("shows the server's message when it rejects a key", async (t) => {
    await openRecipeBook(t);
    await openSettings();
    providerRadio("OpenAI").click();
    enterKey("sk-wrong");

    await answerPending("POST", MODELS_URL, 400, { error: REJECTED });

    assert.deepEqual(byokTexts(), [REJECTED]);
    assert.equal(labeled("Model").disabled, true);
  });

  test("says Couldn't check the key. with Check Again when a check fails", async (t) => {
    quiet.expect(1);
    await openRecipeBook(t);

    await openSettings(SAVED, WITH_KEY, { models: null });
    await answerPending("POST", MODELS_URL, 502, { error: "The provider failed." });

    assert.deepEqual(byokTexts(), ["A key is saved.", "Couldn't check the key."]);
    assert.equal(isShown(settingsControl("Check Again")), true);
  });

  test("says Couldn't check the key. when a check gets no answer", async (t) => {
    quiet.expect(1);
    await openRecipeBook(t);
    await openSettings(SAVED, WITH_KEY, { models: null });

    server.requestFor("POST", MODELS_URL).fail();
    await tick();

    assert.deepEqual(byokTexts(), ["A key is saved.", "Couldn't check the key."]);
  });

  test("hides Check Again until a check fails", async (t) => {
    await openRecipeBook(t);

    await openSettings(SAVED, WITH_KEY);

    assert.equal(isShown(settingsControl("Check Again")), false);
  });

  test("sends the last check again with Check Again", async (t) => {
    quiet.expect(1);
    await openRecipeBook(t);
    await openSettings();
    providerRadio("OpenAI").click();
    enterKey("sk-test");
    await answerPending("POST", MODELS_URL, 502, {});

    settingsControl("Check Again").click();

    assert.deepEqual(modelRequests().at(-1), { provider: "openai", apiKey: "sk-test" });
    assert.equal(modelRequests().length, 2);
    await answerModels(OPENAI_MODELS);
  });

  test("fills Model and focuses it when Check Again gets the list", async (t) => {
    quiet.expect(1);
    await openRecipeBook(t);
    await openSettings(SAVED, WITH_KEY, { models: null });
    await answerPending("POST", MODELS_URL, 502, {});
    settingsControl("Check Again").focus();

    settingsControl("Check Again").click();
    await answerModels(ANTHROPIC_MODELS);

    assert.deepEqual(modelOptions(), ["Claude Next", "Claude Test"]);
    assert.equal(isShown(settingsControl("Check Again")), false);
    assertFocus(document, labeled("Model"));
  });

  test("shows the empty API key field after a change to the other provider", async (t) => {
    await openRecipeBook(t);
    await openSettings(SAVED, WITH_KEY);

    providerRadio("OpenAI").click();

    assert.equal(isShown(labeled("API key")), true);
    assert.equal(labeled("API key").value, "");
    assert.equal(isShown(settingsControl("Replace Key")), false);
  });

  test("clears Model after a change to the other provider", async (t) => {
    await openRecipeBook(t);
    await openSettings(SAVED, WITH_KEY);

    providerRadio("OpenAI").click();
    await tick();

    assert.equal(labeled("Model").disabled, true);
    assert.deepEqual(modelOptions(), [""]);
    assert.deepEqual(modelRequests(), [{ provider: "anthropic" }]);
  });

  test("shows the saved key and its models again after a change back", async (t) => {
    await openRecipeBook(t);
    await openSettings(SAVED, WITH_KEY);
    providerRadio("OpenAI").click();

    providerRadio("Anthropic").click();
    await answerModels(ANTHROPIC_MODELS);

    assert.deepEqual(byokTexts(), ["A key is saved."]);
    assert.equal(labeled("Model").value, "claude-test");
  });

  test("drops Remove Key after a change to the other provider and back", async (t) => {
    await openRecipeBook(t);
    await openSettings(SAVED, WITH_KEY);
    settingsControl("Remove Key").click();
    providerRadio("OpenAI").click();

    providerRadio("Anthropic").click();
    await answerModels(ANTHROPIC_MODELS);

    assert.deepEqual(byokTexts(), ["A key is saved."]);
    assert.equal(isShown(settingsControl("Remove Key")), true);
  });

  test("keeps the family preferences editable while a check runs", async (t) => {
    await openRecipeBook(t);

    await openSettings(SAVED, WITH_KEY, { models: null });

    assert.equal(preferencesField().disabled, false);
    await answerModels(ANTHROPIC_MODELS);
  });

  test("keeps the family preferences editable after a check fails", async (t) => {
    quiet.expect(1);
    await openRecipeBook(t);
    await openSettings(SAVED, WITH_KEY, { models: null });

    await answerPending("POST", MODELS_URL, 502, {});

    assert.equal(preferencesField().disabled, false);
  });

  test("saves the family preferences with Done after a check fails", async (t) => {
    quiet.expect(1);
    await openRecipeBook(t);
    await openSettings(SAVED, WITH_KEY, { models: null });
    await answerPending("POST", MODELS_URL, 502, {});
    typeInto(window, preferencesField(), "No pork.");

    query(".done").click();
    await respondTo(server, "PUT", "/api/preferences", 200, { text: "No pork." });

    assert.equal(settingsDialog().open, false);
    assert.equal(server.requestFor("PUT", SETTINGS_URL), undefined);
  });

  test("saves the family preferences with Done while a check runs", async (t) => {
    await openRecipeBook(t);
    await openSettings(SAVED, WITH_KEY, { models: null });
    typeInto(window, preferencesField(), "No pork.");

    query(".done").click();
    await respondTo(server, "PUT", "/api/preferences", 200, { text: "No pork." });

    assert.equal(settingsDialog().open, false);
    await answerModels(ANTHROPIC_MODELS);
  });

  test("saves the provider and the model with Done", async (t) => {
    await openRecipeBook(t);
    await openSettings(SAVED, WITH_KEY);
    chooseModel("claude-next");

    query(".done").click();

    await waitFor(() => server.requestFor("PUT", SETTINGS_URL) !== undefined);
    assert.deepEqual(server.requestFor("PUT", SETTINGS_URL).body, {
      provider: "anthropic",
      model: "claude-next",
    });
    await respondTo(server, "PUT", SETTINGS_URL, 200, { ...WITH_KEY, model: "claude-next" });
  });

  test("saves a typed key with Done", async (t) => {
    await openRecipeBook(t);
    await openSettings();
    await chooseOpenAI();

    query(".done").click();

    await waitFor(() => server.requestFor("PUT", SETTINGS_URL) !== undefined);
    assert.deepEqual(server.requestFor("PUT", SETTINGS_URL).body, {
      provider: "openai",
      model: "gpt-test",
      apiKey: "sk-test",
    });
    await respondTo(server, "PUT", SETTINGS_URL, 200, OPENAI);
  });

  test("saves a pasted key without spaces or line breaks with Done", async (t) => {
    await openRecipeBook(t);
    await openSettings();
    providerRadio("OpenAI").click();
    pasteKey("  sk-test \t\n");
    await answerModels(OPENAI_MODELS);

    query(".done").click();

    await waitFor(() => server.requestFor("PUT", SETTINGS_URL) !== undefined);
    assert.equal(server.requestFor("PUT", SETTINGS_URL).body.apiKey, "sk-test");
    await respondTo(server, "PUT", SETTINGS_URL, 200, OPENAI);
  });

  test("keeps the saved key when Replace Key leaves the field empty", async (t) => {
    await openRecipeBook(t);
    await openSettings(SAVED, WITH_KEY);
    settingsControl("Replace Key").click();
    chooseModel("claude-next");

    query(".done").click();

    await waitFor(() => server.requestFor("PUT", SETTINGS_URL) !== undefined);
    assert.equal("apiKey" in server.requestFor("PUT", SETTINGS_URL).body, false);
    await respondTo(server, "PUT", SETTINGS_URL, 200, WITH_KEY);
  });

  test("removes the key with Done after Remove Key", async (t) => {
    await openRecipeBook(t);
    await openSettings(SAVED, WITH_KEY);
    settingsControl("Remove Key").click();

    query(".done").click();

    await waitFor(() => server.requestFor("PUT", SETTINGS_URL) !== undefined);
    assert.deepEqual(server.requestFor("PUT", SETTINGS_URL).body, {
      provider: "anthropic",
      model: "claude-test",
      apiKey: null,
    });
    await respondTo(server, "PUT", SETTINGS_URL, 200, { ...WITH_KEY, keySaved: false });
  });

  test("removes the key with Done after Remove Key while a check fails", async (t) => {
    quiet.expect(1);
    await openRecipeBook(t);
    await openSettings(SAVED, WITH_KEY, { models: null });
    await answerPending("POST", MODELS_URL, 502, {});
    settingsControl("Remove Key").click();

    query(".done").click();

    await waitFor(() => server.requestFor("PUT", SETTINGS_URL) !== undefined);
    assert.equal(server.requestFor("PUT", SETTINGS_URL).body.apiKey, null);
    await respondTo(server, "PUT", SETTINGS_URL, 200, { ...WITH_KEY, keySaved: false });
  });

  test("sends only the assistant's settings when the text didn't change", async (t) => {
    await openRecipeBook(t);
    await openSettings();
    await chooseOpenAI();

    query(".done").click();
    await respondTo(server, "PUT", SETTINGS_URL, 200, OPENAI);

    assert.equal(server.requestFor("PUT", "/api/preferences"), undefined);
    assert.equal(settingsDialog().open, false);
  });

  test("sends no assistant's settings when the BYOK section didn't change", async (t) => {
    await openRecipeBook(t);
    await openSettings(SAVED, WITH_KEY);
    typeInto(window, preferencesField(), "No pork.");

    query(".done").click();
    await respondTo(server, "PUT", "/api/preferences", 200, { text: "No pork." });

    assert.equal(server.requestFor("PUT", SETTINGS_URL), undefined);
  });

  test("sends no assistant's settings for a saved model that's not available", async (t) => {
    await openRecipeBook(t);
    await openSettings(SAVED, WITH_KEY, { models: [{ id: "claude-next", name: "Claude Next" }] });
    typeInto(window, preferencesField(), "No pork.");

    query(".done").click();
    await respondTo(server, "PUT", "/api/preferences", 200, { text: "No pork." });

    assert.equal(server.requestFor("PUT", SETTINGS_URL), undefined);
  });

  test("sends no assistant's settings when the server sets the assistant up", async (t) => {
    await openRecipeBook(t);
    await openSettings(SAVED, FROM_SERVER);

    query(".done").click();
    await tick();

    assert.equal(server.requestFor("PUT", SETTINGS_URL), undefined);
    assert.equal(settingsDialog().open, false);
  });

  test("stays open until both saves succeed", async (t) => {
    await openRecipeBook(t);
    await openSettings();
    typeInto(window, preferencesField(), "No pork.");
    await chooseOpenAI();
    query(".done").click();

    await respondTo(server, "PUT", "/api/preferences", 200, { text: "No pork." });

    assert.equal(settingsDialog().open, true);
    await respondTo(server, "PUT", SETTINGS_URL, 200, OPENAI);
    assert.equal(settingsDialog().open, false);
  });

  test("disables the BYOK section while it saves", async (t) => {
    await openRecipeBook(t);
    await openSettings();
    await chooseOpenAI();

    query(".done").click();

    assert.equal(providerRadio("Anthropic").disabled, true);
    assert.equal(labeled("Model").disabled, true);
    assert.equal(labeled("API key").disabled, true);
    await respondTo(server, "PUT", SETTINGS_URL, 200, OPENAI);
  });

  test("enables Model again with its list after a failed save", async (t) => {
    quiet.expect(1);
    await openRecipeBook(t);
    await openSettings();
    await chooseOpenAI();
    query(".done").click();

    await respondTo(server, "PUT", SETTINGS_URL, 500, {});

    assert.equal(labeled("Model").disabled, false);
  });

  test("keeps Model disabled without a list after a failed save", async (t) => {
    quiet.expect(2);
    await openRecipeBook(t);
    await openSettings(SAVED, WITH_KEY, { models: null });
    await answerPending("POST", MODELS_URL, 502, {});
    settingsControl("Remove Key").click();
    query(".done").click();

    await respondTo(server, "PUT", SETTINGS_URL, 500, {});

    assert.equal(labeled("Model").disabled, true);
  });

  test("shows the server's message under BYOK when it rejects the save", async (t) => {
    quiet.expect(1);
    await openRecipeBook(t);
    await openSettings();
    await chooseOpenAI();
    query(".done").click();

    await respondTo(server, "PUT", SETTINGS_URL, 400, { error: "Choose a model from the list." });

    assert.equal(settingsDialog().open, true);
    assert.equal(byokMessage().textContent, "Choose a model from the list.");
    assert.equal(preferencesMessage().textContent, "");
  });

  test("shows a message under BYOK when its save fails", async (t) => {
    quiet.expect(1);
    await openRecipeBook(t);
    await openSettings();
    await chooseOpenAI();
    query(".done").click();

    await waitFor(() => server.requestFor("PUT", SETTINGS_URL) !== undefined);
    server.requestFor("PUT", SETTINGS_URL).fail();
    await tick();

    assert.equal(settingsDialog().open, true);
    assert.equal(byokMessage().textContent, "Couldn't save the settings. Try again.");
  });

  test("focuses Done when the assistant's settings fail to save", async (t) => {
    quiet.expect(1);
    await openRecipeBook(t);
    await openSettings();
    await chooseOpenAI();
    query(".done").click();

    await respondTo(server, "PUT", SETTINGS_URL, 500, {});

    assertFocus(document, query(".done"));
  });

  test("says Choose a provider. for a key without a provider", async (t) => {
    await openRecipeBook(t);
    await openSettings();
    enterKey("sk-test");

    query(".done").click();

    assert.equal(byokMessage().textContent, "Choose a provider.");
    assertFocus(document, providerRadio("Anthropic"));
  });

  test("says Enter an API key for this provider. for a provider alone", async (t) => {
    await openRecipeBook(t);
    await openSettings();
    providerRadio("OpenAI").click();

    query(".done").click();

    assert.equal(byokMessage().textContent, "Enter an API key for this provider.");
    assertFocus(document, labeled("API key"));
  });

  test("says Enter an API key for this provider. for the other provider", async (t) => {
    await openRecipeBook(t);
    await openSettings(SAVED, WITH_KEY);
    providerRadio("OpenAI").click();

    query(".done").click();
    await tick();

    assert.equal(byokMessage().textContent, "Enter an API key for this provider.");
    assert.equal(server.requestFor("PUT", SETTINGS_URL), undefined);
  });

  test("says Wait until the key is checked. while the check runs", async (t) => {
    await openRecipeBook(t);
    await openSettings();
    providerRadio("OpenAI").click();
    enterKey("sk-test");

    query(".done").click();
    await tick();

    assert.equal(byokMessage().textContent, "Wait until the key is checked.");
    assertFocus(document, labeled("API key"));
    assert.equal(server.requestFor("PUT", SETTINGS_URL), undefined);
    await answerModels(OPENAI_MODELS);
  });

  test("says Choose a model from the list. for a model that's not available", async (t) => {
    await openRecipeBook(t);
    await openSettings(SAVED, WITH_KEY, { models: [{ id: "claude-next", name: "Claude Next" }] });
    settingsControl("Replace Key").click();
    typeInto(window, labeled("API key"), "sk-ant-new");

    query(".done").click();
    await tick();

    assert.equal(byokMessage().textContent, "Choose a model from the list.");
    assertFocus(document, labeled("Model"));
    assert.equal(server.requestFor("PUT", SETTINGS_URL), undefined);
  });

  const MESSAGE = "The key can't have spaces or special characters.";
  const KEYS = {
    "a space": "sk test",
    "a control character": "sk\u0007test",
    "a zero-width space": "sk\u200btest",
    "a curly quote": "sk\u2019test",
  };
  for (const [character, key] of Object.entries(KEYS)) {
    test(`refuses a key with ${character}`, async (t) => {
      await openRecipeBook(t);
      await openSettings();
      providerRadio("OpenAI").click();
      typeInto(window, labeled("API key"), key);

      query(".done").click();

      assert.equal(byokMessage().textContent, MESSAGE);
      assertFocus(document, labeled("API key"));
    });
  }

  test("says The key is too long. for a key over 500 characters", async (t) => {
    await openRecipeBook(t);
    await openSettings();
    providerRadio("OpenAI").click();
    typeInto(window, labeled("API key"), "k".repeat(501));

    query(".done").click();

    assert.equal(byokMessage().textContent, "The key is too long.");
    assertFocus(document, labeled("API key"));
  });

  test("names every problem and focuses the first", async (t) => {
    await openRecipeBook(t);
    await openSettings();
    typeInto(window, labeled("API key"), "sk test");

    query(".done").click();

    assert.equal(
      byokMessage().textContent,
      "Choose a provider. The key can't have spaces or special characters.",
    );
    assertFocus(document, providerRadio("Anthropic"));
  });

  test("saves nothing and stays open while the BYOK section has a problem", async (t) => {
    await openRecipeBook(t);
    await openSettings();
    typeInto(window, preferencesField(), "No pork.");
    providerRadio("OpenAI").click();

    query(".done").click();
    await tick();

    assert.equal(settingsDialog().open, true);
    assert.equal(server.requestFor("PUT", "/api/preferences"), undefined);
    assert.equal(server.requestFor("PUT", SETTINGS_URL), undefined);
  });

  test("leaves the API key field empty after closing", async (t) => {
    await openRecipeBook(t);
    await openSettings();
    typeInto(window, labeled("API key"), "sk-test");

    query(".cancel").click();

    assert.equal(labeled("API key").value, "");
  });

  test("leaves the password managers out of the API key field", async (t) => {
    await openRecipeBook(t);

    await openSettings();

    const field = labeled("API key");
    assert.equal(field.hasAttribute("data-1p-ignore"), true);
    assert.equal(field.getAttribute("data-lpignore"), "true");
    assert.equal(field.hasAttribute("data-bwignore"), true);
  });

  test("sends only the failed save again with the next Done", async (t) => {
    quiet.expect(1);
    await openRecipeBook(t);
    await openSettings();
    typeInto(window, preferencesField(), "No pork.");
    await chooseOpenAI();
    query(".done").click();
    await waitFor(() => server.requestFor("PUT", "/api/preferences") !== undefined);
    server.requestFor("PUT", "/api/preferences").fail();
    await respondTo(server, "PUT", SETTINGS_URL, 200, OPENAI);
    const sent = server.requests.length;

    query(".done").click();
    await tick();

    assert.deepEqual(
      server.requests.slice(sent).map((request) => `${request.method} ${request.url}`),
      ["PUT /api/preferences"],
    );
    await respondTo(server, "PUT", "/api/preferences", 200, { text: "No pork." });
  });

  test("stays open on a backdrop click with changes under BYOK", async (t) => {
    await openRecipeBook(t);
    await openSettings();
    providerRadio("OpenAI").click();

    pointerdown(window, settingsDialog());
    settingsDialog().click();

    assert.equal(settingsDialog().open, true);
  });

  test("prevents leaving on beforeunload after Remove Key", async (t) => {
    await openRecipeBook(t);
    await openSettings(SAVED, WITH_KEY);

    settingsControl("Remove Key").click();

    assert.equal(dispatchBeforeUnload(window).defaultPrevented, true);
  });

  test("returns the focus to the button after closing", async (t) => {
    await openRecipeBook(t);
    await openSettings();

    query(".cancel").click();

    assertFocus(document, settingsButton());
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
