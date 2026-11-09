// How the specs move between the pages: the navigation named Sections, which
// is the sidebar on a desktop and the tab bar on a phone.

/** The navigation that links to the pages: the sidebar, or the tab bar on a phone. */
export function sectionsOf(page) {
  return page.getByRole("navigation", { name: "Sections" });
}

/** The link of the navigation to the page named `name`, such as `Recipes`. */
export function pageLink(page, name) {
  return sectionsOf(page).getByRole("link", { name: new RegExp(`^${name}`) });
}
