# Meals

Meals is a web app for planning a family's meals week by week. It shows one
week at a time as a grid of 7 days by 5 meals (breakfast, morning snack,
lunch, afternoon snack, and dinner). Each slot of the grid holds a menu: a
list of recipes from the recipe book, each with a number of servings.

The app runs on a computer at home. Any device on the same network, desktop or
mobile, can use it from a browser.

The terms that the app uses, such as *slot*, *menu*, and *recipe book*, are
defined in [`docs/glossary.md`](docs/glossary.md).

## Before you begin

Install the following:

- Node.js 22 or later. To check your version, run `node --version`.
- npm. To check that it's installed, run `npm --version`.

## Start the server

1. Install the dependencies:

   ```bash
   npm install
   ```

1. Start the server:

   ```bash
   npm start
   ```

   The server prints a line similar to the following:

   ```none
   Meals listening on http://0.0.0.0:3000 (data: /path/to/meals/data)
   ```

To stop the server, press `Control+C`.

## Open the app

- On the computer that runs the server, go to `http://localhost:3000`.
- On a phone or another device on the home network, do the following:

  1. On the computer that runs the server, find its local IP address:

     ```bash
     hostname -I | awk '{print $1}'
     ```

     The output is an address such as `192.168.1.23`.

  1. On the device, connect to the same Wi-Fi network as the computer.
  1. In the device's browser, go to `http://IP_ADDRESS:3000`, where
     `IP_ADDRESS` is the address from the first step.

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

- **Desktop** (windows 768 px wide or wider): the full grid shows one column
  per day and one row per meal. Each day header shows the weekday and the day
  of the month.
- **Mobile:** the app shows one day at a time. To switch days, tap a day in the
  day bar. Each button shows the weekday letter and the day of the month. When
  the page opens, it shows the current day.

When the displayed week contains today, the app marks today in green. On
desktop, it marks today's column. On mobile, it outlines today's button in the
day bar.

To move between weeks, use the week bar below the title. It shows the dates of
the displayed week:

- `‹` shows the previous week.
- `›` shows the next week.
- **Today** shows the current week. On mobile, it also selects today.

On mobile, changing weeks keeps the selected day. The address bar holds the
displayed week, for example `http://localhost:3000/#2026-09-21`, so a reload
shows the same week and you can bookmark a week.

## Plan a meal

To plan a meal, click or tap its slot. The slot editor opens with the slot's
menu:

- To add a recipe, type part of its name in **Add recipe**. Then click the
  recipe, or select it with the arrow keys and press `Enter`. A menu holds up
  to 20 recipes, and the list offers only recipes that aren't archived or
  already in the menu. To add recipes to the recipe book, use the **Recipes**
  page.
- To change the servings of a recipe, click `−` or `+`. Servings go from 0.5
  to 99 in steps of 0.5. A recipe that you add starts at 1.
- To remove a recipe from the menu, click **Remove**.

To save the menu, click **Done**. To close the editor without saving, click
**Cancel** or press `Escape`. In **Add recipe**, the first `Escape` only
clears the text. Clicking outside the editor closes it only if you haven't
changed anything. If you reload or close the page while the editor has
changes, the browser asks you to confirm.

Below each slot, an icon shows the save status:

| Icon             | Status                                                       |
|------------------|--------------------------------------------------------------|
| Gray clock       | The app is saving the slot.                                  |
| Green check mark | The slot is saved. The icon disappears after a few seconds. |
| Red cross        | The save failed. The slot keeps your menu.                   |

To retry a failed save, select the red cross. To see what an icon means,
hover over it.

Before the app changes weeks, it waits for pending saves. If a slot couldn't
be saved, the app asks whether to leave the week anyway. To stay and retry the
save, click **Cancel**. To discard the unsaved menu and change weeks, click
**OK**. The slot then goes back to its last saved menu.

Changes from other devices don't appear in real time. To see them, reload the
page. If two people edit the same slot, the last save wins.

## Manage recipes

The recipe book holds the recipes that you can add to menus. To open it, click
**Recipes** at the top of the meal plan. To go back, click **Meal plan**.

A recipe is a name of up to 100 characters. Names are unique, ignoring case
and accents, so `Café` and `cafe` are the same name.

- To add a recipe, type its name in **New recipe**, and then press `Enter` or
  click **Add**. To clear the field, press `Escape`. If an archived recipe has
  the name, click **Restore it** to bring that recipe back.
- To rename a recipe, click **Rename**, type the new name, and then press
  `Enter` or click **Save**. To keep the old name, press `Escape` or click
  **Cancel**. The new name appears in every menu that uses the recipe, in
  every week.
- To find a recipe, type part of its name in **Search**.
- To archive a recipe that you no longer use, click **Archive**. The slot
  editor stops offering it, and menus that already use it keep showing it.
  Archived recipes are listed under **Archived**. To bring one back, click
  **Restore**.

You can't delete recipes.

## Configure the server

The server reads the following environment variables:

| Variable   | Default  | Description                           |
|------------|----------|---------------------------------------|
| `DATA_DIR` | `./data` | The directory that stores the meal plan and the recipe book. |
| `PORT`     | `3000`   | The port that the server listens on.  |

For example, to store data in `/srv/meals` and listen on port 8080, run the
following command:

```bash
DATA_DIR=/srv/meals PORT=8080 npm start
```

## Back up and restore data

The meal plan and the recipe book live in the `v2/` directory inside the
data directory, which is `data/` unless you set `DATA_DIR`:

- `v2/recipes.json` holds the recipe book.
- `v2/weeks/` holds one file per week, named after the week's Monday, for
  example `v2/weeks/2026-09-21.json`. The server creates a week's file on
  the first save in that week.

Git ignores the `data/` directory.

To back up your data, copy the directory:

```bash
cp -r data/v2 "meals-backup-$(date +%F)"
```

If a week file or `recipes.json` contains invalid JSON, the app shows an
error, such as `Couldn't load the meal plan.`, and doesn't overwrite the file.
To recover, do the following:

1. Restore a backup copy of the file, or fix the JSON by hand.
1. In the app, click **Retry**.

If you restore an older `recipes.json`, menu items whose recipe it doesn't
have disappear from the grid. They come back when you restore a recipe book
that has them.

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

Before you merge a change to the user interface, also run the
[manual test plan](docs/manual-test-plan.md).

## Continuous integration

GitHub Actions runs `npm run lint` and `npm test` with Node.js 22 on every pull
request and on every push to `main`. The workflow is in
`.github/workflows/ci.yml`.

Changes reach `main` only through pull requests that pass the `ci` check.
Each pull request merges with a merge commit.

## Project structure

```none
.github/
  workflows/
    ci.yml              # Continuous integration: lint and tests.
docs/
  glossary.md           # The terms the app uses.
  manual-test-plan.md   # Checks that need a person with a browser.
public/            # User interface: HTML, CSS, and JavaScript, with no framework or build step.
  app.js           # Meal plan page: grid, week changes, and saves.
  dates.js         # Date helpers.*
  dom.js           # DOM helpers shared by both pages.
  http.js          # Requests with a timeout.*
  index.html       # Meal plan page.
  menus.js         # Menu functions.*
  messages.js      # Recipe book message text.*
  recipe-search.js # Recipe name matching and sorting.*
  recipes.html     # Recipe book page.
  recipes.js       # Recipe book page logic.
  saves.js         # Save logic.*
  slot-editor.js   # The slot editor dialog.
  styles.css
server/
  app.js           # HTTP API (Express) and static files.
  errors.js        # Errors for bad input, which app.js maps to HTTP statuses.
  files.js         # JSON files and the write queue. The only module that touches disk.
  index.js         # Startup: reads DATA_DIR and PORT and listens on 0.0.0.0.
  recipes.js       # The recipe book: unique names, renaming, and archiving.
  weeks.js         # Weeks and the menu of each slot.
test/              # Tests: node:test, with supertest for the API and happy-dom for the pages.
biome.json         # Lint and format settings.
```

`*` No DOM access, so tests import the module directly in Node.js.

## API reference

The user interface depends only on this API. All responses are JSON. Errors
have the shape `{ "error": "MESSAGE" }`. Any other path under `/api` returns
`404`. If a data file contains invalid JSON, the requests that read it return
`500`.

A recipe has the shape `{ "id", "name", "archived" }`.

A week is identified by the date of its Monday, formatted as `YYYY-MM-DD`, for
example `2026-09-21`. Each slot of a week holds a menu:

```json
{ "items": [{ "recipeId": "RECIPE_ID", "servings": 1.5 }] }
```

### List recipes

`GET /api/recipes`

| Status | Meaning |
|--------|---------|
| `200`  | The body is `{ "recipes": [...] }`, with every recipe, archived ones included, sorted from A to Z ignoring case and accents. |

### Add a recipe

`POST /api/recipes`

Request body: `{ "name": "NAME" }`

| Status | Meaning |
|--------|---------|
| `201`  | The body is the new recipe. The server trims the name and collapses runs of whitespace. |
| `400`  | `name` is missing, isn't a string, is empty, or is longer than 100 characters. |
| `409`  | Another recipe, active or archived, has the same name, ignoring case and accents. The body is `{ "error", "recipe" }`, where `recipe` is that recipe. |

### Change a recipe

`PATCH /api/recipes/ID`

Request body: `{ "name": "NAME" }` to rename the recipe, or
`{ "archived": true }` or `{ "archived": false }` to archive or restore it.

| Status | Meaning |
|--------|---------|
| `200`  | The body is the updated recipe. |
| `400`  | The body doesn't have exactly one of the two fields, or the value is invalid. |
| `404`  | No recipe has that ID. |
| `409`  | Another recipe, active or archived, has the same name, ignoring case and accents. The body is `{ "error", "recipe" }`. |

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
