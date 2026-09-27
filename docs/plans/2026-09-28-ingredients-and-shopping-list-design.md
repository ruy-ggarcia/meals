# Ingredients and shopping list design

Date: 2026-09-28

## Context and goal

Meals plans a family's meals week by week. Each slot holds a menu: recipes
from the recipe book, each with its servings. A recipe is only a name, so the
app can't tell what to buy for a week.

**Goal:** each recipe lists its ingredients, with a quantity per serving.
Ingredients come from an ingredient catalog, and each ingredient has one
unit, so every recipe measures the same ingredient the same way. For the
displayed week, the meal plan shows a read-only shopping list: for each
ingredient, the sum of quantity × servings over every menu item of the week.

The ingredient catalog grows with use: you add ingredients as you need them
on the **Ingredients** page. The app doesn't ship a catalog and doesn't
depend on external services.

### Out of scope

- Adding ingredients from the recipe editor. You add them on the
  **Ingredients** page.
- Unit conversions, such as kilograms to grams or pieces to grams.
- Editing the shopping list, checking items off, or saving it.
- Exporting the shopping list to other apps. The shopping list is computed
  by a module with no DOM access, which an export can reuse.
- Real-time updates between devices. As today, you reload the page to see
  changes from another device, and the last save wins.

## Glossary

These terms join `docs/glossary.md`. The existing terms keep their meaning.

| Term | Definition |
|------|------------|
| Active ingredient | An ingredient that isn't archived. Only active ingredients can be added to a recipe. |
| Archived ingredient | An ingredient that's as if it didn't exist when you add ingredients to a recipe: it isn't offered, but it stays in the recipes that already use it. You can restore it. |
| Ingredient | Something you buy and use in recipes. The ingredient catalog holds it with a stable ID, a unique name, and a unit. In a recipe, it has a quantity. |
| Ingredient catalog | All the ingredients, active and archived. |
| Quantity | How much of an ingredient one serving of a recipe needs, in the ingredient's unit: a number from 0.01 to 10000 with at most two decimals. |
| Shopping list | For the displayed week, each ingredient with the sum of quantity × servings over every menu item, rounded up to a whole number. |
| Unit | How an ingredient is measured: `g`, `ml`, or `pcs`. |

The name key now applies to ingredient names too. Its definition changes
from "a recipe name" to "a recipe or ingredient name".

## Decisions

| Topic | Decision |
|-------|----------|
| Source of ingredients | An ingredient catalog that you build on the **Ingredients** page. No bundled data and no external services. |
| Units | One unit per ingredient, from a closed set: `g`, `ml`, and `pcs`. No conversions. |
| Changing a unit | Allowed only while no recipe, active or archived, uses the ingredient. |
| Ingredient names | Unique by name key, across active and archived ingredients. |
| Removing ingredients | No deletion. You archive an ingredient and can restore it. |
| Quantity | Per serving, from 0.01 to 10000, with at most two decimals. |
| Recipes without ingredients | Allowed. The recipe book marks them with a warning icon, and the shopping list lists them as not included. |
| Editing a recipe | A dialog with the name and the ingredients, opened by **New recipe** or a row's **Edit**. Renaming in place goes away. |
| Shopping list totals | Rounded up to a whole number, so you never buy too little. |
| Shopping list source | The menus that the grid shows, computed in the browser. |
| Shopping list location | A read-only dialog on the meal plan page. |

## Storage

The new file lives next to the others in `DATA_DIR/v2/`:

```none
data/
  v2/
    ingredients.json
    recipes.json
    weeks/
      2026-09-21.json
```

### Ingredients file

`data/v2/ingredients.json`:

```json
{
  "ingredients": [
    { "id": "9b1e4c2a-7d3f-4a8e-b5c6-1f2e3d4c5b6a", "name": "Onion", "unit": "g", "archived": false }
  ]
}
```

- `id` comes from `crypto.randomUUID()` and never changes.
- `name` follows the recipe name rules: trimmed, runs of whitespace collapsed
  to one space, and 1 to 100 characters.
- `unit` is one of `g`, `ml`, or `pcs`.
- A missing file is an empty catalog. A file with invalid JSON, or that isn't
  shaped like `{ "ingredients": [...] }`, makes reads fail, and the server
  never overwrites it.
- On read, entries without a string `id` and `name` or with an unknown `unit`
  are dropped.

### Recipes file

Each recipe gains an `ingredients` array:

```json
{
  "recipes": [
    {
      "id": "3f2c9a1e-5b7d-4c2a-9e1f-0a6b8c4d2e71",
      "name": "Omelette",
      "archived": false,
      "ingredients": [
        { "ingredientId": "9b1e4c2a-7d3f-4a8e-b5c6-1f2e3d4c5b6a", "quantity": 25 },
        { "ingredientId": "0c7d2e5f-3a1b-4c8d-9e6f-2a3b4c5d6e7f", "quantity": 1.5 }
      ]
    }
  ]
}
```

- A recipe without `ingredients` reads as `ingredients: []`. Existing recipe
  books need no migration, and the storage stays in `v2/`.
- A recipe holds at most 50 ingredients, each at most once, in the order in
  which you added them.
- On read, the store keeps only the ingredients that `PATCH` would accept,
  and drops the ones whose ingredient isn't in the catalog. So a hand-edited
  file, or a catalog restored from an older backup, never produces a recipe
  that can't be saved again.
- On a write, the store keeps the ingredients of the other recipes by shape
  only, without checking the catalog, so saving one recipe can't erase
  another recipe's ingredients because the catalog on disk is older or
  missing. This mirrors how weeks save a slot.
- The store reads `recipes.json` before `ingredients.json`. Ingredients are
  never deleted, so this order can't drop an ingredient that a concurrent
  write just added.

### Server modules

- `server/names.js`: new. `cleanName` and `nameKey`, shared by recipes and
  ingredients. They move out of `server/recipes.js`.
- `server/ingredients.js`: new. Lists, creates, renames, archives, and
  restores ingredients, changes their unit, and enforces unique names. It
  receives `isInUse(id)`, which tells whether any recipe uses an ingredient.
- `server/recipes.js`: creates recipes with ingredients, and changes a
  recipe's name, ingredients, or both. It receives the ingredient catalog to
  check each `ingredientId`, and exposes `usesIngredient(id)`.
- `server/errors.js`: `NameConflictError` carries the conflicting entity and
  its kind, so a `409` body can hold `recipe` or `ingredient`. A new
  `ConflictError` covers other `409` cases, such as changing the unit of an
  ingredient in use.
- `server/index.js`: wires `isInUse` to `recipes.usesIngredient`. The
  ingredient store calls it lazily, so the two stores don't depend on each
  other at construction.

Every write goes through the one shared queue. Checks that read another file,
such as whether an ingredient exists or is in use, run inside the queue, so
no write runs between the check and the save.

## API

All responses are JSON, and errors have the shape `{ "error": "MESSAGE" }`,
as today.

### Ingredients

`GET /api/ingredients`

| Status | Meaning |
|--------|---------|
| `200` | The body is `{ "ingredients": [...] }`, with every ingredient, archived ones included, sorted from A to Z by name key. |

`POST /api/ingredients` with body `{ "name": "NAME", "unit": "UNIT" }`

| Status | Meaning |
|--------|---------|
| `201` | The body is the new ingredient, with `archived: false`. |
| `400` | The body doesn't have exactly `name` and `unit`, the name breaks the name rules, or `unit` isn't `g`, `ml`, or `pcs`. |
| `409` | Another ingredient, active or archived, has the same name key. The body is `{ "error", "ingredient" }`, where `ingredient` is that ingredient. |

`PATCH /api/ingredients/ID` with a body of one of the following shapes, which
mirror the recipe shapes:

- `{ "name": "NAME" }`, `{ "unit": "UNIT" }`, or both fields together. The
  server applies both in one write.
- `{ "archived": BOOLEAN }`, alone.

| Status | Meaning |
|--------|---------|
| `200` | The body is the updated ingredient. |
| `400` | The body mixes `archived` with other fields, has no known field, has other fields, or has an invalid value. |
| `404` | No ingredient has that ID. |
| `409` | Another ingredient has the same name key, and the body is `{ "error", "ingredient" }`. Or the body changes `unit` while a recipe, active or archived, uses the ingredient, and the body is `{ "error" }`. |

Setting `unit` to the ingredient's current unit always succeeds.

### Recipes

A recipe now has the shape `{ "id", "name", "archived", "ingredients" }`,
where each ingredient is `{ "ingredientId", "quantity" }`.
`GET /api/recipes` returns this shape.

`POST /api/recipes` with body `{ "name": "NAME", "ingredients": [...] }`

| Status | Meaning |
|--------|---------|
| `201` | The body is the new recipe. `ingredients` is optional and defaults to `[]`. |
| `400` | `name` is missing or breaks the name rules, the body has other fields, or `ingredients` breaks the rules below. |
| `409` | Another recipe has the same name key. The body is `{ "error", "recipe" }`, as today. |

`PATCH /api/recipes/ID` with a body of one of the following shapes:

- `{ "name": "NAME" }`, `{ "ingredients": [...] }`, or both fields together.
  The server applies both in one write, so a recipe never keeps a new name
  with old ingredients.
- `{ "archived": BOOLEAN }`, alone.

| Status | Meaning |
|--------|---------|
| `200` | The body is the updated recipe. |
| `400` | The body mixes `archived` with other fields, has no known field, has other fields, or has an invalid value. |
| `404` | No recipe has that ID. |
| `409` | Another recipe has the same name key. The body is `{ "error", "recipe" }`. |

`ingredients` is valid when all the following are true:

- It's an array of at most 50 entries.
- Each entry has exactly the keys `ingredientId` and `quantity`.
- Each `ingredientId` is the ID of an existing ingredient, archived or not,
  and appears once. A recipe that already holds an archived ingredient must
  stay savable. The editor, not the server, keeps archived ingredients from
  being added.
- Each `quantity` is a number from 0.01 to 10000 with at most two decimals.
  The server stores it rounded to two decimals, so `0.30000000000000004` is
  stored as `0.3`.

## Interaction rules

The rules in the app stay: Enter or the confirm button confirms, Escape or
**Cancel** discards, and leaving never discards changes. The recipe editor
and the ingredient editor follow the slot editor:

| Action | Recipe editor | Ingredient editor |
|--------|---------------|-------------------|
| Enter or confirm | **Done** saves and closes the editor. Enter in **Add ingredient** adds the highlighted ingredient and doesn't confirm. | **Done** saves and closes the editor. |
| Escape or Cancel | **Cancel** closes the editor without saving. Escape in **Add ingredient** clears it when it has text. | **Cancel** closes the editor without saving. |
| Leaving, without changes | Clicking the backdrop closes the editor. | Clicking the backdrop closes the editor. |
| Leaving, with changes | Nothing happens: the editor stays open. | Nothing happens: the editor stays open. |

While an editor has unconfirmed changes, reloading or closing the page shows
the browser's standard warning (`beforeunload`). Android's **Back** acts as
Escape. When an editor closes, focus returns to the control that opened it,
or to the moved row after a save.

## Navigation

The title bar of each page links to the other two pages: **Meal plan** (`/`),
**Recipes** (`/recipes.html`), and **Ingredients** (`/ingredients.html`).

## Recipe book page

The **New recipe** form and renaming in place go away. Both adding and
editing a recipe happen in the recipe editor.

```none
┌──────────────────────────────────────────────────────┐
│ Recipes                      Meal plan · Ingredients │
│                                                      │
│ [New recipe]                                         │
│                                                      │
│ Search: [                              ]             │
│                                                      │
│ Burritos  ⚠                        [Edit] [Archive]  │
│ Gnocchi carbonara                  [Edit] [Archive]  │
│                                                      │
│ ▸ Archived (1)                                       │
│     Omelette                       [Edit] [Restore]  │
└──────────────────────────────────────────────────────┘
```

- **Loading:** the page requests `GET /api/recipes` and
  `GET /api/ingredients` in parallel. If either fails, the page shows
  `Couldn't load the recipes.` with **Retry**, as today.
- **New recipe** opens the recipe editor, empty.
- Each row, active or archived, has **Edit**. Active rows also have
  **Archive**, and archived rows have **Restore**, which work as today.
- A recipe with no ingredients shows a warning icon after its name, with the
  accessible name and tooltip `No ingredients`.
- Search, the **Archived (N)** section, and the empty recipe book work as
  today. The empty recipe book reads `No recipes yet. Add your first one with
  New recipe.`

### Recipe editor

A modal `<dialog>`, like the slot editor. On desktop it's centered, and on
mobile it fills the screen.

```none
┌─ Edit recipe ────────────────────────────────────┐
│ Name: [Stuffed eggplant                     ]    │
│                                                  │
│ Ingredients (per serving)                        │
│ Eggplant                  [ 150 ] g    [Remove]  │
│ Ground beef               [  80 ] g    [Remove]  │
│ Egg (archived)            [ 0.5 ] pcs  [Remove]  │
│                                                  │
│ Add ingredient: [ oni…                       ]   │
│   └ Onion (g)                                    │
│                                                  │
│                              [Cancel]  [Done]    │
└──────────────────────────────────────────────────┘
```

- The title is `New recipe` or `Edit recipe`. For a new recipe, focus starts
  in **Name**. For an existing one, it starts on the title, so a phone
  doesn't open its keyboard.
- **Name** follows the name rules.
- Each ingredient row shows the ingredient's name, a quantity field, the
  unit, and **Remove**. An archived ingredient shows `(archived)` after its
  name. Rows keep the order in which you added them.
- The quantity field is a text field with `inputmode="decimal"`. It accepts
  `.` or `,` as the decimal separator, because phone keyboards in some
  languages only offer `,`.
- **Add ingredient** works like **Add recipe** in the slot editor. It offers
  the active ingredients that aren't in the recipe yet, as `Onion (g)`,
  filtered by name key and sorted from A to Z. The new row has an empty
  quantity field, which gets the focus. With no matches, it shows
  `No matching ingredients. To add ingredients, use the Ingredients page.`
  At 50 ingredients, the field is disabled.
- With no ingredients, the list shows `No ingredients yet.` You can save the
  recipe anyway.
- **Done** checks the name and every quantity. An invalid quantity shows
  `Enter a quantity from 0.01 to 10000, with up to two decimals.` below its
  row, and focus moves to the first invalid field. Nothing is sent until all
  fields are valid.
- **Done** then sends one request: `POST` for a new recipe, or `PATCH` with
  the fields that changed for an existing one. With no changes, **Done** just
  closes the editor. While the request runs, the editor's controls are
  disabled.
  - On success, the editor closes, and the row appears in its sorted place.
  - On `409` with an active recipe, the message below **Name** reads
    `"NAME" already exists.`
  - On `409` with an archived recipe, it reads
    `"NAME" is archived. To use it, restore it from Archived.`
  - On `400`, it shows the server's message.
  - On a network error or timeout, it reads
    `Couldn't save the recipe. Try again.` The editor stays open with your
    changes.

## Ingredients page

`public/ingredients.html` and `public/ingredients.js` share `styles.css`,
`name-search.js`, and `catalog-list.js` with the recipe book page.

```none
┌──────────────────────────────────────────────────────┐
│ Ingredients                      Meal plan · Recipes │
│                                                      │
│ New ingredient: [              ] [Choose a unit ▾]   │
│                 [Add]                                │
│                                                      │
│ Search: [                              ]             │
│                                                      │
│ Eggplant                 g         [Edit] [Archive]  │
│ Onion                    g         [Edit] [Archive]  │
│                                                      │
│ ▸ Archived (1)                                       │
│     Egg                  pcs       [Edit] [Restore]  │
└──────────────────────────────────────────────────────┘
```

- **Loading:** the page requests `GET /api/ingredients` and
  `GET /api/recipes` in parallel. It uses the recipes to know which
  ingredients are in use. If either fails, the page shows
  `Couldn't load the ingredients.` with **Retry**.
- **Adding:** the form has **Name**, **Unit**, and **Add**. **Unit** is a
  `<select>` that starts at `Choose a unit`, with no unit selected, so you
  always pick one on purpose. **Add** or Enter sends `POST`. Without a unit,
  the message below the form reads `Choose a unit.` The rest works like
  adding a recipe does today, including `"NAME" is archived.` with a
  **Restore it** button. On success, the name field clears, and the unit goes
  back to `Choose a unit`.
- Each row shows the ingredient's name and unit, and **Edit**, plus
  **Archive** or **Restore**.
- **Edit** opens the ingredient editor, a small modal `<dialog>` with
  **Name** and **Unit**. If a recipe uses the ingredient, **Unit** is
  disabled, and the dialog reads
  `Used in N recipes. To change the unit, remove the ingredient from those recipes first.`
  `N` counts active and archived recipes. **Done** sends one `PATCH` with
  the fields that changed, or closes the editor when nothing changed. Errors
  appear in the dialog, which stays open with your changes. A `409` for a
  unit in use, from a recipe saved on another device, reads the server's
  message.
- Archiving and restoring, search, and **Archived (N)** work as on the recipe
  book page. With no ingredients, the page reads
  `No ingredients yet. Add your first one above.`

### Shared list logic

After renaming in place goes away, the two pages share most of their list
logic. `public/catalog-list.js` holds it: loading with **Retry**, search, the
active and archived lists, archiving and restoring, row messages, and moving
focus after a row leaves a list. Each page supplies its texts, its URL, the
content of a row, and what **Edit** does.

`public/recipe-search.js` becomes `public/name-search.js`, with
`filterByName` and `sortByName`, because it now serves recipes and
ingredients. `nameKey` stays.

## Meal plan page

### Loading

Each time a week loads, the page requests `GET /api/weeks/WEEK`,
`GET /api/recipes`, and `GET /api/ingredients` in parallel. If any request
fails, the page shows `Couldn't load the meal plan.` with **Retry**, as
today.

### Shopping list

The week bar gains a **Shopping list** button after **Today**, on desktop and
mobile. It opens a read-only modal `<dialog>`:

```none
┌─ Shopping list · Sep 28 – Oct 4, 2026 ─────────┐
│ Eggplant                               600 g   │
│ Egg                                      3 pcs │
│ Ground beef                            320 g   │
│ Milk                                  1500 ml  │
│ Onion                                  313 g   │
│                                                │
│ ⚠ Not included: these recipes have no          │
│   ingredients.                                 │
│   Burritos · Mon dinner, Thu lunch             │
│   Coffee · Tue breakfast                       │
│                                       [Close]  │
└────────────────────────────────────────────────┘
```

- The title shows `Shopping list` and the range of the displayed week.
- The list has one line per ingredient: its name, its total, and its unit,
  sorted from A to Z by name key. Archived ingredients that recipes use are
  included.
- The source is the menus that the grid shows, including slots that are
  saving or whose save failed.
- The total of an ingredient is the sum of `quantity × servings` over every
  menu item of the week whose recipe has that ingredient, rounded up to a
  whole number. The module computes in integers, hundredths of a unit times
  half servings, and divides once at the end. So `4.4 × 12.5` gives exactly
  `55`, not `56`, `0.56 × 12.5` gives exactly `7`, not `8`, and
  `0.1 + 2.7 + 0.2` gives exactly `3`, not `4`.
- If any recipe in the week's menus has no ingredients, a block with a
  warning icon follows the list: `Not included: these recipes have no
  ingredients.` It lists each such recipe once, sorted from A to Z, with the
  slots where it appears, in day and meal order.
- If the week has no menu items, the dialog reads
  `This week has no menus yet.`
- **Close**, Escape, Android's **Back**, and clicking the backdrop close the
  dialog. Focus returns to **Shopping list**.
- While the dialog is open, a change of the URL hash is undone, as in the
  slot editor.

### Modules with no DOM access

These modules run in Node.js tests:

- `public/quantities.js`: new. Parses a quantity typed with `.` or `,`,
  checks the quantity rules, formats a quantity, and holds the integer
  arithmetic of the shopping list.
- `public/shopping-list.js`: new. `shoppingList(slots, recipes, ingredients)`,
  where `slots` lists the week's slots in day and meal order as
  `{ day, meal, menu }`, returns `{ lines, recipesWithoutIngredients }`. Each
  line is
  `{ ingredientId, name, unit, total }`. Each recipe without ingredients is
  `{ recipeId, name, slots }`, where each slot is `{ day, meal }`.
- `public/name-search.js`: replaces `public/recipe-search.js`.

The DOM modules are `public/recipe-editor.js`,
`public/ingredient-editor.js`, `public/shopping-dialog.js`, and
`public/catalog-list.js`.

## Testing

Each change follows test-driven development: a failing test first. A green
`npm test` prints no stray logs, warnings, or stack traces.

| File | Covers |
|------|--------|
| `test/api.test.js` | Every new route, status code, and validation rule in this design. |
| `test/ingredient-editor.test.js` | The ingredient editor, including the disabled unit. |
| `test/ingredients-page.test.js` | Loading, adding, the unit choice, conflicts, and editing. |
| `test/ingredients.test.js` | Name cleanup, unique name keys, units, archiving, and the in-use rule. |
| `test/meal-plan-page.test.js` | The **Shopping list** button, the dialog, its empty state, and the ingredient catalog request. |
| `test/name-search.test.js` | Replaces `test/recipe-search.test.js`. |
| `test/quantities.test.js` | Parsing with `.` and `,`, limits, two decimals, and the integer arithmetic. |
| `test/recipe-editor.test.js` | New and existing recipes, validation, adding and removing ingredients, archived ingredients, errors, and the interaction rules. |
| `test/recipes-page.test.js` | Loading both catalogs, **New recipe**, **Edit**, the warning icon, and the shared list logic in `catalog-list.js`. Rename tests go away. |
| `test/recipes.test.js` | Ingredients on create and update, normalized reads, and writes that keep other recipes' ingredients. |
| `test/shopping-list.test.js` | Totals, rounding up, floating-point cases, sorting, archived ingredients, and recipes without ingredients. |

`docs/manual-test-plan.md` gains tests for the following:

- Focus, scrolling, and the keyboard in the recipe editor, the ingredient
  editor, and the shopping list on a phone.
- Typing a quantity with `,` on a phone keyboard.
- The warning icon and its tooltip.
- The navigation links on the three pages.

Tests about renaming in place and the **New recipe** form change to use the
recipe editor.

## Documentation

- `docs/glossary.md`: the terms in this design.
- `README.md`: how to use the **Ingredients** page, the recipe editor, and
  the shopping list; the new data file; the API reference; and the project
  structure.
