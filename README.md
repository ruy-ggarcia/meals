# Meals

Meals is a web app for planning a family's meals week by week. It shows one
week at a time as a grid of 7 days by 5 meals (breakfast, morning snack,
lunch, afternoon snack, and dinner). Each slot of the grid holds a menu: a
list of recipes from the recipe book, each with a number of servings.

Each recipe lists its ingredients, with the quantity that one serving
needs, in the ingredient's unit or in a measure such as `medium`. The app
adds them up into a shopping list for the week.

Meals is self-hosted: it runs on a server that you manage, and any desktop or
mobile browser on the same network can use it.

The terms that the app uses, such as *slot*, *menu*, and *recipe book*, are
defined in [`docs/glossary.md`](docs/glossary.md).

## Before you begin

Install the following:

- Node.js 22 or later. To check your version, run `node --version`.
- npm. To check that it's installed, run `npm --version`.
- ShellCheck, which `npm run lint` runs on the shell scripts. On Ubuntu,
  run `sudo apt install shellcheck`.
- Optional: Docker with the Compose plugin, to build and test the image
  with `npm run test:image` and `npm run test:host`.
- Optional: `systemd-analyze`, which systemd provides, to check the systemd
  units with `npm run test:units`.

## Start the server

This section starts a server from your checkout, for development. To run
Meals in production, see [Deploy Meals](docs/deployment.md).

1. Install the dependencies. Run this command again after you pull
   changes, so `node_modules` matches `package-lock.json`:

   ```bash
   npm ci
   ```

1. Start the server:

   ```bash
   npm start
   ```

   The server logs one JSON object per line. The first one is similar to
   the following:

   ```json
   {"time":"2026-10-04T10:00:00.000Z","level":"info","msg":"server started","version":"0.1.0","port":3000,"dataDir":"/path/to/meals/data"}
   ```

To stop the server, press `Control+C`.

If the server can't start, for example because the port is in use, it logs
`server failed to start` with the error and exits with status 1.

If the computer also runs the deployed Meals, it uses port `3000`. To
start a development server next to it, run `PORT=3001 npm start`.

## Open the app

- On the computer that runs the server, go to `http://localhost:3000`.
- On a phone or another device on the same network, do the following:

  1. On the computer that runs the server, find its local IP address:

     ```bash
     hostname -I | awk '{print $1}'
     ```

     The output is an address such as `192.168.1.23`.

  1. On the device, connect to the same Wi-Fi network as the computer.
  1. In the device's browser, go to `http://IP_ADDRESS:3000`, where
     `IP_ADDRESS` is the address from the first step.

To open Meals like an app, with its own icon, add it to the Home Screen. In
Safari on an iPhone or iPad, tap **Share**, and then tap **Add to Home
Screen**.

If the page doesn't load on the device, a firewall might be blocking the port.
To open the port, run the command for your firewall:

- ufw:

  ```bash
  sudo ufw allow 3000/tcp
  ```

- firewalld:

  ```bash
  sudo firewall-cmd --add-port=3000/tcp
  ```

## Navigate the meal plan

Meals has three sections: **Meal plan**, **Recipes**, and **Ingredients**.
On wide screens, a sidebar lists them, with the number of active recipes and
active ingredients. The sidebar shows on screens 1000 px wide or wider. To
hide or show it, click the sidebar button at its top or in the toolbar. The
app remembers your choice. On phones, a tab bar at the bottom lists the
sections.

- **Wide screens** (700 px wide or wider): the grid shows one column per day
  and one row per meal, under the meal's name. Each day header shows the
  weekday and the day of the month.
- **Phones:** the app shows one day at a time, with its name and date at the
  top. To switch days, tap a day in the day bar. Each button shows the
  weekday letter and the day of the month, and a dot marks the days with
  menus. When the page opens, it shows the current day.

When the displayed week contains today, the app marks today in green. On wide
screens, it shades today's column, from its header to its last slot. On
phones, it marks today's button in the day bar, and **Today** follows the
date.

To move between weeks, use the toolbar at the top. On wide screens, it shows
the dates of the displayed week next to **Today**:

- `‹` shows the previous week.
- `›` shows the next week.
- **Today** shows the current week. On phones, it also selects today.

On phones, changing weeks keeps the selected day. The address bar holds the
displayed week, for example `http://localhost:3000/#2026-09-21`, so a reload
shows the same week and you can bookmark a week.

## Plan a meal

To plan a meal, click or tap its slot. The slot editor opens with the slot's
menu:

- To add a recipe, click it in the list under **Add recipe**. To narrow the
  list, type part of the recipe's name, and then click the recipe or select
  it with the arrow keys and press `Enter`. A menu holds up to 20 recipes,
  and the list offers only active recipes that aren't already in the menu.
  To add recipes to the recipe book, use the **Recipes** page.
- To change the servings of a recipe, click `−` or `+`. Servings go from 0.5
  to 99 in steps of 0.5. A recipe that you add starts at 1.
- To remove a recipe from the menu, click the red button before its name.

To save the menu, click **Done**. To close the editor without saving, click
**Cancel** or press `Escape`. In **Add recipe**, the first `Escape` only
clears the text. Clicking outside the editor closes it only if you haven't
changed anything. If you reload or close the page while the editor has
changes, the browser asks you to confirm.

The toolbar shows the save status of the week. On phones, it shows next to
the date:

| Status                  | Meaning                                                      |
|-------------------------|--------------------------------------------------------------|
| **Saving…**             | The app is saving a slot.                                    |
| **All changes saved**   | Every slot is saved. The status disappears after a few seconds. |
| **1 not saved · Retry** | A slot couldn't be saved. The slot keeps your menu.          |

A slot that couldn't be saved has a red outline and a **Retry** button. To
retry it, click **Retry**. To retry every slot that couldn't be saved, click
the status in the toolbar. A screen reader announces each save as it starts,
ends, or fails.

Before the app changes weeks, it waits for pending saves. If a slot couldn't
be saved, the app names the meals that weren't saved and asks whether to
leave the week. To stay and retry the save, click **Stay**. To discard the
unsaved menus and change weeks, click **Leave Without Saving**. The slots
then go back to their last saved menus.

Changes from other devices don't appear in real time. To see them, reload the
page. If two people edit the same slot, the last save wins.

## View the shopping list

To see the shopping list for the displayed week, click **Shopping list** in
the toolbar. It lists ingredients from A to Z, and it counts the menus
that the grid shows, including slots that are still saving and slots whose
save failed.

Each line shows the total in the ingredient's unit, rounded up to a whole
number so that you never buy too little. From 1000 `g` or `ml` on, the total
shows in `kg` or `l`, rounded up to tenths: `1320 g` shows as `1.4 kg`.

When a recipe of the week uses a measure of the ingredient, the line also
breaks the total down in parentheses, under the total: first the part in the
unit, if any, rounded like the total, and then each measure in the
ingredient's order, rounded to two decimals. For example, the following line
means 220 g of onion, 4 medium onions, and 1 large onion, 1.1 kg in all:

```none
Onion                        1.1 kg
             (220 g, 4 medium, 1 large)
```

Recipes without ingredients can't add to the list. The list names them
under **Not included**, with the slots where they appear.

To close the list, click **Close**, press `Escape`, or click outside it.

## Manage recipes

The recipe book holds the recipes that you can add to menus. To open it,
click **Recipes** in the sidebar or the tab bar.

A recipe has a name of up to 100 characters and a list of ingredients,
each with the quantity that one serving needs, in the ingredient's unit or
in one of its measures. Names are unique, ignoring case and accents, so
`Café` and `cafe` are the same name.

- To add a recipe, click **New recipe** in the toolbar. To change a recipe,
  click its row. Both open the recipe editor:
  - Type the name in **Name**. As you type, a message says when another
    recipe has the name. If an archived recipe has it, restore that recipe
    from **Archived** instead.
  - To add an ingredient, click it in the list under **Add ingredient**. To
    narrow the list, type part of the ingredient's name, and then click the
    ingredient or select it with the arrow keys and press `Enter`. A recipe
    holds up to 50 ingredients, and the list offers only active ingredients
    that aren't in the recipe. To add ingredients to the catalog, use the
    **Ingredients** page.
  - Type each quantity from `0.01` to `10000` with at most two decimals,
    such as `0.25`. You can type `.` or `,` as the decimal separator. A
    quantity that isn't valid gets a red outline as you type.
  - To use a measure of the ingredient instead of its unit, choose the
    measure in the list after the quantity, such as `medium (150 g)`. The
    list starts on the unit. An ingredient without measures shows only its
    unit.
  - To remove an ingredient, click the red button before its name.
  - To save, click **Done** or press `Enter`. To close the editor without
    saving, click **Cancel** or press `Escape`.
- Each row lists the recipe's ingredients. A recipe without ingredients shows
  a warning instead. You can save it, but the shopping list can't count it.
- To find a recipe, type part of its name in **Search**.
- To archive a recipe that you no longer use, open it, and then click
  **Archive** at the end of the editor. If you changed something in the
  editor, the app asks first: **Keep Editing** keeps your changes, and
  **Archive Without Saving** archives the recipe without them. To bring a
  recipe back, click **Restore** under **Archived**. An archived recipe
  still opens when you click its row, so you can change it, for example
  for the menus that still use it. Its editor has no **Archive**.

You can't delete recipes.

## Manage ingredients

The ingredient catalog holds the ingredients that recipes use. To open
it, click **Ingredients** in the sidebar or the tab bar.

An ingredient has a name of up to 100 characters, a unit (`g`, `ml`, or
`pcs`), and up to 20 measures. Names are unique, ignoring case and accents.
The shopping list adds up each ingredient in its unit.

A measure is a named amount of the ingredient in its unit, such as `medium`
for 150 g of onion. Its name has up to 100 characters and is unique within
the ingredient, ignoring case and accents. Its amount is from `0.01` to
`10000` with at most two decimals. Each recipe uses an ingredient in its unit
or in one of its measures, so two recipes can measure the same ingredient
differently.

- To add an ingredient, click **New ingredient** in the toolbar. To change
  an ingredient, click its row. Both open the ingredient editor:
  - Type the name in **Name**. As you type, a message says when another
    ingredient has the name. If an archived ingredient has it, restore
    that ingredient from **Archived** instead.
  - Choose the unit in **Unit**: `g`, `ml`, or `pcs`. To change the unit of
    an existing ingredient, see
    [Change the unit of an ingredient](#change-the-unit-of-an-ingredient).
  - To add a measure, click **Add measure**, and type its name and its
    amount in the unit. You can type `.` or `,` as the decimal separator.
    An amount that isn't valid gets a red outline as you type.
  - To rename a measure or change its amount, edit its row. The recipes that
    use the measure follow the change.
  - To remove a measure, click the red button before its name. While a
    recipe, active or archived, uses the measure, the button is disabled, and
    the row says how many recipes use it.
  - To save, click **Done** or press `Enter`. To close the editor without
    saving, click **Cancel** or press `Escape`.
- To find an ingredient, type part of its name in **Search**.
- To archive an ingredient, open it, and then click **Archive** at the end of
  the editor. As with a recipe, the app asks first if you changed something.
  To bring an ingredient back, click **Restore** under **Archived**. As
  with a recipe, an archived ingredient still opens when you click its row.

Each row of the list shows the unit and the names of the measures, such as
`g · medium, large`.

You can't delete ingredients.

### Change the unit of an ingredient

You can change the unit of an ingredient at any time, even while recipes use
it. If the ingredient has measures, or a recipe uses it in its unit, you also
tell the app how the two units convert. To change the unit, do the
following:

1. In the ingredient editor, choose the new unit in **Unit**. If the change
   needs a conversion, a conversion row appears, such as `1 pcs = [ ] g`.
1. Complete the conversion. For example, if a piece weighs 120 g, keep `1`
   and type `120`.
1. If a recipe uses the ingredient in the old unit, check the name in
   **Saved as measure**. In those recipes, a measure with this name replaces
   the old unit. The name starts as the old unit, such as `pcs`.
1. Click **Done**.

The app converts the amounts of the measures, and the recipes keep their
meaning. In the example, `2 pcs` in a recipe becomes `2 pcs (120 g)`: 2 of
the new measure `pcs`, which is 120 g.

While the conversion row shows, the measures are read-only and preview their
converted amounts. To change both the unit and the measures, save each change
separately. If any converted amount falls outside `0.01` to `10000`, the app
rejects the change and changes nothing.

## Configure the server

The server reads the following environment variables:

| Variable   | Default  | Description                           |
|------------|----------|---------------------------------------|
| `DATA_DIR` | `./data` | The data directory. See [Data files](#data-files). |
| `PORT`     | `3000`   | The port that the server listens on.  |

For example, to store data in `/srv/meals` and listen on port 8080, run the
following command:

```bash
DATA_DIR=/srv/meals PORT=8080 npm start
```

The image sets `DATA_DIR` to `/data` and `PORT` to `3000`. See
[Deploy Meals](docs/deployment.md).

## Data files

The meal plan, the recipe book, and the ingredient catalog live in the
`v2/` directory inside the data directory, which is `data/` unless you set
`DATA_DIR`:

- `v2/ingredients.json` holds the ingredient catalog.
- `v2/recipes.json` holds the recipe book.
- `v2/weeks/` holds one file per week, named after the week's Monday, for
  example `v2/weeks/2026-09-21.json`. The server creates a week's file on
  the first save in that week.

Git ignores the `data/` directory.

On the host, backups are automatic. See
[Backups](docs/deployment.md#backups).

If a week file, `recipes.json`, or `ingredients.json` contains invalid JSON,
the app shows an error, such as `Couldn't load the meal plan.`, and doesn't
overwrite the file. To recover, do the following:

1. Restore a backup copy of the file, or fix the JSON by hand.
1. In the app, click **Retry**.

If you restore an older `recipes.json` or `ingredients.json`, the app hides
what the restored file doesn't have: menu items whose recipe is missing, and
recipe ingredients whose ingredient or measure is missing. They come back
when you restore a file that has them.

### Plans from earlier versions

Earlier versions stored each slot as free text, in `data/weeks/` and
`data/week.json`. The app doesn't show those plans, and the server never
reads, changes, or deletes those files. To keep them, leave them where they
are or copy them elsewhere.

## Check your changes

Before you commit, check your changes:

1. Apply the code format and safe lint fixes:

   ```bash
   npm run format
   ```

1. Check the code style. This command doesn't change any files, and it fails
   if the code has lint errors or isn't formatted:

   ```bash
   npm run lint
   ```

1. Run the tests:

   ```bash
   npm test
   ```

[Biome](https://biomejs.dev) checks the style of JavaScript, CSS, and JSON
files. The settings are in `biome.json`.
[ShellCheck](https://www.shellcheck.net) checks the shell scripts. The
settings are in `.shellcheckrc`.

If you change `e2e/`, `public/`, `server/`, or `playwright.config.js`, also
run the browser tests:

1. The first time, and again after an update of `@playwright/test`, install
   Chromium, Firefox, WebKit, and the system packages that they need. On
   Linux, the command installs the packages with `sudo`:

   ```bash
   npm run test:e2e:install
   ```

1. Run the tests in the three browsers and on the two emulated phones:

   ```bash
   npm run test:e2e
   ```

[Playwright](https://playwright.dev) runs the tests in `e2e/`. Each test
starts its own server on a free port, with a new temporary data directory,
so the tests never touch your data. The settings are in
`playwright.config.js`, which names a project for each browser and phone.

To run the tests of one project, or of one file, pass it after `--`:

```bash
npm run test:e2e -- --project=chromium
npm run test:e2e -- e2e/week.spec.js
```

If you change `Dockerfile`, `deploy/compose.yaml`, `scripts/`, or `server/`,
also build and test the image, and then run the host scripts on it:

```bash
npm run test:image
npm run test:host
```

If you change `deploy/systemd/`, also verify the units with
`systemd-analyze`:

```bash
npm run test:units
```

## Continuous integration

GitHub Actions runs three checks on every pull request and on every push to
`main`. The workflow is in `.github/workflows/ci.yml`:

- `ci` runs `npm run lint`, `npm test`, and `npm run test:units` with
  Node.js 22.
- `e2e` runs `npm run test:e2e` with Node.js 22. A test that fails runs
  once more with a trace, and a test that passes only on that retry still
  fails the check. When the check fails, it uploads the Playwright report as
  the `playwright-report` artifact, which GitHub keeps for 7 days.
- `image` runs `npm run test:image` and `npm run test:host`.

`.github/workflows/host.yml` runs `host` on pull requests that change
`.github/workflows/host.yml`, `deploy/`, or `scripts/`, every Monday at
05:17 UTC, and when you run it by hand. `host` runs
`scripts/host-acceptance.sh` on a GitHub-hosted runner, a new virtual
machine for each job. The script installs the host tools for real, and
checks them with the published releases from GitHub and GHCR: the
installation and the timers, a second installation, moving the data of an
earlier installation in, a deployment by hand and the resume, a backup and a
restore, the restore check, a deployment that can't pull its image, and the
app after the Docker daemon restarts. The weekly run catches changes outside
the repository, such as a new runner image or a change in GitHub or GHCR.
`host` isn't a required check, because its path filter skips most pull
requests.

You can't run `scripts/host-acceptance.sh` on your own machine, because it
installs Meals for real. It refuses to run unless `GITHUB_ACTIONS` is
`true`, it runs as root, and `/opt/server/meals` doesn't exist. To run
`host` by hand, run `gh workflow run host.yml --ref BRANCH`, where `BRANCH`
is the branch to check.

On every pull request, `.github/workflows/conventional.yml` also runs
`conventional`. It checks that the pull request title and every commit
except merge commits follow
[Conventional Commits](https://www.conventionalcommits.org), because the
commit type decides releases.

Changes reach `main` only through pull requests that pass `ci`, `image`, and
`conventional`.
Each pull request merges with a merge commit.

On every push to `main`, `.github/workflows/release.yml` keeps a release
pull request up to date, and publishes a release when you merge it. See
[Release a version](docs/deployment.md#release-a-version).

Every week, Dependabot opens pull requests that update the npm
dependencies, the GitHub Actions, and the base image. The settings are in
`.github/dependabot.yml`.

## Project structure

```none
.github/
  workflows/
    ci.yml              # Continuous integration: lint, tests, and the image.
    conventional.yml    # Checks pull request titles and commit subjects.
    host.yml            # Installs the host tools on a disposable runner and checks them.
    release.yml         # Releases: release-please, and the image in GHCR.
  dependabot.yml        # Weekly dependency updates.
deploy/
  systemd/              # The host's timers and their services.
  compose.yaml          # The app service on the host.
docs/
  deployment.md         # Releases, deployments, and backups.
  glossary.md           # The terms the app uses.
e2e/               # Browser tests: Playwright, with a server per test.
public/            # User interface: HTML, CSS, and JavaScript, with no framework or build step.
  app.js               # Meal plan page: grid, week changes, and saves.
  catalog-list.js      # List logic shared by the Recipes and Ingredients pages.
  combobox.js          # The filter-and-pick field of the editors.
  dates.js             # Date helpers.*
  dom.js               # DOM helpers shared by the pages.
  editor-dialog.js     # The dialog lifecycle shared by the recipe and ingredient editors.
  http.js              # Requests with a timeout.*
  index.html           # Meal plan page.
  ingredient-editor.js # The ingredient editor dialog.
  ingredients.html     # Ingredients page.
  ingredients.js       # Ingredients page logic.
  menus.js             # Menu functions.*
  messages.js          # Message text shared by the recipe and ingredient pages.*
  name-search.js       # Name matching and sorting.*
  quantities.js        # Quantity parsing and shopping list arithmetic.*
  recipe-editor.js     # The recipe editor dialog.
  recipes.html         # Recipe book page.
  recipes.js           # Recipe book page logic.
  saves.js             # Save logic.*
  shopping-dialog.js   # The shopping list dialog.
  shopping-list.js     # Computes the shopping list.*
  slot-editor.js       # The slot editor dialog.
  styles.css
scripts/
  lib/
    common.sh           # Functions shared by the meals-* scripts.
  check-conventional.sh # Checks subjects against Conventional Commits.
  host-acceptance.sh    # Installs the host tools for real on a runner and checks them.
  host-smoke.sh         # Runs the meals-* scripts on an image and checks them.
  image-smoke.sh        # Runs an image as the host does and checks it.
  install.sh            # Installs the host tools.
  meals-backup          # Backs up the data.
  meals-deploy          # Deploys a release, with a rollback.
  meals-restore         # Restores a backup.
  meals-restore-check   # Checks that the latest backup restores.
  units-check.sh        # Verifies the systemd units with systemd-analyze.
server/
  app.js         # HTTP API (Express), static files, and the health check.
  errors.js      # Errors for bad input, which app.js maps to HTTP statuses.
  files.js       # JSON files and the write queue. The only module that touches disk.
  healthcheck.js # The image's health check.
  index.js       # Startup: reads DATA_DIR and PORT, and stops on SIGINT and SIGTERM.
  ingredients.js # The ingredient catalog: unique names, units, measures, and archiving.
  logger.js      # Logs one JSON object per line.
  names.js       # Name rules shared by recipes and ingredients.
  quantities.js  # Quantity limits shared by recipes and measures.
  recipes.js     # The recipe book: unique names, ingredients, and archiving.
  shapes.js      # Shape checks shared by the stores.
  shutdown.js    # Stops the server once, within a deadline.
  start.js       # Listens, and stops without cutting a request or a write.
  stores.js      # Wires the stores to one write queue and to each other.
  weeks.js       # Weeks and the menu of each slot.
test/              # Tests: node:test, with supertest for the API and happy-dom for the pages.
  stubs/           # Stub docker and curl for the host script tests.
.dockerignore      # What the image build can read.
.release-please-manifest.json # The current version, for release-please.
.shellcheckrc      # ShellCheck settings.
biome.json         # Lint and format settings.
CHANGELOG.md       # The changes in each release.
Dockerfile         # The server image.
playwright.config.js # Browser test settings.
release-please-config.json # release-please settings.
```

`*` No DOM access, so tests import the module directly in Node.js.

## API reference

The user interface depends only on this API. All responses are JSON. Errors
have the shape `{ "error": "MESSAGE" }`. Any other path under `/api` returns
`404`. If a data file contains invalid JSON, the requests that read it return
`500`.

The server cleans every name that it receives, of a recipe, an ingredient,
or a measure: it trims the name and collapses runs of whitespace. A valid
name is a string with 1 to 100 characters after cleaning.

A recipe has the shape `{ "id", "name", "archived", "ingredients" }`,
where `ingredients` is a list of `{ "ingredientId", "quantity" }`, with
`"measureId"` too for a quantity in a measure. An ingredient has the shape
`{ "id", "name", "unit", "measures", "archived" }`, where `measures` is an
ordered list of `{ "id", "name", "amount" }`, with each `amount` in the
ingredient's unit.

A week is identified by the date of its Monday, formatted as `YYYY-MM-DD`, for
example `2026-09-21`. Each slot of a week holds a menu:

```json
{ "items": [{ "recipeId": "RECIPE_ID", "servings": 1.5 }] }
```

### Check the health

`GET /api/health`

| Status | Meaning |
|--------|---------|
| `200`  | The body is `{ "status": "ok", "version": "VERSION" }`, where `VERSION` is the version of the server, such as `0.1.0`. The server can read, write, and enter the data directory. |
| `503`  | The body is `{ "status": "error", "version": "VERSION" }`. The server can't read, write, or enter the data directory, and it logs `health check failed` with the error code. |

### List recipes

`GET /api/recipes`

| Status | Meaning |
|--------|---------|
| `200`  | The body is `{ "recipes": [...] }`, with every recipe, archived ones included, sorted from A to Z ignoring case and accents. |

### Add a recipe

`POST /api/recipes`

Request body:
`{ "name": "NAME", "ingredients": [{ "ingredientId": "ID", "quantity": 1.5 }] }`,
where `ingredients` is optional and defaults to `[]`. A line can also have
`"measureId": "MEASURE_ID"`.

| Status | Meaning |
|--------|---------|
| `201`  | The body is the new recipe. |
| `400`  | `name` is missing or invalid, the body has other fields, or `ingredients` breaks the rules below. |
| `409`  | Another recipe, active or archived, has the same name, ignoring case and accents. The body is `{ "error", "recipe" }`, where `recipe` is that recipe. |

### Change a recipe

`PATCH /api/recipes/ID`

Request body: `{ "name" }`, `{ "ingredients" }`, or both, to change the
recipe, or `{ "archived": true }` or `{ "archived": false }`, alone, to
archive or restore it.

| Status | Meaning |
|--------|---------|
| `200`  | The body is the updated recipe. |
| `400`  | The body mixes `archived` with other fields, has no known field, has other fields, or has an invalid value. |
| `404`  | No recipe has that ID. |
| `409`  | Another recipe, active or archived, has the same name, ignoring case and accents. The body is `{ "error", "recipe" }`. |

`ingredients` is valid when all the following are true:

- It's an array of at most 50 entries.
- Each entry has the keys `ingredientId` and `quantity`, and optionally
  `measureId`.
- Each `ingredientId` is an existing ingredient, archived or not, and
  appears once.
- Each `measureId` is the ID of a measure of that ingredient. A line without
  `measureId` is in the ingredient's unit.
- Each `quantity` is a number from 0.01 to 10000 with at most two
  decimals.

The server stores each quantity rounded to two decimals. Responses leave out
a line whose ingredient or measure isn't in the catalog.

### List ingredients

`GET /api/ingredients`

| Status | Meaning |
|--------|---------|
| `200`  | The body is `{ "ingredients": [...] }`, with every ingredient, archived ones included, sorted from A to Z ignoring case and accents. |

### Add an ingredient

`POST /api/ingredients`

Request body:
`{ "name": "NAME", "unit": "UNIT", "measures": [{ "name": "NAME", "amount": 150 }] }`,
where `UNIT` is `g`, `ml`, or `pcs`, and `measures` is optional and defaults
to `[]`. The server gives each measure an ID.

| Status | Meaning |
|--------|---------|
| `201`  | The body is the new ingredient. |
| `400`  | `name` or `unit` is missing or invalid, the body has other fields, or `measures` breaks the rules below. |
| `409`  | Another ingredient, active or archived, has the same name, ignoring case and accents. The body is `{ "error", "ingredient" }`. |

### Change an ingredient

`PATCH /api/ingredients/ID`

Request body: any combination of `name`, `unit`, `measures`, and
`conversion`, to change the ingredient, or `{ "archived": true }` or
`{ "archived": false }`, alone, to archive or restore it.

| Status | Meaning |
|--------|---------|
| `200`  | The body is the updated ingredient. |
| `400`  | The body mixes `archived` with other fields, has no known field, has other fields, or has an invalid value, such as `measures` or `conversion` that break the rules below. |
| `404`  | No ingredient has that ID. |
| `409`  | Another ingredient, active or archived, has the same name, ignoring case and accents, and the body is `{ "error", "ingredient" }`. Or `measures` leaves out a measure that a recipe, active or archived, uses, and the body is `{ "error" }`. |

`measures` replaces the whole list, so the server removes a measure that the
list leaves out. It's valid when all the following are true:

- It's an array of at most 20 entries.
- Each entry is `{ "name", "amount" }` for a new measure, which the server
  gives an ID, or `{ "id", "name", "amount" }` for one of the ingredient's
  measures, which keeps its ID.
- Each `name` is a valid name, and is unique within the list, ignoring case
  and accents. It can be the name of a unit, such as `g`.
- Each `amount` is a number from 0.01 to 10000 with at most two decimals, in
  the unit that the ingredient has after the save.

A unit change needs `conversion` when the ingredient has measures, or when a
recipe, active or archived, uses it in its old unit. `conversion` is
`{ "from", "to", "measureName" }`: `from` of the old unit equal `to` of the
new unit, and both are numbers from 0.01 to 10000 with at most two decimals.
`measureName` names the measure that replaces the old unit in recipes, and
is required only when a recipe uses the old unit.

With a conversion, the server multiplies the amount of every measure by
`to ÷ from`, and rounds it to two decimals. If a recipe uses the old unit,
the server also adds the measure `measureName` with an amount of `to ÷ from`,
and points those recipe lines to it, so they keep their meaning. If the
ingredient already has a measure with that name, ignoring case and accents,
and an amount of `1`, the
server uses that measure instead, so you can retry a unit change that failed
halfway. For example,
`{ "unit": "g", "conversion": { "from": 1, "to": 120, "measureName": "piece" } }`
on an ingredient in `pcs` turns `2` in a recipe into `2 piece`, which is
240 g.

The server returns `400`, and changes nothing, in the following cases:

- `conversion` is missing when the change needs it, or present when it
  doesn't.
- The body has `conversion` without a new `unit`, or with `measures`.
- A recipe uses the old unit, and `measureName` is missing, is invalid, or
  matches a measure whose amount isn't `1`, ignoring case and accents.
- A recipe uses the old unit, `measureName` matches no measure, and the
  ingredient already has 20 measures.
- Any converted amount, before rounding, falls outside 0.01 to 10000.

### Get a week

`GET /api/weeks/WEEK`

| Status | Meaning |
|--------|---------|
| `200`  | The body is the full week. It contains the days `mon` through `sun`. Each day contains the meals `breakfast`, `snack_am`, `lunch`, `snack_pm`, and `dinner`, and each meal is a menu. An empty slot is `{ "items": [] }`. |
| `404`  | `WEEK` isn't a valid week identifier. |

### Save a slot

`PUT /api/weeks/WEEK/DAY/MEAL`

Request body: `{ "items": [{ "recipeId": "RECIPE_ID", "servings": 1.5 }] }`

| Status | Meaning |
|--------|---------|
| `200`  | The slot was saved. The body is `{ "week", "day", "meal", "items" }`. |
| `400`  | The body breaks one of the following rules. |
| `404`  | `WEEK`, `DAY`, or `MEAL` isn't a valid identifier. |

- `items` is an array of at most 20 menu items.
- Each menu item has exactly the keys `recipeId` and `servings`.
- Each `recipeId` is an existing recipe, archived or not, and appears once.
- Each `servings` is a multiple of 0.5 from 0.5 to 99.
