// The dialog lifecycle that the recipe and ingredient editors share: opening
// and closing, the busy state while a save runs, and the controls that close
// or confirm the editor. Each editor supplies its fields, what counts as a
// change, and how it checks and sends its save request.

import { askBeforeLosing } from "./alert.js";
import { onBackdropClick } from "./dom.js";
import { sendJson } from "./http.js";

/**
 * Sends the request that archives the entry at `url`, a "recipe" or an
 * "ingredient" (`noun`). Returns the archived entry, or undefined after
 * showing in `message` that the request failed.
 */
export async function sendArchive(url, noun, message) {
  try {
    const { status, body } = await sendJson("PATCH", url, { archived: true });
    if (status === 200) return body;
    throw new Error(`HTTP ${status}`);
  } catch (error) {
    console.error(`Couldn't archive the ${noun}:`, error);
    message.textContent = `Couldn't archive the ${noun}. Try again.`;
    return undefined;
  }
}

/**
 * Wires `dialog`, which holds a `.dialog-title`, a `.name-field` with its
 * `.name-message`, the `.cancel` and `.done` buttons, and an `.archive`
 * button. `onArchive()` runs when the user chooses Archive while no save
 * runs, after an alert confirms it when the fields have changes: it calls
 * submit() with the request that archives the entry, and drops the changes.
 * `hasChanges()` is true when the fields differ from what the editor opened
 * with. `onDone()` runs when the user chooses Done while no save runs: it
 * checks the fields, then calls submit() or close(). `onBusy(busy)` runs
 * after every input and button is enabled or disabled, so the editor can
 * set its other controls. `confirms(target)` is true for the fields besides
 * Name where Enter means Done.
 *
 * Returns { close, isBusy, isOpen, open, submit }:
 * - open({ focus, restoreFocus, onSaved, canArchive }) shows the dialog and
 *   focuses `focus`, with Archive only when `canArchive` is true. After a
 *   save, `onSaved` gets the saved entry and moves focus. After any other
 *   close, `restoreFocus` returns focus to the control that opened the
 *   editor.
 * - submit(send) runs `send()`, which returns the saved entry, or undefined
 *   after showing why the save failed. The editor closes only after a save.
 * - close() closes the editor without a save.
 */
export function createEditorDialog({
  dialog,
  hasChanges,
  onDone,
  onArchive,
  onBusy,
  confirms = () => false,
}) {
  const title = dialog.querySelector(".dialog-title");
  const nameField = dialog.querySelector(".name-field");
  const nameMessage = dialog.querySelector(".name-message");
  const doneButton = dialog.querySelector(".done");
  const archiveButton = dialog.querySelector(".archive");

  /** The open session, or null: { restoreFocus, onSaved, busy }. */
  let session = null;

  function open({ focus, restoreFocus, onSaved, canArchive }) {
    session = { restoreFocus, onSaved, busy: false };
    archiveButton.hidden = !canArchive;
    setBusy(false);
    dialog.showModal();
    focus.focus();
  }

  function isOpen() {
    return session !== null;
  }

  function isBusy() {
    return session?.busy ?? false;
  }

  function finish(saved) {
    if (session === null) return;
    const { restoreFocus, onSaved } = session;
    session = null;
    if (dialog.open) dialog.close();
    if (saved) onSaved(saved);
    else restoreFocus();
  }

  function close() {
    finish();
  }

  function setBusy(busy) {
    session.busy = busy;
    for (const control of dialog.querySelectorAll("input, button")) control.disabled = busy;
    onBusy(busy);
  }

  // After a failed save, focus goes to Name when the message is under it,
  // else to Done.
  async function submit(send) {
    setBusy(true);
    const saved = await send();
    setBusy(false);
    if (saved) finish(saved);
    else if (nameMessage.textContent !== "") nameField.focus();
    else doneButton.focus();
  }

  function done() {
    if (session !== null && !session.busy) onDone();
  }

  dialog.querySelector(".cancel").addEventListener("click", close);
  doneButton.addEventListener("click", done);
  // Archive drops the other changes, so it asks first when there are any.
  archiveButton.addEventListener("click", async () => {
    if (session === null || session.busy) return;
    if (hasChanges()) {
      const archive = await askBeforeLosing({
        title: "Archive without saving?",
        message: "Your changes aren't saved. If you archive now, they're lost.",
        keep: "Keep Editing",
        lose: "Archive Without Saving",
      });
      if (!archive) {
        archiveButton.focus();
        return;
      }
    }
    onArchive();
  });
  // Escape and Android's Back close the dialog, which discards the changes,
  // except while a save runs.
  dialog.addEventListener("cancel", (event) => {
    if (session?.busy) event.preventDefault();
  });
  dialog.addEventListener("close", close);
  // A stray click on the backdrop never throws work away.
  onBackdropClick(dialog, () => {
    if (session !== null && !session.busy && !hasChanges()) finish();
  });
  // Enter confirms the innermost edit. In Name, in a field that `confirms`,
  // on the title, or on the dialog itself, that's Done. Buttons and other
  // fields handle their own Enter.
  dialog.addEventListener("keydown", (event) => {
    if (event.isComposing || event.key !== "Enter") return;
    const { target } = event;
    if (target === title || target === dialog || target === nameField || confirms(target)) {
      event.preventDefault();
      done();
    }
  });

  return { close, isBusy, isOpen, open, submit };
}
