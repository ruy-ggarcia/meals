# Recipes and menus design

Date: 2026-09-26

## Context and goal

Meals shows one week at a time as a grid of 7 days by 5 meals. Today, each
cell holds free text. Free text can't tell that `Cafe` and `Café` are the
same dish, and it can't carry quantities, so features such as a shopping list
or serving management can't build on it.

**Goal:** each slot of the grid holds a menu: a list of recipes from a shared
recipe book, each with a number of servings. The recipe book has its own page,
where you add, rename, archive, and restore recipes.

A recipe is only a name for now. The data model leaves room to add
ingredients to recipes without another change of format.

### Out of scope

- Ingredients, units, and quantities.
- Shopping lists.
- Moving free-text plans to the new format. The existing data stays on disk,
  untouched, and the app no longer shows it.
- Real-time updates between devices. As today, you reload the page to see
  changes from another device, and the last save wins.

## Glossary

The app uses one name per concept in code, API, storage, user interface, and
documentation. This glossary moves to `docs/glossary.md`, and `AGENTS.md`
gains a rule to use its terms.

| Term | Definition |
|------|------------|
| Archived recipe | A recipe that no longer appears when you add recipes to a menu. Menus that already contain it keep showing it. You can restore it. |
| Day | One of the seven days of a week: `mon`, `tue`, `wed`, `thu`, `fri`, `sat`, or `sun`. |
| Meal | One of the five times of day: `breakfast`, `snack_am`, `lunch`, `snack_pm`, or `dinner`. |
| Meal plan | All the saved weeks. |
| Menu | The content of a slot: an ordered list of menu items, possibly empty. |
| Menu item | A recipe in a menu, with its servings. |
| Recipe | An entry of the recipe book, with a stable ID and a unique name. |
| Recipe book | All the recipes, active and archived. |
| Servings | How many servings of a recipe a menu item has: a multiple of 0.5 from 0.5 to 99. |
| Slot | The meeting point of a day and a meal in a week. It holds a menu. |
| Week | Seven days from Monday to Sunday, identified by the date of its Monday as `YYYY-MM-DD`. |

The word *cell* becomes *slot* everywhere: code, CSS classes, tests, README,
and the manual test plan. The words *dish* and *free text* go away.

## Decisions

| Topic | Decision |
|-------|----------|
| Adding recipes to a menu | Only existing, active recipes. You create recipes on the recipe book page. |
| Removing recipes | No deletion. You archive a recipe and can restore it. |
| Servings | New menu items start at 1. You change servings in steps of 0.5, from 0.5 to 99. |
| Menu order | Menu items keep the order in which you added them. There's no reordering. |
| Duplicates | A menu contains each recipe at most once. |
| Recipe names | Unique, ignoring case and accents, across active and archived recipes. |
| Joining names | Weeks store recipe IDs. The browser joins them with the recipe book. |
| Editing a slot | The grid shows menus read-only. Clicking a slot opens an editor dialog. |
| Saving a slot | Only when you confirm the editor with **Done**. |
| Recipe book | A separate page, `/recipes.html`. |
| Old data | Not converted. New data lives in `data/v2/`, and `data/weeks/` stays untouched. |

## Storage

All the data lives under `DATA_DIR/v2/`. The server never reads or writes
`DATA_DIR/weeks/` or `DATA_DIR/week.json`. The startup move of `week.json`
(`migrateLegacyWeek`) goes away, with its tests.

```none
data/
  v2/
    recipes.json
    weeks/
      2026-09-21.json
  weeks/            # Free-text plans. Kept on disk, never read.
```

### Recipes file

`data/v2/recipes.json`:

```json
{
  "recipes": [
    { "id": "3f2c9a1e-5b7d-4c2a-9e1f-0a6b8c4d2e71", "name": "Gnocchi carbonara", "archived": false }
  ]
}
```

- `id` comes from `crypto.randomUUID()`. It never changes, and it's the only
  field that weeks reference.
- `name` is stored trimmed, with runs of whitespace collapsed to one space. It
  has 1 to 100 characters, counted in UTF-16 code units.
- The *name key* decides uniqueness: the name in Unicode NFD form, without
  combining marks, and in lowercase. `Café` and `cafe` have the same key.
- A missing file is an empty recipe book. A file with invalid JSON makes reads
  fail, and the server never overwrites it.

### Week files

`data/v2/weeks/WEEK.json`:

```json
{
  "mon": {
    "breakfast": {
      "items": [{ "recipeId": "3f2c9a1e-5b7d-4c2a-9e1f-0a6b8c4d2e71", "servings": 1.5 }]
    },
    "snack_am": { "items": [] }
  }
}
```

- Each slot holds a menu object, `{ "items": [...] }`, which matches the
  body of `PUT` and leaves room to grow.
- On read, the store normalizes the data as it does today: missing days,
  meals, or menus become empty menus, and unknown keys are dropped. A menu
  item that isn't an object with a string `recipeId` and a numeric
  `servings` is dropped.
- A missing file is an empty week. A file with invalid JSON makes reads fail,
  and the server never overwrites it.

### Server modules

`store.js` splits into three modules:

- `server/files.js`: the only module that touches disk. It reads JSON files,
  writes them atomically (write to `FILE.tmp`, and then rename), and runs
  every write through one queue, so that two read-modify-write cycles never
  interleave.
- `server/recipes.js`: lists, creates, renames, archives, and restores
  recipes, and enforces unique names.
- `server/weeks.js`: reads a week and saves a slot. Saving checks that every
  `recipeId` exists in the recipe book, inside the same queue.

`server/app.js` receives both through dependency injection,
`createApp({ recipes, weeks })`, so that tests run against a temporary
directory.

## API

All responses are JSON. Errors have the shape `{ "error": "MESSAGE" }`. Any
other path under `/api` returns `404`. The free-text API (`{ "text" }`) goes
away.

### Recipes

`GET /api/recipes`

| Status | Meaning |
|--------|---------|
| `200` | `{ "recipes": [...] }` with every recipe, archived ones included, sorted from A to Z by name key. |

`POST /api/recipes` with body `{ "name": "NAME" }`

| Status | Meaning |
|--------|---------|
| `201` | The body is the new recipe, with `archived: false`. |
| `400` | `name` is missing, isn't a string, is empty after trimming, or is longer than 100 characters. |
| `409` | A recipe with the same name key exists. The body is `{ "error", "recipe" }`, where `recipe` is the existing recipe. |

`PATCH /api/recipes/ID` with body `{ "name": "NAME" }` or
`{ "archived": true }` or `{ "archived": false }`

| Status | Meaning |
|--------|---------|
| `200` | The body is the updated recipe. |
| `400` | The body has neither field, has both, has other fields, or has an invalid value. The name rules are the same as for `POST`. |
| `404` | No recipe has that ID. |
| `409` | Another recipe has the same name key. The body is `{ "error", "recipe" }`. |

A recipe can take a name with its own name key, for example to change `Cafe`
to `Café`.

### Weeks

`GET /api/weeks/WEEK`

| Status | Meaning |
|--------|---------|
| `200` | The full week: days `mon` to `sun`, each with the five meals, each meal a menu `{ "items": [...] }`. Empty slots have `{ "items": [] }`. |
| `404` | `WEEK` isn't a valid week identifier. |

`PUT /api/weeks/WEEK/DAY/MEAL` with body
`{ "items": [{ "recipeId": "ID", "servings": 1.5 }] }`

| Status | Meaning |
|--------|---------|
| `200` | The slot was saved. The body is `{ "week", "day", "meal", "items" }`. |
| `400` | The body is invalid. See the rules below. |
| `404` | `WEEK`, `DAY`, or `MEAL` isn't a valid identifier. |

The body is valid when all the following are true:

- `items` is an array of at most 20 menu items.
- Each menu item is an object with exactly the keys `recipeId` and
  `servings`.
- Each `recipeId` is the ID of an existing recipe, archived or not. A menu
  that already holds an archived recipe must stay savable. The editor, not
  the server, keeps archived recipes from being added.
- No `recipeId` appears twice.
- Each `servings` is a number, a multiple of 0.5, from 0.5 to 99.

## Interaction rules

These rules apply to every edit in the app: the slot editor, renaming a
recipe, and adding a recipe.

1. **Enter or the confirm button confirms** the innermost edit.
1. **Escape or the Cancel button discards** the innermost edit and restores
   the previous value.
1. **Leaving never discards changes.** Moving focus away or clicking outside
   closes an edit only when it has no changes. An edit with changes stays
   open, with what you typed, until you confirm or cancel it.

| Action | Slot editor | Renaming a recipe | Adding a recipe |
|--------|-------------|-------------------|-----------------|
| Enter or confirm | **Done** saves the menu and closes the editor. | **Save** saves the name and closes the field. | **Add** creates the recipe. |
| Escape or Cancel | **Cancel** closes the editor without saving. | **Cancel** closes the field without saving. | Escape clears the field. |
| Leaving, without changes | Clicking outside closes the editor. | Moving focus away closes the field. | Nothing happens. |
| Leaving, with changes | Nothing happens: the editor stays open. | Nothing happens: the field stays open. | Nothing happens: the text stays. |

## Meal plan page

### Loading

Each time a week loads, the page requests `GET /api/weeks/WEEK` and
`GET /api/recipes` in parallel, each with the 5-second timeout that requests
already use. Loading the recipe book with every week picks up recipes added on
the recipe book page without a reload. If either request fails, the page
shows `Couldn't load the meal plan.` with **Retry**, as today.

The header gains a **Recipes** link to `/recipes.html`, next to the week bar.

### Slots

Each slot is a button that lists its menu items, one per line, as
`Gnocchi carbonara × 3.5`. An empty slot shows `+ Add`. The status icon stays
below the slot and works as today, including retrying with the red cross. A
menu item whose `recipeId` isn't in the recipe book shows `Unknown recipe`.

### Slot editor

Clicking a slot opens a modal `<dialog>`. On desktop it's a centered dialog.
On mobile it fills the screen.

```none
┌──────────────────────────────────────────────┐
│ Friday, Sep 25 · Lunch                       │
│                                              │
│ Gnocchi carbonara       [−] 3.5 [+] [Remove] │
│ Green salad             [−]  2  [+] [Remove] │
│                                              │
│ Add recipe: [ sal…                        ]  │
│   └ Russian salad                            │
│                                              │
│                          [Cancel]  [Done]    │
└──────────────────────────────────────────────┘
```

- The title shows the day, the date, and the meal.
- Each menu item shows the recipe name, `−` and `+` buttons around the
  servings, and **Remove**. The `−` button is disabled at 0.5 and `+` at 99.
  Buttons have accessible names such as
  `Increase servings of Gnocchi carbonara`.
- The **Add recipe** field filters recipes as you type, ignoring case and
  accents. It offers only active recipes that aren't in the menu yet, sorted
  from A to Z by name key. You pick a recipe by clicking it, or with the arrow
  keys and Enter. The new menu item has 1 serving. With no matches, it shows
  `No recipes found. Add them on the Recipes page.`
- A menu can't have more than 20 menu items. At 20, the **Add recipe** field
  is disabled.
- Escape in the **Add recipe** field clears it when it has text. When it's
  empty, Escape cancels the editor. Enter in the field adds the highlighted
  recipe and doesn't confirm the editor.
- The editor works on a copy of the slot's menu. **Done** copies it back to
  the slot and starts the save. **Cancel** throws the copy away.
- Clicking the backdrop closes the editor only when the copy equals the
  menu it started from.
- Android's **Back** acts as Escape and cancels the editor.
- When the editor closes, focus returns to the slot.
- While the editor is open, a change of the URL hash is undone, so the week
  never changes behind the editor.
- While the editor has unconfirmed changes, reloading or closing the page
  shows the browser's standard warning (`beforeunload`).

### Saving

`saves.js` keeps its behavior and changes only the value it saves: a menu
instead of text.

- `readText(key)` becomes `readMenu(key)`, and saves compare menus by
  content instead of comparing strings.
- `app.js` keeps each slot's menu in a `Map`, which replaces the value of
  the `<textarea>`.
- Everything else stays: one save chain per slot, the page-hide save with
  `keepalive`, `settle`, `unsaved`, `discard`, and the question
  `Some changes in this week couldn't be saved. Leave anyway and discard them?`
  when you change weeks.
- The page-hide save covers only menus confirmed with **Done** whose save is
  pending or failed. It never sends the copy in an open editor.

### Modules with no DOM access

These modules run in Node.js tests:

- `public/menus.js`: adds and removes menu items, steps servings within their
  limits, and compares menus.
- `public/recipe-search.js`: computes the name key, filters recipes by a
  query, and sorts recipes from A to Z. Both pages use it.

The browser never imports from `server/`. The server keeps its own name-key
function.

## Recipe book page

`public/recipes.html` and `public/recipes.js` share `styles.css` and
`recipe-search.js` with the meal plan page.

```none
┌──────────────────────────────────────────────────────┐
│ Recipes                                 Meal plan ›  │
│                                                      │
│ New recipe: [                          ] [Add]       │
│   "Omelette" is archived. [Restore it]               │
│                                                      │
│ Search: [                              ]             │
│                                                      │
│ Gnocchi carbonara                [Rename] [Archive]  │
│ Green salad                      [Rename] [Archive]  │
│ Russian salad                    [Rename] [Archive]  │
│                                                      │
│ ▸ Archived (1)                                       │
│     Omelette                             [Restore]   │
└──────────────────────────────────────────────────────┘
```

- **Meal plan** links to `/`.
- **Loading:** the page requests `GET /api/recipes` with a 5-second timeout.
  If it fails, the page shows `Couldn't load the recipes.` with **Retry**.
- **Order:** both lists are sorted from A to Z by name key.
- **Adding:** **Add** or Enter sends `POST`. While it runs, the field and the
  button are disabled. On success, the field clears, the recipe appears in its
  place, and focus returns to the field.
  - On `409` with an active recipe, the message below the field reads
    `"NAME" already exists.`
  - On `409` with an archived recipe, it reads `"NAME" is archived.` with a
    **Restore it** button.
  - On `400`, it shows the server's message.
  - On a network error or timeout, it reads
    `Couldn't add the recipe. Try again.`, and the text stays in the field.
- **Renaming:** **Rename** turns the name into a field with the text selected,
  plus **Save** and **Cancel**. Several rows can be in rename mode at once.
  On success, the row moves to its sorted place. On an error (`409`, `400`,
  or network), the field stays open with a message below the row. Clicking
  **Cancel** doesn't count as leaving the field.
- **Archiving and restoring:** one click sends `PATCH`, with no confirmation,
  because it's reversible. On success, the row moves to the other list. On
  failure, the row stays and shows an error.
- **Searching:** filters both lists as you type, ignoring case and accents.
  With no matches, it shows `No recipes match "QUERY".`
- **Archived (N)** is a `<details>` element, closed by default. `N` counts
  all archived recipes, not only the ones that match the search.
- **Empty recipe book:** instead of the list, the page shows
  `No recipes yet. Add your first one above.`
- Changes from other devices appear on reload. A name conflict with a recipe
  added on another device shows up as a `409`.

## Testing

Each change follows test-driven development: a failing test first.

| File | Covers |
|------|--------|
| `test/api.test.js` | Every route, status code, and validation rule in this design. |
| `test/files.test.js` | Atomic writes, the write queue, missing files, and invalid JSON. |
| `test/menus.test.js` | Adding and removing menu items, servings limits, and comparing menus. |
| `test/recipe-search.test.js` | Name keys, filtering, and sorting. |
| `test/recipes.test.js` | Name cleanup, unique name keys, renaming, archiving, and restoring. |
| `test/saves.test.js` | The existing cases, moved from text to menus. |
| `test/weeks.test.js` | Normalized reads, invalid JSON, and recipe ID checks on save. |

`test/store.test.js` goes away with `store.js`. Its cases move to
`files.test.js` and `weeks.test.js`, except the ones for `migrateLegacyWeek`.

`docs/manual-test-plan.md` changes as follows:

- Section 1, the upgrade from a single week, goes away.
- Tests that type in a cell now edit a slot through the editor.
- New tests cover the editor: focus, Escape, the backdrop, the
  interaction rules, Android's **Back**, the mobile keyboard, the
  `beforeunload` warning, and the hash while the editor is open.
- New tests cover the recipe book page.

## Documentation

- `docs/glossary.md`: new, with the glossary in this design.
- `AGENTS.md`: a rule to use the terms in `docs/glossary.md`.
- `README.md`: how to use slots and the recipe book, the `data/v2/` layout
  and where free-text plans stay, the API reference, and the project
  structure. The section about the upgrade from a single week goes away.
