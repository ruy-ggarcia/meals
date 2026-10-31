// The shell that every page shares: the section links, which wide screens
// show as a sidebar and phones as a tab bar, and the choice to hide or show
// the sidebar. Each page calls setUpShell() when it starts.

const SIDEBAR_KEY = "meals.sidebar";

// The remembered choice, "shown" or "hidden", or null when there's none or
// the browser blocks storage. Without a choice, the width of the screen
// decides.
function readChoice() {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY);
  } catch {
    return null;
  }
}

function setSidebar(choice) {
  document.documentElement.dataset.sidebar = choice;
  try {
    window.localStorage.setItem(SIDEBAR_KEY, choice);
  } catch {
    // The choice lasts until the page closes.
  }
}

/** Applies the remembered sidebar choice and wires Hide sidebar and Show sidebar. */
export function setUpShell() {
  const choice = readChoice();
  if (choice === "shown" || choice === "hidden") document.documentElement.dataset.sidebar = choice;
  document.querySelector(".hide-sidebar").addEventListener("click", () => setSidebar("hidden"));
  document.querySelector(".show-sidebar").addEventListener("click", () => setSidebar("shown"));
}

/**
 * Shows how many active recipes and active ingredients there are, next to
 * their links and their page's title. Either list can be left out.
 */
export function showCounts({ recipes, ingredients }) {
  const show = (key, entries) => {
    const count = String(entries.filter((entry) => !entry.archived).length);
    for (const element of document.querySelectorAll(`[data-count="${key}"]`)) {
      element.textContent = count;
    }
  };
  if (recipes) show("recipes", recipes);
  if (ingredients) show("ingredients", ingredients);
}
