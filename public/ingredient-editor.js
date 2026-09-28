// The ingredient editor: a modal dialog that changes the name and the unit
// of an ingredient. It follows the app's interaction rules:
// - Done checks the name and saves the changes with one request. The editor
//   closes only when the save succeeds.
// - Cancel, Escape, and Android's Back discard the changes.
// - Clicking the backdrop closes the editor only when nothing changed.

import { onBackdropClick } from "./dom.js";
import { sendJson } from "./http.js";
import { conflictText } from "./messages.js";

// Why the unit can't change while `count` recipes use the ingredient.
function usedInText(count) {
  return count === 1
    ? "Used in 1 recipe. To change the unit, remove the ingredient from that recipe first."
    : `Used in ${count} recipes. To change the unit, remove the ingredient from those recipes first.`;
}

export function createIngredientEditor(dialog) {
  const title = dialog.querySelector(".dialog-title");
  const nameField = dialog.querySelector(".name-field");
  const nameMessage = dialog.querySelector(".name-message");
  const unitField = dialog.querySelector(".unit-field");
  const unitHint = dialog.querySelector(".unit-hint");
  const saveMessage = dialog.querySelector(".save-message");
  const doneButton = dialog.querySelector(".done");

  /** The open editing session, or null: { ingredient, usedIn, restoreFocus, onSaved, busy }. */
  let session = null;

  function open({ ingredient, usedIn, restoreFocus, onSaved }) {
    session = { ingredient, usedIn, restoreFocus, onSaved, busy: false };
    nameField.value = ingredient.name;
    unitField.value = ingredient.unit;
    nameMessage.textContent = "";
    saveMessage.textContent = "";
    unitHint.textContent = usedIn > 0 ? usedInText(usedIn) : "";
    unitHint.hidden = usedIn === 0;
    setBusy(false);
    dialog.showModal();
    // The title, not a field: on a phone, focusing a field opens the keyboard.
    title.focus();
  }

  /** True when the fields differ from the ingredient. */
  function hasChanges() {
    return (
      session !== null &&
      (nameField.value !== session.ingredient.name || unitField.value !== session.ingredient.unit)
    );
  }

  // Closes the editor. After a save, `onSaved` gets the saved ingredient and
  // moves focus. Otherwise, `restoreFocus` returns focus to the control that
  // opened the editor.
  function finish(saved) {
    if (session === null) return;
    const { restoreFocus, onSaved } = session;
    session = null;
    if (dialog.open) dialog.close();
    if (saved) onSaved(saved);
    else restoreFocus();
  }

  function setBusy(busy) {
    session.busy = busy;
    for (const control of dialog.querySelectorAll("input, button")) control.disabled = busy;
    unitField.disabled = busy || session.usedIn > 0;
  }

  // Sends `body`. Returns the saved ingredient, or undefined after showing why
  // the save failed.
  async function send(body) {
    const url = `/api/ingredients/${encodeURIComponent(session.ingredient.id)}`;
    try {
      const { status, body: reply } = await sendJson("PATCH", url, body);
      if (status === 200) return reply;
      if (status === 409 && reply.ingredient) {
        const text = conflictText(reply.ingredient);
        nameMessage.textContent = reply.ingredient.archived
          ? `${text} To use it, restore it from Archived.`
          : text;
        return undefined;
      }
      if ((status === 400 || status === 409) && typeof reply.error === "string") {
        saveMessage.textContent = reply.error;
        return undefined;
      }
      throw new Error(`HTTP ${status}`);
    } catch (error) {
      console.error("Couldn't save the ingredient:", error);
      saveMessage.textContent = "Couldn't save the ingredient. Try again.";
      return undefined;
    }
  }

  async function save() {
    if (session === null || session.busy) return;
    nameMessage.textContent = nameField.value.trim() === "" ? "The name can't be empty." : "";
    saveMessage.textContent = "";
    if (nameMessage.textContent !== "") {
      nameField.focus();
      return;
    }
    const { ingredient } = session;
    const body = {};
    if (nameField.value !== ingredient.name) body.name = nameField.value;
    if (unitField.value !== ingredient.unit) body.unit = unitField.value;
    if (Object.keys(body).length === 0) {
      finish();
      return;
    }
    setBusy(true);
    const saved = await send(body);
    setBusy(false);
    if (saved) finish(saved);
    else if (nameMessage.textContent !== "") nameField.focus();
    else doneButton.focus();
  }

  dialog.querySelector(".cancel").addEventListener("click", () => finish());
  doneButton.addEventListener("click", save);
  // Escape and Android's Back close the dialog, which discards the changes,
  // except while a save runs.
  dialog.addEventListener("cancel", (event) => {
    if (session?.busy) event.preventDefault();
  });
  dialog.addEventListener("close", () => finish());
  onBackdropClick(dialog, () => {
    if (session !== null && !session.busy && !hasChanges()) finish();
  });
  // Enter confirms the innermost edit. In Name, on the title, or on the
  // dialog itself, that's Done.
  dialog.addEventListener("keydown", (event) => {
    if (event.isComposing || event.key !== "Enter") return;
    if (event.target === title || event.target === dialog || event.target === nameField) {
      event.preventDefault();
      save();
    }
  });

  return { hasChanges, open };
}
