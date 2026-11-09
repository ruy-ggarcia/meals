// What the recipe book and the ingredient catalog share: both list their
// entries the same way, open an editor in a dialog, and keep the archived
// entries under a section that you open.

/** The editor of an entry, titled `New <kind>` for a new one and `Edit <kind>` for an existing one. */
export function editorOf(page, title) {
  return page.getByRole("dialog", { name: title });
}

/** The Name field of `editor`. */
export function nameOf(editor) {
  return editor.getByRole("textbox", { name: "Name", exact: true });
}

/** The row button that opens the entry called `name`. */
export function rowOf(page, name) {
  return page.getByRole("button", { name: `Edit ${name}`, exact: true });
}

/**
 * The heading of the Archived section. A `summary` has no role that
 * Playwright can find, so its tag finds it.
 */
export function archivedHeadingOf(page) {
  return page.locator("summary").filter({ hasText: "Archived" });
}

/** The list under Archived, which shows once you open the section. `label` is `Archived recipes` or `Archived ingredients`. */
export function archivedListOf(page, label) {
  return page.getByRole("list", { name: label, exact: true });
}

/** Opens the Archived section, and returns its list, named `label`. */
export async function openArchivedList(page, label) {
  await archivedHeadingOf(page).click();
  const list = archivedListOf(page, label);
  await list.waitFor();
  return list;
}
