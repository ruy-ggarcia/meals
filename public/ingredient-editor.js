// The ingredient editor: a modal dialog that creates an ingredient, or
// changes the name and the unit of one. It follows the app's interaction rules:
// - Done checks the name and saves the changes with one request. The editor
//   closes only when the save succeeds.
// - Cancel, Escape, and Android's Back discard the changes.
// - Clicking the backdrop closes the editor only when nothing changed.

import { createEditorDialog } from "./editor-dialog.js";
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
  const noUnitOption = unitField.querySelector('option[value=""]');
  const unitHint = dialog.querySelector(".unit-hint");
  const saveMessage = dialog.querySelector(".save-message");

  /** What the editor last opened with: { ingredient, usage }. `ingredient` is undefined for a new one. */
  let session = null;

  const lifecycle = createEditorDialog({
    dialog,
    hasChanges,
    onDone: save,
    onBusy: (busy) => {
      unitField.disabled = busy || session.usage.recipes > 0;
    },
  });

  function open({ ingredient, usage, restoreFocus, onSaved }) {
    session = { ingredient, usage };
    const { recipes } = usage;
    title.textContent = ingredient ? "Edit ingredient" : "New ingredient";
    nameField.value = ingredient?.name ?? "";
    // Choosing a unit applies to a new ingredient only.
    noUnitOption.hidden = Boolean(ingredient);
    unitField.value = ingredient?.unit ?? "";
    nameMessage.textContent = "";
    saveMessage.textContent = "";
    unitHint.textContent = recipes > 0 ? usedInText(recipes) : "";
    unitHint.hidden = recipes === 0;
    // The title of an existing ingredient, not a field: on a phone, focusing a
    // field opens the keyboard.
    lifecycle.open({ focus: ingredient ? title : nameField, restoreFocus, onSaved });
  }

  /** True when the fields differ from the ingredient. */
  function hasChanges() {
    return (
      lifecycle.isOpen() &&
      (nameField.value !== (session.ingredient?.name ?? "") ||
        unitField.value !== (session.ingredient?.unit ?? ""))
    );
  }

  // Sends `body`. Returns the saved ingredient, or undefined after showing why
  // the save failed.
  async function send(body) {
    const { ingredient } = session;
    try {
      const { status, body: reply } = ingredient
        ? await sendJson("PATCH", `/api/ingredients/${encodeURIComponent(ingredient.id)}`, body)
        : await sendJson("POST", "/api/ingredients", body);
      if (status === 200 || status === 201) return reply;
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

  // Checks the name, then saves what changed, or closes when nothing did.
  function save() {
    nameMessage.textContent = nameField.value.trim() === "" ? "The name can't be empty." : "";
    saveMessage.textContent = "";
    if (nameMessage.textContent !== "") {
      nameField.focus();
      return;
    }
    const { ingredient } = session;
    if (!ingredient && unitField.value === "") {
      saveMessage.textContent = "Choose a unit.";
      unitField.focus();
      return;
    }
    const body = {};
    if (nameField.value !== (ingredient?.name ?? "")) body.name = nameField.value;
    if (unitField.value !== (ingredient?.unit ?? "")) body.unit = unitField.value;
    if (Object.keys(body).length === 0) lifecycle.close();
    else lifecycle.submit(() => send(body));
  }

  return { hasChanges, open };
}
