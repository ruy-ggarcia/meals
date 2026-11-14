// Settings: a dialog where the family edits the family preferences, the text
// that the assistant reads in every conversation, and sets up the assistant:
// its provider, its API key, and its model, from the list that the provider
// sends for the key. A gear button at the end of the toolbar opens it, at
// every width. Each open loads the saved settings again, so the dialog never
// shows settings that another device has replaced.

import { checkAssistant, refreshAssistant } from "./assistant.js";
import { createElement, focusIsFree, onBackdropClick } from "./dom.js";
import { getJson, sendJson } from "./http.js";

/** The most characters of the family preferences, as the server allows. */
export const MAX_PREFERENCES = 10000;

/** Under this many characters left, the dialog shows how many remain. */
const COUNT_FROM = 1000;

const ASSISTANT_SETTINGS_URL = "/api/assistant/settings";
const MODELS_URL = "/api/assistant/models";

/** The names of the providers, as the Provider control shows them. */
const PROVIDER_NAMES = { anthropic: "Anthropic", openai: "OpenAI" };

/** What the BYOK section says about the saved key, by the key's state. */
const KEY_STATUS = {
  saved: "A key is saved.",
  remove: "Done removes the key.",
};

const SAVE_FAILED = "Couldn't save the settings. Try again.";
const CHECK_FAILED = "Couldn't check the key.";
const NO_MODELS = "This key has no models that can chat.";
const NO_KEY = "Enter an API key for this provider.";
const NOT_LISTED = "Choose a model from the list.";
const CHECKING = "Wait until the key is checked.";

/** The most characters of the key, as the server allows. */
export const MAX_KEY = 500;

// Anything but a visible ASCII character, which no key of a provider holds.
const NOT_IN_KEY = /[^\x21-\x7e]/;

// static markup, never user text. Each section takes its name from
// aria-label, not from aria-labelledby on its heading: Firefox crashed in
// testing, now and then, when axe read the section's ariaLabelledByElements,
// as it did with the card of the assistant's pending changes.
const DIALOG_MARKUP = `
  <div class="dialog-body">
    <header class="sheet-header">
      <button type="button" class="cancel">Cancel</button>
      <div class="sheet-heading">
        <h2 id="settings-title" class="dialog-title" tabindex="-1">Settings</h2>
      </div>
      <button type="button" class="done primary">Done</button>
    </header>
    <div class="sheet-content">
      <section class="assistant-section" aria-label="Assistant">
        <div class="section-title section-heading">
          <h3>Assistant</h3>
          <p class="section-note assistant-off" hidden>Needs a valid API key to turn on.</p>
        </div>
        <label class="field-label" for="family-preferences">Family preferences</label>
        <div class="card preferences-card">
          <textarea id="family-preferences" class="preferences-field" maxlength="${MAX_PREFERENCES}" aria-describedby="family-preferences-hint"></textarea>
        </div>
        <p class="field-hint characters-left" aria-live="polite"></p>
        <p id="family-preferences-hint" class="field-hint">The assistant reads this text in every conversation.</p>
        <p class="field-message save-message" role="status"></p>
      </section>
      <section class="byok-section" aria-label="BYOK">
        <h3 class="section-title">BYOK</h3>
        <div class="server-settings" hidden>
          <dl class="card settings-summary">
            <div class="summary-row"><dt>Provider</dt><dd class="server-provider"></dd></div>
            <div class="summary-row"><dt>Model</dt><dd class="server-model"></dd></div>
          </dl>
          <p class="field-hint">Set on the server.</p>
        </div>
        <div class="byok-fields">
          <fieldset class="provider-field">
            <legend class="field-label">Provider</legend>
            <div class="segmented">
              <label><input type="radio" name="assistant-provider" value="anthropic"><span>Anthropic</span></label>
              <label><input type="radio" name="assistant-provider" value="openai"><span>OpenAI</span></label>
            </div>
          </fieldset>
          <label class="field-label" for="assistant-key">API key</label>
          <input id="assistant-key" class="name-field" type="password" autocomplete="off" data-1p-ignore data-lpignore="true" data-bwignore>
          <div class="card saved-key">
            <p class="key-status" aria-live="polite"></p>
            <div class="key-actions">
              <button type="button" class="key-action replace-key">Replace Key</button>
              <button type="button" class="key-action remove-key">Remove Key</button>
              <button type="button" class="key-action keep-key">Keep Key</button>
            </div>
          </div>
          <label class="field-label" for="assistant-model">Model</label>
          <select id="assistant-model" class="name-field" disabled></select>
          <div class="model-check">
            <p class="field-message model-message" role="status"></p>
            <button type="button" class="key-action check-again" hidden>Check Again</button>
          </div>
        </div>
        <p class="field-message assistant-message" role="status"></p>
      </section>
    </div>
  </div>`;

/**
 * The assistant's settings as the server shows them, without the key.
 * @typedef {{ provider: string | null, model: string | null, keySaved: boolean, source: "environment" | "settings" }} AssistantSettings
 */

/**
 * A model of a provider's list: its identifier, and the name to show.
 * @typedef {{ id: string, name: string }} Model
 */

/**
 * A request for the models of a provider: with the key that the family
 * entered, or without a key, which asks with the saved one.
 * @typedef {{ provider: string, apiKey?: string }} ModelsRequest
 */

/**
 * What the BYOK section does with the key: `none` without a saved key,
 * `saved` keeps the saved key, `replace` shows the field for a new one, and
 * `remove` removes the saved key on Done.
 * @typedef {"none" | "saved" | "replace" | "remove"} KeyState
 */

/**
 * Builds the dialog of Settings at the end of the page, and returns it with
 * the parts that the open and the save change.
 */
function createDialog() {
  const dialog = createElement("dialog", "dialog settings-dialog");
  dialog.setAttribute("aria-labelledby", "settings-title");
  dialog.innerHTML = DIALOG_MARKUP;
  document.body.append(dialog);
  const part = (selector) => dialog.querySelector(selector);
  return {
    dialog,
    title: /** @type {HTMLElement} */ (part(".dialog-title")),
    offHint: /** @type {HTMLElement} */ (part(".assistant-off")),
    field: /** @type {HTMLTextAreaElement} */ (part(".preferences-field")),
    charactersLeft: part(".characters-left"),
    saveMessage: part(".save-message"),
    doneButton: /** @type {HTMLButtonElement} */ (part(".done")),
    serverSettings: /** @type {HTMLElement} */ (part(".server-settings")),
    serverProvider: part(".server-provider"),
    serverModel: part(".server-model"),
    byokFields: /** @type {HTMLElement} */ (part(".byok-fields")),
    providerRadios: /** @type {HTMLInputElement[]} */ ([
      ...dialog.querySelectorAll("input[name='assistant-provider']"),
    ]),
    key: /** @type {HTMLInputElement} */ (part("#assistant-key")),
    savedKey: /** @type {HTMLElement} */ (part(".saved-key")),
    keyStatus: part(".key-status"),
    replaceKey: /** @type {HTMLButtonElement} */ (part(".replace-key")),
    removeKey: /** @type {HTMLButtonElement} */ (part(".remove-key")),
    keepKey: /** @type {HTMLButtonElement} */ (part(".keep-key")),
    model: /** @type {HTMLSelectElement} */ (part("#assistant-model")),
    modelMessage: part(".model-message"),
    checkAgain: /** @type {HTMLButtonElement} */ (part(".check-again")),
    assistantMessage: part(".assistant-message"),
  };
}

/**
 * The count of the characters left in a text of `length` characters, or an
 * empty text while many remain.
 */
function charactersLeftText(length) {
  const left = MAX_PREFERENCES - length;
  if (left >= COUNT_FROM) return "";
  return left === 1 ? "1 character left" : `${left} characters left`;
}

/** Whether `element` shows: neither it nor a container of it is hidden. */
function isShown(element) {
  return element.closest("[hidden]") === null;
}

/** Whether the requests for models `a` and `b` ask the same, and neither is null. */
function sameRequest(a, b) {
  return a !== null && b !== null && a.provider === b.provider && a.apiKey === b.apiKey;
}

/**
 * Wires the gear button of the page to Settings. The dialog is built on the
 * first open and reused, and closing it returns the focus to the button.
 * Cancel, Escape, and Android's Back close it and discard the changes, as in
 * the editors, and a click on the backdrop closes it only without changes.
 * Done saves the text and the assistant's settings, each only when it
 * changed, and closes once both are saved.
 */
export function setUpSettings() {
  const button = /** @type {HTMLButtonElement} */ (document.querySelector(".open-settings"));
  // Says why Settings didn't open, in the page's content where the page shows
  // its own load errors, so it covers nothing. Every page that calls this has
  // the row of its load error, `#load-error`, at the start of its content.
  const loadMessage = createElement("p", "settings-message");
  loadMessage.setAttribute("role", "alert");
  document.getElementById("load-error").before(loadMessage);

  /** @type {ReturnType<typeof createDialog> | null} */
  let parts = null;
  /** The text that the open dialog loaded, or null while it's closed. */
  let loaded = null;
  /** @type {AssistantSettings | null} The assistant's settings that the open dialog loaded. */
  let loadedSettings = null;
  /** @type {KeyState} */
  let keyState = "none";
  let saving = false;
  /**
   * The model that Model selects when a list holds it: the saved one of the
   * chosen provider, or the one that the family chose last.
   */
  let wantedModel = "";
  /** @type {Set<string> | null} The models that Model lists, or null until a list arrives. */
  let listed = null;
  /** @type {ModelsRequest | null} The last check of a key, which Check Again sends again. */
  let lastCheck = null;
  let lastCheckFailed = false;
  // Counts the checks of a key, and the opens and closes. An answer counts
  // only while nothing came after its check, so an older answer never fills
  // the list.
  let checks = 0;
  /**
   * The count of the check that waits for its answer, or null. A newer check,
   * an open, or a close counts past it, so it no longer runs.
   */
  let runningCheck = null;

  /** The provider that the Provider control has chosen, or null. */
  function chosenProvider() {
    return parts.providerRadios.find((radio) => radio.checked)?.value ?? null;
  }

  /**
   * The key in the API key field while it shows, without the spaces and the
   * line breaks that a paste can bring around it.
   */
  function enteredKey() {
    return keyState === "none" || keyState === "replace" ? parts.key.value.trim() : "";
  }

  /** Whether the saved key belongs to `provider`, which may use it. */
  function savedKeyFor(provider) {
    return (
      loadedSettings.source === "settings" &&
      loadedSettings.keySaved &&
      provider === loadedSettings.provider
    );
  }

  /**
   * The body of the save of the assistant's settings, or null when the
   * BYOK section has no changes. The key goes only when one was entered, or
   * as null to remove the saved one. The body never holds a key that the
   * server sent: the server never sends one.
   */
  function assistantChanges() {
    if (loadedSettings === null || loadedSettings.source === "environment") return null;
    const provider = chosenProvider();
    const model = parts.model.value;
    const key = enteredKey();
    /** @type {{ provider: string | null, model: string, apiKey?: string | null }} */
    const changes = { provider, model };
    if (keyState === "remove") changes.apiKey = null;
    else if (key !== "") changes.apiKey = key;
    const changed =
      provider !== loadedSettings.provider ||
      model !== (loadedSettings.model ?? "") ||
      "apiKey" in changes;
    return changed ? changes : null;
  }

  /**
   * What's wrong with `changes` before the server sees them, in the words of
   * the section, each with the control to fix it. A removal needs nothing.
   * The model must come from the list of the key, which only a key without
   * problems can have, once its check answers. The server checks the rest.
   * @param {{ provider: string | null, model: string, apiKey?: string | null }} changes
   * @returns {{ text: string, control: HTMLElement }[]}
   */
  function assistantProblems({ provider, model, apiKey }) {
    if (apiKey === null) return [];
    const problems = [];
    if (provider === null) {
      problems.push({ text: "Choose a provider.", control: parts.providerRadios[0] });
    }
    if (typeof apiKey === "string") {
      if (NOT_IN_KEY.test(apiKey)) {
        problems.push({
          text: "The key can't have spaces or special characters.",
          control: parts.key,
        });
      } else if (apiKey.length > MAX_KEY) {
        problems.push({ text: "The key is too long.", control: parts.key });
      }
    } else if (provider !== null && !savedKeyFor(provider)) {
      // The server never sends a saved key to the other provider.
      problems.push({ text: NO_KEY, control: parts.key });
    }
    if (problems.length === 0 && runningCheck === checks) {
      problems.push({ text: CHECKING, control: parts.key });
    } else if (problems.length === 0 && !listed?.has(model)) {
      problems.push({ text: NOT_LISTED, control: parts.model });
    }
    return problems;
  }

  function hasChanges() {
    return loaded !== null && (parts.field.value !== loaded || assistantChanges() !== null);
  }

  function setSaving(busy) {
    saving = busy;
    const controls =
      /** @type {NodeListOf<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>} */ (
        parts.dialog.querySelectorAll("button, input, select, textarea")
      );
    for (const control of controls) {
      control.disabled = busy;
    }
    // Model takes a choice only from a list.
    parts.model.disabled = busy || listed === null;
  }

  function showCount() {
    parts.charactersLeft.textContent = charactersLeftText(parts.field.value.length);
  }

  /**
   * Shows what happens to the key: the field without a saved key or to
   * replace it, or else the line about the saved key with its buttons. The
   * line is a live region, which speaks whenever its text is set, so it's
   * set only when it changes, not on every open.
   */
  function renderKey() {
    const fieldShown = keyState === "none" || keyState === "replace";
    parts.key.hidden = !fieldShown;
    parts.savedKey.hidden = fieldShown;
    const status = KEY_STATUS[keyState] ?? "";
    if (parts.keyStatus.textContent !== status) parts.keyStatus.textContent = status;
    parts.replaceKey.hidden = keyState !== "saved";
    parts.removeKey.hidden = keyState !== "saved";
    parts.keepKey.hidden = keyState !== "remove";
  }

  /**
   * Makes `settings` what the BYOK section compares its changes with, and
   * empties the key field: the server never sends the key.
   * @param {AssistantSettings} settings
   */
  function takeAssistantSettings(settings) {
    loadedSettings = settings;
    keyState = settings.keySaved ? "saved" : "none";
    parts.key.value = "";
    renderKey();
  }

  /**
   * Shows the assistant's `settings`: read-only when the server sets them,
   * or else in the fields.
   * @param {AssistantSettings} settings
   */
  function showAssistantSettings(settings) {
    const fromServer = settings.source === "environment";
    parts.serverSettings.hidden = !fromServer;
    parts.byokFields.hidden = fromServer;
    parts.serverProvider.textContent = PROVIDER_NAMES[settings.provider] ?? settings.provider;
    parts.serverModel.textContent = settings.model ?? "";
    for (const radio of parts.providerRadios) {
      radio.checked = radio.value === settings.provider;
    }
    takeAssistantSettings(settings);
    wantedModel = settings.model ?? "";
    parts.assistantMessage.textContent = "";
  }

  /**
   * Fills Model with `options`, selects the one whose value is `selected`,
   * and lets the family choose only from a list.
   * @param {{ value: string, text: string }[]} options
   * @param {string} selected
   */
  function setModelOptions(options, selected) {
    parts.model.replaceChildren(
      ...options.map(({ value, text }) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = text;
        return option;
      }),
    );
    parts.model.value = selected;
    parts.model.disabled = saving || listed === null;
  }

  /** Empties Model until a list arrives: it shows the wanted model, if any. */
  function awaitList() {
    listed = null;
    setModelOptions([{ value: wantedModel, text: wantedModel }], wantedModel);
  }

  /**
   * Fills Model with `models`, newest first, and selects the wanted model
   * when the list holds it. A saved model that the list doesn't hold still
   * shows, selected and marked, so the family sees what's saved. Otherwise,
   * Model selects the newest.
   * @param {Model[]} models
   */
  function showModels(models) {
    listed = new Set(models.map(({ id }) => id));
    const options = models.map(({ id, name }) => ({ value: id, text: name }));
    let selected = models[0].id;
    if (listed.has(wantedModel)) {
      selected = wantedModel;
    } else if (
      wantedModel === loadedSettings.model &&
      chosenProvider() === loadedSettings.provider
    ) {
      options.unshift({ value: wantedModel, text: `${wantedModel} (not available)` });
      selected = wantedModel;
    }
    setModelOptions(options, selected);
  }

  /** Says `text` about the check of the key, with Check Again when `failed`. */
  function showCheck(text, failed = false) {
    parts.modelMessage.textContent = text;
    parts.checkAgain.hidden = !failed;
  }

  /**
   * Asks the server for the models of `request`, which checks the key, and
   * shows the answer, unless a newer check, an open, or a close came first.
   * Model takes no choice until the list arrives. Check Again `repeats` a
   * check: its message and its button stay until the answer.
   * @param {ModelsRequest} request
   * @param {boolean} [repeats]
   */
  async function checkModels(request, repeats = false) {
    checks += 1;
    const check = checks;
    runningCheck = check;
    lastCheck = request;
    lastCheckFailed = false;
    if (!repeats) showCheck("");
    awaitList();
    let status;
    let body;
    let failure;
    try {
      ({ status, body } = await sendJson("POST", MODELS_URL, request));
    } catch (error) {
      failure = error;
    }
    if (check !== checks) return;
    runningCheck = null;
    const focused = document.activeElement === parts.checkAgain;
    if (status === 200 && Array.isArray(body?.models)) {
      if (body.models.length > 0) showModels(body.models);
      showCheck(body.models.length > 0 ? "" : NO_MODELS);
    } else if (status === 400 && typeof body?.error === "string") {
      showCheck(body.error);
    } else {
      console.error("Couldn't check the key:", failure ?? new Error(`HTTP ${status}`));
      lastCheckFailed = true;
      showCheck(CHECK_FAILED, true);
    }
    // Check Again hid with the focus: the focus goes to what comes next.
    if (focused && parts.checkAgain.hidden) {
      [parts.model, parts.key, parts.replaceKey]
        .find((control) => isShown(control) && !control.disabled)
        ?.focus();
    }
  }

  /**
   * Checks the key for the chosen provider: the entered one, or else the
   * saved one of that provider. Without either, Model waits for a key. A
   * check doesn't go again with the same request, unless it failed.
   */
  function checkKey() {
    const provider = chosenProvider();
    const apiKey = enteredKey();
    /** @type {ModelsRequest | null} */
    let request = null;
    if (provider !== null && apiKey !== "") request = { provider, apiKey };
    else if (provider !== null && savedKeyFor(provider)) request = { provider };
    if (request === null) {
      checks += 1;
      lastCheck = null;
      showCheck("");
      awaitList();
    } else if (lastCheckFailed || !sameRequest(request, lastCheck)) {
      checkModels(request);
    }
  }

  /**
   * Follows a change of the provider. The saved key of the other provider
   * never goes to this one, so the section asks for a key, and it shows the
   * saved key again on the way back. Model waits for the list of the key.
   */
  function changeProvider() {
    const provider = chosenProvider();
    if (savedKeyFor(provider)) {
      if (keyState === "replace" && parts.key.value.trim() === "") keyState = "saved";
    } else if (keyState === "saved" || keyState === "remove") {
      keyState = "replace";
    }
    renderKey();
    wantedModel = provider === loadedSettings.provider ? (loadedSettings.model ?? "") : "";
    checkKey();
  }

  /**
   * Shows the dialog with the family preferences `text`, the assistant's
   * `settings`, and whether the assistant is on, `enabled`, which is
   * undefined when nobody knows.
   * @param {string} text
   * @param {AssistantSettings} settings
   * @param {boolean | undefined} enabled
   */
  function show(text, settings, enabled) {
    if (parts === null) wireDialog();
    loaded = text;
    parts.field.value = text;
    showCount();
    parts.saveMessage.textContent = "";
    // An unknown state shows no hint.
    parts.offHint.hidden = enabled !== false;
    showAssistantSettings(settings);
    setSaving(false);
    lastCheck = null;
    lastCheckFailed = false;
    checkKey();
    parts.dialog.showModal();
    // The title, not the field: on a phone, focusing a field opens the keyboard.
    parts.title.focus();
  }

  async function open() {
    loadMessage.textContent = "";
    button.disabled = true;
    try {
      const [preferences, settings, enabled] = await Promise.all([
        getJson("/api/preferences"),
        getJson(ASSISTANT_SETTINGS_URL),
        // Settings opens without its answer: the family preferences and the
        // BYOK section don't depend on it.
        checkAssistant(),
      ]);
      show(preferences.text, settings, enabled);
    } catch (error) {
      console.error("Couldn't load the settings:", error);
      loadMessage.textContent = "Couldn't load the settings. Try again.";
      // The message is at the start of the page, which may be scrolled.
      loadMessage.scrollIntoView({ block: "nearest" });
    } finally {
      button.disabled = false;
    }
    // After a failed load, the focus that the disabled button dropped goes
    // back to it, unless the user moved on.
    if (loaded === null && focusIsFree()) button.focus();
  }

  function close() {
    if (loaded === null) return;
    loaded = null;
    loadedSettings = null;
    // A check that answers later finds the dialog closed.
    checks += 1;
    // A typed key that wasn't saved doesn't stay in the page.
    parts.key.value = "";
    lastCheck = null;
    if (parts.dialog.open) parts.dialog.close();
    button.focus();
  }

  /**
   * Saves `text` as the family preferences, and resolves to whether it saved.
   * A saved text is what the next Done compares with.
   */
  async function saveText(text) {
    try {
      const { status } = await sendJson("PUT", "/api/preferences", { text });
      if (status !== 200) throw new Error(`HTTP ${status}`);
      loaded = text;
      return true;
    } catch (error) {
      console.error("Couldn't save the settings:", error);
      parts.saveMessage.textContent = SAVE_FAILED;
      return false;
    }
  }

  /**
   * Saves `changes` as the assistant's settings, and resolves to whether they
   * saved. The saved settings are what the next Done compares with. A
   * rejected save shows the server's message, for the problems that the
   * section doesn't check itself.
   */
  async function saveAssistantSettings(changes) {
    let response;
    try {
      response = await sendJson("PUT", ASSISTANT_SETTINGS_URL, changes);
    } catch (error) {
      console.error("Couldn't save the assistant settings:", error);
      parts.assistantMessage.textContent = SAVE_FAILED;
      return false;
    }
    const { status, body } = response;
    if (status === 200) {
      takeAssistantSettings(body);
      // A save can turn the assistant on or off: the page shows or hides its
      // button without a reload, and the section its hint.
      refreshAssistant().then((enabled) => {
        if (enabled !== undefined) parts.offHint.hidden = enabled;
      });
      return true;
    }
    console.error("Couldn't save the assistant settings:", new Error(`HTTP ${status}`));
    parts.assistantMessage.textContent =
      status === 400 && typeof body?.error === "string" ? body.error : SAVE_FAILED;
    return false;
  }

  async function done() {
    if (loaded === null || saving) return;
    const text = parts.field.value;
    const changes = assistantChanges();
    if (text === loaded && changes === null) {
      close();
      return;
    }
    parts.saveMessage.textContent = "";
    parts.assistantMessage.textContent = "";
    // A problem that the section names stops Done before either save, so
    // nothing is half saved while the family fixes it.
    const problems = changes === null ? [] : assistantProblems(changes);
    if (problems.length > 0) {
      parts.assistantMessage.textContent = problems.map((problem) => problem.text).join(" ");
      problems[0].control.focus();
      return;
    }
    setSaving(true);
    // Both saves run, so a failure of one doesn't hold the other back.
    const saved = await Promise.all([
      text === loaded || saveText(text),
      changes === null || saveAssistantSettings(changes),
    ]);
    setSaving(false);
    if (saved.every(Boolean)) close();
    else parts.doneButton.focus();
  }

  // Replace Key shows the empty field for the new key, with the focus.
  function replaceKey() {
    keyState = "replace";
    renderKey();
    parts.key.focus();
  }

  // Remove Key and Keep Key take turns, and each gives the focus to the
  // other, which takes its place.
  function removeKey() {
    keyState = "remove";
    renderKey();
    parts.keepKey.focus();
  }

  function keepKey() {
    keyState = "saved";
    renderKey();
    parts.removeKey.focus();
  }

  function wireDialog() {
    parts = createDialog();
    const { dialog } = parts;
    dialog.querySelector(".cancel").addEventListener("click", close);
    parts.field.addEventListener("input", showCount);
    parts.doneButton.addEventListener("click", done);
    for (const radio of parts.providerRadios) {
      radio.addEventListener("change", changeProvider);
    }
    // The key is checked once it's entered: when the field loses the focus
    // after a change, or right after a paste, which changes the field with an
    // input of its own. A paste that changes nothing sends none.
    parts.key.addEventListener("change", checkKey);
    parts.key.addEventListener("input", (event) => {
      if (/** @type {InputEvent} */ (event).inputType === "insertFromPaste") checkKey();
    });
    parts.replaceKey.addEventListener("click", replaceKey);
    parts.removeKey.addEventListener("click", removeKey);
    parts.keepKey.addEventListener("click", keepKey);
    parts.model.addEventListener("change", () => {
      wantedModel = parts.model.value;
    });
    parts.checkAgain.addEventListener("click", () => {
      if (lastCheck !== null) checkModels(lastCheck, true);
    });
    // Escape and Android's Back close the dialog, which discards the changes,
    // except while a save runs.
    dialog.addEventListener("cancel", (event) => {
      if (saving) event.preventDefault();
    });
    dialog.addEventListener("close", close);
    // A stray click on the backdrop never throws work away.
    onBackdropClick(dialog, () => {
      if (!saving && !hasChanges()) close();
    });
  }

  button.addEventListener("click", open);
  // Changes that aren't saved would be lost: ask before leaving.
  window.addEventListener("beforeunload", (event) => {
    if (hasChanges()) event.preventDefault();
  });
}
