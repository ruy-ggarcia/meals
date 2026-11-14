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

/**
 * The screens where the tests check the tab bar of a phone: the narrowest
 * phone that the app supports, a small Android phone, an iPhone 15, a
 * Pixel 7, and a screen wide enough for the tab bar to stay centered with
 * the assistant's button beside it.
 */
export const TAB_BAR_SCREENS = [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 393, height: 659 },
  { width: 412, height: 839 },
  { width: 600, height: 900 },
];
