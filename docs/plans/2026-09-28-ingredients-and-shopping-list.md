# Ingredients and shopping list implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recipes list their ingredients from an ingredient catalog, with a
quantity per serving in each ingredient's unit, and the meal plan shows a
read-only shopping list for the displayed week.

**Architecture:** A new server store, `server/ingredients.js`, keeps the
ingredient catalog in `DATA_DIR/v2/ingredients.json`. Recipes in
`recipes.json` gain `ingredients: [{ ingredientId, quantity }]`. One module,
`server/stores.js`, wires the three stores to one write queue. In the
browser, a recipe editor dialog replaces renaming in place, a new
**Ingredients** page manages the catalog, and a DOM-free module computes the
shopping list from the menus that the grid shows.

**Tech stack:** Node.js 22, Express 5, plain HTML, CSS, and JavaScript
modules with no build step, `node:test`, supertest, happy-dom, and Biome.

**Spec:** `docs/plans/2026-09-28-ingredients-and-shopping-list-design.md`.
Read it before you start. When this plan and the spec disagree, this plan
wins, because it's the later, more detailed decision.

## Global constraints

- Node.js `>=22`. No new dependencies.
- Every artifact is in US English: code, comments, UI text, test names,
  fixture data, docs, and commit messages. Fixture names are English, such
  as `Onion` and `Egg`.
- Use the terms in `docs/glossary.md`: *ingredient*, *ingredient catalog*,
  *quantity*, *unit*, *shopping list*, *recipe*, *menu item*, *slot*. Never
  *food*.
- Units: exactly `g`, `ml`, and `pcs`.
- Names: 1 to 100 characters after cleanup, unique by name key among
  active and archived entries of the same kind.
- Quantity: a number from `0.1` to `10000` with at most one decimal. The
  server stores it rounded to one decimal.
- A recipe holds at most `50` ingredients, each at most once.
- The browser never imports from `server/`, and the server never imports
  from `public/`. Rules that both sides need have one implementation on each
  side, pinned to each other by a test.
- Every text the user sees is set with `textContent`, never `innerHTML`,
  except static icon markup.
- Before every commit, run `npm run lint` and `npm test`. Both must pass,
  and the `npm test` output must be clean: no stray logs, warnings, or stack
  traces. Tests that exercise an error path mock `console.error`. To fix
  formatting, run `npm run format`.
- Commit messages follow the existing style, such as
  `feat(server): add the ingredient catalog`. Don't add `Co-Authored-By` or
  any other attribution line.
- Follow test-driven development: write the failing test, run it and watch
  it fail, write the code, and run it again.
- Every test answers every request that it starts. A request left pending
  times out after 5 seconds and logs an error after the test has ended.

## Review focus

These are the inputs and conditions most likely to hurt a real user, with
the behavior a reasonable person expects. Each one has a test in the task
that owns the code.

1. **A quantity typed on a phone with a comma or spaces**, such as `1,5` or
   ` 2 `, is accepted as `1.5` or `2`. `1,25` is rejected with the quantity
   message. Tests: Task 6 and Task 9.
2. **A recipe book restored from a backup that references ingredients the
   catalog doesn't have** loads without errors. Those ingredients are
   dropped from what the API returns, and saving another recipe never
   erases them from disk. Tests: Task 3.
3. **Shopping list totals that are whole numbers but come out slightly
   above them in floating point**, such as `4.4 × 12.5` and
   `0.1 + 2.7 + 0.2`, show `55` and `3`, not `56` and `4`. Tests: Task 6
   and Task 7.
4. **Changing the unit of an ingredient that a recipe started to use on
   another device** fails with `409`, and the ingredient editor shows the
   server's message and stays open. Tests: Task 2, Task 4, and Task 11.
5. **Opening the shopping list while a slot save is pending or failed**
   counts the menu that the grid shows, not the last saved one. Tests:
   Task 13.

## File structure

```none
docs/
  glossary.md                     # Modify: new terms.
  manual-test-plan.md             # Modify: recipe editor, Ingredients page, and shopping list.
  plans/
    2026-09-28-ingredients-and-shopping-list-design.md
    2026-09-28-ingredients-and-shopping-list.md
public/
  app.js                          # Modify: loads ingredients, opens the shopping list.
  catalog-list.js                 # Create: list logic shared by the Recipes and Ingredients pages.
  combobox.js                     # Create: the filter-and-pick field, from slot-editor.js.
  dom.js                          # Modify: onBackdropClick, focusIsFree, createWarningIcon.
  index.html                      # Modify: shared dialog classes, Shopping list button and dialog, links.
  ingredient-editor.js            # Create: the ingredient editor dialog.
  ingredients.html                # Create: the Ingredients page.
  ingredients.js                  # Create: the Ingredients page logic.
  menus.js                        # Modify: imports name-search.js.
  name-search.js                  # Rename from recipe-search.js: filterByName, sortByName.
  quantities.js                   # Create: quantity parsing and shopping list arithmetic.
  recipe-editor.js                # Create: the recipe editor dialog.
  recipes.html                    # Modify: New recipe button, recipe editor dialog, links.
  recipes.js                      # Rewrite: uses catalog-list.js and the recipe editor.
  shopping-dialog.js              # Create: the shopping list dialog.
  shopping-list.js                # Create: computes the shopping list.
  slot-editor.js                  # Modify: uses combobox.js and onBackdropClick.
  styles.css                      # Modify: shared dialog and catalog classes, new pieces.
server/
  app.js                          # Modify: ingredient routes, conflict errors.
  errors.js                       # Modify: NameConflictError carries its kind; new ConflictError.
  index.js                        # Modify: uses stores.js.
  ingredients.js                  # Create: the ingredient catalog store.
  names.js                        # Create: name rules shared by recipes and ingredients.
  recipes.js                      # Modify: ingredients, create(fields), usesIngredient.
  stores.js                       # Create: wires the stores to one queue and to each other.
test/
  api.test.js                     # Modify.
  dom-helpers.js                  # Modify: loadDialog.
  ingredient-editor.test.js       # Create.
  ingredients-page.test.js        # Create.
  ingredients.test.js             # Create.
  limits.test.js                  # Modify: quantity limits.
  meal-plan-page.test.js          # Modify.
  name-search.test.js             # Rename from recipe-search.test.js.
  names.test.js                   # Create.
  navigation.test.js              # Create.
  quantities.test.js              # Create.
  recipe-editor.test.js           # Create.
  recipes-page.test.js            # Rewrite.
  recipes.test.js                 # Modify.
  shopping-list.test.js           # Create.
  slot-editor.test.js             # Modify: shared class names.
  weeks.test.js                   # Modify: uses stores.js.
README.md                         # Modify.
```

## Refactors and test changes in this plan

Approving this plan approves these changes to existing code and tests:

1. Task 1: `cleanName`, `nameKey`, and the name validation move from
   `server/recipes.js` to `server/names.js`. `NameConflictError` carries
   `kind` and `entity` instead of `recipe`. The name tests move to
   `test/names.test.js`.
2. Task 3: `recipes.create(name)` becomes `recipes.create({ name })`, so
   every call in `test/recipes.test.js` and `test/weeks.test.js` changes.
   Expected recipe shapes gain `ingredients: []`. Tests build their stores
   with `createStores`.
3. Task 5: `public/recipe-search.js` becomes `public/name-search.js`, with
   `filterByName` and `sortByName`, and its test file moves with it.
4. Task 8: the filter-and-pick logic moves from `slot-editor.js` to
   `combobox.js`, and the backdrop logic to `dom.js`. The slot editor's CSS
   classes become shared dialog classes (`.dialog`, `.dialog-body`,
   `.dialog-title`, `.option-search`, `.options`, and `.option`), and the
   tests' selectors follow. `loadSlotEditorDialog` builds on a new
   `loadDialog` helper.
5. Task 10: `recipes.js` loses the **New recipe** form and renaming in
   place, and its list logic moves to `catalog-list.js`. The recipe book's
   CSS classes become catalog classes (`.catalog`, `.catalog-list`,
   `.catalog-row`, and `.entry`). `focusIsFree` moves to `dom.js`. The
   tests for adding and renaming recipes go away, replaced by tests for the
   recipe editor.

---

### Task 1: Share the name rules between stores

Moves the name rules out of `server/recipes.js`, so the ingredient catalog
can use them, and lets `NameConflictError` describe a recipe or an
ingredient.

**Files:**

- Create: `server/names.js`, `test/names.test.js`
- Modify: `server/errors.js`, `server/recipes.js`, `server/app.js`,
  `test/recipes.test.js`, `test/recipe-search.test.js`,
  `public/recipe-search.js` (comment only)

**Interfaces:**

- Produces: `server/names.js` exports `MAX_NAME_LENGTH` (`100`),
  `cleanName(name) → string`, `nameKey(name) → string`,
  `byNameKey(a, b) → -1 | 0 | 1` for entries with a `name`,
  `validName(name) → string` (throws `ValidationError`), and
  `holderOf(all, name, exceptId?) → entry | undefined`.
- Produces: `new NameConflictError(message, kind, entity)`, with
  `error.kind` (`"recipe"` or `"ingredient"`) and `error.entity`. The API
  answers `409` with `{ error, [kind]: entity }`.

- [ ] **Step 1: Write the failing name tests**

Create `test/names.test.js`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { ValidationError } from "../server/errors.js";
import { byNameKey, cleanName, holderOf, nameKey, validName } from "../server/names.js";

test("cleanName trims the name and collapses runs of whitespace", () => {
  assert.equal(cleanName("  Green \t salad\n "), "Green salad");
});

test("nameKey ignores case and accents", () => {
  assert.equal(nameKey("Café"), nameKey("CAFE"));
  assert.equal(nameKey("Ñoquis"), "noquis");
  assert.notEqual(nameKey("Cafe"), nameKey("Cafes"));
});

test("byNameKey sorts entries from A to Z by name key", () => {
  const entries = [{ name: "omelette" }, { name: "Ñoquis" }, { name: "Café" }];

  assert.deepEqual(
    entries.sort(byNameKey).map((entry) => entry.name),
    ["Café", "Ñoquis", "omelette"],
  );
});

test("validName returns the cleaned name", () => {
  assert.equal(validName("  Onion   soup "), "Onion soup");
});

test("validName rejects a name that isn't a string, is blank, or is too long", () => {
  for (const name of [undefined, null, 42, ["Soup"], "", "   \n "]) {
    assert.throws(() => validName(name), ValidationError, String(name));
  }
  assert.throws(() => validName(" "), { message: "The name can't be empty." });
  assert.throws(() => validName("x".repeat(101)), {
    message: "The name must be at most 100 characters.",
  });
  // The limit counts the cleaned name.
  assert.equal(validName(` ${"x".repeat(100)} `), "x".repeat(100));
});

test("holderOf finds the entry with the same name key, except the given ID", () => {
  const all = [
    { id: "1", name: "Café" },
    { id: "2", name: "Tea" },
  ];

  assert.equal(holderOf(all, "  CAFE "), all[0]);
  assert.equal(holderOf(all, "cafe", "1"), undefined);
  assert.equal(holderOf(all, "Soup"), undefined);
});
```

In `test/recipes.test.js`, delete the two tests that `test/names.test.js`
now covers, `cleanName trims the name and collapses runs of whitespace` and
`nameKey ignores case and accents`, and change the import to:

```js
import { createRecipes } from "../server/recipes.js";
```

In the same file, the three name conflict tests check `error.recipe`.
Replace each `assert.deepEqual(error.recipe, X);` with these two lines,
keeping `X`:

```js
    assert.equal(error.kind, "recipe");
    assert.deepEqual(error.entity, X);
```

In `test/recipe-search.test.js`, change the server import to:

```js
import { cleanName, nameKey as serverNameKey } from "../server/names.js";
```

and, in the comment above the last-but-one test, change
`server/recipes.js#nameKey` to `server/names.js#nameKey`.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npm test`

Expected: FAIL. `test/names.test.js` and `test/recipe-search.test.js` fail
with `Cannot find module '.../server/names.js'`, and the conflict tests in
`test/recipes.test.js` fail because `error.kind` is `undefined`.

- [ ] **Step 3: Write the code**

Create `server/names.js`:

```js
// Name rules shared by the recipe book and the ingredient catalog: cleanup,
// the name key, validation, and uniqueness.

import { ValidationError } from "./errors.js";

export const MAX_NAME_LENGTH = 100;

/** The name as stored: trimmed, with runs of whitespace collapsed to one space. */
export function cleanName(name) {
  return name.trim().replace(/\s+/g, " ");
}

/**
 * Decides uniqueness and order. It ignores case and accents, so "Café" and
 * "cafe" share a key. public/recipe-search.js has the same rule.
 */
export function nameKey(name) {
  return name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Compares two entries with a `name`, for sorting from A to Z by name key. */
export function byNameKey(a, b) {
  const keyA = nameKey(a.name);
  const keyB = nameKey(b.name);
  if (keyA < keyB) return -1;
  return keyA > keyB ? 1 : 0;
}

/** The cleaned name. Throws a ValidationError when it breaks a rule. */
export function validName(name) {
  if (typeof name !== "string") throw new ValidationError('"name" must be a string.');
  const clean = cleanName(name);
  if (clean === "") throw new ValidationError("The name can't be empty.");
  if (clean.length > MAX_NAME_LENGTH) {
    throw new ValidationError(`The name must be at most ${MAX_NAME_LENGTH} characters.`);
  }
  return clean;
}

/** The entry of `all`, other than `exceptId`, whose name key equals the key of `name`. */
export function holderOf(all, name, exceptId) {
  const key = nameKey(cleanName(name));
  return all.find((entry) => entry.id !== exceptId && nameKey(entry.name) === key);
}
```

Replace the `NameConflictError` class in `server/errors.js` with:

```js
/**
 * Another entry already has the name key. `kind` is "recipe" or
 * "ingredient", and `entity` is that entry.
 */
export class NameConflictError extends Error {
  name = "NameConflictError";

  constructor(message, kind, entity) {
    super(message);
    this.kind = kind;
    this.entity = entity;
  }
}
```

Replace `server/recipes.js` with:

```js
// The recipe book: lists, creates, renames, archives, and restores recipes.
// Names are unique by name key, across active and archived recipes. Recipes
// are never deleted, so a menu never points to a recipe that doesn't exist.

import { randomUUID } from "node:crypto";
import { NameConflictError, NotFoundError, ValidationError } from "./errors.js";
import { dataPath, readJson, writeJson } from "./files.js";
import { byNameKey, holderOf, validName } from "./names.js";

// A PATCH body: exactly one of { name } or { archived }.
function validChanges(changes) {
  const isObject = changes !== null && typeof changes === "object" && !Array.isArray(changes);
  const keys = isObject ? Object.keys(changes) : [];
  if (keys.length !== 1 || (keys[0] !== "name" && keys[0] !== "archived")) {
    throw new ValidationError('Send exactly one of "name" or "archived".');
  }
  if (keys[0] === "name") return { name: validName(changes.name) };
  if (typeof changes.archived !== "boolean") {
    throw new ValidationError('"archived" must be true or false.');
  }
  return { archived: changes.archived };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Keeps only well-formed entries, so a hand-edited file can't break the app.
// `raw` is undefined when the file doesn't exist, which is an empty recipe
// book. A file that exists but isn't shaped like { recipes: [...] } is
// rejected instead, the same as invalid JSON, so it's never overwritten.
function normalize(raw) {
  if (raw === undefined) return [];
  if (!isPlainObject(raw) || !Array.isArray(raw.recipes)) {
    throw new Error('recipes.json must be an object with a "recipes" array.');
  }
  return raw.recipes
    .filter((entry) => typeof entry?.id === "string" && typeof entry.name === "string")
    .map((entry) => ({ id: entry.id, name: entry.name, archived: entry.archived === true }));
}

export function createRecipes({ dataDir, enqueue }) {
  const file = dataPath(dataDir, "recipes.json");

  async function readAll() {
    return normalize(await readJson(file));
  }

  function conflict(recipe) {
    return new NameConflictError(`A recipe named "${recipe.name}" already exists.`, "recipe", recipe);
  }

  /** Every recipe, archived ones included, from A to Z. Never waits for the queue. */
  async function list() {
    return (await readAll()).sort(byNameKey);
  }

  async function create(name) {
    const clean = validName(name);
    return enqueue(async () => {
      const all = await readAll();
      const holder = holderOf(all, clean);
      if (holder) throw conflict(holder);
      const recipe = { id: randomUUID(), name: clean, archived: false };
      await writeJson(file, { recipes: [...all, recipe] });
      return recipe;
    });
  }

  async function update(id, changes) {
    const valid = validChanges(changes);
    return enqueue(async () => {
      const all = await readAll();
      const recipe = all.find((entry) => entry.id === id);
      if (!recipe) throw new NotFoundError(`Unknown recipe: ${id}`);
      if (valid.name !== undefined) {
        const holder = holderOf(all, valid.name, id);
        if (holder) throw conflict(holder);
      }
      Object.assign(recipe, valid);
      await writeJson(file, { recipes: all });
      return recipe;
    });
  }

  return { create, list, update };
}
```

In `server/app.js`, change the `NameConflictError` branch of the error
handler to:

```js
    if (err instanceof NameConflictError) {
      res.status(409).json({ error: err.message, [err.kind]: err.entity });
      return;
    }
```

In `public/recipe-search.js`, change `The server has the same rule in
server/recipes.js.` to `The server has the same rule in server/names.js.`

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npm run lint && npm test`

Expected: PASS, with clean output. The existing API tests for `409` still
pass, because `kind` is `"recipe"`.

- [ ] **Step 5: Commit**

```bash
git add public/recipe-search.js server/app.js server/errors.js server/names.js server/recipes.js test/names.test.js test/recipe-search.test.js test/recipes.test.js
git commit -m "refactor(server): share the name rules between stores"
```

---

### Task 2: Add the ingredient catalog store

**Files:**

- Create: `server/ingredients.js`, `test/ingredients.test.js`
- Modify: `server/errors.js`

**Interfaces:**

- Consumes: `server/names.js` from Task 1.
- Produces: `createIngredients({ dataDir, enqueue, isInUse })`, where
  `isInUse(id) → Promise<boolean>`, returns `{ create, list, update }`:
  - `list() → Promise<Ingredient[]>`, from A to Z by name key, archived
    ones included. `Ingredient` is `{ id, name, unit, archived }`.
  - `create(fields) → Promise<Ingredient>`. `fields` must be exactly
    `{ name, unit }`.
  - `update(id, changes) → Promise<Ingredient>`. `changes` is `{ name }`,
    `{ unit }`, both, or `{ archived }` alone.
- Produces: `UNITS` (`["g", "ml", "pcs"]`) and `ConflictError` in
  `server/errors.js`.

- [ ] **Step 1: Write the failing tests**

Create `test/ingredients.test.js`:

```js
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  ConflictError,
  NameConflictError,
  NotFoundError,
  ValidationError,
} from "../server/errors.js";
import { createQueue } from "../server/files.js";
import { createIngredients } from "../server/ingredients.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let dataDir;
let ingredients;
/** The IDs that the stubbed recipe book says are in use. */
let usedIds;

function ingredientsFile() {
  return path.join(dataDir, "v2", "ingredients.json");
}

function newIngredients() {
  return createIngredients({
    dataDir,
    enqueue: createQueue(),
    isInUse: async (id) => usedIds.has(id),
  });
}

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "meals-ingredients-"));
  usedIds = new Set();
  ingredients = newIngredients();
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

test("list returns an empty catalog when there is no file", async () => {
  assert.deepEqual(await ingredients.list(), []);
});

test("create stores an ingredient with a UUID, the cleaned name, the unit, and archived false", async () => {
  const onion = await ingredients.create({ name: "  Red   onion ", unit: "g" });

  assert.match(onion.id, UUID);
  assert.deepEqual(onion, { id: onion.id, name: "Red onion", unit: "g", archived: false });
  assert.deepEqual(JSON.parse(await readFile(ingredientsFile(), "utf8")), {
    ingredients: [onion],
  });
  // A brand-new store over the same directory sees it too: it really is on disk.
  assert.deepEqual(await newIngredients().list(), [onion]);
});

test("list sorts ingredients from A to Z by name key", async () => {
  for (const name of ["onion", "Ñora", "Egg", "almond"]) {
    await ingredients.create({ name, unit: "g" });
  }

  const names = (await ingredients.list()).map((ingredient) => ingredient.name);
  assert.deepEqual(names, ["almond", "Egg", "Ñora", "onion"]);
});

test("create rejects fields that aren't exactly a valid name and unit", async () => {
  const invalid = [
    undefined,
    null,
    "Onion",
    [],
    {},
    { name: "Onion" },
    { unit: "g" },
    { name: "Onion", unit: "kg" },
    { name: "Onion", unit: "G" },
    { name: "Onion", unit: "g", archived: false },
    { name: "", unit: "g" },
    { name: 42, unit: "g" },
    { name: "x".repeat(101), unit: "g" },
  ];

  for (const fields of invalid) {
    await assert.rejects(ingredients.create(fields), ValidationError, JSON.stringify(fields));
  }
  assert.deepEqual(await ingredients.list(), []);
});

test("create rejects a name whose key is taken, active or archived, and reports that ingredient", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });

  await assert.rejects(ingredients.create({ name: " ONION ", unit: "pcs" }), (error) => {
    assert.ok(error instanceof NameConflictError);
    assert.equal(error.kind, "ingredient");
    assert.deepEqual(error.entity, onion);
    return true;
  });

  const archived = await ingredients.update(onion.id, { archived: true });
  await assert.rejects(ingredients.create({ name: "onion", unit: "g" }), (error) => {
    assert.deepEqual(error.entity, archived);
    return true;
  });
  assert.equal((await ingredients.list()).length, 1);
});

test("update renames an ingredient, and accepts its own name key", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });

  const renamed = await ingredients.update(onion.id, { name: " Red  onion " });
  assert.deepEqual(renamed, { ...onion, name: "Red onion" });

  const cafe = await ingredients.create({ name: "Cafe", unit: "g" });
  assert.equal((await ingredients.update(cafe.id, { name: "Café" })).name, "Café");
});

test("update rejects a name whose key another ingredient has", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });
  const egg = await ingredients.create({ name: "Egg", unit: "pcs" });

  await assert.rejects(ingredients.update(egg.id, { name: "onion" }), (error) => {
    assert.ok(error instanceof NameConflictError);
    assert.deepEqual(error.entity, onion);
    return true;
  });
  assert.deepEqual(await ingredients.list(), [egg, onion]);
});

test("update changes the unit of an ingredient that no recipe uses", async () => {
  const milk = await ingredients.create({ name: "Milk", unit: "g" });

  assert.deepEqual(await ingredients.update(milk.id, { unit: "ml" }), { ...milk, unit: "ml" });
});

test("update rejects a new unit for an ingredient that a recipe uses, and changes nothing", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });
  usedIds.add(onion.id);

  await assert.rejects(ingredients.update(onion.id, { unit: "pcs" }), (error) => {
    assert.ok(error instanceof ConflictError);
    assert.equal(
      error.message,
      '"Onion" is used in recipes. To change its unit, remove it from those recipes first.',
    );
    return true;
  });
  await assert.rejects(ingredients.update(onion.id, { name: "Red onion", unit: "pcs" }), ConflictError);
  assert.deepEqual(await ingredients.list(), [onion]);
});

test("update accepts the current unit and renames an ingredient that a recipe uses", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });
  usedIds.add(onion.id);

  const renamed = await ingredients.update(onion.id, { name: "Red onion", unit: "g" });

  assert.deepEqual(renamed, { ...onion, name: "Red onion" });
});

test("update changes the name and the unit together", async () => {
  const milk = await ingredients.create({ name: "Milk", unit: "g" });

  const updated = await ingredients.update(milk.id, { name: "Whole milk", unit: "ml" });

  assert.deepEqual(updated, { ...milk, name: "Whole milk", unit: "ml" });
  assert.deepEqual(await ingredients.list(), [updated]);
});

test("update archives and restores an ingredient", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });

  assert.deepEqual(await ingredients.update(onion.id, { archived: true }), {
    ...onion,
    archived: true,
  });
  assert.deepEqual(await ingredients.update(onion.id, { archived: false }), onion);
});

test("update rejects changes that aren't a valid shape", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });
  const invalid = [
    undefined,
    null,
    "Onion",
    [],
    {},
    { archived: true, name: "Leek" },
    { archived: true, unit: "g" },
    { color: "red" },
    { name: "Leek", color: "red" },
    { archived: "yes" },
    { unit: "kg" },
    { name: "" },
  ];

  for (const changes of invalid) {
    await assert.rejects(
      ingredients.update(onion.id, changes),
      ValidationError,
      JSON.stringify(changes),
    );
  }
  assert.deepEqual(await ingredients.list(), [onion]);
});

test("update rejects an unknown ID", async () => {
  await assert.rejects(ingredients.update("no-such-id", { archived: true }), NotFoundError);
});

test("list skips malformed entries in the file", async () => {
  await mkdir(path.join(dataDir, "v2"), { recursive: true });
  await writeFile(
    ingredientsFile(),
    JSON.stringify({
      ingredients: [
        { id: "a", name: "Onion", unit: "g", archived: true },
        { id: "b", name: "Egg", unit: "pcs" }, // archived missing -> false
        { id: "c", name: "Flour", unit: "kg" }, // unknown unit
        { id: "d", name: "Salt" }, // no unit
        { id: 5, name: "Bad ID", unit: "g" },
        null,
        "Milk",
      ],
    }),
  );

  assert.deepEqual(await ingredients.list(), [
    { id: "b", name: "Egg", unit: "pcs", archived: false },
    { id: "a", name: "Onion", unit: "g", archived: true },
  ]);
});

test("an ingredients file with invalid JSON or the wrong shape makes reads and writes fail without overwriting it", async () => {
  await mkdir(path.join(dataDir, "v2"), { recursive: true });
  for (const content of ["{ not json", '[{"id":"a","name":"Onion","unit":"g"}]', '{"ingredients":1}']) {
    await writeFile(ingredientsFile(), content);

    await assert.rejects(ingredients.list(), Error);
    await assert.rejects(ingredients.create({ name: "Onion", unit: "g" }), Error);
    assert.equal(await readFile(ingredientsFile(), "utf8"), content);
  }
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `node --test test/ingredients.test.js`

Expected: FAIL with `Cannot find module '.../server/ingredients.js'`.

- [ ] **Step 3: Write the code**

Add to `server/errors.js`, after `NameConflictError`:

```js
/** The request conflicts with the data in another way, such as a new unit for an ingredient in use. */
export class ConflictError extends Error {
  name = "ConflictError";
}
```

Create `server/ingredients.js`:

```js
// The ingredient catalog: lists, creates, renames, archives, and restores
// ingredients, and changes their unit. Names are unique by name key, across
// active and archived ingredients. Ingredients are never deleted, so a recipe
// never points to an ingredient that doesn't exist.

import { randomUUID } from "node:crypto";
import { ConflictError, NameConflictError, NotFoundError, ValidationError } from "./errors.js";
import { dataPath, readJson, writeJson } from "./files.js";
import { byNameKey, holderOf, validName } from "./names.js";

export const UNITS = ["g", "ml", "pcs"];

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validUnit(unit) {
  if (!UNITS.includes(unit)) {
    throw new ValidationError(`"unit" must be one of ${UNITS.join(", ")}.`);
  }
  return unit;
}

// A POST body: exactly { name, unit }.
function validNewIngredient(fields) {
  const keys = isPlainObject(fields) ? Object.keys(fields).sort().join() : "";
  if (keys !== "name,unit") throw new ValidationError('Send exactly "name" and "unit".');
  return { name: validName(fields.name), unit: validUnit(fields.unit) };
}

// A PATCH body: { name }, { unit }, or both, or { archived } alone.
function validChanges(changes) {
  const keys = isPlainObject(changes) ? Object.keys(changes) : [];
  if (keys.length === 1 && keys[0] === "archived") {
    if (typeof changes.archived !== "boolean") {
      throw new ValidationError('"archived" must be true or false.');
    }
    return { archived: changes.archived };
  }
  if (keys.length === 0 || keys.some((key) => key !== "name" && key !== "unit")) {
    throw new ValidationError('Send "name", "unit", or both, or "archived" alone.');
  }
  const valid = {};
  if (keys.includes("name")) valid.name = validName(changes.name);
  if (keys.includes("unit")) valid.unit = validUnit(changes.unit);
  return valid;
}

// Keeps only well-formed entries, so a hand-edited file can't break the app.
// `raw` is undefined when the file doesn't exist, which is an empty catalog.
// A file that exists but isn't shaped like { ingredients: [...] } is rejected
// instead, the same as invalid JSON, so it's never overwritten.
function normalize(raw) {
  if (raw === undefined) return [];
  if (!isPlainObject(raw) || !Array.isArray(raw.ingredients)) {
    throw new Error('ingredients.json must be an object with an "ingredients" array.');
  }
  return raw.ingredients
    .filter(
      (entry) =>
        typeof entry?.id === "string" &&
        typeof entry.name === "string" &&
        UNITS.includes(entry.unit),
    )
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      unit: entry.unit,
      archived: entry.archived === true,
    }));
}

/**
 * `isInUse(id)` tells whether any recipe, active or archived, uses the
 * ingredient. The store calls it only inside the queue, so no recipe write
 * runs between the check and the save.
 */
export function createIngredients({ dataDir, enqueue, isInUse }) {
  const file = dataPath(dataDir, "ingredients.json");

  async function readAll() {
    return normalize(await readJson(file));
  }

  function conflict(ingredient) {
    return new NameConflictError(
      `An ingredient named "${ingredient.name}" already exists.`,
      "ingredient",
      ingredient,
    );
  }

  /** Every ingredient, archived ones included, from A to Z. Never waits for the queue. */
  async function list() {
    return (await readAll()).sort(byNameKey);
  }

  async function create(fields) {
    const valid = validNewIngredient(fields);
    return enqueue(async () => {
      const all = await readAll();
      const holder = holderOf(all, valid.name);
      if (holder) throw conflict(holder);
      const ingredient = { id: randomUUID(), name: valid.name, unit: valid.unit, archived: false };
      await writeJson(file, { ingredients: [...all, ingredient] });
      return ingredient;
    });
  }

  async function update(id, changes) {
    const valid = validChanges(changes);
    return enqueue(async () => {
      const all = await readAll();
      const ingredient = all.find((entry) => entry.id === id);
      if (!ingredient) throw new NotFoundError(`Unknown ingredient: ${id}`);
      if (valid.name !== undefined) {
        const holder = holderOf(all, valid.name, id);
        if (holder) throw conflict(holder);
      }
      if (valid.unit !== undefined && valid.unit !== ingredient.unit && (await isInUse(id))) {
        throw new ConflictError(
          `"${ingredient.name}" is used in recipes. To change its unit, remove it from those recipes first.`,
        );
      }
      Object.assign(ingredient, valid);
      await writeJson(file, { ingredients: all });
      return ingredient;
    });
  }

  return { create, list, update };
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npm run lint && npm test`

Expected: PASS, with clean output.

- [ ] **Step 5: Commit**

```bash
git add server/errors.js server/ingredients.js test/ingredients.test.js
git commit -m "feat(server): add the ingredient catalog store"
```

---

### Task 3: Give recipes their ingredients

**Files:**

- Create: `server/stores.js`
- Modify: `server/recipes.js`, `server/app.js`, `server/index.js`,
  `test/recipes.test.js`, `test/weeks.test.js`, `test/api.test.js`

**Interfaces:**

- Consumes: `createIngredients` and `ConflictError` from Task 2.
- Produces: `createRecipes({ dataDir, enqueue, ingredients })` returns
  `{ create, list, update, usesIngredient }`:
  - A recipe is `{ id, name, archived, ingredients }`, where each
    ingredient is `{ ingredientId, quantity }`.
  - `create(fields)`: `fields` is `{ name }` or `{ name, ingredients }`.
  - `update(id, changes)`: `changes` is `{ name }`, `{ ingredients }`,
    both, or `{ archived }` alone.
  - `list()` drops the ingredients whose ingredient isn't in the catalog.
  - `usesIngredient(id) → Promise<boolean>`.
- Produces: `MAX_INGREDIENTS` (`50`), `MIN_QUANTITY` (`0.1`), and
  `MAX_QUANTITY` (`10000`) from `server/recipes.js`.
- Produces: `createStores({ dataDir }) → { ingredients, recipes, weeks }`
  from `server/stores.js`, all on one queue.
- `POST /api/recipes` passes the whole body to `recipes.create`.

- [ ] **Step 1: Move the existing tests to the new store shape**

In `test/recipes.test.js` and `test/weeks.test.js`, wrap every argument of
`recipes.create(...)` in `{ name: ... }`:

```bash
perl -0pi -e 's/recipes\.create\(((?:[^()]++|\((?1)\))*)\)/recipes.create({ name: $1 })/g' test/recipes.test.js test/weeks.test.js
perl -pi -e 's/\{ name: name \}/{ name }/g' test/recipes.test.js test/weeks.test.js
```

Check the result with `git diff test/recipes.test.js test/weeks.test.js`:
every `recipes.create` call now passes an object, such as
`recipes.create({ name: "Soup" })` or `recipes.create({ name })`, and
nothing else changed.

In `test/recipes.test.js`:

- Replace the imports of `createQueue` and `createRecipes` with
  `import { createStores } from "../server/stores.js";`, and add
  `ConflictError` to the import from `../server/errors.js`.
- Declare `let ingredients;` next to `let recipes;`, and replace the body
  of `beforeEach` after `mkdtemp` with
  `({ ingredients, recipes } = createStores({ dataDir }));`.
- In `create stores a recipe with a UUID, the cleaned name, and archived false`,
  expect `{ id: recipe.id, name: "Gnocchi carbonara", archived: false, ingredients: [] }`,
  and replace `createRecipes({ dataDir, enqueue: createQueue() }).list()`
  with `createStores({ dataDir }).recipes.list()`.
- In `update renames a recipe and keeps its ID`, expect
  `{ id: soup.id, name: "Tomato soup", archived: false, ingredients: [] }`.
- In `list skips malformed entries in the file`, add `ingredients: []` to
  both expected recipes.

In `test/weeks.test.js`:

- Replace the import of `createRecipes` with
  `import { createStores } from "../server/stores.js";`. Keep
  `createQueue` and `createWeeks`: the stub test still uses them.
- Make `newWeeks()` return `createStores({ dataDir }).weeks;`.
- In `beforeEach`, replace the three lines that build `enqueue`,
  `recipes`, and `weeks` with `({ recipes, weeks } = createStores({ dataDir }));`.

In `test/api.test.js`:

- Replace the imports of `createQueue`, `createRecipes`, and `createWeeks`
  with `import { createStores } from "../server/stores.js";`.
- Make `beforeEach` build the app with `app = createApp(createStores({ dataDir }));`
  after `mkdtemp`.
- In `POST /api/recipes returns 201 with the new recipe, and GET lists it`,
  expect `{ id: res.body.id, name: "Gnocchi carbonara", archived: false, ingredients: [] }`.

- [ ] **Step 2: Write the failing ingredient tests**

Add to `test/recipes.test.js`, after the existing tests:

```js
// ---------- Ingredients ----------

function entry(ingredientId, quantity) {
  return { ingredientId, quantity };
}

test("create stores the ingredients, each quantity rounded to one decimal", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });
  const egg = await ingredients.create({ name: "Egg", unit: "pcs" });

  const omelette = await recipes.create({
    name: "Omelette",
    ingredients: [entry(egg.id, 1.5), entry(onion.id, 0.1 * 3)], // 0.30000000000000004
  });

  assert.deepEqual(omelette.ingredients, [entry(egg.id, 1.5), entry(onion.id, 0.3)]);
  assert.deepEqual(await recipes.list(), [omelette]);
});

test("create rejects fields that aren't a name with optional ingredients", async () => {
  for (const fields of [undefined, null, "Soup", [], { name: "Soup", archived: false }]) {
    await assert.rejects(recipes.create(fields), ValidationError, JSON.stringify(fields));
  }
  assert.deepEqual(await recipes.list(), []);
});

test("create and update reject ingredients that break the rules", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });
  const invalid = [
    "Onion",
    null,
    {},
    [entry(onion.id, 1), entry(onion.id, 2)],
    [{ ingredientId: onion.id }],
    [{ ...entry(onion.id, 1), note: "chopped" }],
    [entry(42, 1)],
    ...[0, 0.05, 1.25, 10000.1, -1, "1", Number.NaN, Number.POSITIVE_INFINITY, null].map(
      (quantity) => [entry(onion.id, quantity)],
    ),
    Array.from({ length: 51 }, (_, index) => entry(`id-${index}`, 1)),
  ];

  for (const list of invalid) {
    await assert.rejects(
      recipes.create({ name: "Soup", ingredients: list }),
      ValidationError,
      String(JSON.stringify(list)),
    );
  }
  const soup = await recipes.create({ name: "Soup" });
  for (const list of invalid) {
    await assert.rejects(recipes.update(soup.id, { ingredients: list }), ValidationError);
  }
  assert.deepEqual(await recipes.list(), [soup]);
});

test("create and update reject an ingredient that isn't in the catalog", async () => {
  await assert.rejects(recipes.create({ name: "Soup", ingredients: [entry("gone", 1)] }), {
    name: "ValidationError",
    message: "Unknown ingredient: gone",
  });
  const soup = await recipes.create({ name: "Soup" });
  await assert.rejects(recipes.update(soup.id, { ingredients: [entry("gone", 1)] }), {
    message: "Unknown ingredient: gone",
  });
});

test("a recipe accepts the limits: 50 ingredients, 0.1, and 10000", async () => {
  const many = [];
  for (let index = 0; index < 50; index += 1) {
    many.push(await ingredients.create({ name: `Ingredient ${index}`, unit: "g" }));
  }
  const list = many.map((ingredient, index) =>
    entry(ingredient.id, index === 0 ? 0.1 : 10000),
  );

  const big = await recipes.create({ name: "Big", ingredients: list });

  assert.deepEqual(big.ingredients, list);
});

test("a recipe keeps and saves an archived ingredient", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });
  const soup = await recipes.create({ name: "Soup", ingredients: [entry(onion.id, 100)] });
  await ingredients.update(onion.id, { archived: true });

  const updated = await recipes.update(soup.id, { ingredients: [entry(onion.id, 120)] });

  assert.deepEqual(updated.ingredients, [entry(onion.id, 120)]);
  assert.deepEqual((await recipes.list())[0].ingredients, [entry(onion.id, 120)]);
});

test("update changes the name and the ingredients together", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });
  const soup = await recipes.create({ name: "Soup" });

  const updated = await recipes.update(soup.id, {
    name: "Onion soup",
    ingredients: [entry(onion.id, 200)],
  });

  assert.deepEqual(updated, { ...soup, name: "Onion soup", ingredients: [entry(onion.id, 200)] });
  assert.deepEqual(await recipes.list(), [updated]);
});

test("update rejects archived together with other fields", async () => {
  const soup = await recipes.create({ name: "Soup" });

  for (const changes of [
    { archived: true, ingredients: [] },
    { archived: true, name: "Stew" },
    { name: "Stew", color: "red" },
  ]) {
    await assert.rejects(recipes.update(soup.id, changes), ValidationError);
  }
});

test("list drops ingredients the catalog doesn't have, and reads a recipe without a list as empty", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });
  await writeFile(
    recipesFile(),
    JSON.stringify({
      recipes: [
        {
          id: "a",
          name: "Soup",
          archived: false,
          ingredients: [
            entry(onion.id, 100),
            entry("gone", 5), // not in the catalog
            entry(onion.id, 7), // repeated
            entry("bad", 1.25), // two decimals
            "Salt",
          ],
        },
        { id: "b", name: "Tea", archived: false },
      ],
    }),
  );

  assert.deepEqual(await recipes.list(), [
    { id: "a", name: "Soup", archived: false, ingredients: [entry(onion.id, 100)] },
    { id: "b", name: "Tea", archived: false, ingredients: [] },
  ]);
});

test("saving one recipe keeps another recipe's ingredients that the catalog doesn't have", async () => {
  await mkdir(path.join(dataDir, "v2"), { recursive: true });
  await writeFile(
    recipesFile(),
    JSON.stringify({
      recipes: [
        { id: "a", name: "Soup", archived: false, ingredients: [entry("gone", 5)] },
        { id: "b", name: "Tea", archived: false, ingredients: [] },
      ],
    }),
  );

  await recipes.update("b", { name: "Green tea" });

  const onDisk = JSON.parse(await readFile(recipesFile(), "utf8"));
  assert.deepEqual(onDisk.recipes[0].ingredients, [entry("gone", 5)]);
});

test("usesIngredient tells whether any recipe, archived ones included, uses the ingredient", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });
  const egg = await ingredients.create({ name: "Egg", unit: "pcs" });
  const soup = await recipes.create({ name: "Soup", ingredients: [entry(onion.id, 100)] });
  await recipes.update(soup.id, { archived: true });

  assert.equal(await recipes.usesIngredient(onion.id), true);
  assert.equal(await recipes.usesIngredient(egg.id), false);
});

test("the catalog refuses a new unit for an ingredient that a recipe uses", async () => {
  const onion = await ingredients.create({ name: "Onion", unit: "g" });
  const milk = await ingredients.create({ name: "Milk", unit: "g" });
  await recipes.create({ name: "Soup", ingredients: [entry(onion.id, 100)] });

  await assert.rejects(ingredients.update(onion.id, { unit: "pcs" }), ConflictError);
  assert.equal((await ingredients.update(milk.id, { unit: "ml" })).unit, "ml");
});
```

In `test/api.test.js`, add after `POST /api/recipes returns 201 with the new recipe, and GET lists it`:

```js
test("POST /api/recipes with fields other than name and ingredients returns 400", async () => {
  const res = await request(app).post("/api/recipes").send({ name: "Soup", archived: false });

  assertJsonError(res, 400, "extra field");
  assert.deepEqual((await request(app).get("/api/recipes")).body, { recipes: [] });
});
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `npm test`

Expected: FAIL with `Cannot find module '.../server/stores.js'` in
`test/recipes.test.js`, `test/weeks.test.js`, and `test/api.test.js`.

- [ ] **Step 4: Write the code**

Replace `server/recipes.js` with:

```js
// The recipe book: lists, creates, and changes recipes: their name, their
// ingredients, and whether they're archived. Names are unique by name key,
// across active and archived recipes. Recipes are never deleted, so a menu
// never points to a recipe that doesn't exist.

import { randomUUID } from "node:crypto";
import { NameConflictError, NotFoundError, ValidationError } from "./errors.js";
import { dataPath, readJson, writeJson } from "./files.js";
import { byNameKey, holderOf, validName } from "./names.js";

export const MAX_INGREDIENTS = 50;
export const MIN_QUANTITY = 0.1;
export const MAX_QUANTITY = 10000;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The quantity rounded to one decimal, or undefined when it isn't a number
 * from MIN_QUANTITY to MAX_QUANTITY with at most one decimal. The tolerance
 * absorbs binary floating point, so 0.30000000000000004 counts as 0.3.
 */
function cleanQuantity(quantity) {
  if (typeof quantity !== "number" || !Number.isFinite(quantity)) return undefined;
  const tenths = Math.round(quantity * 10);
  if (Math.abs(quantity * 10 - tenths) > 1e-6) return undefined;
  const clean = tenths / 10;
  return clean >= MIN_QUANTITY && clean <= MAX_QUANTITY ? clean : undefined;
}

// Checks the ingredients of a request, except that their ingredients exist.
// Returns clean copies with only ingredientId and quantity.
function validIngredients(ingredients) {
  if (!Array.isArray(ingredients)) throw new ValidationError('"ingredients" must be an array.');
  if (ingredients.length > MAX_INGREDIENTS) {
    throw new ValidationError(`A recipe holds at most ${MAX_INGREDIENTS} ingredients.`);
  }
  const seen = new Set();
  return ingredients.map((entry, index) => {
    const where = `ingredients[${index}]`;
    if (!isPlainObject(entry) || Object.keys(entry).sort().join() !== "ingredientId,quantity") {
      throw new ValidationError(`${where} must have exactly "ingredientId" and "quantity".`);
    }
    if (typeof entry.ingredientId !== "string") {
      throw new ValidationError(`${where}.ingredientId must be a string.`);
    }
    if (seen.has(entry.ingredientId)) {
      throw new ValidationError(`${where} repeats ingredient ${entry.ingredientId}.`);
    }
    seen.add(entry.ingredientId);
    const quantity = cleanQuantity(entry.quantity);
    if (quantity === undefined) {
      throw new ValidationError(
        `${where}.quantity must be from ${MIN_QUANTITY} to ${MAX_QUANTITY}, with at most one decimal.`,
      );
    }
    return { ingredientId: entry.ingredientId, quantity };
  });
}

// A POST body: { name }, with optional ingredients, and nothing else.
function validNewRecipe(fields) {
  if (!isPlainObject(fields) || Object.keys(fields).some((key) => key !== "name" && key !== "ingredients")) {
    throw new ValidationError('Send "name" and, optionally, "ingredients".');
  }
  return {
    name: validName(fields.name),
    ingredients: fields.ingredients === undefined ? [] : validIngredients(fields.ingredients),
  };
}

// A PATCH body: { name }, { ingredients }, or both, or { archived } alone.
function validChanges(changes) {
  const keys = isPlainObject(changes) ? Object.keys(changes) : [];
  if (keys.length === 1 && keys[0] === "archived") {
    if (typeof changes.archived !== "boolean") {
      throw new ValidationError('"archived" must be true or false.');
    }
    return { archived: changes.archived };
  }
  if (keys.length === 0 || keys.some((key) => key !== "name" && key !== "ingredients")) {
    throw new ValidationError('Send "name", "ingredients", or both, or "archived" alone.');
  }
  const valid = {};
  if (keys.includes("name")) valid.name = validName(changes.name);
  if (keys.includes("ingredients")) valid.ingredients = validIngredients(changes.ingredients);
  return valid;
}

// Keeps only the ingredients that a PATCH would accept: a string
// ingredientId, a valid quantity, no repeats, at most MAX_INGREDIENTS. Doesn't
// check the catalog, so a write never drops another recipe's ingredients
// just because the catalog on disk is older or missing.
function normalizeIngredients(raw) {
  const clean = [];
  const seen = new Set();
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (clean.length === MAX_INGREDIENTS) break;
    if (!isPlainObject(entry) || typeof entry.ingredientId !== "string") continue;
    const quantity = cleanQuantity(entry.quantity);
    if (quantity === undefined || seen.has(entry.ingredientId)) continue;
    seen.add(entry.ingredientId);
    clean.push({ ingredientId: entry.ingredientId, quantity });
  }
  return clean;
}

// Keeps only well-formed entries, so a hand-edited file can't break the app.
// `raw` is undefined when the file doesn't exist, which is an empty recipe
// book. A file that exists but isn't shaped like { recipes: [...] } is
// rejected instead, the same as invalid JSON, so it's never overwritten.
function normalize(raw) {
  if (raw === undefined) return [];
  if (!isPlainObject(raw) || !Array.isArray(raw.recipes)) {
    throw new Error('recipes.json must be an object with a "recipes" array.');
  }
  return raw.recipes
    .filter((entry) => typeof entry?.id === "string" && typeof entry.name === "string")
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      archived: entry.archived === true,
      ingredients: normalizeIngredients(entry.ingredients),
    }));
}

export function createRecipes({ dataDir, enqueue, ingredients }) {
  const file = dataPath(dataDir, "recipes.json");

  // Every recipe as stored, with its ingredients checked by shape only.
  async function readAll() {
    return normalize(await readJson(file));
  }

  async function knownIngredientIds() {
    return new Set((await ingredients.list()).map((ingredient) => ingredient.id));
  }

  // Called inside the queue, so no catalog write runs between this check and
  // the save.
  async function checkIngredientsExist(entries) {
    const known = await knownIngredientIds();
    const unknown = entries.find((entry) => !known.has(entry.ingredientId));
    if (unknown) throw new ValidationError(`Unknown ingredient: ${unknown.ingredientId}`);
  }

  function conflict(recipe) {
    return new NameConflictError(`A recipe named "${recipe.name}" already exists.`, "recipe", recipe);
  }

  /**
   * Every recipe, archived ones included, from A to Z, without the
   * ingredients that the catalog doesn't have. Never waits for the queue.
   * Reads the recipes before the catalog: ingredients are never deleted, so
   * this order can't drop an ingredient that a concurrent write just added.
   */
  async function list() {
    const all = await readAll();
    const known = await knownIngredientIds();
    return all
      .map((recipe) => ({
        ...recipe,
        ingredients: recipe.ingredients.filter((entry) => known.has(entry.ingredientId)),
      }))
      .sort(byNameKey);
  }

  async function create(fields) {
    const valid = validNewRecipe(fields);
    return enqueue(async () => {
      const all = await readAll();
      const holder = holderOf(all, valid.name);
      if (holder) throw conflict(holder);
      await checkIngredientsExist(valid.ingredients);
      const recipe = {
        id: randomUUID(),
        name: valid.name,
        archived: false,
        ingredients: valid.ingredients,
      };
      await writeJson(file, { recipes: [...all, recipe] });
      return recipe;
    });
  }

  async function update(id, changes) {
    const valid = validChanges(changes);
    return enqueue(async () => {
      const all = await readAll();
      const recipe = all.find((entry) => entry.id === id);
      if (!recipe) throw new NotFoundError(`Unknown recipe: ${id}`);
      if (valid.name !== undefined) {
        const holder = holderOf(all, valid.name, id);
        if (holder) throw conflict(holder);
      }
      if (valid.ingredients !== undefined) await checkIngredientsExist(valid.ingredients);
      Object.assign(recipe, valid);
      await writeJson(file, { recipes: all });
      return recipe;
    });
  }

  /** Whether any recipe, active or archived, uses the ingredient. Never waits for the queue. */
  async function usesIngredient(ingredientId) {
    return (await readAll()).some((recipe) =>
      recipe.ingredients.some((entry) => entry.ingredientId === ingredientId),
    );
  }

  return { create, list, update, usesIngredient };
}
```

Create `server/stores.js`:

```js
// Creates the stores on one write queue and wires them to each other: the
// recipe book checks ingredients against the catalog, and the catalog asks
// the recipe book whether an ingredient is in use.

import { createQueue } from "./files.js";
import { createIngredients } from "./ingredients.js";
import { createRecipes } from "./recipes.js";
import { createWeeks } from "./weeks.js";

export function createStores({ dataDir }) {
  // One queue for every file, so a save never checks another file while it
  // changes.
  const enqueue = createQueue();
  // `recipes` is read only when isInUse runs, after it's created below.
  const ingredients = createIngredients({
    dataDir,
    enqueue,
    isInUse: (id) => recipes.usesIngredient(id),
  });
  const recipes = createRecipes({ dataDir, enqueue, ingredients });
  const weeks = createWeeks({ dataDir, enqueue, recipes });
  return { ingredients, recipes, weeks };
}
```

Replace `server/index.js` with:

```js
import path from "node:path";
import { createApp } from "./app.js";
import { createStores } from "./stores.js";

const port = Number(process.env.PORT || 3000);
const dataDir = path.resolve(process.env.DATA_DIR || "data");

const app = createApp(createStores({ dataDir }));

app.listen(port, "0.0.0.0", (error) => {
  if (error) throw error;
  console.log(`Meals listening on http://0.0.0.0:${port} (data: ${dataDir})`);
});
```

In `server/app.js`, change the `POST /api/recipes` route to pass the whole
body:

```js
  app.post("/api/recipes", async (req, res) => {
    res.status(201).json(await recipes.create(req.body));
  });
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npm run format && npm run lint && npm test`

Expected: PASS, with clean output.

- [ ] **Step 6: Commit**

```bash
git add server/app.js server/index.js server/recipes.js server/stores.js test/api.test.js test/recipes.test.js test/weeks.test.js
git commit -m "feat(server): add ingredients to recipes"
```

---

### Task 4: Add the ingredients API

**Files:**

- Modify: `server/app.js`, `test/api.test.js`

**Interfaces:**

- Consumes: `createStores` from Task 3 and `ConflictError` from Task 2.
- Produces: `GET /api/ingredients`, `POST /api/ingredients`, and
  `PATCH /api/ingredients/ID`, as in the spec. `createApp` takes
  `{ ingredients, recipes, weeks }`.

- [ ] **Step 1: Write the failing tests**

Add to `test/api.test.js`, after the recipe tests and before
`// ---------- Weeks ----------`:

```js
// ---------- Ingredients ----------

async function addIngredient(name, unit = "g") {
  const res = await request(app).post("/api/ingredients").send({ name, unit });
  assert.equal(res.status, 201, name);
  return res.body;
}

test("GET /api/ingredients returns an empty catalog at first", async () => {
  const res = await request(app).get("/api/ingredients");

  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /application\/json/);
  assert.deepEqual(res.body, { ingredients: [] });
});

test("POST /api/ingredients returns 201 with the new ingredient, and GET lists them all from A to Z", async () => {
  const res = await request(app).post("/api/ingredients").send({ name: " Onion ", unit: "g" });

  assert.equal(res.status, 201);
  assert.deepEqual(res.body, { id: res.body.id, name: "Onion", unit: "g", archived: false });

  const egg = await addIngredient("Egg", "pcs");
  await request(app).patch(`/api/ingredients/${egg.id}`).send({ archived: true });
  const get = await request(app).get("/api/ingredients");
  assert.deepEqual(get.body, { ingredients: [{ ...egg, archived: true }, res.body] });
});

test("POST /api/ingredients with an invalid body returns 400 JSON and stores nothing", async () => {
  const bodies = [
    {},
    { name: "Onion" },
    { name: "Onion", unit: "kg" },
    { name: "", unit: "g" },
    { name: "Onion", unit: "g", archived: false },
  ];
  for (const body of bodies) {
    assertJsonError(await request(app).post("/api/ingredients").send(body), 400, JSON.stringify(body));
  }
  assertJsonError(await request(app).post("/api/ingredients"), 400, "no body");
  assert.deepEqual((await request(app).get("/api/ingredients")).body, { ingredients: [] });
});

test("POST /api/ingredients with a taken name returns 409 with that ingredient", async () => {
  const onion = await addIngredient("Onion");

  const res = await request(app).post("/api/ingredients").send({ name: "ONION", unit: "pcs" });

  assertJsonError(res, 409, "taken name");
  assert.deepEqual(res.body.ingredient, onion);
  assert.equal(res.body.recipe, undefined);
});

test("PATCH /api/ingredients/ID renames, changes the unit, and archives", async () => {
  const milk = await addIngredient("Milk");

  const both = await request(app)
    .patch(`/api/ingredients/${milk.id}`)
    .send({ name: "Whole milk", unit: "ml" });
  assert.equal(both.status, 200);
  assert.deepEqual(both.body, { ...milk, name: "Whole milk", unit: "ml" });

  const archived = await request(app).patch(`/api/ingredients/${milk.id}`).send({ archived: true });
  assert.deepEqual(archived.body, { ...both.body, archived: true });
});

test("PATCH /api/ingredients/ID returns 400, 404, and 409 JSON errors", async () => {
  const onion = await addIngredient("Onion");
  const egg = await addIngredient("Egg", "pcs");

  assertJsonError(
    await request(app).patch(`/api/ingredients/${egg.id}`).send({ archived: true, unit: "g" }),
    400,
    "archived with unit",
  );
  assertJsonError(
    await request(app).patch("/api/ingredients/no-such-id").send({ archived: true }),
    404,
    "unknown ID",
  );
  const conflict = await request(app).patch(`/api/ingredients/${egg.id}`).send({ name: "onion" });
  assertJsonError(conflict, 409, "taken name");
  assert.deepEqual(conflict.body.ingredient, onion);
});

test("PATCH /api/ingredients/ID with a new unit returns 409 while a recipe uses it", async () => {
  const onion = await addIngredient("Onion");
  await request(app)
    .post("/api/recipes")
    .send({ name: "Soup", ingredients: [{ ingredientId: onion.id, quantity: 100 }] });

  const res = await request(app).patch(`/api/ingredients/${onion.id}`).send({ unit: "pcs" });

  assertJsonError(res, 409, "unit in use");
  assert.deepEqual(Object.keys(res.body), ["error"]);
  assert.equal((await request(app).get("/api/ingredients")).body.ingredients[0].unit, "g");
});

test("POST and PATCH /api/recipes save ingredients, and GET returns them", async () => {
  const onion = await addIngredient("Onion");
  const egg = await addIngredient("Egg", "pcs");

  const created = await request(app)
    .post("/api/recipes")
    .send({ name: "Omelette", ingredients: [{ ingredientId: egg.id, quantity: 2 }] });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.ingredients, [{ ingredientId: egg.id, quantity: 2 }]);

  const updated = await request(app)
    .patch(`/api/recipes/${created.body.id}`)
    .send({
      name: "Onion omelette",
      ingredients: [
        { ingredientId: egg.id, quantity: 2 },
        { ingredientId: onion.id, quantity: 50.5 },
      ],
    });
  assert.equal(updated.status, 200);
  assert.deepEqual((await request(app).get("/api/recipes")).body, { recipes: [updated.body] });
});

test("POST /api/recipes with invalid or unknown ingredients returns 400 JSON", async () => {
  const onion = await addIngredient("Onion");
  const bodies = [
    { name: "Soup", ingredients: "Onion" },
    { name: "Soup", ingredients: [{ ingredientId: onion.id, quantity: 1.25 }] },
    { name: "Soup", ingredients: [{ ingredientId: "gone", quantity: 1 }] },
  ];

  for (const body of bodies) {
    assertJsonError(await request(app).post("/api/recipes").send(body), 400, JSON.stringify(body));
  }
});

test("a corrupt ingredients file makes GET /api/ingredients and GET /api/recipes return 500", async (t) => {
  t.mock.method(console, "error", () => {});
  await mkdir(path.join(dataDir, "v2"), { recursive: true });
  await writeFile(path.join(dataDir, "v2", "ingredients.json"), "{ not json");

  for (const url of ["/api/ingredients", "/api/recipes"]) {
    const res = await request(app).get(url);
    assert.equal(res.status, 500, url);
    assert.deepEqual(res.body, { error: "Internal server error" });
  }
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `node --test test/api.test.js`

Expected: FAIL. The new ingredient routes answer
`404 { "error": "Not found" }`, and the `409` for a unit in use comes back
as `500`.

- [ ] **Step 3: Write the code**

In `server/app.js`:

- Import `ConflictError` too:
  `import { ConflictError, NameConflictError, NotFoundError, ValidationError } from "./errors.js";`
- Change the signature to `export function createApp({ ingredients, recipes, weeks }) {`.
- Add, after `app.get("/api/recipes", ...)`:

```js
  app.get("/api/ingredients", async (_req, res) => {
    res.json({ ingredients: await ingredients.list() });
  });
```

- Add, after `app.patch("/api/recipes/:id", ...)`:

```js
  app.post("/api/ingredients", async (req, res) => {
    res.status(201).json(await ingredients.create(req.body));
  });

  app.patch("/api/ingredients/:id", async (req, res) => {
    res.json(await ingredients.update(req.params.id, req.body));
  });
```

- In the error handler, after the `NameConflictError` branch, add:

```js
    if (err instanceof ConflictError) {
      res.status(409).json({ error: err.message });
      return;
    }
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npm run lint && npm test`

Expected: PASS, with clean output.

- [ ] **Step 5: Try the server**

Run, in one terminal: `DATA_DIR="$(mktemp -d)" npm start`

In another terminal, run:

```bash
curl -s -X POST -H 'Content-Type: application/json' -d '{"name":"Onion","unit":"g"}' http://localhost:3000/api/ingredients; echo
curl -s http://localhost:3000/api/ingredients; echo
```

Expected: the first command prints the new ingredient, and the second prints
`{"ingredients":[...]}` with it. Stop the server with `Control+C`.

- [ ] **Step 6: Commit**

```bash
git add server/app.js test/api.test.js
git commit -m "feat(server): add the ingredients API"
```

---

### Task 5: Generalize the name search in the browser

`public/recipe-search.js` now serves recipes and ingredients, so it becomes
`public/name-search.js`.

**Files:**

- Rename: `public/recipe-search.js` → `public/name-search.js`,
  `test/recipe-search.test.js` → `test/name-search.test.js`
- Modify: `public/menus.js`, `public/recipes.js`

**Interfaces:**

- Produces: `nameKey(name)`, `sortByName(entries) → entries[]` (a new
  array), and `filterByName(entries, query) → entries[]`, for any entries
  with a `name`.

- [ ] **Step 1: Move and update the test**

```bash
git mv test/recipe-search.test.js test/name-search.test.js
```

Replace `test/name-search.test.js` with:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { filterByName, nameKey, sortByName } from "../public/name-search.js";
import { cleanName, nameKey as serverNameKey } from "../server/names.js";

function entry(name, archived = false) {
  return { id: `id-${name}`, name, archived };
}

test("nameKey ignores case and accents, like the server", () => {
  assert.equal(nameKey("Café"), "cafe");
  assert.equal(nameKey("ÑOQUIS"), "noquis");
});

test("sortByName returns a new array from A to Z by name key", () => {
  const input = [entry("omelette"), entry("Ñoquis"), entry("Café"), entry("banana")];

  const sorted = sortByName(input);

  assert.deepEqual(
    sorted.map((item) => item.name),
    ["banana", "Café", "Ñoquis", "omelette"],
  );
  assert.equal(input[0].name, "omelette", "the input keeps its order");
});

test("filterByName matches part of the name, ignoring case, accents, and extra spaces", () => {
  const entries = [entry("Iced café"), entry("Tea"), entry("Café con leche")];

  assert.deepEqual(
    filterByName(entries, "cafe").map((item) => item.name),
    ["Iced café", "Café con leche"],
  );
  assert.deepEqual(
    filterByName(entries, "  CAFÉ   CON ").map((item) => item.name),
    ["Café con leche"],
  );
  assert.deepEqual(filterByName(entries, "juice"), []);
});

test("filterByName with a blank query matches every entry", () => {
  const entries = [entry("Tea"), entry("Soup")];
  assert.deepEqual(filterByName(entries, ""), entries);
  assert.deepEqual(filterByName(entries, "   "), entries);
});

// The browser never imports from server/, so server/names.js#nameKey and
// public/name-search.js#nameKey are separate implementations of the same
// rule on purpose. This pins them to each other.
test("nameKey equals the server's nameKey for accented, cased, and emoji names", () => {
  for (const name of ["Café", "ÑOQUIS", "  Crème  brûlée ", "Ǆ", "🍲"]) {
    assert.equal(nameKey(name), serverNameKey(name), name);
  }
});

test("filterByName matches a name the server would store, for a query with extra spaces", () => {
  const stored = entry(cleanName("  Crème   brûlée  \t"));

  assert.deepEqual(filterByName([stored], "  crème   brûlée  "), [stored]);
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `node --test test/name-search.test.js`

Expected: FAIL with `Cannot find module '.../public/name-search.js'`.

- [ ] **Step 3: Move and update the module**

```bash
git mv public/recipe-search.js public/name-search.js
```

Replace `public/name-search.js` with:

```js
// Name helpers for recipes and ingredients. They never touch the DOM, so
// tests import this module directly in Node.js.

/**
 * Decides matching and order. It ignores case and accents, so "Café" and
 * "cafe" share a key. The server has the same rule in server/names.js.
 */
export function nameKey(name) {
  return name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** A new array of `entries`, each with a `name`, sorted from A to Z by name key. */
export function sortByName(entries) {
  return [...entries].sort((a, b) => {
    const keyA = nameKey(a.name);
    const keyB = nameKey(b.name);
    if (keyA < keyB) return -1;
    return keyA > keyB ? 1 : 0;
  });
}

/** The entries whose name contains `query`, ignoring case, accents, and extra spaces. */
export function filterByName(entries, query) {
  const key = nameKey(query.trim().replace(/\s+/g, " "));
  return entries.filter((entry) => nameKey(entry.name).includes(key));
}
```

In `server/names.js`, change `public/recipe-search.js has the same rule.`
to `public/name-search.js has the same rule.`

In `public/menus.js`, change the import to
`import { filterByName, sortByName } from "./name-search.js";`, and the
last line of `addableRecipes` to
`return sortByName(filterByName(offered, query));`.

In `public/recipes.js`, change the import to
`import { filterByName, sortByName } from "./name-search.js";`, and the line
in `render()` to
`const matches = sortByName(filterByName(recipes, search.value));`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npm run lint && npm test`

Expected: PASS, with clean output.

- [ ] **Step 5: Commit**

```bash
git add public/menus.js public/name-search.js public/recipe-search.js public/recipes.js server/names.js test/name-search.test.js test/recipe-search.test.js
git commit -m "refactor(ui): generalize the recipe search to names"
```

---

### Task 6: Add quantities

**Files:**

- Create: `public/quantities.js`, `test/quantities.test.js`
- Modify: `test/limits.test.js`

**Interfaces:**

- Produces: `MAX_INGREDIENTS` (`50`), `MIN_QUANTITY` (`0.1`),
  `MAX_QUANTITY` (`10000`), `parseQuantity(text) → number | null`,
  `twentieths(quantity, servings) → integer`, and
  `wholeUnits(total) → integer`.

- [ ] **Step 1: Write the failing tests**

Create `test/quantities.test.js`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_QUANTITY,
  MIN_QUANTITY,
  parseQuantity,
  twentieths,
  wholeUnits,
} from "../public/quantities.js";

test("parseQuantity reads whole numbers and one decimal, after . or ,", () => {
  const cases = [
    ["150", 150],
    ["0.5", 0.5],
    ["0,5", 0.5],
    ["1,5", 1.5],
    [" 2 ", 2],
    [".5", 0.5],
    [",5", 0.5],
    ["0.1", MIN_QUANTITY],
    ["10000", MAX_QUANTITY],
    ["10000.0", MAX_QUANTITY],
  ];
  for (const [text, quantity] of cases) {
    assert.equal(parseQuantity(text), quantity, text);
  }
});

test("parseQuantity rejects text that isn't a quantity from 0.1 to 10000 with up to one decimal", () => {
  const texts = [
    "",
    "   ",
    "abc",
    "1,25",
    "1.25",
    "0",
    "0.0",
    "0,04",
    "10000.1",
    "10001",
    "-1",
    "+1",
    "1e3",
    "1.000,5",
    "1.",
    "1 000",
  ];
  for (const text of texts) {
    assert.equal(parseQuantity(text), null, text);
  }
});

test("twentieths counts tenths of a unit times half servings", () => {
  assert.equal(twentieths(1, 1), 20);
  assert.equal(twentieths(0.1, 0.5), 1);
  assert.equal(twentieths(4.4, 12.5), 1100);
  assert.equal(twentieths(0.3, 99), 594);
});

test("wholeUnits rounds a total up to a whole number", () => {
  assert.equal(wholeUnits(0), 0);
  assert.equal(wholeUnits(20), 1);
  assert.equal(wholeUnits(21), 2);
  assert.equal(wholeUnits(1100), 55);
});

test("the arithmetic stays exact where decimals don't", () => {
  // In floating point, 4.4 × 12.5 is 55.00000000000001, and
  // 0.1 + 2.7 + 0.2 is 3.0000000000000004.
  assert.equal(Math.ceil(4.4 * 12.5), 56);
  assert.equal(wholeUnits(twentieths(4.4, 12.5)), 55);
  assert.equal(Math.ceil(0.1 + 2.7 + 0.2), 4);
  assert.equal(wholeUnits(twentieths(0.1, 1) + twentieths(2.7, 1) + twentieths(0.2, 1)), 3);
});
```

Replace `test/limits.test.js` with:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_ITEMS as CLIENT_MAX_ITEMS,
  MAX_SERVINGS as CLIENT_MAX_SERVINGS,
  MIN_SERVINGS as CLIENT_MIN_SERVINGS,
} from "../public/menus.js";
import {
  MAX_INGREDIENTS as CLIENT_MAX_INGREDIENTS,
  MAX_QUANTITY as CLIENT_MAX_QUANTITY,
  MIN_QUANTITY as CLIENT_MIN_QUANTITY,
} from "../public/quantities.js";
import {
  MAX_INGREDIENTS as SERVER_MAX_INGREDIENTS,
  MAX_QUANTITY as SERVER_MAX_QUANTITY,
  MIN_QUANTITY as SERVER_MIN_QUANTITY,
} from "../server/recipes.js";
import {
  MAX_ITEMS as SERVER_MAX_ITEMS,
  MAX_SERVINGS as SERVER_MAX_SERVINGS,
  MIN_SERVINGS as SERVER_MIN_SERVINGS,
} from "../server/weeks.js";

test("the client's menu limits equal the server's", () => {
  assert.equal(CLIENT_MAX_ITEMS, SERVER_MAX_ITEMS);
  assert.equal(CLIENT_MIN_SERVINGS, SERVER_MIN_SERVINGS);
  assert.equal(CLIENT_MAX_SERVINGS, SERVER_MAX_SERVINGS);
});

test("the client's recipe limits equal the server's", () => {
  assert.equal(CLIENT_MAX_INGREDIENTS, SERVER_MAX_INGREDIENTS);
  assert.equal(CLIENT_MIN_QUANTITY, SERVER_MIN_QUANTITY);
  assert.equal(CLIENT_MAX_QUANTITY, SERVER_MAX_QUANTITY);
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `node --test test/quantities.test.js test/limits.test.js`

Expected: FAIL with `Cannot find module '.../public/quantities.js'`.

- [ ] **Step 3: Write the code**

Create `public/quantities.js`:

```js
// Quantities of ingredients per serving, and the arithmetic of the shopping
// list. They never touch the DOM, so tests import this module directly in
// Node.js.

// The same limits the API enforces.
export const MAX_INGREDIENTS = 50;
export const MIN_QUANTITY = 0.1;
export const MAX_QUANTITY = 10000;

// Digits with at most one decimal, after "." or ",": phone keyboards in some
// languages only offer ",".
const QUANTITY_PATTERN = /^(?:\d+(?:[.,]\d)?|[.,]\d)$/;

/**
 * The quantity that `text` holds, or null when it isn't a number from
 * MIN_QUANTITY to MAX_QUANTITY with at most one decimal.
 */
export function parseQuantity(text) {
  const trimmed = text.trim();
  if (!QUANTITY_PATTERN.test(trimmed)) return null;
  const quantity = Number(trimmed.replace(",", "."));
  return quantity >= MIN_QUANTITY && quantity <= MAX_QUANTITY ? quantity : null;
}

/**
 * What `quantity` per serving makes for `servings`, in twentieths of a unit:
 * tenths of a unit times half servings. Both are whole numbers, so sums of
 * them are exact, unlike sums of the decimals themselves.
 */
export function twentieths(quantity, servings) {
  return Math.round(quantity * 10) * Math.round(servings * 2);
}

/** A total in twentieths as the whole number of units to buy, rounded up. */
export function wholeUnits(total) {
  return Math.ceil(total / 20);
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npm run lint && npm test`

Expected: PASS, with clean output.

- [ ] **Step 5: Commit**

```bash
git add public/quantities.js test/limits.test.js test/quantities.test.js
git commit -m "feat(ui): add quantity parsing and exact arithmetic"
```

---

### Task 7: Compute the shopping list

**Files:**

- Create: `public/shopping-list.js`, `test/shopping-list.test.js`

**Interfaces:**

- Consumes: `sortByName` from Task 5, `twentieths` and `wholeUnits` from
  Task 6.
- Produces: `shoppingList(slots, recipes, ingredients)`, where `slots` is
  `[{ day, meal, menu }]` in day and meal order, `recipes` is the recipe
  book, and `ingredients` is the catalog. It returns
  `{ lines, recipesWithoutIngredients }`:
  - `lines`: `[{ ingredientId, name, unit, total }]`, from A to Z.
  - `recipesWithoutIngredients`: `[{ recipeId, name, slots: [{ day, meal }] }]`,
    from A to Z, each slot in the order of `slots`.

- [ ] **Step 1: Write the failing tests**

Create `test/shopping-list.test.js`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { shoppingList } from "../public/shopping-list.js";

function ingredient(id, name, unit, archived = false) {
  return { id, name, unit, archived };
}

function recipe(id, name, ingredients = [], archived = false) {
  return {
    id,
    name,
    archived,
    ingredients: ingredients.map(([ingredientId, quantity]) => ({ ingredientId, quantity })),
  };
}

function slot(day, meal, ...items) {
  return {
    day,
    meal,
    menu: { items: items.map(([recipeId, servings]) => ({ recipeId, servings })) },
  };
}

const EGG = ingredient("egg", "Egg", "pcs");
const MILK = ingredient("milk", "Milk", "ml");
const ONION = ingredient("onion", "Onion", "g");
const RICE = ingredient("rice", "Rice", "g");
const CATALOG = [ONION, RICE, EGG, MILK];

test("sums quantity × servings per ingredient over every slot, from A to Z", () => {
  const recipes = [
    recipe("omelette", "Omelette", [
      ["egg", 2],
      ["onion", 50],
    ]),
    recipe("soup", "Onion soup", [
      ["onion", 150],
      ["milk", 100],
    ]),
  ];
  const slots = [
    slot("mon", "lunch", ["omelette", 2]),
    slot("tue", "dinner", ["soup", 1.5]),
    slot("wed", "lunch", ["omelette", 1]),
    slot("wed", "dinner"),
  ];

  assert.deepEqual(shoppingList(slots, recipes, CATALOG), {
    lines: [
      { ingredientId: "egg", name: "Egg", unit: "pcs", total: 6 },
      { ingredientId: "milk", name: "Milk", unit: "ml", total: 150 },
      { ingredientId: "onion", name: "Onion", unit: "g", total: 375 },
    ],
    recipesWithoutIngredients: [],
  });
});

test("rounds each total up to a whole number", () => {
  const recipes = [
    recipe("salad", "Salad", [
      ["onion", 12.5],
      ["egg", 0.3],
    ]),
  ];

  const { lines } = shoppingList([slot("mon", "lunch", ["salad", 1])], recipes, CATALOG);

  assert.deepEqual(
    lines.map((line) => [line.name, line.total]),
    [
      ["Egg", 1],
      ["Onion", 13],
    ],
  );
});

test("totals stay exact where floating point would round up too far", () => {
  const recipes = [
    recipe("risotto", "Risotto", [["rice", 4.4]]),
    recipe("a", "A", [["egg", 0.1]]),
    recipe("b", "B", [["egg", 2.7]]),
    recipe("c", "C", [["egg", 0.2]]),
  ];
  const slots = [
    slot("mon", "lunch", ["risotto", 12.5]),
    slot("tue", "lunch", ["a", 1], ["b", 1], ["c", 1]),
  ];

  const { lines } = shoppingList(slots, recipes, CATALOG);

  assert.deepEqual(
    lines.map((line) => [line.name, line.total]),
    [
      ["Egg", 3],
      ["Rice", 55],
    ],
  );
});

test("counts archived recipes and archived ingredients", () => {
  const catalog = [ingredient("saffron", "Saffron", "g", true)];
  const recipes = [recipe("paella", "Paella", [["saffron", 0.5]], true)];

  const { lines } = shoppingList([slot("sun", "lunch", ["paella", 4])], recipes, catalog);

  assert.deepEqual(lines, [{ ingredientId: "saffron", name: "Saffron", unit: "g", total: 2 }]);
});

test("lists each recipe without ingredients once, from A to Z, with its slots in order", () => {
  const recipes = [
    recipe("coffee", "Coffee"),
    recipe("burrito", "Burrito"),
    recipe("omelette", "Omelette", [["egg", 2]]),
  ];
  const slots = [
    slot("mon", "breakfast", ["coffee", 2]),
    slot("tue", "breakfast", ["coffee", 1], ["omelette", 1]),
    slot("thu", "dinner", ["burrito", 3]),
  ];

  assert.deepEqual(shoppingList(slots, recipes, CATALOG), {
    lines: [{ ingredientId: "egg", name: "Egg", unit: "pcs", total: 2 }],
    recipesWithoutIngredients: [
      { recipeId: "burrito", name: "Burrito", slots: [{ day: "thu", meal: "dinner" }] },
      {
        recipeId: "coffee",
        name: "Coffee",
        slots: [
          { day: "mon", meal: "breakfast" },
          { day: "tue", meal: "breakfast" },
        ],
      },
    ],
  });
});

test("skips unknown recipes and unknown ingredients, and a recipe left with none counts as without", () => {
  const recipes = [
    recipe("soup", "Soup", [
      ["onion", 100],
      ["gone", 5],
    ]),
    recipe("ghost", "Ghost", [["gone", 1]]),
  ];
  const slots = [slot("mon", "lunch", ["soup", 1], ["unknown", 2], ["ghost", 1])];

  assert.deepEqual(shoppingList(slots, recipes, CATALOG), {
    lines: [{ ingredientId: "onion", name: "Onion", unit: "g", total: 100 }],
    recipesWithoutIngredients: [
      { recipeId: "ghost", name: "Ghost", slots: [{ day: "mon", meal: "lunch" }] },
    ],
  });
});

test("an empty week has an empty shopping list", () => {
  assert.deepEqual(shoppingList([slot("mon", "lunch")], [], CATALOG), {
    lines: [],
    recipesWithoutIngredients: [],
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `node --test test/shopping-list.test.js`

Expected: FAIL with `Cannot find module '.../public/shopping-list.js'`.

- [ ] **Step 3: Write the code**

Create `public/shopping-list.js`:

```js
// The shopping list of a week: for each ingredient, the sum of quantity ×
// servings over every menu item, rounded up. It never touches the DOM, so
// tests import this module directly in Node.js, and an export can reuse it.

import { sortByName } from "./name-search.js";
import { twentieths, wholeUnits } from "./quantities.js";

/**
 * `slots` lists the week's slots in day and meal order, as
 * { day, meal, menu }. Menu items whose recipe isn't in `recipes`, and recipe
 * ingredients that aren't in `ingredients`, are skipped.
 *
 * Returns { lines, recipesWithoutIngredients }, both from A to Z:
 * - lines: [{ ingredientId, name, unit, total }]
 * - recipesWithoutIngredients: [{ recipeId, name, slots: [{ day, meal }] }]
 */
export function shoppingList(slots, recipes, ingredients) {
  const recipesById = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const ingredientsById = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
  /** Twentieths of a unit, by ingredient ID. */
  const totals = new Map();
  /** Recipes without ingredients, by recipe ID. */
  const without = new Map();

  for (const { day, meal, menu } of slots) {
    for (const item of menu.items) {
      const recipe = recipesById.get(item.recipeId);
      if (!recipe) continue;
      const known = recipe.ingredients.filter((entry) => ingredientsById.has(entry.ingredientId));
      if (known.length === 0) {
        const entry = without.get(recipe.id) ?? { recipeId: recipe.id, name: recipe.name, slots: [] };
        entry.slots.push({ day, meal });
        without.set(recipe.id, entry);
        continue;
      }
      for (const { ingredientId, quantity } of known) {
        const total = (totals.get(ingredientId) ?? 0) + twentieths(quantity, item.servings);
        totals.set(ingredientId, total);
      }
    }
  }

  const lines = [...totals].map(([ingredientId, total]) => {
    const { name, unit } = ingredientsById.get(ingredientId);
    return { ingredientId, name, unit, total: wholeUnits(total) };
  });
  return { lines: sortByName(lines), recipesWithoutIngredients: sortByName([...without.values()]) };
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npm run lint && npm test`

Expected: PASS, with clean output.

- [ ] **Step 5: Commit**

```bash
git add public/shopping-list.js test/shopping-list.test.js
git commit -m "feat(ui): compute the shopping list of a week"
```

---

### Task 8: Share the dialog pieces

The recipe editor, the ingredient editor, and the shopping list are dialogs
like the slot editor. This task moves the pieces they share out of the slot
editor, with no change in behavior.

**Files:**

- Create: `public/combobox.js`
- Modify: `public/dom.js`, `public/slot-editor.js`, `public/index.html`,
  `public/styles.css`, `test/dom-helpers.js`, `test/slot-editor.test.js`,
  `test/meal-plan-page.test.js`

**Interfaces:**

- Produces: `createCombobox({ input, list, noMatch, idPrefix, matches, label, onPick, isDisabled })`
  → `{ render, reset }` in `public/combobox.js`.
- Produces: `onBackdropClick(dialog, onClick)` in `public/dom.js`.
- Produces: shared CSS classes `.dialog`, `.dialog-body`, `.dialog-title`,
  `.option-search`, `.options`, `.option`, `.no-match`, and
  `.dialog-actions`.
- Produces: `loadDialog({ html, id, script, fetch })` →
  `{ window, document, dialog, module, cleanup }` in `test/dom-helpers.js`.

- [ ] **Step 1: Change the tests' selectors to the shared classes**

```bash
sed -i -e 's/\.recipe-search/.option-search/g' -e 's/\.recipe-option/.option/g' -e 's/\.slot-editor-title/.dialog-title/g' test/slot-editor.test.js test/meal-plan-page.test.js
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `node --test test/slot-editor.test.js test/meal-plan-page.test.js`

Expected: FAIL, with `TypeError: Cannot read properties of null` where the
tests look for `.option-search`, `.option`, and `.dialog-title`.

- [ ] **Step 3: Write the code**

Create `public/combobox.js`:

```js
// A combobox: a text field that filters a list of options, which you pick by
// clicking one, or with the arrow keys and Enter. Escape in the field clears
// its text first. Enter never confirms the dialog around it.

import { createElement } from "./dom.js";

/**
 * Wires `input` (the text field), `list` (its listbox), and `noMatch` (shown
 * when nothing matches). `matches(query)` returns the entries to offer,
 * `label(entry)` their text, and `onPick(entry)` runs when one is picked.
 * While `isDisabled()` is true, the list offers nothing and `noMatch` stays
 * hidden. `idPrefix` makes the option IDs unique in the page.
 *
 * Returns { render, reset }: render() rebuilds the list for the text in the
 * field, and reset() clears the text first.
 */
export function createCombobox({
  input,
  list,
  noMatch,
  idPrefix,
  matches,
  label,
  onPick,
  isDisabled,
}) {
  /** The entries the list offers, and the index of the highlighted one. */
  let entries = [];
  let highlighted = 0;

  function render() {
    entries = isDisabled() ? [] : matches(input.value);
    highlighted = Math.min(highlighted, Math.max(entries.length - 1, 0));
    list.replaceChildren(
      ...entries.map((entry, index) => {
        const option = createElement("li", "option", label(entry));
        option.id = `${idPrefix}-${index}`;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(index === highlighted));
        option.addEventListener("click", () => onPick(entry));
        return option;
      }),
    );
    list.hidden = entries.length === 0;
    noMatch.hidden = isDisabled() || entries.length > 0;
    input.setAttribute("aria-expanded", String(entries.length > 0));
    if (entries.length > 0) {
      input.setAttribute("aria-activedescendant", `${idPrefix}-${highlighted}`);
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function reset() {
    input.value = "";
    highlighted = 0;
    render();
  }

  function highlight(index) {
    highlighted = index;
    render();
    list.children[index]?.scrollIntoView({ block: "nearest" });
  }

  input.addEventListener("input", () => {
    highlighted = 0;
    render();
  });

  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "ArrowDown" && entries.length > 0) {
      event.preventDefault();
      highlight((highlighted + 1) % entries.length);
    } else if (event.key === "ArrowUp" && entries.length > 0) {
      event.preventDefault();
      highlight((highlighted - 1 + entries.length) % entries.length);
    } else if (event.key === "Enter") {
      // Picks the highlighted entry. It never confirms the dialog.
      event.preventDefault();
      if (entries.length > 0) onPick(entries[highlighted]);
    } else if (event.key === "Escape" && input.value !== "") {
      // The innermost edit is the text: clear it and keep the dialog open.
      // Canceling the keydown stops the dialog's close request.
      event.preventDefault();
      reset();
    }
  });

  return { render, reset };
}
```

Add to `public/dom.js`:

```js
/**
 * Calls `onClick` for a click on the backdrop of `dialog`, a <dialog> with no
 * padding, so that a click whose target is the dialog itself landed on the
 * backdrop. A press that starts inside a field and is released after
 * dragging over the backdrop also produces such a click, so the press must
 * have started on the backdrop too.
 */
export function onBackdropClick(dialog, onClick) {
  let pressedOnBackdrop = false;
  dialog.addEventListener("pointerdown", (event) => {
    pressedOnBackdrop = event.target === dialog;
  });
  dialog.addEventListener("click", (event) => {
    if (pressedOnBackdrop && event.target === dialog) onClick();
  });
}
```

Replace `public/slot-editor.js` with:

```js
// The slot editor: a modal dialog that edits a copy of a slot's menu. It
// follows the app's interaction rules:
// - Done confirms: it hands the edited menu back. Nothing else saves.
// - Cancel, Escape, and Android's Back discard the copy.
// - Clicking the backdrop closes the editor only when the copy has no
//   changes, so a stray click never throws work away.

import { createCombobox } from "./combobox.js";
import { createButton, createElement, onBackdropClick } from "./dom.js";
import {
  addableRecipes,
  addItem,
  copyMenu,
  MAX_ITEMS,
  MAX_SERVINGS,
  MIN_SERVINGS,
  removeItem,
  sameMenu,
  stepServings,
} from "./menus.js";

export function createSlotEditor(dialog) {
  const title = dialog.querySelector(".dialog-title");
  const itemList = dialog.querySelector(".menu-items");
  const search = dialog.querySelector(".option-search");
  const doneButton = dialog.querySelector(".done");

  /** The open editing session, or null: { original, copy, recipes, names, opener, onDone }. */
  let session = null;

  const combobox = createCombobox({
    input: search,
    list: dialog.querySelector(".options"),
    noMatch: dialog.querySelector(".no-match"),
    idPrefix: "recipe-option",
    matches: (query) => addableRecipes(session.recipes, session.copy, query),
    label: (recipe) => recipe.name,
    onPick: (recipe) => add(recipe.id),
    isDisabled: () => isFull(),
  });

  function nameOf(recipeId) {
    return session.names.get(recipeId) ?? "Unknown recipe";
  }

  function isFull() {
    return session.copy.items.length >= MAX_ITEMS;
  }

  function open({ title: text, menu, recipes, opener, onDone }) {
    session = {
      original: copyMenu(menu),
      copy: copyMenu(menu),
      recipes,
      names: new Map(recipes.map((recipe) => [recipe.id, recipe.name])),
      opener,
      onDone,
    };
    title.textContent = text;
    renderItems();
    combobox.reset();
    dialog.showModal();
    // The title, not a field: on a phone, focusing a field opens the keyboard.
    title.focus();
  }

  function isOpen() {
    return session !== null;
  }

  function hasChanges() {
    return session !== null && !sameMenu(session.copy, session.original);
  }

  // Closes the editor and returns focus to the slot. Only Done passes `save`.
  function close(save) {
    if (session === null) return;
    const { copy, opener, onDone } = session;
    session = null;
    if (dialog.open) dialog.close();
    if (save) onDone(copy);
    opener.focus();
  }

  function itemRow(item) {
    const name = nameOf(item.recipeId);
    const row = createElement("li", "menu-item");
    const servings = createElement("span", "servings", String(item.servings));
    servings.setAttribute("aria-live", "polite");
    const decrease = createButton("−", `Decrease servings of ${name}`, "step");
    const increase = createButton("+", `Increase servings of ${name}`, "step");
    const remove = createButton("Remove", `Remove ${name}`, "remove");
    decrease.disabled = item.servings <= MIN_SERVINGS;
    increase.disabled = item.servings >= MAX_SERVINGS;
    decrease.addEventListener("click", () => step(item.recipeId, -1, row));
    increase.addEventListener("click", () => step(item.recipeId, 1, row));
    remove.addEventListener("click", () => {
      const index = session.copy.items.findIndex((entry) => entry.recipeId === item.recipeId);
      session.copy = removeItem(session.copy, item.recipeId);
      renderItems();
      combobox.render();
      focusRemoved(index);
    });
    row.append(createElement("span", "recipe-name", name), decrease, servings, increase, remove);
    return row;
  }

  // Updates the row in place, so the pressed button keeps focus.
  function step(recipeId, steps, row) {
    session.copy = stepServings(session.copy, recipeId, steps);
    const { servings } = session.copy.items.find((item) => item.recipeId === recipeId);
    const [decrease, increase] = row.querySelectorAll(".step");
    row.querySelector(".servings").textContent = String(servings);
    decrease.disabled = servings <= MIN_SERVINGS;
    increase.disabled = servings >= MAX_SERVINGS;
    // A disabled button loses focus: move it to the other one.
    if (steps < 0 && decrease.disabled) increase.focus();
    if (steps > 0 && increase.disabled) decrease.focus();
  }

  // After Remove takes a row out of the list, focus the Remove button of the
  // row now in its place, else of the previous row, else the editor title.
  // Focusing the search field instead would open the keyboard on a phone.
  function focusRemoved(index) {
    const row = itemList.children[Math.min(index, itemList.children.length - 1)];
    (row?.querySelector(".remove") ?? title).focus();
  }

  function renderItems() {
    itemList.replaceChildren(...session.copy.items.map(itemRow));
    search.disabled = isFull();
    search.placeholder = isFull() ? `A menu holds up to ${MAX_ITEMS} recipes.` : "";
  }

  function add(recipeId) {
    session.copy = addItem(session.copy, recipeId);
    renderItems();
    combobox.reset();
    (search.disabled ? doneButton : search).focus();
  }

  dialog.querySelector(".cancel").addEventListener("click", () => close(false));
  doneButton.addEventListener("click", () => close(true));
  // Escape and Android's Back close the dialog: that discards the copy.
  dialog.addEventListener("close", () => close(false));
  onBackdropClick(dialog, () => {
    if (!hasChanges()) close(false);
  });
  // Enter confirms the innermost edit. On the title (focused when the editor
  // opens) or the dialog itself, that's Done; buttons and the search field
  // handle their own Enter.
  dialog.addEventListener("keydown", (event) => {
    if (event.isComposing || event.key !== "Enter") return;
    if (event.target === title || event.target === dialog) {
      event.preventDefault();
      close(true);
    }
  });

  return { hasChanges, isOpen, open };
}
```

In `public/index.html`, change the slot editor's markup:

- `<dialog id="slot-editor" class="slot-editor" ...>` →
  `<dialog id="slot-editor" class="dialog slot-editor" ...>`
- `<div class="slot-editor-body">` → `<div class="dialog-body">`
- `class="slot-editor-title"` → `class="dialog-title"`
- `class="recipe-search"` → `class="option-search"`
- `class="recipe-options"` → `class="options"`

In `public/styles.css`, rename the classes:

```bash
sed -i -e 's/\.slot-editor-body/.dialog-body/g' -e 's/\.slot-editor-title/.dialog-title/g' -e 's/\.slot-editor\b/.dialog/g' -e 's/\.recipe-search/.option-search/g' -e 's/\.recipe-options/.options/g' -e 's/\.recipe-option/.option/g' public/styles.css
```

Then, in `public/styles.css`, rename the section comment
`/* ---------- Slot editor ---------- */` to
`/* ---------- Dialogs ---------- */`, replace the comment above `.dialog {`
with the following, and change `/* The slot editor fills the screen on phones. */`
to `/* Dialogs fill the screen on phones. */`:

```css
/* No padding: onBackdropClick in dom.js treats a click whose target is the
   dialog itself as a click on the backdrop. The body inside carries the
   padding. */
```

In `test/dom-helpers.js`, replace `loadSlotEditorDialog` with:

```js
/**
 * Builds a document holding only the `<dialog id="ID">` markup from the real
 * public/HTML, installs the globals a dialog module needs, with `fetch` for
 * the network, and imports public/SCRIPT fresh.
 *
 * Returns `{ window, document, dialog, module, cleanup }`. Always call
 * `cleanup()`.
 */
export async function loadDialog({ html, id, script, fetch }) {
  const markup = await readFile(path.join(PUBLIC_DIR, html), "utf8");
  const dialogMarkup = markup.match(new RegExp(`<dialog id="${id}"[\\s\\S]*?</dialog>`))[0];

  const window = new Window({ url: "http://localhost/" });
  window.document.write(`<!doctype html><html><body>${dialogMarkup}</body></html>`);
  const { document } = window;

  const cleanup = installGlobals(window, fetch);
  const module = await import(`../public/${script}?instance=${nextInstanceId++}`);

  return { window, document, dialog: document.getElementById(id), module, cleanup };
}

/**
 * The slot editor from the real public/index.html: `loadDialog` plus
 * `editor`, which is `createSlotEditor` applied to the dialog.
 */
export async function loadSlotEditorDialog() {
  const loaded = await loadDialog({ html: "index.html", id: "slot-editor", script: "slot-editor.js" });
  return { ...loaded, editor: loaded.module.createSlotEditor(loaded.dialog) };
}
```

Also update the first comment of `test/dom-helpers.js`: the page scripts
are now `app.js`, `recipes.js`, and the dialog modules.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npm run format && npm run lint && npm test`

Expected: PASS, with clean output. `grep -rn "recipe-search\|recipe-option\|slot-editor-" public test`
prints only IDs, which stay: `for="recipe-search"`, `id="recipe-search"`,
`aria-controls="recipe-options"`, and `id="recipe-options"` in
`public/index.html`, and `idPrefix: "recipe-option"` in
`public/slot-editor.js`.

- [ ] **Step 5: Check it in a browser**

Run `DATA_DIR="$(mktemp -d)" npm start`, add a recipe with `curl` as in
the manual test plan, and open `http://localhost:3000`. Open a slot: the
editor looks and works as before, including the list of recipes, the dark
backdrop, and the full screen on a narrow window. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add public/combobox.js public/dom.js public/index.html public/slot-editor.js public/styles.css test/dom-helpers.js test/meal-plan-page.test.js test/slot-editor.test.js
git commit -m "refactor(ui): share the dialog pieces of the slot editor"
```

---

### Task 9: Add the recipe editor

**Files:**

- Create: `public/recipe-editor.js`, `test/recipe-editor.test.js`
- Modify: `public/recipes.html`, `public/styles.css`

**Interfaces:**

- Consumes: `createCombobox` and `onBackdropClick` from Task 8,
  `filterByName` and `sortByName` from Task 5, `MAX_INGREDIENTS` and
  `parseQuantity` from Task 6, `sendJson` from `public/http.js`, and
  `conflictText` from `public/messages.js`.
- Produces: `createRecipeEditor(dialog)` → `{ hasChanges, isOpen, open }`.
  `open({ recipe, ingredients, opener, onSaved })`: `recipe` is undefined
  for a new recipe, `ingredients` is the whole catalog, and
  `onSaved(savedRecipe)` runs after a successful save, when the editor has
  closed. Focus then belongs to `onSaved`. After Cancel, Escape, or a
  backdrop click, focus returns to `opener`.

- [ ] **Step 1: Add the dialog markup**

In `public/recipes.html`, add this before `</body>`:

```html
    <!-- Recipe editor. Filled and opened by recipe-editor.js. -->
    <dialog id="recipe-editor" class="dialog" aria-labelledby="recipe-editor-title">
      <div class="dialog-body">
        <!-- biome-ignore lint/a11y/useHeadingContent: recipe-editor.js sets the text when it opens. -->
        <h2 id="recipe-editor-title" class="dialog-title" tabindex="-1"></h2>
        <label class="field-label" for="recipe-name">Name</label>
        <input id="recipe-name" class="name-field" type="text" autocomplete="off">
        <p class="field-message name-message" role="status"></p>
        <h3 class="dialog-subtitle">Ingredients (per serving)</h3>
        <p class="hint no-ingredients">No ingredients yet.</p>
        <ul class="ingredient-rows" aria-label="Ingredients in this recipe"></ul>
        <label class="field-label" for="ingredient-search">Add ingredient</label>
        <input
          id="ingredient-search"
          class="option-search"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-controls="ingredient-options"
          aria-expanded="false"
          autocomplete="off"
        >
        <!-- biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the combobox pattern needs a listbox. -->
        <ul id="ingredient-options" class="options" role="listbox" aria-label="Ingredients" hidden></ul>
        <p class="no-match" hidden>No matching ingredients. To add ingredients, use the Ingredients page.</p>
        <p class="field-message save-message" role="status"></p>
        <div class="dialog-actions">
          <button type="button" class="cancel">Cancel</button>
          <button type="button" class="done">Done</button>
        </div>
      </div>
    </dialog>
```

- [ ] **Step 2: Write the failing tests**

Create `test/recipe-editor.test.js`:

```js
// Tests for the recipe editor (public/recipe-editor.js) against a real DOM,
// built from the real dialog markup in public/recipes.html. See
// test/dom-helpers.js for the harness and the DOM library choice.

import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { fakeFetch, loadDialog, tick, waitFor } from "./dom-helpers.js";

const EGG = { id: "egg", name: "Egg", unit: "pcs", archived: false };
const MILK = { id: "milk", name: "Milk", unit: "ml", archived: false };
const ONION = { id: "onion", name: "Onion", unit: "g", archived: false };
const SALT = { id: "salt", name: "Salt", unit: "g", archived: true };
const CATALOG = [ONION, SALT, EGG, MILK];

const SOUP = {
  id: "soup",
  name: "Onion soup",
  archived: false,
  ingredients: [
    { ingredientId: "onion", quantity: 150 },
    { ingredientId: "salt", quantity: 0.5 },
  ],
};

let server;
let dialog;
let document;
let window;
let editor;
let cleanup;

beforeEach(async () => {
  mock.method(console, "error", () => {}); // some tests simulate a failed save on purpose
  server = fakeFetch();
  let module;
  ({ dialog, document, window, module, cleanup } = await loadDialog({
    html: "recipes.html",
    id: "recipe-editor",
    script: "recipe-editor.js",
    fetch: server.fetch,
  }));
  editor = module.createRecipeEditor(dialog);
});

afterEach(async () => {
  await cleanup();
  mock.restoreAll();
});

function openEditor({ recipe, ingredients = CATALOG } = {}) {
  const opener = document.createElement("button");
  document.body.append(opener);
  const saved = [];
  editor.open({ recipe, ingredients, opener, onSaved: (entry) => saved.push(entry) });
  return { opener, saved };
}

function query(selector) {
  return document.querySelector(selector);
}

function nameField() {
  return query(".name-field");
}

function search() {
  return query(".option-search");
}

function rowNames() {
  return [...document.querySelectorAll(".ingredient-name")].map((name) => name.textContent);
}

function quantityFields() {
  return [...document.querySelectorAll(".quantity-field")];
}

function optionTexts() {
  return [...document.querySelectorAll(".option")].map((option) => option.textContent);
}

function setValue(element, value) {
  element.value = value;
  element.dispatchEvent(new window.Event("input", { bubbles: true }));
}

function keydownOn(element, key) {
  const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  return event;
}

function pointerdownOn(element) {
  element.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }));
}

function addIngredient(text) {
  setValue(search(), text);
  keydownOn(search(), "Enter");
}

async function respondTo(method, url, status, body) {
  await waitFor(() => server.requestFor(method, url) !== undefined);
  server.requestFor(method, url).respond(status, body);
  await tick();
}

test("a new recipe opens empty, titled New recipe, with focus in Name", () => {
  openEditor();

  assert.equal(dialog.open, true);
  assert.equal(query(".dialog-title").textContent, "New recipe");
  assert.equal(nameField().value, "");
  assert.equal(document.activeElement, nameField());
  assert.equal(query(".no-ingredients").hidden, false);
  assert.deepEqual(rowNames(), []);
});

test("an existing recipe opens with its name and ingredients, and focus on the title", () => {
  openEditor({ recipe: SOUP });

  assert.equal(query(".dialog-title").textContent, "Edit recipe");
  assert.equal(nameField().value, "Onion soup");
  assert.equal(document.activeElement, query(".dialog-title"));
  assert.equal(query(".no-ingredients").hidden, true);
  assert.deepEqual(rowNames(), ["Onion", "Salt (archived)"]);
  assert.deepEqual(
    quantityFields().map((field) => field.value),
    ["150", "0.5"],
  );
  assert.deepEqual(
    [...document.querySelectorAll(".ingredient-row .unit")].map((unit) => unit.textContent),
    ["g", "g"],
  );
  assert.equal(quantityFields()[0].getAttribute("inputmode"), "decimal");
  assert.equal(quantityFields()[0].getAttribute("aria-label"), "Quantity of Onion per serving");
});

test("Add ingredient offers active ingredients not in the recipe, from A to Z, with their unit", () => {
  openEditor({ recipe: SOUP });

  assert.deepEqual(optionTexts(), ["Egg (pcs)", "Milk (ml)"]);
  setValue(search(), "MI");
  assert.deepEqual(optionTexts(), ["Milk (ml)"]);
});

test("Enter in Add ingredient adds the highlighted ingredient with an empty quantity, focused", () => {
  openEditor();
  setValue(search(), "egg");

  const event = keydownOn(search(), "Enter");

  assert.equal(event.defaultPrevented, true);
  assert.equal(dialog.open, true);
  assert.deepEqual(rowNames(), ["Egg"]);
  assert.equal(quantityFields()[0].value, "");
  assert.equal(document.activeElement, quantityFields()[0]);
  assert.equal(search().value, "");
  assert.equal(query(".no-ingredients").hidden, true);
});

test("with no matches, Add ingredient points to the Ingredients page", () => {
  openEditor();

  setValue(search(), "xyz");

  assert.equal(query(".options").hidden, true);
  assert.equal(query(".no-match").hidden, false);
  assert.equal(
    query(".no-match").textContent,
    "No matching ingredients. To add ingredients, use the Ingredients page.",
  );
});

test("Done with an invalid quantity shows a message under its row, focuses it, and sends nothing", () => {
  openEditor({ recipe: SOUP });
  setValue(quantityFields()[1], "1.25");

  query(".done").click();

  const rows = [...document.querySelectorAll(".ingredient-row")];
  assert.equal(dialog.open, true);
  assert.equal(rows[0].querySelector(".row-message"), null);
  assert.equal(
    rows[1].querySelector(".row-message").textContent,
    "Enter a quantity from 0.1 to 10000, with up to one decimal.",
  );
  assert.equal(quantityFields()[1].value, "1.25");
  assert.equal(document.activeElement, quantityFields()[1]);
  assert.equal(server.requests.length, 0);
});

test("Done with an empty name shows a message under Name and sends nothing", () => {
  openEditor();
  setValue(nameField(), "   ");

  query(".done").click();

  assert.equal(query(".name-message").textContent, "The name can't be empty.");
  assert.equal(document.activeElement, nameField());
  assert.equal(server.requests.length, 0);
});

test("Done on a new recipe sends POST with the name and the quantities, then closes", async () => {
  const { saved } = openEditor();
  setValue(nameField(), "Omelette");
  addIngredient("egg");
  setValue(quantityFields()[0], " 1,5 ");

  query(".done").click();

  assert.equal(query(".done").disabled, true);
  assert.equal(query(".cancel").disabled, true);
  await waitFor(() => server.requestFor("POST", "/api/recipes") !== undefined);
  assert.deepEqual(server.requestFor("POST", "/api/recipes").body, {
    name: "Omelette",
    ingredients: [{ ingredientId: "egg", quantity: 1.5 }],
  });
  const created = {
    id: "new",
    name: "Omelette",
    archived: false,
    ingredients: [{ ingredientId: "egg", quantity: 1.5 }],
  };
  await respondTo("POST", "/api/recipes", 201, created);
  assert.equal(dialog.open, false);
  assert.deepEqual(saved, [created]);
});

test("a new recipe can be saved without ingredients", async () => {
  openEditor();
  setValue(nameField(), "Coffee");

  query(".done").click();

  await waitFor(() => server.requestFor("POST", "/api/recipes") !== undefined);
  assert.deepEqual(server.requestFor("POST", "/api/recipes").body, {
    name: "Coffee",
    ingredients: [],
  });
  await respondTo("POST", "/api/recipes", 201, {
    id: "coffee",
    name: "Coffee",
    archived: false,
    ingredients: [],
  });
});

test("Done on an existing recipe sends only the name when only the name changed", async () => {
  openEditor({ recipe: SOUP });
  setValue(nameField(), "French onion soup");

  query(".done").click();

  await waitFor(() => server.requestFor("PATCH", "/api/recipes/soup") !== undefined);
  assert.deepEqual(server.requestFor("PATCH", "/api/recipes/soup").body, {
    name: "French onion soup",
  });
  await respondTo("PATCH", "/api/recipes/soup", 200, { ...SOUP, name: "French onion soup" });
});

test("Done on an existing recipe sends only the ingredients when only a quantity changed", async () => {
  openEditor({ recipe: SOUP });
  setValue(quantityFields()[0], "200");

  query(".done").click();

  await waitFor(() => server.requestFor("PATCH", "/api/recipes/soup") !== undefined);
  assert.deepEqual(server.requestFor("PATCH", "/api/recipes/soup").body, {
    ingredients: [
      { ingredientId: "onion", quantity: 200 },
      { ingredientId: "salt", quantity: 0.5 },
    ],
  });
  await respondTo("PATCH", "/api/recipes/soup", 200, SOUP);
});

test("Done with no changes closes without a request and returns focus to the opener", () => {
  const { opener, saved } = openEditor({ recipe: SOUP });
  setValue(quantityFields()[0], "150.0"); // the same quantity

  query(".done").click();

  assert.equal(dialog.open, false);
  assert.equal(server.requests.length, 0);
  assert.deepEqual(saved, []);
  assert.equal(document.activeElement, opener);
});

test("a name conflict (409) shows the message under Name and keeps the editor open", async () => {
  openEditor();
  setValue(nameField(), "soup");

  query(".done").click();
  await respondTo("POST", "/api/recipes", 409, {
    error: 'A recipe named "Soup" already exists.',
    recipe: { id: "x", name: "Soup", archived: false, ingredients: [] },
  });

  assert.equal(dialog.open, true);
  assert.equal(query(".name-message").textContent, '"Soup" already exists.');
  assert.equal(nameField().value, "soup");
  assert.equal(document.activeElement, nameField());
  assert.equal(query(".done").disabled, false);
});

test("a conflict with an archived recipe says to restore it from Archived", async () => {
  openEditor();
  setValue(nameField(), "Soup");

  query(".done").click();
  await respondTo("POST", "/api/recipes", 409, {
    error: 'A recipe named "Soup" already exists.',
    recipe: { id: "x", name: "Soup", archived: true, ingredients: [] },
  });

  assert.equal(
    query(".name-message").textContent,
    '"Soup" is archived. To use it, restore it from Archived.',
  );
});

test("a rejected save (400) shows the server's message", async () => {
  openEditor();
  setValue(nameField(), "Soup");

  query(".done").click();
  await respondTo("POST", "/api/recipes", 400, { error: "The name must be at most 100 characters." });

  assert.equal(query(".save-message").textContent, "The name must be at most 100 characters.");
  assert.equal(dialog.open, true);
});

test("a network error keeps the editor open with the changes", async () => {
  openEditor({ recipe: SOUP });
  setValue(nameField(), "Stew");

  query(".done").click();
  await waitFor(() => server.requestFor("PATCH", "/api/recipes/soup") !== undefined);
  server.requestFor("PATCH", "/api/recipes/soup").fail();
  await tick();

  assert.equal(dialog.open, true);
  assert.equal(query(".save-message").textContent, "Couldn't save the recipe. Try again.");
  assert.equal(nameField().value, "Stew");
  assert.equal(document.activeElement, query(".done"));
});

test("Remove takes the row out and moves focus to the next Remove, then the title", () => {
  openEditor({ recipe: SOUP });

  query('[aria-label="Remove Onion"]').click();

  assert.deepEqual(rowNames(), ["Salt (archived)"]);
  assert.equal(document.activeElement, query('[aria-label="Remove Salt"]'));
  assert.deepEqual(optionTexts(), ["Egg (pcs)", "Milk (ml)", "Onion (g)"]);

  query('[aria-label="Remove Salt"]').click();

  assert.equal(document.activeElement, query(".dialog-title"));
  assert.equal(query(".no-ingredients").hidden, false);
});

test("Cancel discards the changes and returns focus to the opener", () => {
  const { opener, saved } = openEditor({ recipe: SOUP });
  setValue(nameField(), "Stew");

  query(".cancel").click();

  assert.equal(dialog.open, false);
  assert.equal(editor.isOpen(), false);
  assert.deepEqual(saved, []);
  assert.equal(document.activeElement, opener);
  assert.equal(server.requests.length, 0);
});

test("Escape (the dialog's close event) discards the changes", () => {
  const { opener } = openEditor({ recipe: SOUP });
  setValue(nameField(), "Stew");

  // The browser fires "close" for Escape and Android's Back; happy-dom
  // doesn't drive that from a keypress, so the test closes the dialog itself.
  dialog.close();

  assert.equal(editor.isOpen(), false);
  assert.equal(document.activeElement, opener);
  assert.equal(server.requests.length, 0);
});

test("a backdrop click closes the editor only when nothing changed", () => {
  openEditor({ recipe: SOUP });
  pointerdownOn(dialog);
  dialog.click();
  assert.equal(dialog.open, false);

  openEditor({ recipe: SOUP });
  setValue(quantityFields()[0], "10");
  pointerdownOn(dialog);
  dialog.click();
  assert.equal(dialog.open, true);
  assert.equal(editor.hasChanges(), true);
});

test("Enter in Name or in a quantity confirms, the same as Done", async () => {
  openEditor({ recipe: SOUP });
  setValue(nameField(), "Stew");

  const event = keydownOn(nameField(), "Enter");

  assert.equal(event.defaultPrevented, true);
  await waitFor(() => server.requestFor("PATCH", "/api/recipes/soup") !== undefined);
  await respondTo("PATCH", "/api/recipes/soup", 200, { ...SOUP, name: "Stew" });

  openEditor({ recipe: SOUP });
  setValue(quantityFields()[0], "300");
  keydownOn(quantityFields()[0], "Enter");
  await waitFor(() => server.requests.filter((request) => request.method === "PATCH").length === 2);
  server.requests.filter((request) => request.method === "PATCH")[1].respond(200, SOUP);
  await tick();
});

test("at 50 ingredients, Add ingredient is disabled with the limit's placeholder", () => {
  const many = Array.from({ length: 51 }, (_, index) => ({
    id: `i${index}`,
    name: `Ingredient ${index}`,
    unit: "g",
    archived: false,
  }));
  const big = {
    id: "big",
    name: "Big",
    archived: false,
    ingredients: many.slice(0, 50).map((ingredient) => ({ ingredientId: ingredient.id, quantity: 1 })),
  };
  openEditor({ recipe: big, ingredients: many });

  assert.equal(search().disabled, true);
  assert.equal(search().placeholder, "A recipe holds up to 50 ingredients.");
  assert.equal(query(".no-match").hidden, true);

  query('[aria-label="Remove Ingredient 0"]').click();

  assert.equal(search().disabled, false);
});

test("an ingredient name with HTML renders as text", () => {
  openEditor({ ingredients: [{ id: "b", name: "<b>Bold</b>", unit: "g", archived: false }] });

  assert.deepEqual(optionTexts(), ["<b>Bold</b> (g)"]);
  assert.equal(query(".options b"), null);
});
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `node --test test/recipe-editor.test.js`

Expected: FAIL with `Cannot find module '.../public/recipe-editor.js'`.

- [ ] **Step 4: Write the code**

Create `public/recipe-editor.js`:

```js
// The recipe editor: a modal dialog that creates a recipe, or changes the
// name and the ingredients of one. It follows the app's interaction rules:
// - Done checks the fields and saves them with one request. The editor
//   closes only when the save succeeds.
// - Cancel, Escape, and Android's Back discard the changes.
// - Clicking the backdrop closes the editor only when nothing changed, so a
//   stray click never throws work away.

import { createCombobox } from "./combobox.js";
import { createButton, createElement, onBackdropClick } from "./dom.js";
import { sendJson } from "./http.js";
import { conflictText } from "./messages.js";
import { filterByName, sortByName } from "./name-search.js";
import { MAX_INGREDIENTS, parseQuantity } from "./quantities.js";

const QUANTITY_MESSAGE = "Enter a quantity from 0.1 to 10000, with up to one decimal.";

function sameIngredients(a, b) {
  return (
    a.length === b.length &&
    a.every(
      (entry, index) =>
        entry.ingredientId === b[index].ingredientId && entry.quantity === b[index].quantity,
    )
  );
}

export function createRecipeEditor(dialog) {
  const title = dialog.querySelector(".dialog-title");
  const nameField = dialog.querySelector(".name-field");
  const nameMessage = dialog.querySelector(".name-message");
  const rowList = dialog.querySelector(".ingredient-rows");
  const noIngredients = dialog.querySelector(".no-ingredients");
  const search = dialog.querySelector(".option-search");
  const saveMessage = dialog.querySelector(".save-message");
  const doneButton = dialog.querySelector(".done");

  /**
   * The open editing session, or null: { recipe, catalog, rows, opener,
   * onSaved, busy }. `recipe` is undefined for a new recipe, and `catalog`
   * holds every ingredient by ID. Each row is { ingredientId, text, message },
   * where `text` is what its quantity field holds.
   */
  let session = null;

  const combobox = createCombobox({
    input: search,
    list: dialog.querySelector(".options"),
    noMatch: dialog.querySelector(".no-match"),
    idPrefix: "ingredient-option",
    matches: addableIngredients,
    label: (ingredient) => `${ingredient.name} (${ingredient.unit})`,
    onPick: (ingredient) => add(ingredient.id),
    isDisabled: isFull,
  });

  function isFull() {
    return session.rows.length >= MAX_INGREDIENTS;
  }

  // The rows that `recipe` starts with.
  function rowsOf(recipe) {
    return (recipe?.ingredients ?? []).map(({ ingredientId, quantity }) => ({
      ingredientId,
      text: String(quantity),
      message: "",
    }));
  }

  function open({ recipe, ingredients, opener, onSaved }) {
    session = {
      recipe,
      catalog: new Map(ingredients.map((ingredient) => [ingredient.id, ingredient])),
      rows: rowsOf(recipe),
      opener,
      onSaved,
      busy: false,
    };
    title.textContent = recipe ? "Edit recipe" : "New recipe";
    nameField.value = recipe?.name ?? "";
    nameMessage.textContent = "";
    saveMessage.textContent = "";
    setBusy(false);
    renderRows();
    combobox.reset();
    dialog.showModal();
    // A new recipe starts with its name. An existing one starts on the
    // title: on a phone, focusing a field opens the keyboard.
    (recipe ? title : nameField).focus();
  }

  function isOpen() {
    return session !== null;
  }

  /** True when the fields differ from what the editor opened with. */
  function hasChanges() {
    if (session === null) return false;
    const original = rowsOf(session.recipe);
    return (
      nameField.value !== (session.recipe?.name ?? "") ||
      session.rows.length !== original.length ||
      session.rows.some(
        (row, index) =>
          row.ingredientId !== original[index].ingredientId || row.text !== original[index].text,
      )
    );
  }

  // Closes the editor. After a save, `onSaved` gets the saved recipe and
  // moves focus. Otherwise, focus returns to the opener.
  function finish(saved) {
    if (session === null) return;
    const { opener, onSaved } = session;
    session = null;
    if (dialog.open) dialog.close();
    if (saved) onSaved(saved);
    else opener.focus();
  }

  function setBusy(busy) {
    session.busy = busy;
    for (const control of dialog.querySelectorAll("input, button")) control.disabled = busy;
    search.disabled = busy || isFull();
  }

  function rowElement(row, index) {
    const ingredient = session.catalog.get(row.ingredientId);
    const name = ingredient?.name ?? "Unknown ingredient";
    const item = createElement("li", "ingredient-row");
    const field = createElement("input", "quantity-field");
    field.type = "text";
    field.value = row.text;
    field.setAttribute("autocomplete", "off");
    field.setAttribute("inputmode", "decimal");
    field.setAttribute("aria-label", `Quantity of ${name} per serving`);
    field.addEventListener("input", () => {
      row.text = field.value;
    });
    const remove = createButton("Remove", `Remove ${name}`, "remove");
    remove.addEventListener("click", () => removeRow(index));
    item.append(
      createElement("span", "ingredient-name", ingredient?.archived ? `${name} (archived)` : name),
      field,
      createElement("span", "unit", ingredient?.unit ?? ""),
      remove,
    );
    if (row.message) {
      field.setAttribute("aria-invalid", "true");
      item.append(createElement("p", "row-message", row.message));
    }
    return item;
  }

  function renderRows() {
    rowList.replaceChildren(...session.rows.map(rowElement));
    noIngredients.hidden = session.rows.length > 0;
    search.disabled = session.busy || isFull();
    search.placeholder = isFull() ? `A recipe holds up to ${MAX_INGREDIENTS} ingredients.` : "";
  }

  // The active ingredients that aren't in the recipe yet and match `query`,
  // from A to Z.
  function addableIngredients(query) {
    const used = new Set(session.rows.map((row) => row.ingredientId));
    const offered = [...session.catalog.values()].filter(
      (ingredient) => !ingredient.archived && !used.has(ingredient.id),
    );
    return sortByName(filterByName(offered, query));
  }

  // Adds a row with an empty quantity, and focuses its field.
  function add(ingredientId) {
    session.rows.push({ ingredientId, text: "", message: "" });
    renderRows();
    combobox.reset();
    rowList.lastElementChild.querySelector(".quantity-field").focus();
  }

  // After Remove takes a row out, focus the Remove button of the row now in
  // its place, else of the previous row, else the title. Focusing the search
  // field instead would open the keyboard on a phone.
  function removeRow(index) {
    session.rows.splice(index, 1);
    renderRows();
    combobox.render();
    const row = rowList.children[Math.min(index, rowList.children.length - 1)];
    (row?.querySelector(".remove") ?? title).focus();
  }

  // Reads every quantity and shows a message under each invalid one. Returns
  // the recipe's ingredients, or null when any quantity is invalid.
  function readIngredients() {
    const ingredients = [];
    for (const row of session.rows) {
      const quantity = parseQuantity(row.text);
      row.message = quantity === null ? QUANTITY_MESSAGE : "";
      if (quantity !== null) ingredients.push({ ingredientId: row.ingredientId, quantity });
    }
    renderRows();
    return ingredients.length === session.rows.length ? ingredients : null;
  }

  // The request body: the whole recipe when it's new, else only the fields
  // that changed, or null when nothing did.
  function changes(name, ingredients) {
    const { recipe } = session;
    if (!recipe) return { name, ingredients };
    const body = {};
    if (name !== recipe.name) body.name = name;
    if (!sameIngredients(ingredients, recipe.ingredients)) body.ingredients = ingredients;
    return Object.keys(body).length > 0 ? body : null;
  }

  // Sends `body`. Returns the saved recipe, or undefined after showing why
  // the save failed.
  async function send(body) {
    const { recipe } = session;
    try {
      const { status, body: reply } = recipe
        ? await sendJson("PATCH", `/api/recipes/${encodeURIComponent(recipe.id)}`, body)
        : await sendJson("POST", "/api/recipes", body);
      if (status === 200 || status === 201) return reply;
      if (status === 409 && reply.recipe) {
        const text = conflictText(reply.recipe);
        nameMessage.textContent = reply.recipe.archived
          ? `${text} To use it, restore it from Archived.`
          : text;
        return undefined;
      }
      if (status === 400 && typeof reply.error === "string") {
        saveMessage.textContent = reply.error;
        return undefined;
      }
      throw new Error(`HTTP ${status}`);
    } catch (error) {
      console.error("Couldn't save the recipe:", error);
      saveMessage.textContent = "Couldn't save the recipe. Try again.";
      return undefined;
    }
  }

  async function save() {
    if (session === null || session.busy) return;
    nameMessage.textContent = nameField.value.trim() === "" ? "The name can't be empty." : "";
    saveMessage.textContent = "";
    const ingredients = readIngredients();
    if (nameMessage.textContent !== "") {
      nameField.focus();
      return;
    }
    if (ingredients === null) {
      rowList.querySelector('[aria-invalid="true"]').focus();
      return;
    }
    const body = changes(nameField.value, ingredients);
    if (body === null) {
      finish();
      return;
    }
    setBusy(true);
    const saved = await send(body);
    setBusy(false);
    if (saved) finish(saved);
    else if (nameMessage.textContent !== "") nameField.focus();
    else doneButton.focus();
  }

  dialog.querySelector(".cancel").addEventListener("click", () => finish());
  doneButton.addEventListener("click", save);
  // Escape and Android's Back close the dialog, which discards the changes,
  // except while a save runs.
  dialog.addEventListener("cancel", (event) => {
    if (session?.busy) event.preventDefault();
  });
  dialog.addEventListener("close", () => finish());
  onBackdropClick(dialog, () => {
    if (session !== null && !session.busy && !hasChanges()) finish();
  });
  // Enter confirms the innermost edit. In Name, in a quantity, on the title,
  // or on the dialog itself, that's Done. Buttons and Add ingredient handle
  // their own Enter.
  dialog.addEventListener("keydown", (event) => {
    if (event.isComposing || event.key !== "Enter") return;
    const { target } = event;
    if (
      target === title ||
      target === dialog ||
      target === nameField ||
      target.classList.contains("quantity-field")
    ) {
      event.preventDefault();
      save();
    }
  });

  return { hasChanges, isOpen, open };
}
```

Add to `public/styles.css`, after the `.dialog-actions` rule:

```css
/* ---------- Recipe and ingredient editors ---------- */

.field-label {
  font-weight: 600;
}

.dialog-subtitle {
  margin: 0.5rem 0 0;
  font-size: 1rem;
}

.name-field,
.quantity-field,
.unit-field {
  padding: 0.4rem;
  border: 1px solid var(--border);
  border-radius: 0.3rem;
  font: inherit;
}

.name-field {
  width: 100%;
}

.ingredient-rows {
  margin: 0;
  padding: 0;
  list-style: none;
}

.ingredient-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0;
  border-bottom: 1px solid #eee;
}

.ingredient-name {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.quantity-field {
  width: 5.5rem;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.unit {
  min-width: 2rem;
}
```

In the mobile media query of `public/styles.css`, after the rule for
`.option-search`, add:

```css
  /* >= 16px prevents iOS Safari from zooming in on focus. */
  .name-field,
  .quantity-field,
  .unit-field {
    font-size: 16px;
  }
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npm run format && npm run lint && npm test`

Expected: PASS, with clean output.

- [ ] **Step 6: Commit**

```bash
git add public/recipe-editor.js public/recipes.html public/styles.css test/recipe-editor.test.js
git commit -m "feat(ui): add the recipe editor"
```

---

### Task 10: Use the recipe editor on the recipe book page

Replaces the **New recipe** form and renaming in place with the recipe
editor, marks recipes without ingredients, and moves the list logic to
`public/catalog-list.js`, which the **Ingredients** page reuses in Task 12.

**Files:**

- Create: `public/catalog-list.js`
- Modify: `public/recipes.html`, `public/recipes.js` (rewrite),
  `public/dom.js`, `public/styles.css`, `test/recipes-page.test.js`
  (rewrite)

**Interfaces:**

- Consumes: `createRecipeEditor` from Task 9, `filterByName` and
  `sortByName` from Task 5.
- Produces: `createCatalogList({ elements, noun, url, details, onEdit })` →
  `{ focusEdit, remember, resetMessages, setEntries }`:
  - `elements`: `{ search, emptyMessage, noMatches, activeList, archived, archivedCount, archivedList }`.
  - `noun`: `"recipe"` or `"ingredient"`, for messages.
  - `url(id)`: the entry's API URL.
  - `details(entry)`: the nodes a row shows after the name.
  - `onEdit(entry, editButton)`: opens the entry's editor.
  - `setEntries(entries)` and `remember(entry)` render the list.
    `focusEdit(id)` focuses the row's **Edit** button, or **Search** when
    the search hides the row.
- Produces: rows are `li.catalog-row[data-id]` with `.entry-name`, and the
  buttons `Edit NAME`, `Archive NAME`, and `Restore NAME` (accessible names).
- Produces: `focusIsFree()` and `createWarningIcon(label?)` in
  `public/dom.js`.

- [ ] **Step 1: Rewrite the page tests**

Replace `test/recipes-page.test.js` with:

```js
// Tests for the recipe book page (public/recipes.js) against a real DOM,
// built from the real public/recipes.html. See test/dom-helpers.js for the
// harness and the DOM library choice. The recipe editor itself has its own
// tests in test/recipe-editor.test.js.

import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { fakeFetch, loadPage, tick, waitFor } from "./dom-helpers.js";

const ONION = { id: "onion", name: "Onion", unit: "g", archived: false };
const WITH_ONION = [{ ingredientId: "onion", quantity: 100 }];

function recipe(id, name, archived = false, ingredients = []) {
  return { id, name, archived, ingredients };
}

let page;
let server;
let document;
let window;

async function openRecipesPage(recipes = [], ingredients = [ONION]) {
  server = fakeFetch();
  page = await loadPage({ html: "recipes.html", script: "recipes.js", fetch: server.fetch });
  ({ document, window } = page);
  await tick();
  server.requestFor("GET", "/api/recipes").respond(200, { recipes });
  server.requestFor("GET", "/api/ingredients").respond(200, { ingredients });
  await tick();
}

function setValue(element, value) {
  element.value = value;
  element.dispatchEvent(new window.Event("input", { bubbles: true }));
}

function keydownOn(element, key) {
  const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  return event;
}

function searchField() {
  return document.getElementById("search");
}

function activeNames() {
  return [...document.querySelectorAll("#active-recipes .entry-name")].map((el) => el.textContent);
}

function archivedNames() {
  return [...document.querySelectorAll("#archived-recipes .entry-name")].map(
    (el) => el.textContent,
  );
}

function rowById(id) {
  return document.querySelector(`.catalog-row[data-id="${id}"]`);
}

function buttonLabeled(label) {
  return document.querySelector(`[aria-label="${label}"]`);
}

function editorDialog() {
  return document.getElementById("recipe-editor");
}

async function respondTo(method, url, status, body) {
  await waitFor(() => server.requestFor(method, url) !== undefined);
  server.requestFor(method, url).respond(status, body);
  await tick();
}

beforeEach(() => {
  mock.method(console, "error", () => {}); // some tests simulate a failed request on purpose
});

afterEach(async () => {
  await page.cleanup();
  mock.restoreAll();
});

test("New recipe opens the editor, and the saved recipe appears in its sorted place with focus on Edit", async () => {
  await openRecipesPage([recipe("1", "Green salad", false, WITH_ONION)]);

  document.getElementById("new-recipe").click();

  assert.equal(editorDialog().open, true);
  assert.equal(editorDialog().querySelector(".dialog-title").textContent, "New recipe");
  setValue(document.getElementById("recipe-name"), "Apple pie");
  editorDialog().querySelector(".done").click();
  await respondTo("POST", "/api/recipes", 201, recipe("2", "Apple pie"));

  assert.equal(editorDialog().open, false);
  assert.deepEqual(activeNames(), ["Apple pie", "Green salad"]);
  assert.equal(document.activeElement, buttonLabeled("Edit Apple pie"));
});

test("Cancel in a new recipe returns focus to New recipe and sends nothing", async () => {
  await openRecipesPage();
  const newRecipe = document.getElementById("new-recipe");

  newRecipe.click();
  editorDialog().querySelector(".cancel").click();

  assert.equal(editorDialog().open, false);
  assert.equal(document.activeElement, newRecipe);
  assert.equal(server.requestFor("POST", "/api/recipes"), undefined);
});

test("Edit opens the recipe with its ingredients, and a save updates its row", async () => {
  await openRecipesPage([recipe("1", "Soup", false, WITH_ONION)]);

  buttonLabeled("Edit Soup").click();

  assert.equal(document.getElementById("recipe-name").value, "Soup");
  assert.equal(editorDialog().querySelector(".quantity-field").value, "100");
  setValue(document.getElementById("recipe-name"), "Onion soup");
  editorDialog().querySelector(".done").click();
  await respondTo("PATCH", "/api/recipes/1", 200, recipe("1", "Onion soup", false, WITH_ONION));

  assert.deepEqual(activeNames(), ["Onion soup"]);
  assert.equal(document.activeElement, buttonLabeled("Edit Onion soup"));
});

test("archived recipes have Edit and Restore", async () => {
  await openRecipesPage([recipe("1", "Café", true)]);

  assert.ok(buttonLabeled("Edit Café"));
  assert.ok(buttonLabeled("Restore Café"));
  assert.equal(buttonLabeled("Archive Café"), null);
});

test("a recipe without ingredients shows a warning icon, and one with ingredients doesn't", async () => {
  await openRecipesPage([recipe("1", "Coffee"), recipe("2", "Soup", false, WITH_ONION)]);

  const icon = rowById("1").querySelector(".warning-icon");
  assert.equal(icon.getAttribute("role"), "img");
  assert.equal(icon.getAttribute("aria-label"), "No ingredients");
  assert.equal(icon.title, "No ingredients");
  assert.equal(rowById("2").querySelector(".warning-icon"), null);
});

test("saving ingredients for a recipe removes its warning icon", async () => {
  await openRecipesPage([recipe("1", "Soup")]);

  buttonLabeled("Edit Soup").click();
  const search = editorDialog().querySelector(".option-search");
  setValue(search, "oni");
  keydownOn(search, "Enter");
  setValue(editorDialog().querySelector(".quantity-field"), "100");
  editorDialog().querySelector(".done").click();
  await respondTo("PATCH", "/api/recipes/1", 200, recipe("1", "Soup", false, WITH_ONION));

  assert.equal(rowById("1").querySelector(".warning-icon"), null);
});

test("beforeunload prevents leaving only while the editor has changes", async () => {
  await openRecipesPage();
  function dispatchBeforeUnload() {
    const event = new window.Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event;
  }

  document.getElementById("new-recipe").click();
  assert.equal(dispatchBeforeUnload().defaultPrevented, false);
  setValue(document.getElementById("recipe-name"), "Pie");
  assert.equal(dispatchBeforeUnload().defaultPrevented, true);
  editorDialog().querySelector(".cancel").click();
  assert.equal(dispatchBeforeUnload().defaultPrevented, false);
});

test("Archive and Restore move a recipe between the lists", async () => {
  await openRecipesPage([recipe("1", "Omelette"), recipe("2", "Café", true)]);

  buttonLabeled("Archive Omelette").click();
  await respondTo("PATCH", "/api/recipes/1", 200, recipe("1", "Omelette", true));
  assert.deepEqual(activeNames(), []);
  assert.deepEqual(archivedNames(), ["Café", "Omelette"]);

  buttonLabeled("Restore Café").click();
  await respondTo("PATCH", "/api/recipes/2", 200, recipe("2", "Café", false));
  assert.deepEqual(activeNames(), ["Café"]);
  assert.deepEqual(archivedNames(), ["Omelette"]);
});

test("a failed archive shows its message and leaves the recipe in place", async () => {
  await openRecipesPage([recipe("1", "Omelette")]);

  buttonLabeled("Archive Omelette").click();
  await waitFor(() => server.requestFor("PATCH", "/api/recipes/1") !== undefined);
  server.requestFor("PATCH", "/api/recipes/1").fail();
  await tick();

  assert.equal(
    rowById("1").querySelector(".row-message").textContent,
    "Couldn't archive the recipe. Try again.",
  );
  assert.deepEqual(activeNames(), ["Omelette"]);
});

test("shows the empty-book message when there are no recipes", async () => {
  await openRecipesPage([]);

  const empty = document.getElementById("empty-book");
  assert.equal(empty.hidden, false);
  assert.equal(empty.textContent, "No recipes yet. Add your first one with New recipe.");
});

test("search filters the active list to matches", async () => {
  await openRecipesPage([recipe("1", "Green salad"), recipe("2", "Lentil soup")]);
  assert.equal(document.getElementById("empty-book").hidden, true);
  assert.equal(document.getElementById("no-matches").hidden, true);

  setValue(searchField(), "sal");

  assert.deepEqual(activeNames(), ["Green salad"]);
});

test("search shows the no-match message when no active recipe matches", async () => {
  await openRecipesPage([recipe("1", "Green salad"), recipe("2", "Lentil soup")]);

  setValue(searchField(), "zzz");

  assert.deepEqual(activeNames(), []);
  assert.equal(document.getElementById("no-matches").hidden, false);
  assert.equal(document.getElementById("no-matches").textContent, 'No recipes match "zzz".');
});

test("a search that matches only an archived recipe still shows the no-match message", async () => {
  await openRecipesPage([recipe("1", "Omelette", true)]);

  setValue(searchField(), "omel");

  assert.deepEqual(activeNames(), []);
  assert.equal(document.getElementById("no-matches").hidden, false);
  assert.equal(document.getElementById("no-matches").textContent, 'No recipes match "omel".');
  assert.deepEqual(archivedNames(), ["Omelette"]); // stays in Archived
});

test("the Archived count reflects the archived recipes", async () => {
  await openRecipesPage([recipe("1", "Omelette"), recipe("2", "Café", true)]);

  assert.equal(document.getElementById("archived").hidden, false);
  assert.equal(document.getElementById("archived-count").textContent, "1");

  buttonLabeled("Archive Omelette").click();
  await respondTo("PATCH", "/api/recipes/1", 200, recipe("1", "Omelette", true));

  assert.equal(document.getElementById("archived-count").textContent, "2");
});

test("a search that doesn't match an archived recipe leaves the Archived count unchanged", async () => {
  await openRecipesPage([recipe("1", "Omelette"), recipe("2", "Café", true)]);
  assert.equal(document.getElementById("archived-count").textContent, "1");

  setValue(searchField(), "zzz");

  assert.equal(document.getElementById("archived-count").textContent, "1");
});

test("a failed load of the ingredient catalog shows the error, and Retry loads both again", async () => {
  server = fakeFetch();
  page = await loadPage({ html: "recipes.html", script: "recipes.js", fetch: server.fetch });
  ({ document, window } = page);
  await tick();
  server.requestFor("GET", "/api/recipes").respond(200, { recipes: [] });
  server.requestFor("GET", "/api/ingredients").fail();
  await tick();

  assert.equal(document.getElementById("load-error").hidden, false);
  assert.equal(document.getElementById("recipe-book").hidden, true);

  document.getElementById("retry-load").click();
  await waitFor(
    () => server.requests.filter((request) => request.url === "/api/ingredients").length === 2,
  );
  server.requests
    .filter((request) => request.url === "/api/recipes")[1]
    .respond(200, { recipes: [recipe("1", "Soup")] });
  server.requests
    .filter((request) => request.url === "/api/ingredients")[1]
    .respond(200, { ingredients: [] });
  await tick();

  assert.equal(document.getElementById("load-error").hidden, true);
  assert.deepEqual(activeNames(), ["Soup"]);
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `node --test test/recipes-page.test.js`

Expected: FAIL. The page has no `#new-recipe` button yet, rows have no
`.entry-name`, and the page never requests `/api/ingredients`.

- [ ] **Step 3: Write the code**

Add to `public/dom.js`:

```js
/**
 * True when nothing has focus. The control that started a request is
 * disabled while the request runs, so its focus falls to <body>. Anything
 * else means the user moved on, and a finished request must not steal focus
 * back.
 */
export function focusIsFree() {
  return document.activeElement === null || document.activeElement === document.body;
}

// A triangle with an exclamation mark, drawn with currentColor.
const WARNING_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3.5L2.5 20h19L12 3.5z"/><path d="M12 10v4.5M12 17.5v.01"/></svg>';

/**
 * A warning icon. With a `label`, the icon has that accessible name and
 * tooltip. Without one, it's decorative, and screen readers skip it.
 */
export function createWarningIcon(label) {
  const icon = createElement("span", "warning-icon");
  icon.innerHTML = WARNING_ICON; // static markup, never user text
  if (label) {
    icon.setAttribute("role", "img");
    icon.setAttribute("aria-label", label);
    icon.title = label;
  }
  return icon;
}
```

Create `public/catalog-list.js`:

```js
// The list logic that the recipe book and the ingredient catalog share:
// search, the active and archived lists, archiving and restoring, row
// messages, and moving focus after a row leaves a list. Each page supplies
// its elements, its texts, and what a row shows besides the name.

import { createButton, createElement, focusIsFree } from "./dom.js";
import { sendJson } from "./http.js";
import { quoted } from "./messages.js";
import { filterByName, sortByName } from "./name-search.js";

/**
 * `elements` holds the page's `search` field, `emptyMessage`, `noMatches`,
 * `activeList`, `archived` (the <details>), `archivedCount`, and
 * `archivedList`. `noun` is "recipe" or "ingredient", for messages.
 * `url(id)` is an entry's API URL, and `details(entry)` returns the nodes a
 * row shows after the name. `onEdit(entry, editButton)` opens the entry's
 * editor.
 *
 * Returns { focusEdit, remember, resetMessages, setEntries }.
 */
export function createCatalogList({ elements, noun, url, details, onEdit }) {
  const { search, emptyMessage, noMatches, activeList, archived, archivedCount, archivedList } =
    elements;

  /** Every entry, active and archived, as the server last confirmed. */
  let entries = [];
  /** Error messages under rows, by entry ID. */
  const rowMessages = new Map();
  /** Entry IDs with an archive or restore request running. */
  const busy = new Set();

  function rowElement(id) {
    const selector = `.catalog-row[data-id="${CSS.escape(id)}"]`;
    return activeList.querySelector(selector) ?? archivedList.querySelector(selector);
  }

  function button(text, label, onClick) {
    const element = createButton(text, label);
    element.addEventListener("click", onClick);
    return element;
  }

  function row(entry) {
    const item = createElement("li", "catalog-row");
    item.dataset.id = entry.id;
    const label = createElement("span", "entry");
    label.append(createElement("span", "entry-name", entry.name), ...details(entry));
    const edit = button("Edit", `Edit ${entry.name}`, () => onEdit(entry, edit));
    const toggle = entry.archived
      ? button("Restore", `Restore ${entry.name}`, () => setArchived(entry.id, false))
      : button("Archive", `Archive ${entry.name}`, () => setArchived(entry.id, true));
    const actions = createElement("span", "row-actions");
    actions.append(edit, toggle);
    for (const control of actions.children) control.disabled = busy.has(entry.id);
    item.append(label, actions);
    const message = rowMessages.get(entry.id);
    if (message) item.append(createElement("p", "row-message", message));
    return item;
  }

  function render() {
    const query = search.value.trim();
    const matches = sortByName(filterByName(entries, search.value));
    const activeMatches = matches.filter((entry) => !entry.archived);
    const archivedTotal = entries.filter((entry) => entry.archived).length;
    activeList.replaceChildren(...activeMatches.map(row));
    archivedList.replaceChildren(...matches.filter((entry) => entry.archived).map(row));
    archivedCount.textContent = String(archivedTotal);
    archived.hidden = archivedTotal === 0;
    emptyMessage.hidden = entries.length > 0;
    // Depends on active matches only: an archived entry that matches doesn't
    // hide the message, because it's as if it didn't exist.
    noMatches.hidden = entries.length === 0 || query === "" || activeMatches.length > 0;
    noMatches.textContent = `No ${noun}s match ${quoted(query)}.`;
  }

  function setEntries(list) {
    entries = list;
    render();
  }

  /** Replaces or adds `entry`, as the server confirmed it, and shows it. */
  function remember(entry) {
    entries = [...entries.filter((other) => other.id !== entry.id), entry];
    render();
  }

  // Clears every row message and re-renders, so a new request starts without
  // a stale error from an earlier one.
  function resetMessages() {
    rowMessages.clear();
    render();
  }

  /** Focuses the Edit button of an entry's row, or Search when a search hides the row. */
  function focusEdit(id) {
    (rowElement(id)?.querySelector(".row-actions button") ?? search).focus();
  }

  // After a row leaves a list, focus moves to the row now in its place, the
  // one before it, or the search field.
  function focusNeighbor(list, index) {
    const target = list.children[Math.min(index, list.children.length - 1)];
    (target?.querySelector(".row-actions button:last-child") ?? search).focus();
  }

  async function setArchived(id, archive) {
    const failure = archive
      ? `Couldn't archive the ${noun}. Try again.`
      : `Couldn't restore the ${noun}. Try again.`;
    const list = archive ? activeList : archivedList;
    const index = [...list.children].findIndex((element) => element.dataset.id === id);
    busy.add(id);
    resetMessages();
    try {
      const { status, body } = await sendJson("PATCH", url(id), { archived: archive });
      if (status !== 200) throw new Error(`HTTP ${status}`);
      entries = [...entries.filter((entry) => entry.id !== id), body];
    } catch (error) {
      console.error(failure, error);
      rowMessages.set(id, failure);
    }
    busy.delete(id);
    render();
    if (!focusIsFree()) return;
    if (rowMessages.has(id)) {
      rowElement(id)?.querySelector(".row-actions button:last-child")?.focus();
    } else {
      focusNeighbor(list, index);
    }
  }

  search.addEventListener("input", render);

  return { focusEdit, remember, resetMessages, setEntries };
}
```

Replace `public/recipes.js` with:

```js
// Recipe book page. Depends ONLY on the HTTP API (/api/recipes and
// /api/ingredients); never import from server/. Adding and editing a recipe
// happen in the recipe editor, and the list logic lives in catalog-list.js.

import { createCatalogList } from "./catalog-list.js";
import { createWarningIcon, withLoadState } from "./dom.js";
import { getJson } from "./http.js";
import { createRecipeEditor } from "./recipe-editor.js";

const loadError = document.getElementById("load-error");
const retryLoadButton = document.getElementById("retry-load");
const book = document.getElementById("recipe-book");
const newRecipeButton = document.getElementById("new-recipe");
const editor = createRecipeEditor(document.getElementById("recipe-editor"));

/** The ingredient catalog as last loaded, for the editor. */
let ingredients = [];

const list = createCatalogList({
  elements: {
    search: document.getElementById("search"),
    emptyMessage: document.getElementById("empty-book"),
    noMatches: document.getElementById("no-matches"),
    activeList: document.getElementById("active-recipes"),
    archived: document.getElementById("archived"),
    archivedCount: document.getElementById("archived-count"),
    archivedList: document.getElementById("archived-recipes"),
  },
  noun: "recipe",
  url: (id) => `/api/recipes/${encodeURIComponent(id)}`,
  details: (recipe) =>
    recipe.ingredients.length === 0 ? [createWarningIcon("No ingredients")] : [],
  onEdit: openEditor,
});

// Opens the editor on `recipe`, or on a new recipe when it's undefined.
function openEditor(recipe, opener) {
  list.resetMessages();
  editor.open({
    recipe,
    ingredients,
    opener,
    onSaved: (saved) => {
      list.remember(saved);
      list.focusEdit(saved.id);
    },
  });
}

async function load() {
  await withLoadState({
    loadError,
    retryButton: retryLoadButton,
    content: [book],
    errorMessage: "Couldn't load the recipes:",
    run: async () => {
      const [recipeBook, catalog] = await Promise.all([
        getJson("/api/recipes"),
        getJson("/api/ingredients"),
      ]);
      ingredients = catalog.ingredients;
      list.setEntries(recipeBook.recipes);
    },
  });
}

newRecipeButton.addEventListener("click", () => openEditor(undefined, newRecipeButton));
retryLoadButton.addEventListener("click", load);
// Unconfirmed changes in the editor would be lost: ask before leaving.
window.addEventListener("beforeunload", (event) => {
  if (editor.hasChanges()) event.preventDefault();
});

load();
```

In `public/recipes.html`, replace the whole `<main>` element with:

```html
    <main id="recipe-book" class="catalog" hidden>
      <button type="button" id="new-recipe" class="primary new-entry-button">New recipe</button>

      <label for="search">Search</label>
      <input id="search" type="search" autocomplete="off">

      <p id="empty-book" class="hint" hidden>No recipes yet. Add your first one with New recipe.</p>
      <p id="no-matches" class="hint" hidden></p>
      <ul id="active-recipes" class="catalog-list" aria-label="Recipes"></ul>

      <details id="archived" class="archived" hidden>
        <summary>Archived (<span id="archived-count">0</span>)</summary>
        <ul id="archived-recipes" class="catalog-list" aria-label="Archived recipes"></ul>
      </details>
    </main>
```

In `public/styles.css`:

1. Rename the recipe book classes:

   ```bash
   sed -i -e 's/\.recipe-book/.catalog/g' -e 's/\.recipe-list/.catalog-list/g' -e 's/\.recipe-row/.catalog-row/g' -e 's/\.new-recipe/.new-entry/g' public/styles.css
   ```

1. Rename the section comment `/* ---------- Recipe book ---------- */` to
   `/* ---------- Recipe book and ingredient catalog ---------- */`.
1. Delete the `.catalog-row .rename-field` rule.
1. Replace the `.catalog-row .recipe-name` rule with:

   ```css
   .entry {
     display: flex;
     flex: 1;
     align-items: center;
     gap: 0.4rem;
     min-width: 0;
   }

   .entry-name {
     min-width: 0;
     overflow-wrap: anywhere;
   }

   .entry-unit {
     color: #666;
   }

   .new-entry-button {
     align-self: flex-start;
     margin-bottom: 0.75rem;
   }

   .warning-icon {
     display: inline-flex;
     flex-shrink: 0;
     color: var(--warning);
   }

   .warning-icon svg {
     width: 1.1em;
     height: 1.1em;
     fill: none;
     stroke: currentColor;
     stroke-width: 2;
     stroke-linecap: round;
     stroke-linejoin: round;
   }
   ```

1. Add `--warning: #8a5a00;` to `:root`, after `--error`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npm run format && npm run lint && npm test`

Expected: PASS, with clean output.

- [ ] **Step 5: Check it in a browser**

Run `DATA_DIR="$(mktemp -d)" npm start`, add an ingredient with `curl`
(Task 4, Step 5), and open `http://localhost:3000/recipes.html`. Add a
recipe with **New recipe** and one ingredient, add another without
ingredients, and check that only the second one shows the warning icon.
Check the editor on a narrow window. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add public/catalog-list.js public/dom.js public/recipes.html public/recipes.js public/styles.css test/recipes-page.test.js
git commit -m "feat(ui): edit recipes and their ingredients in a dialog"
```

---

### Task 11: Add the ingredient editor

**Files:**

- Create: `public/ingredients.html`, `public/ingredient-editor.js`,
  `test/ingredient-editor.test.js`
- Modify: `public/styles.css`

**Interfaces:**

- Consumes: `onBackdropClick` from Task 8.
- Produces: `createIngredientEditor(dialog)` → `{ hasChanges, open }`.
  `open({ ingredient, usedIn, opener, onSaved })`: `usedIn` is how many
  recipes, active and archived, use the ingredient. `onSaved(saved)` runs
  after a successful save, when the editor has closed.
- Produces: `public/ingredients.html`, with the page markup that Task 12's
  script fills, and the `#ingredient-editor` dialog.

- [ ] **Step 1: Create the page markup**

Create `public/ingredients.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Ingredients</title>
    <link rel="stylesheet" href="styles.css">
    <script type="module" src="ingredients.js"></script>
  </head>
  <body>
    <header class="page-header">
      <div class="title-bar">
        <h1>Ingredients</h1>
        <nav class="page-links" aria-label="Pages">
          <a class="page-link" href="/">Meal plan</a>
          <a class="page-link" href="/recipes.html">Recipes</a>
        </nav>
      </div>
    </header>

    <div id="load-error" class="load-error" role="alert" hidden>
      <span>Couldn't load the ingredients.</span>
      <button type="button" id="retry-load">Retry</button>
    </div>

    <main id="ingredient-catalog" class="catalog" hidden>
      <form id="new-ingredient" class="new-entry">
        <label for="new-ingredient-name">New ingredient</label>
        <div class="field-row">
          <input id="new-ingredient-name" type="text" autocomplete="off">
          <select id="new-ingredient-unit" aria-label="Unit">
            <option value="">Choose a unit</option>
            <option value="g">g</option>
            <option value="ml">ml</option>
            <option value="pcs">pcs</option>
          </select>
          <button type="submit" class="primary">Add</button>
        </div>
        <p id="new-ingredient-message" class="field-message" role="status"></p>
      </form>

      <label for="search">Search</label>
      <input id="search" type="search" autocomplete="off">

      <p id="empty-catalog" class="hint" hidden>No ingredients yet. Add your first one above.</p>
      <p id="no-matches" class="hint" hidden></p>
      <ul id="active-ingredients" class="catalog-list" aria-label="Ingredients"></ul>

      <details id="archived" class="archived" hidden>
        <summary>Archived (<span id="archived-count">0</span>)</summary>
        <ul id="archived-ingredients" class="catalog-list" aria-label="Archived ingredients"></ul>
      </details>
    </main>

    <!-- Ingredient editor. Filled and opened by ingredient-editor.js. -->
    <dialog id="ingredient-editor" class="dialog" aria-labelledby="ingredient-editor-title">
      <div class="dialog-body">
        <h2 id="ingredient-editor-title" class="dialog-title" tabindex="-1">Edit ingredient</h2>
        <label class="field-label" for="ingredient-name">Name</label>
        <input id="ingredient-name" class="name-field" type="text" autocomplete="off">
        <p class="field-message name-message" role="status"></p>
        <label class="field-label" for="ingredient-unit">Unit</label>
        <select id="ingredient-unit" class="unit-field">
          <option value="g">g</option>
          <option value="ml">ml</option>
          <option value="pcs">pcs</option>
        </select>
        <p class="hint unit-hint" hidden></p>
        <p class="field-message save-message" role="status"></p>
        <div class="dialog-actions">
          <button type="button" class="cancel">Cancel</button>
          <button type="button" class="done">Done</button>
        </div>
      </div>
    </dialog>
  </body>
</html>
```

- [ ] **Step 2: Write the failing tests**

Create `test/ingredient-editor.test.js`:

```js
// Tests for the ingredient editor (public/ingredient-editor.js) against a
// real DOM, built from the real dialog markup in public/ingredients.html. See
// test/dom-helpers.js for the harness and the DOM library choice.

import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { fakeFetch, loadDialog, tick, waitFor } from "./dom-helpers.js";

const MILK = { id: "milk", name: "Milk", unit: "g", archived: false };

let server;
let dialog;
let document;
let window;
let editor;
let cleanup;

beforeEach(async () => {
  mock.method(console, "error", () => {}); // some tests simulate a failed save on purpose
  server = fakeFetch();
  let module;
  ({ dialog, document, window, module, cleanup } = await loadDialog({
    html: "ingredients.html",
    id: "ingredient-editor",
    script: "ingredient-editor.js",
    fetch: server.fetch,
  }));
  editor = module.createIngredientEditor(dialog);
});

afterEach(async () => {
  await cleanup();
  mock.restoreAll();
});

function openEditor({ ingredient = MILK, usedIn = 0 } = {}) {
  const opener = document.createElement("button");
  document.body.append(opener);
  const saved = [];
  editor.open({ ingredient, usedIn, opener, onSaved: (entry) => saved.push(entry) });
  return { opener, saved };
}

function query(selector) {
  return document.querySelector(selector);
}

function setName(value) {
  query(".name-field").value = value;
  query(".name-field").dispatchEvent(new window.Event("input", { bubbles: true }));
}

function setUnit(value) {
  query(".unit-field").value = value;
  query(".unit-field").dispatchEvent(new window.Event("change", { bubbles: true }));
}

function pointerdownOn(element) {
  element.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }));
}

async function respondToPatch(status, body) {
  await waitFor(() => server.requestFor("PATCH", "/api/ingredients/milk") !== undefined);
  server.requestFor("PATCH", "/api/ingredients/milk").respond(status, body);
  await tick();
}

test("opens with the name and the unit, focus on the title, and Unit enabled when no recipe uses it", () => {
  openEditor();

  assert.equal(dialog.open, true);
  assert.equal(query(".name-field").value, "Milk");
  assert.equal(query(".unit-field").value, "g");
  assert.equal(query(".unit-field").disabled, false);
  assert.equal(query(".unit-hint").hidden, true);
  assert.equal(document.activeElement, query(".dialog-title"));
});

test("Unit is disabled, with the reason, while recipes use the ingredient", () => {
  openEditor({ usedIn: 2 });

  assert.equal(query(".unit-field").disabled, true);
  assert.equal(query(".unit-hint").hidden, false);
  assert.equal(
    query(".unit-hint").textContent,
    "Used in 2 recipes. To change the unit, remove the ingredient from those recipes first.",
  );

  query(".cancel").click();
  openEditor({ usedIn: 1 });

  assert.equal(
    query(".unit-hint").textContent,
    "Used in 1 recipe. To change the unit, remove the ingredient from that recipe first.",
  );
});

test("Done with no changes closes without a request and returns focus to the opener", () => {
  const { opener } = openEditor();

  query(".done").click();

  assert.equal(dialog.open, false);
  assert.equal(server.requests.length, 0);
  assert.equal(document.activeElement, opener);
});

test("Done sends the changed name and unit in one PATCH, then closes", async () => {
  const { saved } = openEditor();
  setName("Whole milk");
  setUnit("ml");

  query(".done").click();

  assert.equal(query(".done").disabled, true);
  await waitFor(() => server.requestFor("PATCH", "/api/ingredients/milk") !== undefined);
  assert.deepEqual(server.requestFor("PATCH", "/api/ingredients/milk").body, {
    name: "Whole milk",
    unit: "ml",
  });
  const updated = { ...MILK, name: "Whole milk", unit: "ml" };
  await respondToPatch(200, updated);
  assert.equal(dialog.open, false);
  assert.deepEqual(saved, [updated]);
});

test("a name conflict (409) shows the message under Name", async () => {
  openEditor();
  setName("egg");

  query(".done").click();
  await respondToPatch(409, {
    error: 'An ingredient named "Egg" already exists.',
    ingredient: { id: "egg", name: "Egg", unit: "pcs", archived: false },
  });

  assert.equal(dialog.open, true);
  assert.equal(query(".name-message").textContent, '"Egg" already exists.');
  assert.equal(document.activeElement, query(".name-field"));
});

test("a unit in use (409 without an ingredient) shows the server's message", async () => {
  openEditor();
  setUnit("ml");

  query(".done").click();
  await respondToPatch(409, {
    error: '"Milk" is used in recipes. To change its unit, remove it from those recipes first.',
  });

  assert.equal(dialog.open, true);
  assert.equal(
    query(".save-message").textContent,
    '"Milk" is used in recipes. To change its unit, remove it from those recipes first.',
  );
  assert.equal(query(".unit-field").value, "ml");
});

test("a rejected save (400) shows the server's message", async () => {
  openEditor();
  setName(" ");

  query(".done").click();
  await respondToPatch(400, { error: "The name can't be empty." });

  assert.equal(query(".save-message").textContent, "The name can't be empty.");
});

test("a network error keeps the editor open with the changes", async () => {
  openEditor();
  setName("Oat milk");

  query(".done").click();
  await waitFor(() => server.requestFor("PATCH", "/api/ingredients/milk") !== undefined);
  server.requestFor("PATCH", "/api/ingredients/milk").fail();
  await tick();

  assert.equal(dialog.open, true);
  assert.equal(query(".save-message").textContent, "Couldn't save the ingredient. Try again.");
  assert.equal(query(".name-field").value, "Oat milk");
  assert.equal(document.activeElement, query(".done"));
});

test("Cancel and Escape (the dialog's close event) discard the changes", () => {
  const { opener } = openEditor();
  setName("Oat milk");
  query(".cancel").click();
  assert.equal(dialog.open, false);
  assert.equal(document.activeElement, opener);

  openEditor();
  setName("Oat milk");
  dialog.close();
  assert.equal(editor.hasChanges(), false);
  assert.equal(server.requests.length, 0);
});

test("a backdrop click closes the editor only when nothing changed", () => {
  openEditor();
  pointerdownOn(dialog);
  dialog.click();
  assert.equal(dialog.open, false);

  openEditor();
  setUnit("ml");
  pointerdownOn(dialog);
  dialog.click();
  assert.equal(dialog.open, true);
});

test("Enter in Name confirms, the same as Done", async () => {
  openEditor();
  setName("Oat milk");

  const event = new window.KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
  });
  query(".name-field").dispatchEvent(event);

  assert.equal(event.defaultPrevented, true);
  await respondToPatch(200, { ...MILK, name: "Oat milk" });
});
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `node --test test/ingredient-editor.test.js`

Expected: FAIL with `Cannot find module '.../public/ingredient-editor.js'`.

- [ ] **Step 4: Write the code**

Create `public/ingredient-editor.js`:

```js
// The ingredient editor: a modal dialog that changes the name and the unit
// of an ingredient. It follows the app's interaction rules:
// - Done saves the changes with one request. The editor closes only when
//   the save succeeds.
// - Cancel, Escape, and Android's Back discard the changes.
// - Clicking the backdrop closes the editor only when nothing changed.

import { onBackdropClick } from "./dom.js";
import { sendJson } from "./http.js";
import { conflictText } from "./messages.js";

// Why the unit can't change while `count` recipes use the ingredient.
function usedInText(count) {
  return count === 1
    ? "Used in 1 recipe. To change the unit, remove the ingredient from that recipe first."
    : `Used in ${count} recipes. To change the unit, remove the ingredient from those recipes first.`;
}

export function createIngredientEditor(dialog) {
  const title = dialog.querySelector(".dialog-title");
  const nameField = dialog.querySelector(".name-field");
  const nameMessage = dialog.querySelector(".name-message");
  const unitField = dialog.querySelector(".unit-field");
  const unitHint = dialog.querySelector(".unit-hint");
  const saveMessage = dialog.querySelector(".save-message");
  const doneButton = dialog.querySelector(".done");

  /** The open editing session, or null: { ingredient, usedIn, opener, onSaved, busy }. */
  let session = null;

  function open({ ingredient, usedIn, opener, onSaved }) {
    session = { ingredient, usedIn, opener, onSaved, busy: false };
    nameField.value = ingredient.name;
    unitField.value = ingredient.unit;
    nameMessage.textContent = "";
    saveMessage.textContent = "";
    unitHint.textContent = usedIn > 0 ? usedInText(usedIn) : "";
    unitHint.hidden = usedIn === 0;
    setBusy(false);
    dialog.showModal();
    // The title, not a field: on a phone, focusing a field opens the keyboard.
    title.focus();
  }

  /** True when the fields differ from the ingredient. */
  function hasChanges() {
    return (
      session !== null &&
      (nameField.value !== session.ingredient.name || unitField.value !== session.ingredient.unit)
    );
  }

  // Closes the editor. After a save, `onSaved` gets the saved ingredient and
  // moves focus. Otherwise, focus returns to the opener.
  function finish(saved) {
    if (session === null) return;
    const { opener, onSaved } = session;
    session = null;
    if (dialog.open) dialog.close();
    if (saved) onSaved(saved);
    else opener.focus();
  }

  function setBusy(busy) {
    session.busy = busy;
    for (const control of dialog.querySelectorAll("input, button")) control.disabled = busy;
    unitField.disabled = busy || session.usedIn > 0;
  }

  // Sends `body`. Returns the saved ingredient, or undefined after showing why
  // the save failed.
  async function send(body) {
    const url = `/api/ingredients/${encodeURIComponent(session.ingredient.id)}`;
    try {
      const { status, body: reply } = await sendJson("PATCH", url, body);
      if (status === 200) return reply;
      if (status === 409 && reply.ingredient) {
        nameMessage.textContent = conflictText(reply.ingredient);
        return undefined;
      }
      if ((status === 400 || status === 409) && typeof reply.error === "string") {
        saveMessage.textContent = reply.error;
        return undefined;
      }
      throw new Error(`HTTP ${status}`);
    } catch (error) {
      console.error("Couldn't save the ingredient:", error);
      saveMessage.textContent = "Couldn't save the ingredient. Try again.";
      return undefined;
    }
  }

  async function save() {
    if (session === null || session.busy) return;
    const { ingredient } = session;
    const body = {};
    if (nameField.value !== ingredient.name) body.name = nameField.value;
    if (unitField.value !== ingredient.unit) body.unit = unitField.value;
    if (Object.keys(body).length === 0) {
      finish();
      return;
    }
    nameMessage.textContent = "";
    saveMessage.textContent = "";
    setBusy(true);
    const saved = await send(body);
    setBusy(false);
    if (saved) finish(saved);
    else if (nameMessage.textContent !== "") nameField.focus();
    else doneButton.focus();
  }

  dialog.querySelector(".cancel").addEventListener("click", () => finish());
  doneButton.addEventListener("click", save);
  // Escape and Android's Back close the dialog, which discards the changes,
  // except while a save runs.
  dialog.addEventListener("cancel", (event) => {
    if (session?.busy) event.preventDefault();
  });
  dialog.addEventListener("close", () => finish());
  onBackdropClick(dialog, () => {
    if (session !== null && !session.busy && !hasChanges()) finish();
  });
  // Enter confirms the innermost edit. In Name, on the title, or on the
  // dialog itself, that's Done.
  dialog.addEventListener("keydown", (event) => {
    if (event.isComposing || event.key !== "Enter") return;
    if (event.target === title || event.target === dialog || event.target === nameField) {
      event.preventDefault();
      save();
    }
  });

  return { hasChanges, open };
}
```

Add to `public/styles.css`, after the `.unit` rule:

```css
.unit-field {
  background: #fff;
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npm run format && npm run lint && npm test`

Expected: PASS, with clean output.

- [ ] **Step 6: Commit**

```bash
git add public/ingredient-editor.js public/ingredients.html public/styles.css test/ingredient-editor.test.js
git commit -m "feat(ui): add the ingredient editor"
```

---

### Task 12: Add the Ingredients page and link the pages

**Files:**

- Create: `public/ingredients.js`, `test/ingredients-page.test.js`,
  `test/navigation.test.js`
- Modify: `public/index.html`, `public/recipes.html`, `public/styles.css`

**Interfaces:**

- Consumes: `createCatalogList`, `focusIsFree` from Task 10,
  `createIngredientEditor` from Task 11, and `conflictText` from
  `public/messages.js`.
- Produces: the page at `/ingredients.html`, and a `nav.page-links` in the
  title bar of every page.

- [ ] **Step 1: Write the failing tests**

Create `test/navigation.test.js`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Window } from "happy-dom";

const PAGES = [
  ["index.html", ["/recipes.html", "/ingredients.html"]],
  ["recipes.html", ["/", "/ingredients.html"]],
  ["ingredients.html", ["/", "/recipes.html"]],
];

test("each page links to the other two, in the order Meal plan, Recipes, Ingredients", async () => {
  for (const [html, links] of PAGES) {
    const markup = await readFile(new URL(`../public/${html}`, import.meta.url), "utf8");
    const window = new Window({ url: "http://localhost/" });
    window.document.write(markup.replace(/<script[^>]*><\/script>/g, ""));

    const hrefs = [...window.document.querySelectorAll(".page-links a")].map((link) =>
      link.getAttribute("href"),
    );

    assert.deepEqual(hrefs, links, html);
    await window.happyDOM.close();
  }
});
```

Create `test/ingredients-page.test.js`:

```js
// Tests for the Ingredients page (public/ingredients.js) against a real DOM,
// built from the real public/ingredients.html. See test/dom-helpers.js for
// the harness and the DOM library choice. The list logic it shares with the
// recipe book is also covered by test/recipes-page.test.js.

import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { fakeFetch, loadPage, tick, waitFor } from "./dom-helpers.js";

function ingredient(id, name, unit = "g", archived = false) {
  return { id, name, unit, archived };
}

function recipe(id, name, ingredientIds, archived = false) {
  return {
    id,
    name,
    archived,
    ingredients: ingredientIds.map((ingredientId) => ({ ingredientId, quantity: 1 })),
  };
}

let page;
let server;
let document;
let window;

async function openIngredientsPage(ingredients = [], recipes = []) {
  server = fakeFetch();
  page = await loadPage({ html: "ingredients.html", script: "ingredients.js", fetch: server.fetch });
  ({ document, window } = page);
  await tick();
  server.requestFor("GET", "/api/ingredients").respond(200, { ingredients });
  server.requestFor("GET", "/api/recipes").respond(200, { recipes });
  await tick();
}

function nameField() {
  return document.getElementById("new-ingredient-name");
}

function unitField() {
  return document.getElementById("new-ingredient-unit");
}

function addButton() {
  return document.querySelector('#new-ingredient button[type="submit"]');
}

function formMessage() {
  return document.getElementById("new-ingredient-message");
}

function setValue(element, value) {
  element.value = value;
  element.dispatchEvent(new window.Event("input", { bubbles: true }));
}

function chooseUnit(unit) {
  unitField().value = unit;
  unitField().dispatchEvent(new window.Event("change", { bubbles: true }));
}

function activeRows() {
  return [...document.querySelectorAll("#active-ingredients .catalog-row")].map((row) => [
    row.querySelector(".entry-name").textContent,
    row.querySelector(".entry-unit").textContent,
  ]);
}

function activeNames() {
  return activeRows().map(([name]) => name);
}

function archivedNames() {
  return [...document.querySelectorAll("#archived-ingredients .entry-name")].map(
    (el) => el.textContent,
  );
}

function buttonLabeled(label) {
  return document.querySelector(`[aria-label="${label}"]`);
}

async function respondTo(method, url, status, body) {
  await waitFor(() => server.requestFor(method, url) !== undefined);
  server.requestFor(method, url).respond(status, body);
  await tick();
}

beforeEach(() => {
  mock.method(console, "error", () => {}); // some tests simulate a failed request on purpose
});

afterEach(async () => {
  await page.cleanup();
  mock.restoreAll();
});

test("rows show each ingredient's name and unit from A to Z, and archived ones under Archived", async () => {
  await openIngredientsPage([
    ingredient("1", "Onion"),
    ingredient("2", "Egg", "pcs"),
    ingredient("3", "Saffron", "g", true),
  ]);

  assert.deepEqual(activeRows(), [
    ["Egg", "pcs"],
    ["Onion", "g"],
  ]);
  assert.deepEqual(archivedNames(), ["Saffron"]);
});

test("adding an ingredient sends the name and the unit, then clears both fields", async () => {
  await openIngredientsPage([ingredient("1", "Onion")]);
  setValue(nameField(), "Milk");
  chooseUnit("ml");

  addButton().click();
  await waitFor(() => server.requestFor("POST", "/api/ingredients") !== undefined);
  assert.deepEqual(server.requestFor("POST", "/api/ingredients").body, {
    name: "Milk",
    unit: "ml",
  });
  await respondTo("POST", "/api/ingredients", 201, ingredient("2", "Milk", "ml"));

  assert.deepEqual(activeNames(), ["Milk", "Onion"]);
  assert.equal(nameField().value, "");
  assert.equal(unitField().value, "");
  assert.equal(document.activeElement, nameField());
});

test("adding without a unit asks for one and sends nothing", async () => {
  await openIngredientsPage();
  setValue(nameField(), "Milk");

  addButton().click();
  await tick();

  assert.equal(formMessage().textContent, "Choose a unit.");
  assert.equal(document.activeElement, unitField());
  assert.equal(server.requestFor("POST", "/api/ingredients"), undefined);
});

test("adding a name that an active ingredient has shows the conflict", async () => {
  await openIngredientsPage([ingredient("1", "Onion")]);
  setValue(nameField(), "ONION");
  chooseUnit("pcs");

  addButton().click();
  await respondTo("POST", "/api/ingredients", 409, {
    error: 'An ingredient named "Onion" already exists.',
    ingredient: ingredient("1", "Onion"),
  });

  assert.equal(formMessage().textContent, '"Onion" already exists.');
});

test("adding a name that an archived ingredient has offers Restore it", async () => {
  await openIngredientsPage([ingredient("1", "Saffron", "g", true)]);
  setValue(nameField(), "saffron");
  chooseUnit("g");

  addButton().click();
  await respondTo("POST", "/api/ingredients", 409, {
    error: 'An ingredient named "Saffron" already exists.',
    ingredient: ingredient("1", "Saffron", "g", true),
  });
  assert.equal(formMessage().textContent, '"Saffron" is archived. Restore it');

  buttonLabeled("Restore it: Saffron").click();
  await respondTo("PATCH", "/api/ingredients/1", 200, ingredient("1", "Saffron"));

  assert.deepEqual(activeNames(), ["Saffron"]);
  assert.equal(nameField().value, "");
  assert.equal(formMessage().textContent, "");
});

test("a network error adding an ingredient keeps the typed name and unit", async () => {
  await openIngredientsPage();
  setValue(nameField(), "Milk");
  chooseUnit("ml");

  addButton().click();
  await waitFor(() => server.requestFor("POST", "/api/ingredients") !== undefined);
  server.requestFor("POST", "/api/ingredients").fail();
  await tick();

  assert.equal(formMessage().textContent, "Couldn't add the ingredient. Try again.");
  assert.equal(nameField().value, "Milk");
  assert.equal(unitField().value, "ml");
});

test("Escape clears New ingredient", async () => {
  await openIngredientsPage();
  setValue(nameField(), "Milk");

  nameField().dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );

  assert.equal(nameField().value, "");
});

test("Edit opens the editor, and a saved name updates the row and focuses its Edit button", async () => {
  await openIngredientsPage([ingredient("1", "Onion")]);

  buttonLabeled("Edit Onion").click();
  const dialog = document.getElementById("ingredient-editor");
  assert.equal(dialog.open, true);
  setValue(document.getElementById("ingredient-name"), "Red onion");
  dialog.querySelector(".done").click();
  await respondTo("PATCH", "/api/ingredients/1", 200, ingredient("1", "Red onion"));

  assert.equal(dialog.open, false);
  assert.deepEqual(activeNames(), ["Red onion"]);
  assert.equal(document.activeElement, buttonLabeled("Edit Red onion"));
});

test("Edit disables Unit for an ingredient that recipes use, counting archived recipes", async () => {
  await openIngredientsPage(
    [ingredient("1", "Onion"), ingredient("2", "Milk", "ml")],
    [
      recipe("r1", "Soup", ["1"]),
      recipe("r2", "Old soup", ["1"], true),
      recipe("r3", "Latte", ["2"]),
    ],
  );

  buttonLabeled("Edit Onion").click();

  assert.equal(document.getElementById("ingredient-unit").disabled, true);
  assert.equal(
    document.querySelector("#ingredient-editor .unit-hint").textContent,
    "Used in 2 recipes. To change the unit, remove the ingredient from those recipes first.",
  );
});

test("Archive moves an ingredient to Archived", async () => {
  await openIngredientsPage([ingredient("1", "Onion")]);

  buttonLabeled("Archive Onion").click();
  await respondTo("PATCH", "/api/ingredients/1", 200, ingredient("1", "Onion", "g", true));

  assert.deepEqual(activeNames(), []);
  assert.deepEqual(archivedNames(), ["Onion"]);
});

test("the empty catalog and a search with no matches show their messages", async () => {
  await openIngredientsPage();
  assert.equal(
    document.getElementById("empty-catalog").textContent,
    "No ingredients yet. Add your first one above.",
  );
  assert.equal(document.getElementById("empty-catalog").hidden, false);
  await page.cleanup();

  await openIngredientsPage([ingredient("1", "Onion")]);
  setValue(document.getElementById("search"), "zzz");
  assert.equal(document.getElementById("no-matches").textContent, 'No ingredients match "zzz".');
});

test("a load failure shows the error, and Retry loads again", async () => {
  server = fakeFetch();
  page = await loadPage({ html: "ingredients.html", script: "ingredients.js", fetch: server.fetch });
  ({ document, window } = page);
  await tick();
  server.requestFor("GET", "/api/ingredients").fail();
  server.requestFor("GET", "/api/recipes").respond(200, { recipes: [] });
  await tick();

  assert.equal(document.getElementById("load-error").hidden, false);
  assert.equal(document.getElementById("ingredient-catalog").hidden, true);

  document.getElementById("retry-load").click();
  await waitFor(
    () => server.requests.filter((request) => request.url === "/api/ingredients").length === 2,
  );
  server.requests
    .filter((request) => request.url === "/api/ingredients")[1]
    .respond(200, { ingredients: [ingredient("1", "Onion")] });
  server.requests
    .filter((request) => request.url === "/api/recipes")[1]
    .respond(200, { recipes: [] });
  await tick();

  assert.equal(document.getElementById("load-error").hidden, true);
  assert.deepEqual(activeNames(), ["Onion"]);
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `node --test test/ingredients-page.test.js test/navigation.test.js`

Expected: FAIL. `ingredients.js` doesn't exist, so importing it fails, and
`index.html` and `recipes.html` have no `.page-links`.

- [ ] **Step 3: Write the code**

Create `public/ingredients.js`:

```js
// Ingredient catalog page. Depends ONLY on the HTTP API (/api/ingredients and
// /api/recipes); never import from server/. It follows the app's interaction
// rules: Enter or the confirm button confirms, Escape or Cancel discards, and
// leaving a field never discards changes.

import { createCatalogList } from "./catalog-list.js";
import { createButton, createElement, focusIsFree, withLoadState } from "./dom.js";
import { getJson, sendJson } from "./http.js";
import { createIngredientEditor } from "./ingredient-editor.js";
import { conflictText } from "./messages.js";

const loadError = document.getElementById("load-error");
const retryLoadButton = document.getElementById("retry-load");
const catalog = document.getElementById("ingredient-catalog");
const form = document.getElementById("new-ingredient");
const nameField = document.getElementById("new-ingredient-name");
const unitField = document.getElementById("new-ingredient-unit");
const addButton = form.querySelector('button[type="submit"]');
const formMessage = document.getElementById("new-ingredient-message");
const editor = createIngredientEditor(document.getElementById("ingredient-editor"));

/** How many recipes, active and archived, use each ingredient, by ingredient ID. */
let usage = new Map();

function ingredientUrl(id) {
  return `/api/ingredients/${encodeURIComponent(id)}`;
}

const list = createCatalogList({
  elements: {
    search: document.getElementById("search"),
    emptyMessage: document.getElementById("empty-catalog"),
    noMatches: document.getElementById("no-matches"),
    activeList: document.getElementById("active-ingredients"),
    archived: document.getElementById("archived"),
    archivedCount: document.getElementById("archived-count"),
    archivedList: document.getElementById("archived-ingredients"),
  },
  noun: "ingredient",
  url: ingredientUrl,
  details: (ingredient) => [createElement("span", "entry-unit", ingredient.unit)],
  onEdit: openEditor,
});

function countUsage(recipes) {
  const counts = new Map();
  for (const recipe of recipes) {
    for (const { ingredientId } of recipe.ingredients) {
      counts.set(ingredientId, (counts.get(ingredientId) ?? 0) + 1);
    }
  }
  return counts;
}

function openEditor(ingredient, opener) {
  list.resetMessages();
  editor.open({
    ingredient,
    usedIn: usage.get(ingredient.id) ?? 0,
    opener,
    onSaved: (saved) => {
      list.remember(saved);
      list.focusEdit(saved.id);
    },
  });
}

async function load() {
  await withLoadState({
    loadError,
    retryButton: retryLoadButton,
    content: [catalog],
    errorMessage: "Couldn't load the ingredients:",
    run: async () => {
      const [ingredientCatalog, recipeBook] = await Promise.all([
        getJson("/api/ingredients"),
        getJson("/api/recipes"),
      ]);
      usage = countUsage(recipeBook.recipes);
      list.setEntries(ingredientCatalog.ingredients);
    },
  });
}

// ---------- Adding ----------

function showFormMessage(...content) {
  formMessage.replaceChildren(...content);
}

function setFormBusy(isBusy) {
  nameField.disabled = isBusy;
  unitField.disabled = isBusy;
  addButton.disabled = isBusy;
  for (const control of formMessage.querySelectorAll("button")) control.disabled = isBusy;
}

function clearForm() {
  nameField.value = "";
  unitField.value = "";
  showFormMessage();
}

function restoreButton(id, name) {
  const button = createButton("Restore it", `Restore it: ${name}`);
  button.addEventListener("click", () => restoreFromForm(id, name));
  return button;
}

async function addIngredient() {
  if (unitField.value === "") {
    showFormMessage("Choose a unit.");
    unitField.focus();
    return;
  }
  setFormBusy(true);
  showFormMessage();
  list.resetMessages();
  try {
    const { status, body } = await sendJson("POST", "/api/ingredients", {
      name: nameField.value,
      unit: unitField.value,
    });
    if (status === 201) {
      list.remember(body);
      clearForm();
    } else if (status === 409 && body.ingredient?.archived) {
      showFormMessage(
        `${conflictText(body.ingredient)} `,
        restoreButton(body.ingredient.id, body.ingredient.name),
      );
    } else if (status === 409 && body.ingredient) {
      showFormMessage(conflictText(body.ingredient));
    } else if (status === 400 && typeof body.error === "string") {
      showFormMessage(body.error);
    } else {
      throw new Error(`HTTP ${status}`);
    }
  } catch (error) {
    console.error("Couldn't add the ingredient:", error);
    showFormMessage("Couldn't add the ingredient. Try again."); // the text stays in the field
  } finally {
    setFormBusy(false);
    if (focusIsFree()) nameField.focus();
  }
}

async function restoreFromForm(id, name) {
  setFormBusy(true);
  list.resetMessages();
  try {
    const { status, body } = await sendJson("PATCH", ingredientUrl(id), { archived: false });
    if (status !== 200) throw new Error(`HTTP ${status}`);
    list.remember(body);
    clearForm();
  } catch (error) {
    console.error("Couldn't restore the ingredient:", error);
    showFormMessage("Couldn't restore the ingredient. Try again. ", restoreButton(id, name));
  } finally {
    setFormBusy(false);
    if (focusIsFree()) nameField.focus();
  }
}

// ---------- Events ----------

form.addEventListener("submit", (event) => {
  event.preventDefault();
  addIngredient();
});

nameField.addEventListener("keydown", (event) => {
  if (event.isComposing || event.key !== "Escape") return;
  nameField.value = "";
  showFormMessage();
});

retryLoadButton.addEventListener("click", load);
// Unconfirmed changes in the editor would be lost: ask before leaving.
window.addEventListener("beforeunload", (event) => {
  if (editor.hasChanges()) event.preventDefault();
});

load();
```

In `public/index.html`, replace
`<a class="page-link" href="/recipes.html">Recipes</a>` with:

```html
        <nav class="page-links" aria-label="Pages">
          <a class="page-link" href="/recipes.html">Recipes</a>
          <a class="page-link" href="/ingredients.html">Ingredients</a>
        </nav>
```

In `public/recipes.html`, replace
`<a class="page-link" href="/">Meal plan</a>` with:

```html
        <nav class="page-links" aria-label="Pages">
          <a class="page-link" href="/">Meal plan</a>
          <a class="page-link" href="/ingredients.html">Ingredients</a>
        </nav>
```

Add to `public/styles.css`, after the `.page-link` rule:

```css
.page-links {
  display: flex;
  gap: 1rem;
}
```

and, after the `.catalog input` rule:

```css
.catalog select {
  padding: 0.4rem;
  border: 1px solid var(--border);
  border-radius: 0.3rem;
  background: #fff;
  font: inherit;
}
```

In the mobile media query, add `.catalog select` to the selector of the
`.catalog input` rule, so selects also get `font-size: 16px`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npm run format && npm run lint && npm test`

Expected: PASS, with clean output.

- [ ] **Step 5: Check it in a browser**

Run `DATA_DIR="$(mktemp -d)" npm start`, and open
`http://localhost:3000/ingredients.html`. Add an ingredient, try to add one
without a unit, edit one, and follow the links between the three pages.
Check the page on a narrow window. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/ingredients.js public/recipes.html public/styles.css test/ingredients-page.test.js test/navigation.test.js
git commit -m "feat(ui): add the Ingredients page and link the pages"
```

---

### Task 13: Show the shopping list

**Files:**

- Create: `public/shopping-dialog.js`
- Modify: `public/app.js`, `public/index.html`, `public/styles.css`,
  `test/meal-plan-page.test.js`

**Interfaces:**

- Consumes: `shoppingList` from Task 7, `onBackdropClick` from Task 8, and
  `createWarningIcon` from Task 10.
- Produces: `createShoppingDialog(dialog)` → `{ isOpen, open }`.
  `open({ title, list, isEmpty, slotLabel, opener })`: `list` is the
  result of `shoppingList`, `isEmpty` tells that the week has no menu
  items, and `slotLabel({ day, meal })` names a slot, such as
  `Mon dinner`.

- [ ] **Step 1: Write the failing tests**

In `test/meal-plan-page.test.js`:

- Add `import { formatWeekRange } from "../public/dates.js";` to the imports.
- Change `openWeek` to take and serve the ingredient catalog:

```js
async function openWeek({
  week = WEEK,
  weekData = blankWeek(DAYS, MEALS),
  recipes = [],
  ingredients = [],
} = {}) {
  server = fakeFetch();
  page = await loadPage({
    html: "index.html",
    script: "app.js",
    fetch: server.fetch,
    url: `http://localhost/#${week}`,
  });
  await tick();
  server.requestFor("GET", `/api/weeks/${week}`).respond(200, weekData);
  server.requestFor("GET", "/api/recipes").respond(200, { recipes });
  server.requestFor("GET", "/api/ingredients").respond(200, { ingredients });
  await tick();
  return page;
}
```

- In `a load failure shows the error, and Retry reloads`, answer the
  catalog requests too. After the first
  `server.requestFor("GET", "/api/recipes").respond(200, { recipes: [] });`,
  add `server.requestFor("GET", "/api/ingredients").respond(200, { ingredients: [] });`.
  After the second recipes response, add:

```js
  server.requests
    .filter((request) => request.url === "/api/ingredients")[1]
    .respond(200, { ingredients: [] });
```

- Add these tests at the end of the file:

```js
// ---------- Shopping list ----------

const EGG = { id: "egg", name: "Egg", unit: "pcs", archived: false };
const ONION = { id: "onion", name: "Onion", unit: "g", archived: false };

function shoppingButton() {
  return page.document.getElementById("shopping-list");
}

function shoppingDialog() {
  return page.document.getElementById("shopping-dialog");
}

function lineTexts() {
  return [...shoppingDialog().querySelectorAll(".shopping-line")].map((line) => [
    line.querySelector(".line-name").textContent,
    line.querySelector(".line-amount").textContent,
  ]);
}

test("Shopping list shows the week's totals per ingredient, from A to Z", async () => {
  let weekData = withSlot(blankWeek(DAYS, MEALS), "mon", "lunch", [
    { recipeId: "omelette", servings: 2 },
  ]);
  weekData = withSlot(weekData, "tue", "dinner", [{ recipeId: "soup", servings: 1.5 }]);
  await openWeek({
    weekData,
    recipes: [
      {
        id: "omelette",
        name: "Omelette",
        archived: false,
        ingredients: [
          { ingredientId: "egg", quantity: 2 },
          { ingredientId: "onion", quantity: 50 },
        ],
      },
      {
        id: "soup",
        name: "Onion soup",
        archived: false,
        ingredients: [{ ingredientId: "onion", quantity: 150.5 }],
      },
    ],
    ingredients: [ONION, EGG],
  });

  shoppingButton().click();

  assert.equal(shoppingDialog().open, true);
  assert.equal(
    shoppingDialog().querySelector(".dialog-title").textContent,
    `Shopping list · ${formatWeekRange(WEEK)}`,
  );
  assert.deepEqual(lineTexts(), [
    ["Egg", "4 pcs"],
    ["Onion", "326 g"],
  ]);
  assert.equal(shoppingDialog().querySelector(".empty-week").hidden, true);
  assert.equal(shoppingDialog().querySelector(".not-included").hidden, true);
});

test("the shopping list counts a slot whose save is still pending", async () => {
  await openWeek({
    recipes: [
      {
        id: "omelette",
        name: "Omelette",
        archived: false,
        ingredients: [{ ingredientId: "egg", quantity: 2 }],
      },
    ],
    ingredients: [EGG],
  });
  slotButton("mon", "lunch").click();
  const search = page.document.querySelector("#slot-editor .option-search");
  search.value = "omel";
  search.dispatchEvent(new page.window.Event("input", { bubbles: true }));
  page.document.querySelector("#slot-editor .option").click();
  page.document.querySelector("#slot-editor .done").click();
  const saveUrl = `/api/weeks/${WEEK}/mon/lunch`;
  await waitFor(() => server.requestFor("PUT", saveUrl) !== undefined);

  shoppingButton().click();

  assert.deepEqual(lineTexts(), [["Egg", "2 pcs"]]);
  server
    .requestFor("PUT", saveUrl)
    .respond(200, { week: WEEK, day: "mon", meal: "lunch", items: [] });
  await tick();
});

test("recipes without ingredients are listed as not included, with their slots", async () => {
  let weekData = withSlot(blankWeek(DAYS, MEALS), "mon", "dinner", [
    { recipeId: "burrito", servings: 2 },
  ]);
  weekData = withSlot(weekData, "thu", "snack_am", [{ recipeId: "burrito", servings: 1 }]);
  await openWeek({
    weekData,
    recipes: [{ id: "burrito", name: "Burrito", archived: false, ingredients: [] }],
  });

  shoppingButton().click();

  const block = shoppingDialog().querySelector(".not-included");
  assert.equal(block.hidden, false);
  assert.equal(
    block.querySelector(".not-included-title").textContent,
    "Not included: these recipes have no ingredients.",
  );
  assert.ok(block.querySelector(".not-included-title .warning-icon"));
  assert.deepEqual(
    [...block.querySelectorAll("li")].map((item) => item.textContent),
    ["Burrito · Mon dinner, Thu morning snack"],
  );
  assert.deepEqual(lineTexts(), []);
  assert.equal(shoppingDialog().querySelector(".empty-week").hidden, true);
});

test("an empty week says it has no menus", async () => {
  await openWeek();

  shoppingButton().click();

  const empty = shoppingDialog().querySelector(".empty-week");
  assert.equal(empty.hidden, false);
  assert.equal(empty.textContent, "This week has no menus yet.");
  assert.equal(shoppingDialog().querySelector(".not-included").hidden, true);
});

test("a hash change while the shopping list is open is undone, and Close returns focus", async () => {
  await openWeek();
  shoppingButton().click();

  page.window.location.hash = "#2026-09-28";
  await waitFor(() => page.window.location.hash === `#${WEEK}`);

  assert.equal(shoppingDialog().open, true);
  assert.equal(page.document.getElementById("grid").dataset.week, WEEK);
  shoppingDialog().querySelector(".close-dialog").click();
  assert.equal(shoppingDialog().open, false);
  assert.equal(page.document.activeElement, shoppingButton());
});

test("a backdrop click closes the shopping list", async () => {
  await openWeek();
  shoppingButton().click();

  shoppingDialog().dispatchEvent(new page.window.PointerEvent("pointerdown", { bubbles: true }));
  shoppingDialog().click();

  assert.equal(shoppingDialog().open, false);
});

test("the ingredient catalog loads again with every week", async () => {
  await openWeek();

  page.document.getElementById("next-week").click();
  await waitFor(
    () => server.requests.filter((request) => request.url === "/api/ingredients").length === 2,
  );

  server.requestFor("GET", "/api/weeks/2026-09-28").respond(200, blankWeek(DAYS, MEALS));
  server.requestFor("GET", "/api/recipes").respond(200, { recipes: [] });
  server.requestFor("GET", "/api/ingredients").respond(200, { ingredients: [] });
  await tick();
  assert.equal(page.document.getElementById("grid").dataset.week, "2026-09-28");
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `node --test test/meal-plan-page.test.js`

Expected: FAIL. The page has no `#shopping-list` button, so
`shoppingButton()` is `null`. The page also never requests
`/api/ingredients`, so the catalog test times out in `waitFor`.

- [ ] **Step 3: Write the code**

Create `public/shopping-dialog.js`:

```js
// The shopping list dialog: a read-only modal dialog with the shopping list
// of the displayed week. Close, Escape, Android's Back, and a click on the
// backdrop close it.

import { createElement, createWarningIcon, onBackdropClick } from "./dom.js";

export function createShoppingDialog(dialog) {
  const title = dialog.querySelector(".dialog-title");
  const emptyWeek = dialog.querySelector(".empty-week");
  const lines = dialog.querySelector(".shopping-lines");
  const notIncluded = dialog.querySelector(".not-included");
  const notIncludedRecipes = dialog.querySelector(".not-included-recipes");
  dialog.querySelector(".not-included-title").prepend(createWarningIcon());

  /** The control that opened the dialog, or null while it's closed. */
  let opener = null;

  function line({ name, total, unit }) {
    const item = createElement("li", "shopping-line");
    item.append(
      createElement("span", "line-name", name),
      createElement("span", "line-amount", `${total} ${unit}`),
    );
    return item;
  }

  /**
   * Shows `list`, the result of shoppingList(). `isEmpty` tells that the week
   * has no menu items, and `slotLabel({ day, meal })` names a slot, such as
   * "Mon dinner".
   */
  function open({ title: text, list, isEmpty, slotLabel, opener: from }) {
    opener = from;
    title.textContent = text;
    emptyWeek.hidden = !isEmpty;
    lines.replaceChildren(...list.lines.map(line));
    lines.hidden = list.lines.length === 0;
    notIncludedRecipes.replaceChildren(
      ...list.recipesWithoutIngredients.map((recipe) =>
        createElement("li", undefined, `${recipe.name} · ${recipe.slots.map(slotLabel).join(", ")}`),
      ),
    );
    notIncluded.hidden = list.recipesWithoutIngredients.length === 0;
    dialog.showModal();
    // The title, so a screen reader starts from the top of the list.
    title.focus();
  }

  function isOpen() {
    return opener !== null;
  }

  function close() {
    if (opener === null) return;
    const from = opener;
    opener = null;
    if (dialog.open) dialog.close();
    from.focus();
  }

  dialog.querySelector(".close-dialog").addEventListener("click", close);
  // Escape and Android's Back close the dialog.
  dialog.addEventListener("close", close);
  onBackdropClick(dialog, close);

  return { isOpen, open };
}
```

In `public/index.html`:

- In the week bar, after the **Today** button, add:

```html
        <button type="button" id="shopping-list" class="shopping-list-button">Shopping list</button>
```

- After the slot editor's `</dialog>`, add:

```html

    <!-- Shopping list. Filled and opened by shopping-dialog.js. -->
    <dialog id="shopping-dialog" class="dialog" aria-labelledby="shopping-dialog-title">
      <div class="dialog-body">
        <!-- biome-ignore lint/a11y/useHeadingContent: shopping-dialog.js sets the text when it opens. -->
        <h2 id="shopping-dialog-title" class="dialog-title" tabindex="-1"></h2>
        <p class="hint empty-week" hidden>This week has no menus yet.</p>
        <ul class="shopping-lines" aria-label="Ingredients to buy"></ul>
        <section class="not-included" aria-labelledby="not-included-title" hidden>
          <p id="not-included-title" class="not-included-title">Not included: these recipes have no ingredients.</p>
          <ul class="not-included-recipes"></ul>
        </section>
        <div class="dialog-actions">
          <button type="button" class="close-dialog">Close</button>
        </div>
      </div>
    </dialog>
```

In `public/app.js`:

- Change the first comment line to
  `// Meal plan page. Depends ONLY on the HTTP API (/api/weeks, /api/recipes, and`
  `// /api/ingredients); never import from server/.`
- Add the imports, keeping them sorted:

```js
import { createShoppingDialog } from "./shopping-dialog.js";
import { shoppingList } from "./shopping-list.js";
```

- After `const editor = createSlotEditor(...);`, add:

```js
const shopping = createShoppingDialog(document.getElementById("shopping-dialog"));
const shoppingButton = document.getElementById("shopping-list");
```

- After `let recipesById = new Map();`, add:

```js
/** The ingredient catalog as last loaded. */
let ingredients = [];
```

- After `openEditor`, add:

```js
// For example, "Mon dinner".
function slotLabel({ day, meal }) {
  const dayLabel = DAYS.find((entry) => entry.id === day).label.slice(0, 3);
  return `${dayLabel} ${MEALS.find((entry) => entry.id === meal).label.toLowerCase()}`;
}

// Opens the shopping list of the week on screen. It counts the menus that
// the grid shows, including slots that are saving or whose save failed.
function openShoppingList() {
  const { week } = grid.dataset;
  if (grid.hidden || week === undefined) return;
  const slots = DAYS.flatMap((day) =>
    MEALS.map((meal) => ({
      day: day.id,
      meal: meal.id,
      menu: menus.get(slotKey(week, day.id, meal.id)),
    })),
  );
  shopping.open({
    title: `Shopping list · ${formatWeekRange(week)}`,
    list: shoppingList(slots, [...recipesById.values()], ingredients),
    isEmpty: slots.every((slot) => slot.menu.items.length === 0),
    slotLabel,
    opener: shoppingButton,
  });
}
```

- In `loadWeek`, replace the `run` body with:

```js
      // The recipe book and the ingredient catalog load with every week, so
      // what the other pages add shows up without a reload.
      const [weekData, recipeBook, catalog] = await Promise.all([
        getJson(`/api/weeks/${week}`),
        getJson("/api/recipes"),
        getJson("/api/ingredients"),
      ]);
      recipesById = new Map(recipeBook.recipes.map((recipe) => [recipe.id, recipe]));
      ingredients = catalog.ingredients;
      fillWeek(week, weekData);
      showDayDates(week);
      markToday();
```

- In `goToWeek`, change the first line to
  `if (changingWeek || editor.isOpen() || shopping.isOpen()) return;`.
- In the `hashchange` listener, change the comment to
  `// The week never changes behind an open dialog.` and the condition to
  `if (isWeekId(week) && !editor.isOpen() && !shopping.isOpen()) goToWeek(week);`.
- After the listener of `today`, add:

```js
shoppingButton.addEventListener("click", openShoppingList);
```

Add to `public/styles.css`, after the editor rules from Task 9:

```css
/* ---------- Shopping list ---------- */

.shopping-lines,
.not-included-recipes {
  margin: 0;
  padding: 0;
  list-style: none;
}

.shopping-line {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.3rem 0;
  border-bottom: 1px solid #eee;
}

.line-name,
.not-included-recipes li {
  min-width: 0;
  overflow-wrap: anywhere;
}

.line-amount {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.not-included {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.not-included-title {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  font-weight: 600;
}
```

and let the week bar wrap, so **Shopping list** gets its own row on phones:
add `flex-wrap: wrap;` to the `.week-bar` rule, and, in the mobile media
query, add:

```css
  .shopping-list-button {
    flex: 1 0 100%;
  }
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npm run format && npm run lint && npm test`

Expected: PASS, with clean output.

- [ ] **Step 5: Check it in a browser**

Run `DATA_DIR="$(mktemp -d)" npm start`. Add ingredients and a recipe with
ingredients, plan it in a slot, and click **Shopping list**. Check the
totals, the **Not included** block with a recipe without ingredients, the
empty week, and the layout on a narrow window. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add public/app.js public/index.html public/shopping-dialog.js public/styles.css test/meal-plan-page.test.js
git commit -m "feat(ui): show the shopping list of the week"
```

---

### Task 14: Document the feature

**Files:**

- Modify: `docs/glossary.md`, `README.md`, `docs/manual-test-plan.md`

**Interfaces:**

- Consumes: the behavior of Tasks 1–13. Copy UI text exactly from the code.

- [ ] **Step 1: Update the glossary**

In `docs/glossary.md`, add these rows to the table, keeping it sorted from
A to Z, and replace the **Name key** row:

```markdown
| Active ingredient | An ingredient that isn't archived. Only active ingredients can be added to a recipe. |
| Archived ingredient | An ingredient that's as if it didn't exist when you add ingredients to a recipe: it isn't offered, but it stays in the recipes that already use it. You can restore it. |
| Ingredient | Something you buy and use in recipes. The ingredient catalog holds it with a stable ID, a unique name, and a unit. In a recipe, it has a quantity. |
| Ingredient catalog | All the ingredients, active and archived. |
| Name key | The form of a recipe or ingredient name that decides uniqueness and order: without accents and in lowercase. `Café` and `cafe` have the same name key. |
| Quantity | How much of an ingredient one serving of a recipe needs, in the ingredient's unit: a number from 0.1 to 10000 with at most one decimal. |
| Shopping list | For the displayed week, each ingredient with the sum of quantity × servings over every menu item, rounded up to a whole number. |
| Unit | How an ingredient is measured: `g`, `ml`, or `pcs`. |
```

- [ ] **Step 2: Update the README**

In `README.md`:

1. After the first paragraph, add:

   ```markdown
   Each recipe lists its ingredients, with the quantity that one serving
   needs, and the app adds them up into a shopping list for the week.
   ```

1. After the section `## Plan a meal`, add:

   ```markdown
   ## View the shopping list

   To see what to buy for the displayed week, click **Shopping list** in the
   week bar. For each ingredient, the list shows the sum of its quantity ×
   the servings of every menu item of the week, rounded up to a whole
   number, from A to Z. The list counts the menus that the grid shows,
   including slots that are still saving.

   Recipes without ingredients can't add to the list. The dialog names them
   under **Not included**, with the slots where they appear.

   To close the list, click **Close**, press `Escape`, or click outside it.
   ```

1. Replace the section `## Manage recipes` with:

   ```markdown
   ## Manage recipes

   The recipe book holds the recipes that you can add to menus. To open it,
   click **Recipes** at the top of any page.

   A recipe has a name of up to 100 characters and a list of ingredients,
   each with the quantity that one serving needs. Names are unique, ignoring
   case and accents, so `Café` and `cafe` are the same name.

   - To add a recipe, click **New recipe**. To change a recipe, click its
     **Edit** button. Both open the recipe editor:
     - Type the name in **Name**.
     - To add an ingredient, type part of its name in **Add ingredient**, and
       then click it, or select it with the arrow keys and press `Enter`. A
       recipe holds up to 50 ingredients, and the list offers only active
       ingredients that aren't in the recipe. To add ingredients to the
       catalog, use the **Ingredients** page.
     - Type each quantity in the ingredient's unit, from `0.1` to `10000`
       with at most one decimal. You can type `.` or `,` as the decimal
       separator.
     - To remove an ingredient, click **Remove**.
     - To save, click **Done** or press `Enter`. To close the editor without
       saving, click **Cancel** or press `Escape`.
   - A recipe without ingredients shows a warning icon. You can save a
     recipe without ingredients, but the shopping list can't count it.
   - To find a recipe, type part of its name in **Search**.
   - To archive a recipe that you no longer use, click **Archive**. The slot
     editor stops offering it, and menus that already use it keep showing it.
     Archived recipes are listed under **Archived**. To bring one back, click
     **Restore**.

   You can't delete recipes.

   ## Manage ingredients

   The ingredient catalog holds the ingredients that recipes use. To open
   it, click **Ingredients** at the top of any page.

   An ingredient has a name of up to 100 characters and a unit: `g`, `ml`,
   or `pcs`. Every recipe measures an ingredient in its unit, so the
   shopping list can add the quantities up. Names are unique, ignoring case
   and accents.

   - To add an ingredient, type its name in **New ingredient**, choose its
     unit, and then press `Enter` or click **Add**. If an archived
     ingredient has the name, click **Restore it** to bring that ingredient
     back.
   - To rename an ingredient or change its unit, click **Edit**. You can
     change the unit only while no recipe, active or archived, uses the
     ingredient.
   - To find an ingredient, type part of its name in **Search**.
   - To archive an ingredient, click **Archive**. The recipe editor stops
     offering it, and recipes that already use it keep it. To bring one
     back, click **Restore** under **Archived**.

   You can't delete ingredients.
   ```

1. In `## Back up and restore data`:
   - Add the bullet ``- `v2/ingredients.json` holds the ingredient catalog.``
     before the `v2/recipes.json` bullet.
   - Change `If a week file or recipes.json contains invalid JSON` to
     ``If a week file, `recipes.json`, or `ingredients.json` contains invalid JSON``.
   - After the paragraph about restoring an older `recipes.json`, add:
     ``If you restore an older `ingredients.json`, recipe ingredients that it doesn't have disappear from the recipes and the shopping list. They come back when you restore a catalog that has them.``

1. In `## API reference`:
   - Replace `A recipe has the shape { "id", "name", "archived" }.` with:

     ```markdown
     A recipe has the shape `{ "id", "name", "archived", "ingredients" }`,
     where `ingredients` is a list of `{ "ingredientId", "quantity" }`. An
     ingredient has the shape `{ "id", "name", "unit", "archived" }`.
     ```

   - In `### Add a recipe`, change the request body to
     `{ "name": "NAME", "ingredients": [{ "ingredientId": "ID", "quantity": 1.5 }] }`,
     say that `ingredients` is optional and defaults to `[]`, and add to the
     `400` row: `, the body has other fields, or ingredients breaks the rules below`.
   - In `### Change a recipe`, change the request body line to:
     ``Request body: `{ "name" }`, `{ "ingredients" }`, or both, to change the recipe, or `{ "archived": true }` or `{ "archived": false }`, alone, to archive or restore it.``
     Change the `400` row to: `The body mixes archived with other fields, has no known field, has other fields, or has an invalid value.`
   - After `### Change a recipe`, add the ingredient rules and routes:

     ```markdown
     `ingredients` is valid when all the following are true:

     - It's an array of at most 50 entries.
     - Each entry has exactly the keys `ingredientId` and `quantity`.
     - Each `ingredientId` is an existing ingredient, archived or not, and
       appears once.
     - Each `quantity` is a number from 0.1 to 10000 with at most one
       decimal.

     ### List ingredients

     `GET /api/ingredients`

     | Status | Meaning |
     |--------|---------|
     | `200`  | The body is `{ "ingredients": [...] }`, with every ingredient, archived ones included, sorted from A to Z ignoring case and accents. |

     ### Add an ingredient

     `POST /api/ingredients`

     Request body: `{ "name": "NAME", "unit": "UNIT" }`, where `UNIT` is
     `g`, `ml`, or `pcs`.

     | Status | Meaning |
     |--------|---------|
     | `201`  | The body is the new ingredient. |
     | `400`  | The body doesn't have exactly `name` and `unit`, the name is invalid, or the unit isn't `g`, `ml`, or `pcs`. |
     | `409`  | Another ingredient, active or archived, has the same name, ignoring case and accents. The body is `{ "error", "ingredient" }`. |

     ### Change an ingredient

     `PATCH /api/ingredients/ID`

     Request body: `{ "name" }`, `{ "unit" }`, or both, or
     `{ "archived": true }` or `{ "archived": false }`, alone.

     | Status | Meaning |
     |--------|---------|
     | `200`  | The body is the updated ingredient. |
     | `400`  | The body mixes `archived` with other fields, has no known field, has other fields, or has an invalid value. |
     | `404`  | No ingredient has that ID. |
     | `409`  | Another ingredient has the same name, and the body is `{ "error", "ingredient" }`. Or the unit changes while a recipe uses the ingredient, and the body is `{ "error" }`. |
     ```

1. In `## Project structure`, replace the `public/`, `server/`, and `test/`
   entries with the current files, sorted from A to Z, with the same
   one-line style. New entries:

   ```none
     catalog-list.js    # List logic shared by the Recipes and Ingredients pages.
     combobox.js        # The filter-and-pick field of the editors.
     ingredient-editor.js # The ingredient editor dialog.
     ingredients.html   # Ingredients page.
     ingredients.js     # Ingredients page logic.
     name-search.js     # Name matching and sorting.*
     quantities.js      # Quantity parsing and shopping list arithmetic.*
     recipe-editor.js   # The recipe editor dialog.
     shopping-dialog.js # The shopping list dialog.
     shopping-list.js   # Computes the shopping list.*
   ```

   ```none
     ingredients.js   # The ingredient catalog: unique names, units, and archiving.
     names.js         # Name rules shared by recipes and ingredients.
     recipes.js       # The recipe book: unique names, ingredients, and archiving.
     stores.js        # Wires the stores to one write queue and to each other.
   ```

   Remove the `recipe-search.js` entry, and change the `dom.js` entry to
   `# DOM helpers shared by the pages.` Align the `#` comments.

- [ ] **Step 3: Update the manual test plan**

In `docs/manual-test-plan.md`:

1. In `## Set up a test server`, after the step that adds recipes, add a
   step:

   ````markdown
   1. Add the test ingredients:

      ```bash
      for entry in Egg:pcs Milk:ml Onion:g Rice:g; do
        curl -s -X POST -H 'Content-Type: application/json' \
          -d "{\"name\":\"${entry%%:*}\",\"unit\":\"${entry##*:}\"}" \
          http://localhost:3000/api/ingredients; echo
      done
      ```
   ````

1. Replace the table of `## 8. Recipe book` with:

   ```markdown
   | ID  | Step | Expected result |
   |-----|------|-----------------|
   | 8.1 | On the meal plan, click **Recipes**. | The recipe book opens with the test recipes from A to Z, each with a warning icon, and no **Archived** section. The title bar links to **Meal plan** and **Ingredients**. |
   | 8.2 | Hover over the warning icon of `Omelette`. | The tooltip reads `No ingredients`. |
   | 8.3 | Click **New recipe**. | The editor opens, titled `New recipe`, with focus in **Name** and the text `No ingredients yet.` |
   | 8.4 | Type `Tortilla`. In **Add ingredient**, type `eg`, and press `Enter`. | `Egg` appears with `pcs` and an empty quantity field, which has focus. |
   | 8.5 | Type `1,5` in the quantity, and press `Enter`. | The editor closes. `Tortilla` appears in its sorted place without a warning icon, and its **Edit** button has focus. |
   | 8.6 | Click **Edit** on `Tortilla`. | The quantity reads `1.5`, and focus is on the title. |
   | 8.7 | Replace the quantity with `1.25`, and click **Done**. | `Enter a quantity from 0.1 to 10000, with up to one decimal.` appears below the row, focus moves to the field, and the editor stays open. |
   | 8.8 | Click the dark area outside the editor. | The editor stays open. Click **Cancel**: the editor closes, and nothing is saved. |
   | 8.9 | Click **Edit** on `Lentil soup`, change the name to `Red lentil soup`, and press `Enter`. | The row shows `Red lentil soup` in its sorted place. |
   | 8.10 | Go to the meal plan, show the next week, and look at the slot from `1.3`. | It shows `Red lentil soup × 1`. |
   | 8.11 | On the recipe book, click **Edit** on `Omelette`, change the name to `Green salad`, and click **Done**. | The editor stays open with `"Green salad" already exists.` below **Name**. Press `Escape`: the editor closes. |
   | 8.12 | Archive `Omelette`. Click **New recipe**, type `Omelette`, and click **Done**. | `Omelette` moves under **Archived**, and the editor reads `"Omelette" is archived. To use it, restore it from Archived.` Click **Cancel**. |
   | 8.13 | Click **New recipe**, type a name, and reload the page. | The browser asks whether to leave. Click **Cancel** or **Stay**: the editor keeps the name. Click **Cancel** in the editor. |
   | 8.14 | Archive `Green salad`, which the slot from `5.7` uses. Go to the meal plan. | The slot still shows `Green salad × 2`. In its editor, `+` on `Green salad` followed by **Done** saves without a red cross. |
   | 8.15 | Stop the server. Click **Edit** on a recipe, change its name, and click **Done**. Then archive a recipe. | The editor shows `Couldn't save the recipe. Try again.` and keeps your change. Archiving shows `Couldn't archive the recipe. Try again.` below the row. |
   | 8.16 | Start the server, and click **Done** in the editor from `8.15`. | The recipe is saved, and the editor closes. |
   | 8.17 | Stop the server again, and reload the recipe book. Start the server and click **Retry**. | The page shows `Couldn't load the recipes.`, and **Retry** loads the recipe book. |
   | 8.18 | On mobile, open the recipe book, and tap **New recipe**. | The editor fills the screen, the keyboard opens for **Name**, and the page doesn't zoom or scroll sideways. |
   | 8.19 | On mobile, add an ingredient to the recipe, and tap its quantity field. | The keyboard offers digits and a decimal separator. `0,5` is accepted when you tap **Done**. |
   ```

1. Renumber `## 9. Keyboard and screen readers (optional)` to `## 11.` and
   `## 10. Day and week changes (optional)` to `## 12.`, with their test
   IDs (`9.1` becomes `11.1`, and so on). Search the file for references to
   the old IDs and update them. In `## Before you begin`, change
   `all of sections 9 and 10` to `all of sections 11 and 12`.
1. Before the renumbered section 11, add:

   ```markdown
   ## 9. Ingredients

   Run these tests on desktop unless a test says otherwise.

   | ID  | Step | Expected result |
   |-----|------|-----------------|
   | 9.1 | Click **Ingredients** in the title bar. | The page lists `Egg pcs`, `Milk ml`, `Onion g`, and `Rice g`. The title bar links to **Meal plan** and **Recipes**. |
   | 9.2 | In **New ingredient**, type `Flour`, and press `Enter`. | `Choose a unit.` appears, focus moves to the unit, and nothing is added. |
   | 9.3 | Choose `g`, and click **Add**. | `Flour g` appears in its sorted place. The name clears, the unit goes back to `Choose a unit`, and focus returns to the name. |
   | 9.4 | Type `ONION`, choose `pcs`, and click **Add**. | `"Onion" already exists.` appears. |
   | 9.5 | Archive `Flour`. Type `flour`, choose `g`, and click **Add**. | `"Flour" is archived.` appears with **Restore it**. Click it: `Flour` is back in the list, and the field is empty. |
   | 9.6 | Click **Edit** on `Egg`. | The editor shows `Egg` and `pcs`. **Unit** is disabled, with `Used in 1 recipe. To change the unit, remove the ingredient from that recipe first.` |
   | 9.7 | Click **Cancel**. Click **Edit** on `Milk`, choose `g`, and click **Done**. Then change it back to `ml`. | `Milk` shows `g`, and then `ml` again. |
   | 9.8 | Open the recipe book in a second tab, and add `Milk` to a recipe. In the first tab, click **Edit** on `Milk`, choose `g`, and click **Done**. | The editor stays open with `"Milk" is used in recipes. To change its unit, remove it from those recipes first.` Click **Cancel**. |
   | 9.9 | Stop the server. Type a name, choose a unit, and click **Add**. | `Couldn't add the ingredient. Try again.` appears, and the name and the unit stay. |
   | 9.10 | Reload the page. Start the server, and click **Retry**. | The page shows `Couldn't load the ingredients.`, and **Retry** loads the catalog. |
   | 9.11 | On mobile, open the Ingredients page, and tap **Edit** on an ingredient. | The editor fills the screen, and no keyboard opens until you tap **Name**. |

   ## 10. Shopping list

   | ID  | Step | Expected result |
   |-----|------|-----------------|
   | 10.1 | In the next week, add `Tortilla` to Tuesday's lunch with 2 servings. Click **Shopping list**. | The dialog is titled `Shopping list ·` and the week's range, and lists `Egg 3 pcs`. Below, a warning icon and `Not included: these recipes have no ingredients.` list the week's other recipes with their slots, such as `Red lentil soup`. |
   | 10.2 | Press `Escape`. | The dialog closes, and **Shopping list** has focus. |
   | 10.3 | Show a week with no menus, and click **Shopping list**. | The dialog reads `This week has no menus yet.` Click outside the dialog: it closes. |
   | 10.4 | Stop the server. In the week from `10.1`, change `Tortilla` to 3 servings, and click **Done**. When the red cross appears, click **Shopping list**. | The list shows `Egg 5 pcs`: 1.5 × 3 = 4.5, rounded up. Close it, start the server, and retry the save. |
   | 10.5 | With the shopping list open, change the week in the address bar, and press `Enter`. | The address goes back, and the dialog stays open on the same week. |
   | 10.6 | On mobile, tap **Shopping list** in a week with many ingredients. | The dialog fills the screen, the list scrolls inside it, and the page doesn't scroll sideways. The week bar shows **Shopping list** on its own row. |
   ```

- [ ] **Step 4: Check the docs**

Run: `npm run lint && npm test`

Expected: PASS. Then read the changed sections of the three files and check
them against the style rules in `AGENTS.md`: sentence case headings,
"you", present tense, code font for literal values, and the serial comma.
Check every UI string against the code with `grep`, for example
`grep -rn "No ingredients yet" public docs README.md`.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/glossary.md docs/manual-test-plan.md
git commit -m "docs: document ingredients and the shopping list"
```

---

### Task 15: Close the branch

This task follows the project's closing routine. It changes nothing without
the user's decision.

- [ ] **Step 1: Fix every review finding.** For each issue that the task
  reviews reported, write a failing test when the issue is testable, fix
  it, and fold the fix into the commit that introduced the issue:

  ```bash
  git commit --fixup=<commit>
  GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash main
  ```

  Fix issues that already exist on `main` in separate commits.
- [ ] **Step 2: Propose refactors and test changes.** Look for code to
  simplify, holes in the test net, and parts of `docs/manual-test-plan.md`
  that could become automated tests. Present them to the user as a
  numbered list (what, where, why, and risk), and do only the items that
  the user chooses.
- [ ] **Step 3: Validate the whole branch.** Run `npm run lint` and
  `npm test`, and check that the test output is clean. Read the README and
  every document the branch changed: simplify the text, remove overlaps and
  repetition, and unify tone and style.
- [ ] **Step 4: Run the manual test plan.** Ask the user to run
  `docs/manual-test-plan.md` on a desktop and a phone, and fix what fails,
  starting with a failing test when possible.
- [ ] **Step 5: Ask about the design and plan documents.** Ask the user
  whether to remove `docs/plans/2026-09-28-ingredients-and-shopping-list-design.md`
  and this plan before merging, as with the previous feature.

---

## Task dependencies

Each task needs the code or files of the tasks listed for it:

| Task | Needs |
|------|-------|
| 1 | — |
| 2 | 1 |
| 3 | 2 |
| 4 | 3 |
| 5 | 1 (its test imports `server/names.js`) |
| 6 | 3 (its test imports the limits in `server/recipes.js`) |
| 7 | 5, 6 |
| 8 | — |
| 9 | 5, 6, 8 |
| 10 | 9 |
| 11 | 8, 9 (it adds CSS after the rules of Task 9) |
| 12 | 10, 11 |
| 13 | 7, 10 (`createWarningIcon`) |
| 14 | 1–13 |
| 15 | 1–14 |

Tasks that change the same files can't run at the same time, even when
neither needs the other: Tasks 8 to 13 all change `public/styles.css`, and
several change `public/dom.js`, `public/index.html`, or
`public/recipes.html`. Only two lines of work are independent: the server
(Tasks 1–4) and the dialog refactor (Task 8).
