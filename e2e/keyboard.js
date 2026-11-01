// How the specs drive the keyboard: moving the focus with Tab, and checking
// that a dialog keeps it.

import { expect } from "./fixtures.js";

/** The most Tab presses that a test spends to reach a control. */
const MOST_TABS = 30;

/** Presses Tab until `target` has the focus, at most `most` times. */
export async function tabTo(page, target, most = MOST_TABS) {
  for (let presses = 0; presses < most; presses += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target, `focused after ${most} Tab presses`).toBeFocused();
}

/**
 * Presses Tab and then Shift+Tab `presses` times each, and checks that the
 * focus never leaves `dialog`, and that it reaches each control called
 * `names`, by its label or its text. With `exact`, it reaches no other
 * control. Start with the focus where the dialog puts it.
 *
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").Locator} dialog
 * @param {{ names: string[], presses: number, exact?: boolean }} options
 */
export async function expectFocusTrapped(page, dialog, { names, presses, exact = false }) {
  const visited = new Set();
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let press = 1; press <= presses; press += 1) {
      await page.keyboard.press(key);
      const focus = await dialog.evaluate((element) => {
        const active = document.activeElement;
        // The browser's own interface can hold the focus: no element has it.
        // On the way around, Firefox and Safari focus the dialog itself.
        if (active === null || active === document.body || active === element) {
          return { outside: false, name: null };
        }
        const name =
          active.getAttribute("aria-label") ??
          /** @type {HTMLInputElement} */ (active).labels?.[0]?.textContent ??
          active.textContent.trim();
        return { outside: !element.contains(active), name };
      });
      expect(focus.outside, `${key} ${press} focused ${focus.name}`).toBe(false);
      if (focus.name !== null) visited.add(focus.name);
    }
  }
  if (exact) expect([...visited].sort()).toEqual([...names].sort());
  else expect([...visited]).toEqual(expect.arrayContaining(names));
}
