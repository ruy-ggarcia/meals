# Browser and host tests implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** every check of `docs/manual-test-plan.md` runs automatically, in
real browsers or on a disposable host, and the manual plan goes away.

**Architecture:** Playwright Test runs the browser tests in `e2e/` against a
server that each test starts in-process on a free port with its own data
directory, with a fixed date and simulated server failures. A shell script
runs the host checks on a GitHub-hosted runner, which is a new virtual machine
with systemd and Docker for each job.

**Tech stack:** Node.js 22, `@playwright/test` 1.64.1, `@axe-core/playwright`
4.14.0, Bash, systemd, Docker, and GitHub Actions.

**Spec:** `docs/plans/2026-11-01-browser-and-host-tests-design.md`. Read it
before any task: the plan argues from it and doesn't repeat it.

## Global constraints

- Every artifact is in US English: code, comments, test names, and docs.
  Docs follow the Google developer documentation style guide.
- Commit messages follow Conventional Commits, with no attribution trailers.
  Test commits use `test`, workflow commits use `ci`, and docs use `docs`.
- Before every commit, `npm run lint` and `npm test` pass, and a green
  `npm test` prints no stray logs, warnings, or stack traces. A task that
  changes `e2e/` also passes `npm run test:e2e` on all five projects.
- Run tools only through npm scripts. Never run `npx`.
- Test names describe behavior. Code and test names never mention the IDs of
  the manual plan.
- Find elements by role and accessible name, by label, or by visible text.
  Use a CSS selector only for an element with no role or name, such as the
  today marker, and never a class that only styles it.
- Never wait a fixed time. Wait with assertions. The only long wait is the
  app's 5-second request timeout, in the tests of stalled requests.
- Each test is independent: it creates its own data and never relies on
  another test.
- Every browser test starts at `2026-09-23T10:00:00+02:00`, a Wednesday, in
  `Europe/Madrid` with the locale `en-US`. The current week is `2026-09-21`,
  and the next week is `2026-09-28`.
- Nothing touches port `3000`, `/opt/server/meals`, or a `data/` directory of
  a checkout: production runs on the development machine.
- Test-driven development for tests of existing behavior: write the test,
  then break the behavior it checks for a moment (each task lists the
  sabotage), run the test, watch it fail for the right reason, and undo the
  sabotage. Before each commit, `git diff` shows no change outside the
  task's files.
- Don't change the product. If a test shows a bug, stop and ask the user
  before fixing it.

## Review focus

These are the conditions most likely to hurt someone who runs the tests, and
the test that covers each one.

1. **Running the browser tests on the machine where production runs:** each
   test uses its own port and data directory. Task 1 tests that the server of
   a test isn't on port `3000` and that its data directory is new.
1. **Running the host test anywhere but a runner:** the script refuses.
   Task 10 tests that it refuses without `GITHUB_ACTIONS=true`, and as a user
   other than root.
1. **The date and the time zone of the machine:** every page sees the fixed
   date. Task 1 tests the current week with the fixed date, and Task 2 moves
   the clock.
1. **Order and repetition:** the suite passes in any order and twice in a
   row. Task 1 and the final validation run
   `npm run test:e2e -- --repeat-each=2 --shuffle`.
1. **An error in the page that no assertion sees:** the test fails. Task 1
   tests that an uncaught error fails a test, with `test.fail()`.

---

### Task 1: Harness, CI job, and week navigation

Covers manual checks `1.1` to `1.10`, `2.1`, and `2.2`.

**Files:**
- Create: `playwright.config.js`, `e2e/api.js`, `e2e/catalog.js`,
  `e2e/fixtures.js`, `e2e/harness.spec.js`, `e2e/week.spec.js`
- Modify: `.github/workflows/ci.yml`, `.gitignore`, `AGENTS.md`,
  `README.md`, `package.json`, `package-lock.json`

**Interfaces:**
- Produces, in `e2e/catalog.js`: `NOW` (a `Date` for
  `2026-09-23T10:00:00+02:00`), `CURRENT_WEEK = "2026-09-21"`,
  `NEXT_WEEK = "2026-09-28"`, `RECIPE_NAMES` (the seven names of the manual
  plan's setup, in that order), and `INGREDIENTS` (`[{ name, unit }]` for
  `Egg pcs`, `Milk ml`, `Onion g`, and `Rice g`).
- Produces, in `e2e/api.js`: `createApi(url)` returns
  `{ recipes(), createRecipe(fields), updateRecipe(id, changes), ingredients(), createIngredient(fields), updateIngredient(id, changes), week(weekId), saveSlot(weekId, day, meal, items) }`.
  Each method resolves to the parsed JSON body and throws an `Error` with the
  status and the body for any status other than 2xx. `day` is `mon` to `sun`,
  and `meal` is one of `breakfast`, `snack_am`, `lunch`, `snack_pm`, and
  `dinner`.
- Produces, in `e2e/fixtures.js`: `test` and `expect`, with these fixtures:
  - `seed`: option, `"catalog"` (default) or `"empty"`.
  - `app`: `{ url, port, dataDir, api, recipes, ingredients }`, where
    `recipes` and `ingredients` map each seeded name to its object.
  - `baseURL`: `app.url`.
  - `page`: installs `page.clock` at `NOW` before the test, and after the
    test fails it if the page threw an uncaught error, or logged a console
    error while `consoleErrors.allowed` is `false`.
  - `consoleErrors`: `{ allowed: false }`. Task 5 sets it.

- [ ] **Step 1: Add the dependencies and scripts.** `@playwright/test`
  `1.64.1` and `@axe-core/playwright` `4.14.0`, exact, in `devDependencies`.
  Scripts: `"test:e2e": "playwright test"` and
  `"test:e2e:install": "playwright install --with-deps chromium firefox webkit"`.
  `.gitignore` gains `playwright-report/` and `test-results/`, sorted.

- [ ] **Step 2: Write the tests** in `e2e/week.spec.js`, with the expected
  results of the manual plan:
  - `opens the current week when the address has no week`: the hash is
    `#2026-09-21` and the heading reads `Sep 21 – 27, 2026`.
  - `steps to the next week and back`: **Next week** shows `#2026-09-28` and
    `Sep 28 – Oct 4, 2026`. **Previous week** shows the current week again.
  - `keeps a menu in its own week`: in the next week, add `Lentil soup` to a
    slot in the slot editor and click **Done**. The current week doesn't
    show it, and the next week shows `Lentil soup` with `×1`.
  - `stays on the week in the address after a reload`.
  - `ends on the last week after fast week changes`: five quick clicks on
    **Next week**, with week responses that arrive out of order, end on
    `#2026-10-26`. The range, the hash, and the grid agree, and a menu saved
    in `2026-10-05` never shows.
  - `opens the week in the address`: `/#2026-12-28` shows
    `Dec 28, 2026 – Jan 3, 2027`.
  - `goes back to the current week with Today`.
  - `adds no history entry when you change weeks`: from `about:blank`, open
    the app, click **Next week** twice, and go back: the page is
    `about:blank`. A hash typed into the address does add an entry.
  - `hides the sidebar and remembers it`: the sidebar lists **Meal plan**,
    which has `aria-current="page"`, **Recipes** with `7`, and
    **Ingredients** with `4`. **Hide sidebar** hides it, the grid gets wider,
    and it stays hidden after a reload.
  - `remembers a shown sidebar on a medium window`: after **Show sidebar**, a
    reload at 800 px wide still shows it.
  - `puts the displayed week back when the address has another week`:
    `#hello`, `#2026-09-22`, and `#2026-02-30` each change back to
    `#2026-09-21`.
  - `opens the current week when the address has no valid week`:
    `/#hello`.
  - `starts each test with its own server and data`: `app.port` isn't
    `3000`, and `app.dataDir` is a new directory under the system's
    temporary directory.

  And in `e2e/harness.spec.js`:
  - `fails a test on an uncaught error in the page`, marked `test.fail()`:
    the page throws from a timer.

- [ ] **Step 3: Run them and watch them fail.**
  Run: `npm run test:e2e -- --project=chromium`.
  Expected: they fail, because there's no config or fixtures yet.

- [ ] **Step 4: Implement the harness.** `playwright.config.js`: `testDir`
  `e2e`, `fullyParallel`, `forbidOnly`, `failOnFlakyTests`, and `retries: 1`
  only when `CI` is set, reporter `dot` (plus `html` with `open: "never"` in
  CI), `use` with `locale`, `timezoneId`, and `trace: "on-first-retry"`, and
  the projects `chromium`, `firefox`, and `webkit` (the `Desktop Chrome`,
  `Desktop Firefox`, and `Desktop Safari` devices, ignoring
  `*.mobile.spec.js`), and `pixel` and `iphone` (the `Pixel 7` and
  `iPhone 15` devices, matching only `*.mobile.spec.js`). The `app` fixture
  calls `start({ dataDir, logger: silentLogger, port: 0, version })` with a
  `mkdtemp` directory, seeds through the API, and calls `stop()` and removes
  the directory afterward.

- [ ] **Step 5: Run the tests and watch them pass** on all five projects.
  Run: `npm run test:e2e`. Then
  `npm run test:e2e -- --repeat-each=2 --shuffle`.
  Expected: all pass. The phone projects have no tests yet.

- [ ] **Step 6: Sabotage checks.** One at a time, then undo each:
  - In `public/app.js`, skip the `history.replaceState` that writes the
    hash: the hash tests fail.
  - In `public/shell.js`, make `readChoice()` return `null`: the remembered
    sidebar tests fail.
  - In `public/app.js`, drop the check that ignores a stale week response:
    the fast week changes test fails.

- [ ] **Step 7: Add the `e2e` job** to `.github/workflows/ci.yml`:
  `ubuntu-24.04`, `timeout-minutes: 15`, checkout and `setup-node` with
  Node.js 22 and the npm cache (the same pinned actions as the other jobs),
  `npm ci`, `npm run test:e2e:install`, and `npm run test:e2e`. When the job
  fails, `actions/upload-artifact`, pinned by SHA, uploads
  `playwright-report/` for 7 days.

- [ ] **Step 8: Document.** README, [Check your changes](../../README.md#check-your-changes):
  install the browsers once, and run `npm run test:e2e` after a change to
  `public/` or `server/`. README, [Continuous integration](../../README.md#continuous-integration):
  the `e2e` job. README, project structure: `e2e/` and
  `playwright.config.js`. `AGENTS.md`, Checks: a change to `public/` or
  `server/` also passes `npm run test:e2e`.

- [ ] **Step 9: Commit.** `test(e2e): run the week navigation in real browsers`.

### Task 2: Dates, the today marker, and day changes

Covers manual checks `3.1` to `3.4` and `12.1` to `12.3`.

**Files:**
- Create: `e2e/page-visibility.js`, `e2e/dates.spec.js`,
  `e2e/dates.mobile.spec.js`

**Interfaces:**
- Consumes: `test`, `expect`, `NOW`, and `CURRENT_WEEK` from Task 1.
- Produces, in `e2e/page-visibility.js`: `hidePage(page)` and
  `showPage(page)`, which set `document.visibilityState` and
  `document.hidden` and dispatch `visibilitychange`, and
  `switchAway(page)`, which hides and then shows the page.

- [ ] **Step 1: Write the tests.** In `e2e/dates.spec.js`:
  - `marks today in the current week`: the day headers read `MON 21` to
    `SUN 27` as rendered. Only Wednesday's name is green, its number has a
    green circle, and the band of today's column spans from its header to
    its last slot.
  - `marks no day in another week`.
  - `moves the today marker when the day changes`: set the clock to Thursday
    and switch away and back: the marker is on Thursday.
  - `selects the new day with Today on a narrow window`: at 600 px wide,
    after the same day change, **Today** selects Thursday in the day bar.
  - `shows the next week with Today after the week changes`: with the clock
    on `2026-09-28`, **Today** shows `#2026-09-28`.

  In `e2e/dates.mobile.spec.js`:
  - `marks today in the day bar`: each day button has a letter over a
    number, a gray dot marks the days with menus, today's letter and number
    are green with the number in a green circle, and the title reads today's
    name and date with `· Today`.
  - `marks the selected day apart from today`: after selecting Friday, today
    stays green, Friday's number has a black circle, and the title reads
    Friday without `· Today`.

- [ ] **Step 2: Run them, and watch the helpers' imports fail.**
- [ ] **Step 3: Implement `e2e/page-visibility.js`.**
- [ ] **Step 4: Run the tests and watch them pass on all projects.**
- [ ] **Step 5: Sabotage checks:** drop the `visibilitychange` listener in
  `public/app.js` (the day change test fails), and make today's marker use
  the first day of the week (the marker tests fail). Undo each.
- [ ] **Step 6: Commit.** `test(e2e): check dates and the today marker in real browsers`.

### Task 3: The meal plan on a phone

Covers manual checks `4.1` to `4.6` and `4.13`.

**Files:**
- Create: `e2e/layout.js`, `e2e/phone.js`, `e2e/meal-plan.mobile.spec.js`

**Interfaces:**
- Produces, in `e2e/layout.js`: `expectNoSidewaysScroll(page)`,
  `expectInsideViewport(locator)`, and `expectAbove(upper, lower)`, which
  checks that the bottom of `upper` is at or above the top of `lower`.
- Produces, in `e2e/phone.js`: `expectNoZoomOnFocus(locator)` (computed
  `font-size` of at least `16px`), `expectNoDoubleTapZoom(locator)`
  (computed `touch-action` of `manipulation`), `expectKeyboardClosed(page)`
  (the focused element isn't a text field), `expectKeyboardOpen(locator)`
  (the locator is focused and is a text field), and
  `expectDecimalKeyboard(locator)` (`inputmode="decimal"`).

- [ ] **Step 1: Write the tests** in `e2e/meal-plan.mobile.spec.js`:
  - `shows the current week with today selected`: each meal shows its name
    over a card with its menu and **Add**, and the tab bar lists
    **Meal plan**, **Recipes**, and **Ingredients**.
  - `keeps the selected day when the week changes`: Thursday stays
    selected in the next week.
  - `goes back to today with Today`.
  - `fits the range of a week that spans two years`: `/#2026-12-28` shows
    `Dec 28 – Jan 3` between the week buttons, with no sideways scroll.
  - `changes weeks on fast taps without zooming`: several quick taps on
    **Next week** end on one week, the buttons still work, and they have no
    double-tap zoom.
  - `keeps the toolbar and the tab bar in place while the page scrolls`:
    their boxes don't move, and the last meal scrolls clear of the tab bar.
  - `can be added to the Home Screen`: the manifest and the touch icon load,
    the viewport has `viewport-fit=cover`, and with safe area insets of
    `47px` and `34px`, the toolbar and the tab bar leave room for them.

- [ ] **Step 2: Run them, and watch the helpers' imports fail.**
- [ ] **Step 3: Implement `e2e/layout.js` and `e2e/phone.js`.**
- [ ] **Step 4: Run the tests and watch them pass on `pixel` and `iphone`.**
- [ ] **Step 5: Sabotage checks:** remove `touch-action: manipulation`, give
  `.week-short` a `min-width` wider than the phone, and drop the safe area
  padding of the toolbar in `public/styles.css`. Undo each.
- [ ] **Step 6: Commit.** `test(e2e): check the meal plan on phones`.

### Task 4: The slot editor

Covers manual checks `4.7` to `4.12` and `5.1` to `5.17`.

**Files:**
- Create: `e2e/slot-editor.spec.js`, `e2e/slot-editor.mobile.spec.js`

**Interfaces:**
- Consumes: Tasks 1 to 3. `seed` `"catalog"` gives the seven recipes.

- [ ] **Step 1: Write the tests.** In `e2e/slot-editor.spec.js`, one test
  for each of `5.1` to `5.17`, with the manual plan's values:
  - `opens an empty slot with the recipes from A to Z`
  - `finds recipes by any part of the name, ignoring case and accents`
  - `adds the highlighted recipe with the arrow keys and Enter`
  - `adds a recipe from the list with a click`
  - `steps servings by halves`
  - `stops servings at a half and moves focus to plus`
  - `saves the menu with Done and shows that it saved`
  - `stays open when a drag ends outside the editor`
  - `clears the search with Escape before it closes the editor`
  - `closes an unchanged editor from outside`
  - `stays open with a change when you click outside`
  - `says when no recipe matches`
  - `wraps a long recipe name in the slot and the editor`
  - `asks before a reload loses the editor's changes`
  - `reloads without asking after Cancel`
  - `keeps focus inside the editor`
  - `moves focus to Done when the menu is full`, with 20 more recipes
    through the API.

  In `e2e/slot-editor.mobile.spec.js`:
  - `opens the editor without the keyboard`: the editor fills the screen
    below the safe area, and the keyboard stays closed.
  - `removes a recipe without the keyboard`
  - `opens the keyboard for Add recipe without zooming`
  - `stays open when you tap inside the editor`
  - `keeps the editor when you switch away and back`
  - `closes the editor without saving on Back`: `Escape` sends the same
    `cancel` event.
  - `wraps a long recipe name on a phone`

- [ ] **Step 2: Run them and watch the ones of new behavior fail**, then
  fix the tests until they pass for the right reason.
- [ ] **Step 3: Sabotage checks:** in `public/name-search.js`, drop the
  `.replace(/\p{M}/gu, "")` that removes accents; let the stepper in
  `public/slot-editor.js` go below `0.5`; and make the slot editor's
  `close` listener save, as **Done** does. Undo each.
- [ ] **Step 4: Run all projects, and commit.**
  `test(e2e): check the slot editor in real browsers`.

### Task 5: Saves and unsaved changes

Covers manual checks `4.14`, `6.1` to `6.11`, and `7.1` to `7.5`.

**Files:**
- Modify: `e2e/fixtures.js`
- Create: `e2e/saves.spec.js`, `e2e/saves.mobile.spec.js`

**Interfaces:**
- Produces, in `e2e/fixtures.js`: the `network` fixture,
  `{ down(), stall(), up() }`, on the page's browser context. `down()` aborts
  every `/api/**` request with `connectionrefused`. `stall()` holds every
  `/api/**` request without an answer. `up()` aborts the held requests and
  lets new ones through. `down()` and `stall()` set
  `consoleErrors.allowed`.

- [ ] **Step 1: Write the tests** in `e2e/saves.spec.js`, one for each of
  `6.1` to `6.11`, `7.1`, `7.2`, and `7.4`, with the manual plan's values.
  Each one reads the result from `app.api.week()` where the manual plan
  looks at a slot after a reload. In `e2e/saves.mobile.spec.js`: `4.14`,
  `7.3`, and `7.5`.
- [ ] **Step 2: Run them and watch the `network` fixture's absence fail.**
- [ ] **Step 3: Implement `network`.**
- [ ] **Step 4: Run them and watch them pass on all projects.**
- [ ] **Step 5: Sabotage checks:** drop the `pagehide` flush in
  `public/app.js`, make the leave alert skip failed slots, and resend
  nothing on `visibilitychange`. Undo each.
- [ ] **Step 6: Commit.** `test(e2e): check saves and server failures in real browsers`.

### Task 6: The recipe book

Covers manual checks `8.1` to `8.22`.

**Files:**
- Create: `e2e/recipes.spec.js`, `e2e/recipes.mobile.spec.js`

- [ ] **Step 1: Write the tests**, one for each check, with the manual
  plan's values. `Tortilla` with `Egg` at `1.25` and the archived recipes
  are seed data through `app.api`. `8.18` and `8.19` go in the phone file.
- [ ] **Step 2: Run them and watch them pass on all projects.**
- [ ] **Step 3: Sabotage checks:** accept three decimals in quantities in
  `public/quantities.js`, show archived recipes in the active list, and
  remove `inputmode` from the quantity field. Undo each.
- [ ] **Step 4: Commit.** `test(e2e): check the recipe book in real browsers`.

### Task 7: The ingredient catalog

Covers manual checks `9.1` to `9.28`.

**Files:**
- Create: `e2e/ingredients.spec.js`, `e2e/ingredients.mobile.spec.js`

- [ ] **Step 1: Write the tests**, one for each check, with the manual
  plan's values. `9.23` to `9.27` go in the phone file. The two-tab checks
  use two pages of the same browser context.
- [ ] **Step 2: Run them and watch them pass on all projects.**
- [ ] **Step 3: Sabotage checks:** skip the duplicate measure check in
  `public/ingredient-editor.js`, show the conversion row for an unused unit,
  and drop the arrow keys of the unit control. Undo each.
- [ ] **Step 4: Commit.** `test(e2e): check the ingredient catalog in real browsers`.

### Task 8: The shopping list

Covers manual checks `10.1` to `10.10`.

**Files:**
- Create: `e2e/shopping-list.spec.js`, `e2e/shopping-list.mobile.spec.js`

- [ ] **Step 1: Write the tests**, one for each check, with the manual
  plan's values: `Egg 3 pcs`, `Egg 4 pcs`, `Carrot 240 g (2 pcs)`,
  `Onion 1.1 kg (220 g, 4 medium, 1 large)`, `1.7 kg`, `1 kg`, and `998 g`.
  `10.10` goes in the phone file.
- [ ] **Step 2: Run them and watch them pass on all projects.**
- [ ] **Step 3: Sabotage checks:** round totals down in
  `public/shopping-list.js`, and leave the dialog open on a week change.
  Undo each.
- [ ] **Step 4: Commit.** `test(e2e): check the shopping list in real browsers`.

### Task 9: Accessibility

Covers manual checks `3.5` and `11.1` to `11.8`.

**Files:**
- Create: `e2e/accessibility.spec.js`, `e2e/accessibility.mobile.spec.js`

**Interfaces:**
- Consumes: `AxeBuilder` from `@axe-core/playwright`, with the tags
  `wcag2a`, `wcag2aa`, `wcag21a`, and `wcag21aa`.

- [ ] **Step 1: Write the tests.** axe reports no violations on each page
  and dialog that the design lists, in the light and the dark appearance,
  on desktop and phone. The other tests check `11.1` to `11.8` through
  accessible names, descriptions, and the text of `#week-range` and
  `#save-announcement`. `11.4` goes in the phone file.
- [ ] **Step 2: Run them.** If axe reports a violation, stop and ask the
  user before changing the product.
- [ ] **Step 3: Sabotage checks:** remove the `aria-label` of the slots, and
  stop writing `#save-announcement`. Undo each.
- [ ] **Step 4: Commit.** `test(e2e): check accessibility in real browsers`.

### Task 10: The host on a disposable runner

Covers manual checks `13.1` to `13.10`.

**Files:**
- Create: `scripts/host-acceptance.sh`, `test/host-acceptance.test.js`,
  `.github/workflows/host.yml`
- Modify: `README.md`

**Interfaces:**
- Produces: `scripts/host-acceptance.sh`, with no arguments. It exits `1`
  with `Run the host acceptance test only on a GitHub Actions runner.` when
  `GITHUB_ACTIONS` isn't `true`, with `Run the host acceptance test as
  root.` when it isn't root, and with `/opt/server/meals already exists.`
  when it does.

- [ ] **Step 1: Write the failing tests** in `test/host-acceptance.test.js`:
  - `host acceptance refuses to run outside GitHub Actions`
  - `host acceptance refuses to run as a user other than root`, with
    `GITHUB_ACTIONS=true`.
- [ ] **Step 2: Run them and watch them fail**, because the script doesn't
  exist.
- [ ] **Step 3: Write the script**, with the steps of the design in order.
  Each check prints what it checked, and the first failure prints what it
  expected and what it found, and exits `1`. A `trap` removes the
  `/etc/hosts` line on exit.
- [ ] **Step 4: Run the tests and watch them pass.**
- [ ] **Step 5: Add `.github/workflows/host.yml`:** `pull_request` with the
  paths of the design, `schedule` at `17 5 * * 1`, and `workflow_dispatch`.
  One job, `host`, on `ubuntu-24.04`, `timeout-minutes: 20`, that runs
  `sudo --preserve-env=GITHUB_ACTIONS,GITHUB_TOKEN scripts/host-acceptance.sh`
  with `GITHUB_TOKEN: ${{ github.token }}`.
- [ ] **Step 6: Run the workflow on the branch** and watch it pass. Then
  break the mode that `install.sh` gives `data/`, watch the run fail at the
  install check, and undo it.
- [ ] **Step 7: Document** the workflow in the README's Continuous
  integration section and in the project structure.
- [ ] **Step 8: Commit.** `ci: check the host tools on a disposable runner`.

### Task 11: Retire the manual test plan

**Files:**
- Delete: `docs/manual-test-plan.md`
- Modify: `AGENTS.md`, `README.md`

- [ ] **Step 1: Check the coverage.** Every check of the manual plan has its
  test, as the design's mapping lists.
- [ ] **Step 2: Delete the plan**, and replace the rule in `AGENTS.md`,
  Testing: a behavior that needs a real browser gets a test in `e2e/`, and a
  behavior of the host gets a check in `scripts/host-acceptance.sh`.
- [ ] **Step 3: Update the README:** remove the line that sends you to the
  manual plan, and its entry in the project structure.
- [ ] **Step 4: Check that no file links to the plan.**
  Run: `git grep -n manual-test-plan`.
  Expected: only the design and this plan.
- [ ] **Step 5: Commit.** `docs: replace the manual test plan with automated tests`.
