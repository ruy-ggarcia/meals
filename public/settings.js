// Settings: a dialog where the family edits the family preferences, the text
// that the assistant reads in every conversation. A gear button opens it: at
// the end of the toolbar on wide screens, and on the line of the large title
// on phones. The page has both, and the styles show one. Each open loads the saved text again, so
// the dialog never shows a text that another device has replaced.

import { createElement, focusIsFree, onBackdropClick } from "./dom.js";
import { getJson, sendJson } from "./http.js";

// static markup, never user text
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
      <label class="section-title" for="family-preferences">Family preferences</label>
      <div class="card">
        <textarea id="family-preferences" class="preferences-field" maxlength="10000"></textarea>
      </div>
      <p id="family-preferences-hint" class="field-hint">The assistant reads this text in every conversation.</p>
      <p id="assistant-off" class="field-hint" hidden>The assistant isn't set up on this server.</p>
      <p class="field-message save-message" role="status"></p>
    </div>
  </div>`;

/**
 * Builds the dialog of Settings at the end of the page, and returns it with
 * the parts that the open and the save change.
 */
function createDialog() {
  const dialog = createElement("dialog", "dialog");
  dialog.setAttribute("aria-labelledby", "settings-title");
  dialog.innerHTML = DIALOG_MARKUP;
  document.body.append(dialog);
  return {
    dialog,
    title: /** @type {HTMLElement} */ (dialog.querySelector(".dialog-title")),
    field: /** @type {HTMLTextAreaElement} */ (dialog.querySelector(".preferences-field")),
    assistantOff: /** @type {HTMLElement} */ (dialog.querySelector("#assistant-off")),
    saveMessage: dialog.querySelector(".save-message"),
    doneButton: /** @type {HTMLButtonElement} */ (dialog.querySelector(".done")),
  };
}

/**
 * Whether the assistant is on, or undefined when the server doesn't say.
 * Settings opens either way: only the line about the assistant depends on it.
 */
async function checkAssistant() {
  try {
    const { enabled } = await getJson("/api/assistant");
    return enabled;
  } catch (error) {
    console.error("Couldn't check the assistant:", error);
    return undefined;
  }
}

/**
 * Wires the gear buttons of the page to Settings. The dialog is built on the
 * first open and reused, and closing it returns the focus to the button that
 * opened it. Cancel, Escape, and Android's Back close it and
 * discard the changes, as in the editors, and a click on the backdrop closes
 * it only without changes. Done saves the text when it changed.
 */
export function setUpSettings() {
  const buttons = /** @type {NodeListOf<HTMLButtonElement>} */ (
    document.querySelectorAll(".open-settings")
  );
  // Each button says under it why Settings didn't open.
  const loadMessages = new Map();
  for (const button of buttons) {
    const message = createElement("p", "settings-message");
    message.setAttribute("role", "alert");
    button.after(message);
    loadMessages.set(button, message);
  }
  /** The button that opened Settings last, which gets the focus back. */
  let opener = buttons[0];

  /** @type {ReturnType<typeof createDialog> | null} */
  let parts = null;
  /** The text that the open dialog loaded, or null while it's closed. */
  let loaded = null;
  let saving = false;

  function hasChanges() {
    return loaded !== null && parts.field.value !== loaded;
  }

  function setSaving(busy) {
    saving = busy;
    const controls = /** @type {NodeListOf<HTMLButtonElement | HTMLTextAreaElement>} */ (
      parts.dialog.querySelectorAll("button, textarea")
    );
    for (const control of controls) {
      control.disabled = busy;
    }
  }

  function show(text, enabled) {
    if (parts === null) wireDialog();
    loaded = text;
    parts.field.value = text;
    parts.saveMessage.textContent = "";
    const off = enabled === false;
    parts.assistantOff.hidden = !off;
    parts.field.setAttribute(
      "aria-describedby",
      off ? "family-preferences-hint assistant-off" : "family-preferences-hint",
    );
    setSaving(false);
    parts.dialog.showModal();
    // The title, not the field: on a phone, focusing a field opens the keyboard.
    parts.title.focus();
  }

  async function open(button) {
    opener = button;
    for (const message of loadMessages.values()) message.textContent = "";
    for (const each of buttons) each.disabled = true;
    try {
      const [preferences, enabled] = await Promise.all([
        getJson("/api/preferences"),
        checkAssistant(),
      ]);
      show(preferences.text, enabled);
    } catch (error) {
      console.error("Couldn't load the settings:", error);
      loadMessages.get(button).textContent = "Couldn't load the settings. Try again.";
    } finally {
      for (const each of buttons) each.disabled = false;
    }
    // After a failed load, the focus that the disabled button dropped goes
    // back to it, unless the user moved on.
    if (loaded === null && focusIsFree()) button.focus();
  }

  function close() {
    if (loaded === null) return;
    loaded = null;
    if (parts.dialog.open) parts.dialog.close();
    opener.focus();
  }

  async function done() {
    if (loaded === null || saving) return;
    const text = parts.field.value;
    if (text === loaded) {
      close();
      return;
    }
    parts.saveMessage.textContent = "";
    setSaving(true);
    let saved = false;
    try {
      const { status } = await sendJson("PUT", "/api/preferences", { text });
      if (status !== 200) throw new Error(`HTTP ${status}`);
      saved = true;
    } catch (error) {
      console.error("Couldn't save the settings:", error);
      parts.saveMessage.textContent = "Couldn't save the settings. Try again.";
    }
    setSaving(false);
    if (saved) close();
    else parts.doneButton.focus();
  }

  function wireDialog() {
    parts = createDialog();
    const { dialog } = parts;
    dialog.querySelector(".cancel").addEventListener("click", close);
    parts.doneButton.addEventListener("click", done);
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

  for (const button of buttons) button.addEventListener("click", () => open(button));
  // Changes that aren't saved would be lost: ask before leaving.
  window.addEventListener("beforeunload", (event) => {
    if (hasChanges()) event.preventDefault();
  });
}
