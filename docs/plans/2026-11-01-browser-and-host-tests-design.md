# Browser and host tests design

Date: 2026-11-01

## Context and goal

`docs/manual-test-plan.md` lists 145 checks that need a person: a desktop
browser, a phone, a screen reader, a change of the system clock, or the host.
The README asks you to run it before you merge a change to the user
interface, `deploy/`, or `scripts/`. Its sections build on each other, so one
failure blocks the rest, and every change to the interface means editing the
plan as well as the code and the tests.

The automated tests stop where happy-dom stops. They never check real focus
and keyboard input, native dialogs and the leave-page prompt, page lifecycle
events, layout, phone screens, or the dark appearance. The host scripts run
against stub commands and against Docker, but never against systemd, the
`deployer` user, and the published releases.

**Goal:** every check of the manual plan runs automatically in CI, and the
plan goes away. Checks of the user interface run in real browsers. Checks of
the host run on a disposable host. When only a real phone or a real screen
reader shows an effect, the test checks its cause.

### Goals

- Each check of the manual plan becomes an automated test: in a real browser,
  on a disposable host, or as a check of the cause of a phone or screen reader
  effect.
- Tests are independent and deterministic. Each one has its own server and
  data, a fixed date, and simulated server failures.
- `npm test` stays as it is: fast, and with no browser.
- A flaky test fails the build instead of passing on a retry.

### Non-goals

- Real phones, real screen readers, and screenshot comparisons.
- Replacing the happy-dom tests. They stay as the fast check of the page
  scripts.
- Testing the production host.

### Anti-goals

The design fails, even if every test passes, if any of the following happens:

- A test touches `/opt/server/meals`, port `3000`, or the `data/` directory of
  a checkout.
- A test passes or fails depending on the day you run it, the time zone of the
  machine, or the order of the tests.
- The browser tests need a manual step, such as a server in another terminal.

## Decisions

| Topic | Decision |
|-------|----------|
| Test runner | Playwright Test, `@playwright/test` pinned to `1.64.1`, with `@axe-core/playwright` pinned to `4.14.0`. Its assertions wait for the page, which keeps the tests stable. |
| Browsers | Desktop: Chromium, Firefox, and WebKit. Phones: the `Pixel 7` device on Chromium and the `iPhone 15` device on WebKit. |
| Files | Tests in `e2e/`: `*.spec.js` runs on the desktop browsers, and `*.mobile.spec.js` runs on the phones. Settings in `playwright.config.js`. |
| Server | Each test starts its own server in the test process, with `start()` from `server/start.js`, on port `0`, with a new temporary data directory and `silentLogger`. |
| Data | Through the HTTP API, before the page opens. By default, each test starts with the catalog of the manual plan. |
| Date and place | Each page starts at Wednesday, September 23, 2026, 10:00, through `page.clock`. Every browser uses the time zone `Europe/Madrid` and the locale `en-US`. |
| Server failures | Routes on `/api/**`. *Down* aborts each request as a refused connection. *Stalled* never answers, so the app's 5-second timeout fires. Static files keep loading. |
| Hidden page | A `visibilitychange` event, with `document.visibilityState` set to `hidden` and then `visible`. Reloads and closed tabs fire the real `pagehide` and `beforeunload`. |
| Layout | Geometry, not pixels: no sideways scroll, boxes inside the viewport, boxes that don't overlap, and bars that keep their place when the page scrolls. |
| Phone-only effects | The cause, as [Phone checks](#phone-checks) lists. |
| Accessibility | axe with the WCAG 2.1 A and AA rules on each page and dialog, in the light and the dark appearance. Accessible names, descriptions, and live regions through Playwright locators and assertions. |
| Console | A test fails on an uncaught error in the page. It also fails on a console error, unless it simulated a server failure. |
| Flaky tests | In CI, one retry with a trace, and `failOnFlakyTests`, so a test that passes only on its retry fails the run. `forbidOnly` in CI. |
| Scripts | `npm run test:e2e` runs the browser tests. `npm run test:e2e:install` installs the browsers and the system packages they need. |
| CI | A new job, `e2e`, in `.github/workflows/ci.yml`, on every pull request and push to `main`. A new workflow, `.github/workflows/host.yml`, runs the host test. |
| Host test | `scripts/host-acceptance.sh`, on a GitHub-hosted runner. It refuses to run anywhere else. |
| Manual plan | The last task deletes `docs/manual-test-plan.md` and the rules that send you to it. |

## Test layers

| Layer | Tools | What it checks | When it runs |
|-------|-------|----------------|--------------|
| Static checks | Biome, ShellCheck, and `systemd-analyze` | Code style, shell scripts, and units | Before every commit, and in CI |
| Units and API | `node:test` and supertest | Logic, the stores, and the HTTP API | `npm test` |
| Page scripts | `node:test` with happy-dom | How each page reacts to data and events | `npm test` |
| Browser | Playwright | Sections 1 to 12 of the manual plan | `npm run test:e2e`, and CI |
| Image | `image-smoke.sh` and `host-smoke.sh` | The image, and the host scripts against Docker | CI |
| Host | `host-acceptance.sh` | Section 13 of the manual plan | CI on a disposable runner |
| Production | The health check and rollback of `meals-deploy`, and `meals-restore-check` | What only the real host shows | On the host, always |

A check lives in the cheapest layer that can catch its failure. For example,
the arithmetic of the shopping list stays in the unit tests, and the browser
tests check one integrated example of it.

## Browser tests

### Harness

`e2e/fixtures.js` exports `test` and `expect`. Its fixtures are the
following:

- `seed`, an option: `"catalog"`, the default, or `"empty"`.
- `app`: starts the server, adds the seed data, and exposes `url`, the API
  client `api`, and the seeded `recipes` and `ingredients` by name. After the
  test, it stops the server and deletes the data directory.
- `baseURL`: `app.url`, so tests open pages with `page.goto("/")`.
- `page`: installs the clock before the test opens the first page, and checks
  the console after the test.
- `network`: `down()`, `stall()`, and `up()`, for every page of the test.

Other modules in `e2e/`:

- `api.js`: a client of the HTTP API, for the seed data and for reading what
  the server saved.
- `catalog.js`: the seed data, the fixed date, and the weeks the tests use.
- `page-visibility.js`: hides and shows a page.
- `layout.js`: geometry assertions.
- `phone.js`: the phone checks.

### Seed data

The catalog has the recipes `Gnocchi carbonara`, `Green salad`,
`Lentil soup`, `Omelette`, `Russian salad`, `<b>Bold</b> soup`, and
`Supercalifragilisticexpialidocious-casserole-with-a-very-long-name`, and
the ingredients `Egg` in `pcs`, `Milk` in `ml`, `Onion` in `g`, and `Rice`
in `g`. A test that needs more, such as `Tortilla` with `Egg`, or measures on
`Onion`, adds it through `app.api` before it opens the page.

The sections of the manual plan build on each other, but the tests don't.
Each test creates, as data, what the earlier sections would have left.

### Phone checks

| Effect on a phone | What the test checks |
|-------------------|----------------------|
| The page zooms in when a field gets focus | The computed `font-size` of the field is at least `16px`. |
| A double tap zooms in | The computed `touch-action` of the buttons is `manipulation`. |
| The keyboard opens, or doesn't | The focused element is, or isn't, a text field. |
| The keyboard offers digits | The field has `inputmode="decimal"`, and a decimal comma works. |
| You switch to another app and back | The page is hidden and shown. |
| The Android **Back** gesture closes a dialog | The dialog gets a `cancel` event, which `Escape` also sends. |
| Add to Home Screen | The manifest and the touch icon load, the viewport has `viewport-fit=cover`, and the bars leave room for the safe area insets. |

### Accessibility

- axe checks the meal plan, the slot editor, the alert about unsaved changes,
  the shopping list, the recipe book, the recipe editor, the ingredient
  catalog, and the ingredient editor, in the light and the dark appearance.
- Tests find elements by role and accessible name, with the names the manual
  plan gives, and check accessible names and descriptions directly.
- Tests check what the live regions `#week-range` and `#save-announcement`
  say.

## Host test

`scripts/host-acceptance.sh` is section 13 of the manual plan as a script. It
installs Meals for real, so it refuses to run unless `GITHUB_ACTIONS` is
`true`, it runs as root, and `/opt/server/meals` doesn't exist. A
GitHub-hosted runner is a new virtual machine for each job, with systemd,
Docker, and passwordless `sudo`.

The script runs these steps in order, and stops at the first failure with the
check that failed:

1. Installs the host tools, and checks the `deployer` user, the owners and
   modes of `/opt/server`, `/opt/server/meals`, and its `data/`, and `hold`.
1. Checks that the three timers are enabled and scheduled.
1. Installs again, and checks that `.env` and `hold` don't change.
1. Moves the data of an earlier installation in, as
   [Move an existing installation](../deployment.md#move-an-existing-installation)
   describes, and checks the health check, the data, and the mode of `data/`.
1. Deploys `0.2.0` by hand, resumes, and lets `meals-deploy.service` deploy
   the latest release.
1. Backs up through `meals-backup.service`, and restores that backup with
   `meals-restore`.
1. Runs `meals-restore-check.service`, and checks its journal and that its
   container is gone.
1. Blocks `ghcr.io` in `/etc/hosts`, and checks that a deployment fails with
   `Couldn't pull` and changes nothing.
1. Restarts the Docker daemon in place of a reboot, and checks that the app
   and the timers come back within 2 minutes.

`meals-deploy` calls the GitHub API without a token, and runners share
addresses, so the unauthenticated rate limit could fail a run. The script
gives `meals-deploy` the job's token through a curl configuration file in
`CURL_HOME`, and leaves the scripts unchanged.

`.github/workflows/host.yml` runs the script on pull requests that change
`.github/workflows/host.yml`, `deploy/`, or `scripts/`, every Monday at
05:17 UTC, and by hand. The weekly run catches changes outside the
repository, such as a new runner image or a change in GitHub or GHCR. The
check isn't required, because its path filter skips most pull requests.

## Mapping of the manual plan

| Section | Checks | Browser | Host | Cause |
|---------|-------:|--------:|-----:|------:|
| 1. Week navigation on desktop | 10 | 10 | | |
| 2. Week in the URL | 2 | 2 | | |
| 3. Dates and today marker | 5 | 5 | | |
| 4. Mobile | 14 | 7 | | 7 |
| 5. Slot editor | 17 | 17 | | |
| 6. Saves and unsaved changes | 11 | 11 | | |
| 7. Saves when the page is hidden | 5 | 3 | | 2 |
| 8. Recipe book | 22 | 20 | | 2 |
| 9. Ingredients | 28 | 25 | | 3 |
| 10. Shopping list | 10 | 10 | | |
| 11. Keyboard and screen readers | 8 | 2 | | 6 |
| 12. Day and week changes | 3 | 3 | | |
| 13. Host | 10 | | 9 | 1 |
| **Total** | **145** | **115** | **9** | **21** |

The checks of the cause are `4.5`, `4.7` to `4.9`, `4.11` to `4.13`, `7.3`,
`7.5`, `8.18`, `8.19`, `9.23`, `9.25`, `9.26`, `11.3` to `11.8`, and `13.8`.
The optional checks of the manual plan run like the others.

## Documentation

- `README.md`: [Check your changes](../../README.md#check-your-changes)
  adds the browser tests, [Continuous integration](../../README.md#continuous-integration)
  adds the `e2e` job and the host workflow, and the project structure adds the
  new files. The rule that sends you to the manual plan goes away.
- `AGENTS.md`: a behavior that needs a real browser gets a test in `e2e/`, and
  a change to the user interface also passes `npm run test:e2e`.
- `.gitignore`: `playwright-report/` and `test-results/`.

## Risks

| Risk | Mitigation |
|------|------------|
| Races, such as fast week changes or a save during a week change | Assertions that wait, and stalled routes that fix the order of events |
| A request with `keepalive` while a tab closes | The test reads the result from the server, and waits for it |
| WebKit on Linux isn't Safari on iOS | The phone checks test the causes that Safari reacts to |
| Interface changes break tests | Locators by role and accessible name, never by CSS class |
| GitHub or GHCR is down during the host test | The check isn't required, and you can run it again by hand |
