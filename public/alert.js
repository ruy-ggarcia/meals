// An alert that asks before an action that loses changes: a modal dialog
// with a title, a message, the choice that keeps the changes, and the one
// that loses them.

import { createElement } from "./dom.js";

/** Makes the IDs of each alert unique in the page. */
let nextAlertId = 0;

/**
 * Asks `title` and `message` in a modal alert, with the buttons `keep`, the
 * choice that keeps the changes, which has focus, and `lose`, the one that
 * loses them. Resolves to true for `lose`, and to false for `keep`, Escape,
 * or Android's Back. The alert leaves the page when it closes.
 */
export function askBeforeLosing({ title, message, keep, lose }) {
  const id = `alert-${nextAlertId++}`;
  const alert = createElement("dialog", "alert");
  alert.setAttribute("role", "alertdialog");
  alert.setAttribute("aria-labelledby", `${id}-title`);
  alert.setAttribute("aria-describedby", `${id}-message`);
  const icon = createElement("span", "alert-icon");
  // static markup, never user text
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5v9M12 19h.01"/></svg>';
  const heading = createElement("h2", "alert-title", title);
  heading.id = `${id}-title`;
  const text = createElement("p", "alert-message", message);
  text.id = `${id}-message`;
  const keepButton = createElement("button", "keep", keep);
  keepButton.type = "button";
  const loseButton = createElement("button", "lose", lose);
  loseButton.type = "button";
  const actions = createElement("div", "alert-actions");
  actions.append(keepButton, loseButton);
  alert.append(icon, heading, text, actions);
  document.body.append(alert);

  let lost = false;
  keepButton.addEventListener("click", () => alert.close());
  loseButton.addEventListener("click", () => {
    lost = true;
    alert.close();
  });
  return new Promise((resolve) => {
    alert.addEventListener(
      "close",
      () => {
        alert.remove();
        resolve(lost);
      },
      { once: true },
    );
    alert.showModal();
    keepButton.focus();
  });
}
