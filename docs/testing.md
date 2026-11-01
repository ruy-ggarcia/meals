# Testing strategy

This document describes how the repository tests the app and the host tools:
the levels of tests, what each level proves, where a new test goes, and the
rules that every test follows.

## Rules for every test

Every test follows these rules. Apply them when you add, move, or review a
test.

- **No flaky tests.** A test pins the guarantee that it promises consistently
  and reproducibly, whatever the load of the machine that runs it. Time
  limits catch an app that hangs, not a slow machine. If a check can't pass
  every time, narrow what the test promises and say so in its name, even if
  coverage drops. Never hide a test that only sometimes passes with a retry
  or a skip.
- **One guarantee per test.** The test's name states one behavior, and the
  test can fail only when that behavior breaks.
- **A name with one form.** The subject of a test goes once in a `describe`
  block, in one form: a function by its identifier without parentheses
  (`validName`), a module or file by its path from the repository root with
  its extension (`server/weeks.js`), an API route by its method and path
  (`GET /api/health`), a host script by its name (`meals-backup`), a page or
  editor on happy-dom by its screen name (`slot editor`), and a browser test
  by its feature (`shopping list`). A `describe` name never holds a
  condition. The test name starts with a verb in the present tense and third
  person, with a lowercase first letter, and states one behavior, such as
  "rejects a blank name". It puts a condition after "when", "unless",
  "before", "after", "while", or "without", as in "returns 503 when the data
  directory isn't writable". It writes user interface labels exactly as the
  screen shows them, as in "closes with Leave Without Saving", and it never
  contains "should", a final period, quotes, or backticks. It has at most 70
  characters without the subject, uses US English with the terms of the
  [glossary](glossary.md), and uses "and" only when both parts are one
  guarantee.
- **Independence.** A test shares no state with other tests and doesn't
  depend on their order.
- **The lowest level that can prove it.** A calculation rule doesn't need a
  browser, and a domain rule doesn't need a disk. Put each test in the lowest
  level of the [test pyramid](#test-pyramid) that can prove its guarantee.
- **No duplicates across levels.** A higher level doesn't check a guarantee
  again, unless it checks something that the lower level can't, such as how
  the result looks in a browser.
- **A failure that says what broke.** A failing test's message tells what
  broke, without debugging the test.
- **Helpers stay in their layer.** Tests share helpers only within one layer:
  the backend (`server/`), the frontend (`public/`), the host tools, or
  `e2e/`. Across layers, share data files, not code.

Before you add or change a browser test, run it under load with more workers
than the default, for example:

```bash
npm run test:e2e -- e2e/saves.spec.js --repeat-each=10 --workers=12
```

## Test pyramid

The tests form a pyramid: many fast and isolated tests at the bottom, and few
slow tests that use the real system at the top. Each level proves something
that the level below it can't.

| Level | Backend | Frontend | Deployment |
| --- | --- | --- | --- |
| Static | Biome and CodeQL | Biome and CodeQL | ShellCheck, `systemd-analyze verify`, and the check of the units in `test/systemd-units.test.js` |
| Unit | Pure modules of `server/`, such as names and limits | Pure modules of `public/`, such as dates, quantities, the shopping list, and saves | The `meals-*` scripts, with stubs of Docker and systemd |
| Integration | The API with supertest, the stores on a real data directory, and the server's start and stop | The pages and the editors on happy-dom, with a fake server | The image through `deploy/compose.yaml`, and the `meals-*` scripts with real Docker |
| End to end | The app in real browsers, with the real server: `e2e/` | The app in real browsers, with the real server: `e2e/` | A real installation of the host tools on a disposable runner: `scripts/host-acceptance.sh` |
| Exploratory | Short sessions on real devices before each release | Short sessions on real devices before each release |

### Static

Static checks read the code without running it:

- [Biome](https://biomejs.dev) checks the format and the lint rules of the
  JavaScript, and [ShellCheck](https://www.shellcheck.net) checks the shell
  scripts. `npm run lint` runs both.
- `npm run test:units` runs `systemd-analyze verify` on the units in
  `deploy/systemd`.
- `test/systemd-units.test.js` checks that each host script that runs on a
  schedule has a service and a timer.
- [CodeQL](https://codeql.github.com) code scanning on GitHub checks the
  JavaScript and the workflows for security problems.

### Unit

Unit tests check one module with no disk, network, or browser, in
`test/*.test.js`. A test replaces `fetch` or a slow dependency with a fake
when the module needs one. The tests of the `meals-*` scripts run the real
scripts with the stubs in `test/stubs/` in place of Docker, systemd, and the
other host commands. `npm test` runs them.

### Integration

Integration tests check modules together with a real dependency, also in
`test/*.test.js`:

- On the backend, the API runs with supertest, the stores write to a
  temporary data directory, and the server starts and stops as a real
  process.
- On the frontend, the pages and the editors run on
  [happy-dom](https://github.com/capricorn86/happy-dom) with a fake server, so
  a test can click, type, and read the page.
- For the deployment, `npm run test:image` builds the image and runs it
  through `deploy/compose.yaml` as the host does, and `npm run test:host`
  runs the `meals-*` scripts against real Docker in a temporary root.

### End to end

End-to-end tests check the whole system as a person or the host uses it:

- `e2e/` runs the app in [Playwright](https://playwright.dev): Chromium,
  Firefox, and WebKit on a desktop, and Pixel 7 and iPhone 15 emulation. Each
  test starts its own server on `127.0.0.1` with its own data, at a fixed date
  and time zone, and fails on an unexpected console error. axe checks every
  page and dialog in the light and dark appearances. A request never times
  out in a browser test, so a test can hold it as long as it needs; a test
  that checks how the app gives up on a request uses `test.use({
  requestTimeout: "real" })` and waits for the real 5 seconds. `npm run
  test:e2e` runs them.
- `scripts/host-acceptance.sh` installs the host tools for real on a
  disposable GitHub-hosted runner, deploys published releases, backs up,
  restores, and restarts Docker. `.github/workflows/host.yml` runs it on pull
  requests that change `deploy/` or `scripts/`, every week, and by hand. The
  weekly run catches changes outside the repository, such as a new runner
  image or a change in GitHub or GHCR.

### Exploratory

Before each release, the maintainer spends a short session in Safari on a Mac
and on an iPhone, with a written goal, such as the keyboard in the editors.
The session finds what Playwright can't emulate. It never blocks a release:
each finding becomes an issue, and its fix comes with a test at the lowest
level that can prove it.

## Where a new test goes

To choose the level of a new test, find the first row that matches what the
test proves:

| The test proves | Level |
| --- | --- |
| A rule of calculation, text, or validation | Unit |
| The logic of a `meals-*` script | Unit, with the stubs |
| How a page reacts to clicks, typing, and data | Integration, on happy-dom |
| The API, the stores, or the server's start and stop | Integration, on the backend |
| That the image or the `meals-*` scripts work with real Docker | Integration, `test:image` or `test:host` |
| Focus, layout, real browser events, a difference between browsers, accessibility, or the contract with the real server | End to end, `e2e/` |
| That the host tools work on a real host | End to end, `scripts/host-acceptance.sh` |

Before you fix a bug, write the test that reproduces it at that level, and
watch it fail.

## Checks in production

The host also checks the running app, outside the test pyramid:

- The image's `HEALTHCHECK` asks the app for its health every 30 seconds.
- `meals-deploy.timer` starts the deployed version if it isn't running, and
  deploys new releases.
- `meals-backup.timer` backs up the data every day.
- `meals-restore-check.timer` restores the latest backup into a separate
  Compose project every week and checks that the app answers.

These checks watch the running system. They don't test the code, and a
failure only shows in the journal and in the state of the unit.
