// What the specs of Settings share: how to open it, find its parts, and save
// a key.

import { expect } from "./fixtures.js";

/** The one Settings button of the page, at the end of its toolbar. */
export function settingsButton(page) {
  return page.getByRole("button", { name: "Settings", exact: true });
}

/** Opens Settings with its button, and returns the dialog. */
export async function openSettings(page) {
  await settingsButton(page).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** The section BYOK of the Settings `dialog`. */
export function byokSectionOf(dialog) {
  return dialog.getByRole("region", { name: "BYOK" });
}

/**
 * Sets up the assistant in the Settings `dialog` with OpenAI and a key,
 * chooses the model `gpt-test` from the key's list, and saves it with Done.
 */
export async function saveKey(dialog) {
  const section = byokSectionOf(dialog);
  await section.getByRole("radio", { name: "OpenAI" }).check();
  const key = section.getByLabel("API key");
  await key.fill("sk-test");
  // The key is checked once the field loses the focus.
  await key.blur();
  const model = section.getByRole("combobox", { name: "Model" });
  await expect(model).toBeEnabled();
  await model.selectOption("gpt-test");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
}
