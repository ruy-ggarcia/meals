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
- `curl`, which `npm run lint` uses to download actionlint and hadolint. The
  download supports only Linux on x86-64.
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
   {"time":"2026-10-04T10:00:00.000Z","level":"info","msg":"server started","version":"0.1.0","port":3000,"dataDir":"/path/to/meals/data","assistant":"off"}
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

The app asks the same question before it opens another page, such as
**Recipes** or **Ingredients**. On a computer, the browser also asks before
you close or reload the tab while a slot isn't saved.

A phone doesn't ask before you close the tab or reload the page. The app
tries to save a slot when the page goes to the background, but a change that
couldn't be saved can be lost. Before you close the app on a phone, check
that no slot shows **Retry**.

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

## Change the settings

**Settings** has two sections: **Assistant** holds the family preferences,
and **BYOK**, for bring your own key, sets up the assistant with your key of
a provider.

The family preferences are a text of up to 10,000 characters, such as
dietary rules and who eats away from home. The assistant reads this text in
every conversation, and a change applies from the next message. You can
edit the text while the assistant is off. While it's off, the **Assistant**
section says "Needs a valid API key to turn on."

To change the family preferences, do the following:

1. Click the gear button at the end of the toolbar of any page, in the
   upper right corner. On the meal plan, it's after **Shopping list**.
1. Under **Assistant**, edit the text under **Family preferences**. When
   fewer than 1,000 characters remain, a count under the text shows how
   many are left.
1. Click **Done**.

The **BYOK** section holds the assistant's provider, API key, and model. To
set up the assistant, do the following:

1. Click the gear button of **Settings**.
1. Under **BYOK**, choose **Anthropic** or **OpenAI** under **Provider**.
1. Paste the key from the provider's console under **API key**. The app
   asks the provider for its models with the key, without saving the key.
1. Under **Model**, choose a model from the list that the provider sends,
   newest first.
1. Click **Done**.

**Model** lists the models of the provider that can chat. A list that
arrives proves that the provider accepts the key, and until it arrives, you
can't choose a model. When **Settings** opens with a saved key, the app asks
for the list again with the saved key. The section says what went wrong
under **Model**:

- "The provider didn't accept this key." when the provider rejects the key.
- "This key has no models that can chat." when the list is empty.
- "Couldn't check the key." when the app can't reach the provider. Click
  **Check Again** to ask again.

A saved model that the list no longer holds shows as "(not available)",
selected, so you see what's saved. If you change the provider, enter a key
for it: the app never sends the saved key to another provider.

**Done** saves the family preferences and the **BYOK** section, each only
when it changed. If the **BYOK** section has a problem, such as a model that
isn't from the list, **Done** saves nothing and says what to fix. A saved
key that the app couldn't check doesn't keep you from saving the family
preferences. If a save fails, **Settings** stays open and shows why under
its section. When a save turns the assistant on or off, the page shows or
hides the assistant's round button at once, without a reload.

**Settings** never shows the key again. Once a key is saved, the **BYOK**
section says "A key is saved." instead of the key field, with two buttons:

- **Replace Key** shows an empty key field for a new key. If you leave it
  empty, the saved key stays.
- **Remove Key** removes the key when you click **Done**, which turns off
  the assistant. Until then, **Keep Key** undoes it.

When the server sets up the assistant with its environment variables, the
**BYOK** section shows the provider and the model, says "Set on the
server.", and can't change them. See
[Configure the server](#configure-the-server).

To close **Settings** without saving, click **Cancel** or press `Escape`.

## Ask the assistant

The assistant is a chat that plans menus and proposes changes to recipes and
ingredients. It saves nothing until you apply its changes. When the
assistant is set up, a round button in the lower right corner of every page
opens it. On a phone, the button sits on the line of the tab bar, to its
right. With a keyboard, press `Tab` once at the start of any page to reach
**Ask the assistant**, which opens it too. To set up the assistant, see
[Change the settings](#change-the-settings).

To ask the assistant, do the following:

1. Click the round button.
1. On a touch screen, the window opens without the on-screen keyboard: tap
   the message field. Type your message, such as `Plan next week`. On the
   meal plan, the assistant knows which week you see. An empty conversation
   shows a few examples: click one to put it in the message field, and then
   edit it or send it.
1. Optional: to attach files, such as a school menu, click the paper clip
   button. You can attach up to 5 PDF, JPEG, or PNG files, and up to 20 MB
   in one conversation. Each PDF can have up to 10 MB, and each JPEG or PNG
   image up to 7 MB. To remove a file before you send it, click the button
   next to its name.
1. Press `Enter`, or click the send button with the up arrow. To add a line
   without sending, press `Shift+Enter`.

The round button is hidden while the window is open. On a wide screen, the
window opens in the lower right corner, and the page behind it stays usable.
When the meal plan keeps room for all seven days beside the window, such as
on a laptop with the sidebar hidden, the page makes room for the window,
which can narrow a little to fit. On a phone, and on a screen 500 px tall
or less, such as a phone in landscape, the window opens as a sheet over the
dimmed page, and the page behind it takes no taps until you collapse the
window.

While the assistant answers, the window shows "Thinking…", and you can type
but not send. If the answer fails, click **Retry** to ask again. When the
conversation is too long for the assistant, the window offers **New
conversation** instead of **Retry**.

The changes that the assistant proposes are pending changes. A card above the
message field summarizes them: how many slots of each week change, and each
recipe and ingredient to create, change, archive, or restore. On a screen
500 px tall or less, the card shows these counts in one line. To see each
change, click **View details**, which lists the changes under the lines of
the summary. Then do one of the following:

- To save every pending change, click **Apply**. The conversation shows what
  the app saved, such as "Applied: 35 slots, 4 recipes, and 6 ingredients.",
  with a link to each week of the menus that the meal plan doesn't show. On
  a phone, the link shows the first day of that week whose menu changed.
  When the window is a sheet, the link also collapses it, so you see the
  week. The page shows the new data without a reload. On the meal plan, if a
  slot isn't saved yet, or the slot editor or the shopping list is open, the
  new data shows when you change the week. If someone changed a slot, a
  recipe, or an ingredient by hand after the assistant proposed a change to
  it, the app saves nothing, and **View details** shows the problem on that
  change. Tell the assistant about it in your next message. If **Apply**
  fails after it saved part of the changes, the card says so: check the meal
  plan before you apply again, or click **Discard**.
- To drop every pending change, click **Discard**. If there are more than
  three pending changes, the app asks first. The conversation shows that you
  discarded them.

To collapse the window, click the button with the down arrow or press
`Escape`. On a phone in landscape, you can also tap the dimmed page above
the sheet. The round button shows again. The conversation stays, also when
you open another page. The window stays open on the other pages that you
open in the same tab, and a new visit, such as opening the app from the Home
Screen again, starts with the window collapsed. While the window is
collapsed, a red mark on the round button shows a reply that you haven't
seen or pending changes.

To start over, click **New conversation**, the button with the pencil. If
the conversation has pending changes, the app asks first, because a new
conversation loses them. A conversation also ends after 24 hours without a
message, **Apply**, or **Discard**, and when the server restarts.

## Configure the server

The server reads the following environment variables:

| Variable             | Default  | Description                                             |
|----------------------|----------|---------------------------------------------------------|
| `ASSISTANT_API_KEY`  | None     | The API key of the assistant's provider.                |
| `ASSISTANT_MODEL`    | None     | The identifier of the model at the provider.            |
| `ASSISTANT_PROVIDER` | None     | The provider of the assistant: `anthropic` or `openai`. |
| `DATA_DIR`           | `./data` | The data directory. See [Data files](#data-files).      |
| `PORT`               | `3000`   | The port that the server listens on.                    |

You can set up the assistant in **Settings** instead of with the three
`ASSISTANT_` variables. When all three are set, they take precedence over
**Settings**. If only some of them are set, `ASSISTANT_PROVIDER` isn't
`anthropic` or `openai`, or `ASSISTANT_MODEL` looks like an API key, the
server logs `assistant not configured` with the problem, and uses the
settings saved in **Settings** instead. The assistant is off until the
variables or the settings have a provider, a model, and a key. No response
or log of the server holds the API key.

The `server started` log line has `assistant`, which is `anthropic`,
`openai`, or `off`, and, when the assistant is on, `source`, which is
`environment` or `settings`.

For example, to store data in `/srv/meals` and listen on port 8080, run the
following command:

```bash
DATA_DIR=/srv/meals PORT=8080 npm start
```

The image sets `DATA_DIR` to `/data` and `PORT` to `3000`. See
[Deploy Meals](docs/deployment.md).

## Data files

The meal plan, the recipe book, the ingredient catalog, the family
preferences, and the assistant's settings live in the `v2/` directory inside
the data directory, which is `data/` unless you set `DATA_DIR`:

- `v2/assistant.json` holds the assistant's settings from **Settings**, as
  `{ "provider", "model", "apiKey" }`, where `apiKey` is `null` when no key
  is saved. The file holds the key in plain text, so backups include it.
- `v2/ingredients.json` holds the ingredient catalog.
- `v2/preferences.json` holds the family preferences, as `{ "text": "..." }`.
- `v2/recipes.json` holds the recipe book.
- `v2/weeks/` holds one file per week, named after the week's Monday, for
  example `v2/weeks/2026-09-21.json`. The server creates a week's file on
  the first save in that week.

Git ignores the `data/` directory.

On the host, backups are automatic. See
[Backups](docs/deployment.md#backups).

If a week file, `preferences.json`, `recipes.json`, or `ingredients.json`
contains invalid JSON, the app shows an error, such as
`Couldn't load the meal plan.`, and doesn't overwrite the file. For an
invalid `preferences.json`, a click on the gear button of **Settings**
shows `Couldn't load the settings. Try again.` at the top of the page, and
the assistant can't answer. To recover, do the following:

1. Restore a backup copy of the file, or fix the JSON by hand.
1. In the app, click **Retry**. For the family preferences, click the gear
   button again.

If `assistant.json` isn't valid, and the `ASSISTANT_` variables don't set up
the assistant, the server logs `assistant settings unreadable` when it
starts, without the file's content, and starts with the assistant off.
**Settings** shows `Couldn't load the settings. Try again.` until you fix
the file. The server doesn't overwrite the file. To recover, restore a
backup copy of the file or fix it by hand, and then restart the server.

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

For how the tests are organized and the rules that every test follows, see
[Testing strategy](docs/testing.md).

Before you commit, check your changes:

1. Apply the code format and safe lint fixes:

   ```bash
   npm run format
   ```

1. Check the code style, the workflows, and the `Dockerfile`. This command
   changes no files except `.tools/`, and it fails if the code has lint
   errors or isn't formatted:

   ```bash
   npm run lint
   ```

1. Check the types of the JavaScript. This command changes no files:

   ```bash
   npm run typecheck
   ```

1. Run the tests:

   ```bash
   npm test
   ```

[Biome](https://biomejs.dev) checks the style of JavaScript, CSS, and JSON
files. The settings are in `biome.json`.
[ShellCheck](https://www.shellcheck.net) checks the shell scripts. The
settings are in `.shellcheckrc`.
[actionlint](https://github.com/rhysd/actionlint) checks the workflows in
`.github/workflows/`, and [hadolint](https://github.com/hadolint/hadolint)
checks the `Dockerfile`. `npm run lint` runs `scripts/install-lint-tools.sh`
first. The script downloads the pinned version of each tool from its GitHub
release into `.tools/bin`, which Git ignores, and checks the SHA-256
checksum of the download. It skips a tool that's already installed. To
ignore a hadolint rule, add a comment next to the instruction that explains
why.

[TypeScript](https://www.typescriptlang.org) checks the types of the
JavaScript without compiling it: the app stays plain JavaScript. It reads
the JSDoc comments in the `.js` files of `e2e/`, `public/`, `server/`, and
`test/`, and in `playwright.config.js`. A
`@param`, `@returns`, `@typedef`, or `@type` comment gives a function or a
value the type that TypeScript can't infer. The settings are in
`tsconfig.json`, and `tsconfig.browser.json` and `tsconfig.tests.json`
extend it. `npm run typecheck` checks three sets of files, so that the
globals of one environment don't hide a mistake in another: `server/` and
`playwright.config.js` see only the Node.js types, `public/` sees only the
browser types, and `e2e/` and `test/` see both. The check isn't `strict`.
To fix an error, give the code the right type. Use `// @ts-expect-error`
only with a comment that explains why the code is right and the type can't
say so.

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
`playwright.config.js`, which defines five projects: three desktop browsers
and two emulated phones.

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

- `ci` runs `npm run lint`, `npm run typecheck`, `npm test`, and
  `npm run test:units` with Node.js 22. `npm run lint` checks the code, the
  shell scripts, the workflows, and the `Dockerfile`. `npm run typecheck`
  checks the types of the JavaScript.
- `e2e` runs `npm run test:e2e` with Node.js 22 in the
  [Playwright image](https://playwright.dev/docs/docker), which holds the
  browsers and the system packages that they need. A test that fails runs
  once more with a trace, and a test that passes only on that retry still
  fails the check. When the check fails, it uploads the Playwright report as
  the `playwright-report` artifact, which GitHub keeps for 7 days.
- `image` runs `npm run test:image` and `npm run test:host`.

`.github/workflows/host.yml` runs `host` on pull requests that change that
file, `deploy/`, or `scripts/`, every Monday at 05:17 UTC, and when you run
it by hand. `host` runs
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

[CodeQL](https://codeql.github.com) code scanning analyzes every pull
request except Dependabot's, and its `CodeQL` check fails when the pull
request adds an alert on the lines that it changes. An alert on `main`
outside those lines fails no pull request, so `.github/workflows/alerts.yml`
runs `alerts` every day at 06:41 UTC, and when you run it by hand: it fails
while `main` has an open alert.

Changes reach `main` only through pull requests that pass `ci`, `CodeQL`,
`conventional`, `e2e`, and `image`.
Each pull request merges with a merge commit.

On every push to `main`, `.github/workflows/release.yml` keeps a release
pull request up to date, and publishes a release when you merge it. See
[Release a version](docs/deployment.md#release-a-version).

Every week, Dependabot opens pull requests that update the npm
dependencies, the GitHub Actions, and the base image. The settings are in
`.github/dependabot.yml`.

Dependabot doesn't update the Playwright image of the `e2e` job. When it
updates `@playwright/test`, the `ci` check of its pull request fails until
the image has the same version. To update the image in the pull request, do
the following:

1. Check out the pull request's branch:

   ```bash
   gh pr checkout NUMBER
   ```

   Replace `NUMBER` with the number of the pull request.

1. Get the digest of the image of the new version:

   ```bash
   docker buildx imagetools inspect --format '{{.Manifest.Digest}}' mcr.microsoft.com/playwright:vX.Y.Z-noble
   ```

   Replace `X.Y.Z` with the new version of `@playwright/test`.

1. In `.github/workflows/ci.yml`, replace the version in the `image` of the
   `e2e` job with `X.Y.Z`, and its digest with the output of the last
   command. Docker pulls the image by its digest, so a new tag with an old
   digest still runs the old browsers.
1. Commit the change as
   `build(deps-dev): update the Playwright image to X.Y.Z`, and push it.

After your commit, Dependabot no longer rebases the pull request, and a
`@dependabot recreate` comment discards your commit.

## Project structure

```none
.github/
  workflows/
    alerts.yml          # Fails while main has an open code scanning alert.
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
  testing.md            # Testing strategy: the levels of tests and their rules.
e2e/               # Browser tests: Playwright, with a server per test.
public/            # User interface: HTML, CSS, and JavaScript, with no framework or build step.
  app.js               # Meal plan page: grid, week changes, and saves.
  assistant-view.js    # What the assistant's window shows: pending changes, the mark, and attachment checks.*
  assistant.js         # The assistant's button and window: messages, pending changes, and polling.
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
  settings.js          # The Settings dialog: the family preferences and the assistant's settings.
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
  install-lint-tools.sh # Downloads actionlint and hadolint, and checks their checksums.
  install.sh            # Installs the host tools.
  meals-backup          # Backs up the data.
  meals-deploy          # Deploys a release, with a rollback.
  meals-restore         # Restores a backup.
  meals-restore-check   # Checks that the latest backup restores.
  units-check.sh        # Verifies the systemd units with systemd-analyze.
server/
  assistant/
    providers/
      anthropic.js    # The adapter of the Anthropic Messages API.
      errors.js       # The error of a call to a provider.
      http.js         # The HTTP request of the adapters.
      index.js        # The providers: the adapter and the model list of each.
      openai.js       # The adapter of the OpenAI Responses API.
      types.js        # The common shape of a provider and of a conversation.
    config.js         # Reads the assistant's environment variables.
    conversations.js  # Conversations in memory, their turns, and Apply.
    instructions.js   # The system instructions of the model.
    limits.js         # The limits of the data, as the model reads them.
    pending.js        # Pending changes and the data that they would save.
    settings.js       # The assistant's settings from Settings, with the API key.
    setup.js          # The provider, from the environment or the settings.
    tools.js          # The tools that the model calls.
    turn.js           # A turn: model calls and tool calls until an answer.
  app.js         # HTTP API (Express), the pages, static files, and the health check.
  errors.js      # Errors for bad input, which app.js maps to HTTP statuses.
  files.js       # JSON files and the write queue. The only module that touches disk.
  healthcheck.js # The image's health check.
  index.js       # Startup: reads the environment variables, and stops on SIGINT and SIGTERM.
  ingredients.js # The ingredient catalog: unique names, units, measures, and archiving.
  logger.js      # Logs one JSON object per line.
  names.js       # Name rules shared by recipes and ingredients.
  preferences.js # The family preferences: one free text.
  quantities.js  # Quantity limits shared by recipes and measures.
  recipes.js     # The recipe book: unique names, ingredients, and archiving.
  shapes.js      # Shape checks shared by the stores.
  shutdown.js    # Stops the server once, within a deadline.
  start.js       # Listens, and stops without cutting a request or a write.
  stores.js      # Wires the stores to one write queue and to each other.
  weeks.js       # Weeks and the menu of each slot.
test/              # Tests: node:test, with supertest for the API and happy-dom for the pages.
  hooks/           # Code that tests preload with node --import, such as the time limits.
  stubs/           # Stub docker and curl for the host script tests.
.dockerignore      # What the image build can read.
.release-please-manifest.json # The current version, for release-please.
.shellcheckrc      # ShellCheck settings.
biome.json         # Lint and format settings.
CHANGELOG.md       # The changes in each release.
Dockerfile         # The server image.
playwright.config.js # Browser test settings.
release-please-config.json # release-please settings.
tsconfig.browser.json # Type check settings of public/.
tsconfig.json      # Type check settings of server/, and the base of the others.
tsconfig.tests.json # Type check settings of e2e/ and test/.
```

`*` No DOM access, so tests import the module directly in Node.js.

## API reference

The user interface depends only on this API. All responses are JSON. Errors
have the shape `{ "error": "MESSAGE" }`. A body that isn't valid JSON returns
`400` with a message that doesn't quote the body. Any other path under `/api`
returns `404`. If a data file contains invalid JSON, the requests that read
it return `500`.

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

### Get the family preferences

`GET /api/preferences`

| Status | Meaning |
|--------|---------|
| `200`  | The body is `{ "text": "TEXT" }`. `TEXT` is empty until the first save. |

### Save the family preferences

`PUT /api/preferences`

Request body: `{ "text": "TEXT" }`

| Status | Meaning |
|--------|---------|
| `200`  | The text was saved. The body is `{ "text": "TEXT" }`. |
| `400`  | The body isn't exactly `{ "text": string }`, or the text has more than 10,000 characters. |

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

### Check the assistant

`GET /api/assistant`

| Status | Meaning |
|--------|---------|
| `200`  | The body is `{ "enabled": true }` when the assistant is on, and `{ "enabled": false }` when it's off. |

The routes of the conversations work while the assistant is off, except that
a message or a retry returns `409`.

### Get the assistant's settings

`GET /api/assistant/settings`

| Status | Meaning |
|--------|---------|
| `200`  | The body is `{ "provider", "model", "keySaved", "source" }`. |

- `provider` is `anthropic` or `openai`, and `model` is the model's
  identifier. Both are `null` until the first save.
- `keySaved` is `true` when a key is saved.
- `source` is `environment` when the three `ASSISTANT_` variables set up the
  assistant, and `settings` otherwise. See
  [Configure the server](#configure-the-server).

### List the models of a key

`POST /api/assistant/models`

Request body: `{ "provider": "PROVIDER", "apiKey": "API_KEY" }`, where
`apiKey` is optional. Without `apiKey`, the server uses the saved key, but
only for the provider that it was saved for. The server asks the provider
for its models with the key, so a list that arrives proves that the
provider accepts the key. The key travels in the body, never in the URL.

| Status | Meaning |
|--------|---------|
| `200`  | The body is `{ "models": [{ "id", "name" }] }`, newest first. The list is empty when the key has no models that can chat. |
| `400`  | The body breaks one of the following rules, no key of this provider is saved, or the provider didn't accept the key. |
| `409`  | The three `ASSISTANT_` variables set up the assistant, so the settings can't change. |
| `502`  | The provider failed or didn't answer within 4 seconds. The body is `{ "error": "Couldn't check the key." }`. |

- The body has exactly `provider`, or `provider` and `apiKey`.
- `provider` is `anthropic` or `openai`.
- `apiKey` has 1 to 500 printable ASCII characters, with no spaces.

`id` is the model's identifier at the provider. For Anthropic, `name` is
the model's display name. OpenAI's list has no display names, so `name` is
the identifier, and the list holds only the models that start with `gpt-`
or with `o` and a digit, without the models for audio, realtime, speech,
transcription, images, embeddings, search, and moderation.

### Save the assistant's settings

`PUT /api/assistant/settings`

Request body: `{ "provider": "PROVIDER", "model": "MODEL", "apiKey": "API_KEY" }`,
where `apiKey` is optional. Without `apiKey`, the saved key stays. With
`"apiKey": null`, the server removes the key, keeps the provider and the
model, and turns off the assistant. The next message uses the new settings,
and an answer in progress finishes with the old ones. The server logs
`assistant settings changed` with the provider and the model.

Unless the body removes the key, the server first asks the provider for its
models with the key, as `POST /api/assistant/models` does, and saves only
when the list holds the model. Without `apiKey`, it asks with the saved key,
which must be a key of the same provider. So the saved settings always have
a key that the provider accepted.

| Status | Meaning |
|--------|---------|
| `200`  | The settings were saved. The body is what `GET /api/assistant/settings` returns. |
| `400`  | The server saved nothing: the body breaks one of the following rules, no key of this provider is saved, the provider didn't accept the key, or the provider's list doesn't hold the model. |
| `409`  | The three `ASSISTANT_` variables set up the assistant, so the settings can't change. |
| `502`  | The server saved nothing: the provider failed or didn't answer within 4 seconds. The body is `{ "error": "Couldn't check the key." }`. |

- The body has exactly `provider` and `model`, or `provider`, `model`, and
  `apiKey`.
- `provider` is `anthropic` or `openai`.
- `model` has 1 to 200 characters, with no control characters.
- `apiKey` is `null`, or 1 to 500 printable ASCII characters with no spaces.

### Start a conversation

`POST /api/assistant/conversations`

| Status | Meaning |
|--------|---------|
| `201`  | The body is `{ "id": "ID" }`. When the server already keeps 20 conversations, the one with the oldest activity ends. |

### Get a conversation

`GET /api/assistant/conversations/ID`

| Status | Meaning |
|--------|---------|
| `200`  | The body is the conversation. The server doesn't log a successful request. |
| `404`  | No conversation has that ID, for example because it expired after 24 hours without activity, or because the server restarted. |

The server keeps each conversation in memory. A conversation has the shape
`{ "id", "status", "error", "messages", "pending", "revision" }`:

- `status` is `idle`, `working` while the assistant answers, or `failed`
  when the last message failed.
- `error` is only present when `status` is `failed`: `limit` when the turn
  ran for 30 tool rounds or 3 minutes, `too_long` when the conversation is
  too long for the model, or `provider` for any other failure, such as a
  rejected API key or no network.
- `messages` is a list of the messages and the events of the conversation,
  in order. A message is `{ "role", "text" }`, where `role` is `user` or
  `assistant`. A user message can also have `"attachments"`, the names of its
  files, and `"failed": true`. An event is `{ "role": "event", "kind" }`,
  where `kind` is `discarded` after a discard, or `applied` after an apply.
  A discard or an apply without pending changes adds no event. An `applied`
  event also has `"counts"`, `{ "slots", "recipes", "ingredients" }`, how
  many of each the apply saved, and `"weeks"`, the weeks of its menus, from
  the earliest, as `[{ "week", "day" }]`, where `day` is the first day of the
  week whose menu changed. The assistant never reads the events.
- `pending` is the list of pending changes, each with a `target`, a `kind`
  of `menu`, `recipe`, or `ingredient`, the names of the recipes and
  ingredients that it uses, and a `problem` after a rejected apply.
- `revision` is `0` in a new conversation, and grows each time the list of
  pending changes changes, such as when the assistant proposes a change, or
  when you apply or discard the pending changes.

### Send a message

`POST /api/assistant/conversations/ID/messages`

Request body:
`{ "text": "TEXT", "attachments": [{ "name": "NAME", "data": "BASE64" }], "week": "WEEK", "today": "DATE" }`,
where `attachments` is optional and defaults to `[]`, `week` is the week
that the page shows, also optional, and `today` is the browser's local date
as `YYYY-MM-DD`, also optional. The assistant reads `today` as the current
date when it's at most one day from the server's date, and the server's date
otherwise. This route accepts a body of up to 30 MB; every other route
accepts up to 100 KB.

| Status | Meaning |
|--------|---------|
| `202`  | The assistant answers the message in the background. The body is `{}`. Get the conversation until its `status` isn't `working`. |
| `400`  | The message breaks one of the following rules. |
| `404`  | No conversation has that ID. |
| `409`  | The assistant isn't set up, the assistant is still answering, or the pending changes are being applied. |

- The message has text or at least one attachment.
- Its text has at most 20,000 characters, without the spaces around it.
- It has at most 5 attachments, each with a name of at most 255 characters,
  and with `data` in standard base64.
- Each file is a PDF, a JPEG, or a PNG, as its first bytes show. A PDF has
  at most 10 MB, and a JPEG or a PNG at most 7 MB.
- The attachments of the conversation total at most 20 MB. A new
  conversation frees the space.
- `week` is a valid week identifier.
- `today` is a valid date as `YYYY-MM-DD`.

### Retry a message

`POST /api/assistant/conversations/ID/retry`

| Status | Meaning |
|--------|---------|
| `202`  | The assistant answers the failed message again in the background. The body is `{}`. |
| `404`  | No conversation has that ID. |
| `409`  | The last message didn't fail, the assistant isn't set up, the assistant is still answering, or the pending changes are being applied. |

### Apply the pending changes

`POST /api/assistant/conversations/ID/apply`

Request body: `{ "revision": N }`, where `N` is the `revision` of the
conversation whose pending changes you reviewed.

| Status | Meaning |
|--------|---------|
| `200`  | The server saved every pending change. If there were any, the conversation shows an `applied` event. The body is `{ "applied": true }`. |
| `400`  | `revision` is missing or isn't an integer. |
| `404`  | No conversation has that ID. |
| `409`  | The server saved nothing. If `revision` isn't the current one, because the pending changes changed after you got the conversation, the body is `{ "error": "The pending changes changed. Review them again." }`. If a pending change is invalid against the data as it is now, for example because someone edited its target by hand, the body is `{ "error", "problems" }`, where `problems` is a list of `{ "target", "message" }`, and the conversation keeps its pending changes. Otherwise, the assistant is still answering, or the pending changes are already being applied. |
| `500`  | A write to a data file failed, and the conversation keeps its pending changes. If the server saved part of the changes before the failure, the body also has `"code": "partly_saved"`. |

### Discard the pending changes

`POST /api/assistant/conversations/ID/discard`

| Status | Meaning |
|--------|---------|
| `200`  | The server removed every pending change. If there were any, the conversation shows a `discarded` event. The body is `{}`. |
| `404`  | No conversation has that ID. |
| `409`  | The assistant is still answering, or the pending changes are being applied. |

### End a conversation

`DELETE /api/assistant/conversations/ID`

| Status | Meaning |
|--------|---------|
| `204`  | The conversation ended, and the server canceled its answer in progress. |
| `404`  | No conversation has that ID. |
