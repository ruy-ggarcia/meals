// The dialog lifecycle that the recipe and ingredient editors share: opening
// and closing, the busy state while a save runs, and the controls that close
// or confirm the editor. Each editor supplies its fields, what counts as a
// change, and how it checks and sends its save request.

import { onBackdropClick } from "./dom.js";

/**
 * Wires `dialog`, which holds a `.dialog-title`, a `.name-field` with its
 * `.name-message`, and the `.cancel` and `.done` buttons.
 * `hasChanges()` is true when the fields differ from what the editor opened
 * with. `onDone()` runs when the user chooses Done while no save runs: it
 * checks the fields, then calls submit() or close(). `onBusy(busy)` runs
 * after every input and button is enabled or disabled, so the editor can
 * set its other controls. `confirms(target)` is true for the fields besides
 * Name where Enter means Done.
 *
 * Returns { close, isBusy, isOpen, open, submit }:
 * - open({ focus, restoreFocus, onSaved }) shows the dialog and focuses
 *   `focus`. After a save, `onSaved` gets the saved entry and moves focus.
 *   After any other close, `restoreFocus` returns focus to the control that
 *   opened the editor.
 * - submit(send) runs `send()`, which returns the saved entry, or undefined
 *   after showing why the save failed. The editor closes only after a save.
 * - close() closes the editor without a save.
 */
export function createEditorDialog({ dialog, hasChanges, onDone, onBusy, confirms = () => false }) {
  const title = dialog.querySelector(".dialog-title");
  const nameField = dialog.querySelector(".name-field");
  const nameMessage = dialog.querySelector(".name-message");
  const doneButton = dialog.querySelector(".done");

  /** The open session, or null: { restoreFocus, onSaved, busy }. */
  let session = null;

  function open({ focus, restoreFocus, onSaved }) {
    session = { restoreFocus, onSaved, busy: false };
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
