# Recipes and Menus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the free text of each slot with a menu of recipes from a
shared recipe book, each with a number of servings, and add a page to manage
the recipe book.

**Architecture:** The server splits `store.js` into `files.js` (the only
module that touches disk), `recipes.js` (the recipe book), and `weeks.js`
(weeks of menus), with all data under `DATA_DIR/v2/`. The API gains
`/api/recipes`, and `PUT /api/weeks/WEEK/DAY/MEAL` takes `{ items }`. The meal
plan page shows menus read-only in the grid and edits them in a modal
`<dialog>` that saves only on **Done**. `saves.js` keeps its save logic and
saves menus instead of text. A new page, `recipes.html`, manages the recipe
book.

**Tech Stack:** Node.js 22 or later with `node:test`, ES modules, Express 5,
supertest 7, and plain HTML, CSS, and JavaScript with no framework or build
step. Biome checks the style.

**Spec:** `docs/plans/2026-09-26-recipes-and-menus-design.md`. Read it before
you start any task.

## Global Constraints

- **Language:** all code, comments, UI text, test names, docs, and commit
  messages are in US English (`AGENTS.md`).
- **Vocabulary:** use the terms in `docs/glossary.md` (Task 1): week, day,
  meal, slot, menu, menu item, recipe, recipe book, archived recipe, servings,
  and meal plan. Never write *cell* or *dish* in new or changed code, tests, or
  docs.
- **Checks before every commit:** `npm run lint` and `npm test` must both pass.
  To fix formatting, run `npm run format`.
- **TDD:** write the failing test, watch it fail, then write the code
  (`AGENTS.md`).
- **Commits:** Conventional Commits. No planning labels, such as task numbers,
  in commit messages or files. No `Co-Authored-By` or other attribution
  trailers.
- **Ordering:** `git add` paths and other free-order lists go from A to Z
  (`AGENTS.md`).
- **Branch:** `feature/recipes-and-menus`. `main` changes only through pull
  requests.
- **Dependencies:** no new dependencies. Runtime `express` only; dev
  `@biomejs/biome` and `supertest` only.
- **Frontend boundary:** nothing in `public/` imports from `server/`.
- **Storage:** everything under `DATA_DIR/v2/`: `recipes.json` and
  `weeks/WEEK.json`. The server never reads or writes `DATA_DIR/weeks/` or
  `DATA_DIR/week.json`. Atomic writes through `FILE.tmp` and `rename`. One
  write queue for all files.
- **Limits:** recipe names have 1 to 100 characters after cleanup. Servings are
  multiples of 0.5 from 0.5 to 99. A menu has at most 20 menu items. Requests
  from the browser time out after 5 seconds.
- **Name key:** `name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()`.
  The server and the browser each have their own copy of this function.
- **UI text (verbatim):**
  - Meal plan page: header link `Recipes`. Empty slot `+ Add`. Menu item line
    `NAME × SERVINGS`, for example `Gnocchi carbonara × 1.5`. Fallback name
    `Unknown recipe`. Load error `Couldn't load the meal plan.` with `Retry`.
    Unsaved question
    `Some changes in this week couldn't be saved. Leave anyway and discard them?`.
  - Slot editor: title `WEEKDAY, MONTH DAY · MEAL`, for example
    `Friday, September 25 · Lunch`. Label `Add recipe`. Message
    `No recipes found. Add them on the Recipes page.` Placeholder when full
    `A menu holds up to 20 recipes.` Buttons `−`, `+`, `Remove`, `Cancel`, and
    `Done`, with accessible names `Decrease servings of NAME`,
    `Increase servings of NAME`, and `Remove NAME`.
  - Recipe book page: title `Recipes`, link `Meal plan`, labels `New recipe`
    and `Search`, buttons `Add`, `Rename`, `Archive`, `Restore`, `Save`,
    `Cancel`, `Restore it`, and `Retry`, summary `Archived (N)`. Messages
    `"NAME" already exists.`, `"NAME" is archived.`,
    `Couldn't add the recipe. Try again.`,
    `Couldn't rename the recipe. Try again.`,
    `Couldn't archive the recipe. Try again.`,
    `Couldn't restore the recipe. Try again.`, `No recipes match "QUERY".`,
    `No recipes yet. Add your first one above.`, and
    `Couldn't load the recipes.`
  - Server messages for names: `The name can't be empty.` and
    `The name must be at most 100 characters.`
- **Accent color:** `#2e7d32`.
- **Out of scope:** ingredients, shopping lists, converting free-text plans,
  deleting recipes, reordering menu items, and real-time updates.

## Review Focus

- **Week files edited by hand, or a recipe book restored from an older
  backup:** servings off the 0.5 grid, a repeated recipe, more than 20 menu
  items, or a recipe ID that doesn't exist. Every menu that `readWeek` returns
  must pass `saveSlot` again, so a slot never gets stuck with a red cross.
  Task 4 has a test that saves every slot of a messy file back.
- **Recipe names with HTML or very long words:** they show as literal text and
  wrap inside the slot, the editor, and the recipe book rows, and never widen
  the page. Tasks 8, 9, and 10 set names only through `textContent` (the
  `createElement` helper), and CSS uses `overflow-wrap: anywhere`. Task 11
  tests `5.14` and `5.15` check it by hand.
- **Escape in the Add recipe field while it has text:** it clears the field,
  and the dialog stays open, in Chrome, Firefox, and Safari. Task 9 cancels the
  `keydown` event, which stops the dialog's close request. Task 11 test `5.10`
  checks it by hand.
- **Opening the editor on a slot whose save failed:** the editor starts from
  the slot's unsaved menu, not the server's, and **Done** saves it. Task 9
  opens the editor with `menus.get(key)`, which holds the confirmed but
  unsaved menu. Task 11 test `6.3` checks it by hand.
- **Adding a name that matches an archived recipe only after cleanup**, such as
  `  cafe ` when `Café` is archived: `409` with the archived recipe, and
  **Restore it** restores it. Task 5 has an API test for it, and Task 11 test
  `8.3` checks the page.

## File Structure

```none
docs/
  glossary.md           # Task 1: the terms the app uses.
  manual-test-plan.md   # Task 11: rewritten for menus, the editor, and the recipe book.
public/
  app.js                # Tasks 8, 9: menus in the grid, and the slot editor wiring.
  dom.js                # Task 8: createElement, shared by the pages.
  http.js               # Task 6: getJson and sendJson with the 5-second timeout.
  index.html            # Tasks 8, 9: Recipes link and the editor dialog.
  menus.js              # Task 6: pure menu functions.
  recipe-search.js      # Task 6: name key, filtering, and sorting.
  recipes.html          # Task 10: the recipe book page.
  recipes.js            # Task 10: the recipe book page logic.
  saves.js              # Task 7: saves menus instead of text.
  slot-editor.js        # Task 9: the slot editor dialog.
  styles.css            # Tasks 8, 9, 10.
server/
  app.js                # Task 5: /api/recipes and the new /api/weeks body.
  errors.js             # Task 3: ValidationError, NotFoundError, NameConflictError.
  files.js              # Task 2: dataPath, readJson, writeJson, createQueue.
  index.js              # Task 5: wires the stores.
  recipes.js            # Task 3: the recipe book.
  store.js              # Task 5: deleted.
  weeks.js              # Task 4: weeks of menus.
test/
  api.test.js           # Tasks 5, 10.
  files.test.js         # Task 2.
  http.test.js          # Task 6.
  menus.test.js         # Task 6.
  recipe-search.test.js # Task 6.
  recipes.test.js       # Task 3.
  saves.test.js         # Task 7.
  store.test.js         # Task 5: deleted.
  weeks.test.js         # Task 4.
AGENTS.md               # Task 1.
README.md               # Tasks 1, 5, 8, 9, 10.
```

Responsibilities: `server/files.js` is the only module that touches disk.
`server/recipes.js` and `server/weeks.js` enforce the domain rules and throw
the errors in `server/errors.js`. They know nothing about HTTP.
`server/app.js` maps errors to status codes and never touches `fs`. In
`public/`, `dates.js`, `http.js`, `menus.js`, `recipe-search.js`, and
`saves.js` have no DOM access, so Node.js tests import them. `app.js`,
`slot-editor.js`, and `recipes.js` own the DOM.

Between Task 5 and Task 8, the API no longer accepts `{ "text" }`, so the meal
plan page can't save. The tests pass at every commit, and the page works
again from Task 8.

---

### Task 1: Glossary

**Files:**

- Create: `docs/glossary.md`
- Modify: `AGENTS.md`
- Modify: `README.md` (intro and project structure)

**Interfaces:**

- Consumes: nothing.
- Produces: the vocabulary that every later task uses.

This task changes only documentation, so it has no test.

- [ ] **Step 1: Write the glossary**

Create `docs/glossary.md`:

```markdown
# Glossary

The app uses one name per concept in code, API, storage, user interface, and
documentation. This glossary defines those names. Use them, and don't use
synonyms such as *cell* for a slot or *dish* for a recipe.

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
```

- [ ] **Step 2: Add the vocabulary rule to `AGENTS.md`**

In `AGENTS.md`, after the `## Language` section and before
`## Documentation style`, add:

```markdown
## Vocabulary

Use the terms in `docs/glossary.md`, with one name per concept in code, API,
storage, user interface, and documentation. To add or rename a concept, change
the glossary in the same commit.
```

- [ ] **Step 3: Link the glossary from `README.md`**

In `README.md`, after the paragraph that starts with `The app runs on a
computer at home.`, add:

```markdown
The terms that the app uses, such as *slot*, *menu*, and *recipe book*, are
defined in [`docs/glossary.md`](docs/glossary.md).
```

In the `## Project structure` tree, replace the `docs/` entry with:

```none
docs/
  glossary.md          # The terms the app uses.
  manual-test-plan.md  # Checks that need a person with a browser.
```

- [ ] **Step 4: Check and commit**

Run: `npm run lint && npm test`
Expected: both pass.

```bash
git add AGENTS.md README.md docs/glossary.md
git commit -m "docs: add a glossary"
```

---

### Task 2: JSON file helpers and the write queue

**Files:**

- Create: `server/files.js`
- Test: `test/files.test.js`

**Interfaces:**

- Consumes: nothing.
- Produces, all exported from `server/files.js`:
  - `dataPath(dataDir: string, ...parts: string[]): string`: joins
    `dataDir`, `"v2"`, and `parts`.
  - `readJson(file: string): Promise<any | undefined>`: `undefined` when the
    file doesn't exist; rejects with `SyntaxError` on invalid JSON.
  - `writeJson(file: string, value: any): Promise<void>`: creates the
    directory, writes `FILE.tmp` with two-space indentation and a final
    newline, and renames it over `file`.
  - `createQueue(): (task: () => Promise<T>) => Promise<T>`: returns an
    `enqueue` function that runs tasks one at a time, in order. A rejected
    task doesn't block the next.

- [ ] **Step 1: Write the failing tests**

Create `test/files.test.js`:

```js
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { createQueue, dataPath, readJson, writeJson } from "../server/files.js";

let dir;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "meals-files-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("dataPath puts every file of the current format under v2", () => {
  assert.equal(
    dataPath("/srv/meals", "weeks", "2026-09-21.json"),
    path.join("/srv/meals", "v2", "weeks", "2026-09-21.json"),
  );
  assert.equal(
    dataPath("/srv/meals", "recipes.json"),
    path.join("/srv/meals", "v2", "recipes.json"),
  );
});

test("readJson returns undefined when the file doesn't exist", async () => {
  assert.equal(await readJson(path.join(dir, "missing", "file.json")), undefined);
});

test("readJson rejects invalid JSON (never silently discards data)", async () => {
  const file = path.join(dir, "broken.json");
  await writeFile(file, "{ not json");
  await assert.rejects(readJson(file), SyntaxError);
});

test("writeJson creates the directory, and readJson reads the value back", async () => {
  const file = path.join(dir, "a", "b", "value.json");

  await writeJson(file, { name: "Café", list: [1, 2] });

  assert.deepEqual(await readJson(file), { name: "Café", list: [1, 2] });
  assert.equal(
    await readFile(file, "utf8"),
    '{\n  "name": "Café",\n  "list": [\n    1,\n    2\n  ]\n}\n',
  );
});

test("writeJson replaces the file and leaves no temporary file behind", async () => {
  const file = path.join(dir, "value.json");

  await writeJson(file, { version: 1 });
  await writeJson(file, { version: 2 });

  assert.deepEqual(await readJson(file), { version: 2 });
  assert.deepEqual(await readdir(dir), ["value.json"]);
});

test("the queue runs tasks one at a time, in order", async () => {
  const enqueue = createQueue();
  const events = [];
  let finishFirst;
  const first = enqueue(
    () =>
      new Promise((resolve) => {
        events.push("first starts");
        finishFirst = () => {
          events.push("first ends");
          resolve("one");
        };
      }),
  );
  const second = enqueue(async () => {
    events.push("second runs");
    return "two";
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["first starts"]);

  finishFirst();
  assert.equal(await first, "one");
  assert.equal(await second, "two");
  assert.deepEqual(events, ["first starts", "first ends", "second runs"]);
});

test("a failed task rejects, and the next task still runs", async () => {
  const enqueue = createQueue();

  const failed = enqueue(async () => {
    throw new Error("disk full");
  });
  const next = enqueue(async () => "ok");

  await assert.rejects(failed, /disk full/);
  assert.equal(await next, "ok");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/files.test.js`
Expected: FAIL with `Cannot find module '.../server/files.js'`.

- [ ] **Step 3: Write the module**

Create `server/files.js`:

```js
// The only module that touches disk: JSON files, atomic writes, and the queue
// that keeps writes from interleaving.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/** Every file of the current storage format lives under DATA_DIR/v2/. */
export function dataPath(dataDir, ...parts) {
  return path.join(dataDir, "v2", ...parts);
}

/**
 * The parsed content of `file`, or undefined when it doesn't exist. Invalid
 * JSON rejects on purpose: treating it as empty would overwrite the user's
 * data on the next write.
 */
export async function readJson(file) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
  return JSON.parse(text);
}

/** Writes `value` to `file` atomically, creating its directory if needed. */
export async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmpFile = `${file}.tmp`;
  await writeFile(tmpFile, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tmpFile, file); // atomic replace
}

/**
 * Returns `enqueue(task)`, which runs each task after the previous one
 * finishes, so two read-modify-write cycles never interleave and lose each
 * other's changes. It resolves or rejects like the task.
 */
export function createQueue() {
  let tail = Promise.resolve();
  return function enqueue(task) {
    const run = tail.then(task);
    tail = run.catch(() => {}); // a failed task must not block later ones
    return run;
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/files.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Check and commit**

Run: `npm run format && npm run lint && npm test`
Expected: all pass.

```bash
git add server/files.js test/files.test.js
git commit -m "feat(store): add JSON file helpers and a write queue"
```

---

### Task 3: The recipe book store

**Files:**

- Create: `server/errors.js`
- Create: `server/recipes.js`
- Test: `test/recipes.test.js`

**Interfaces:**

- Consumes: `dataPath`, `readJson`, `writeJson`, and `createQueue` from
  `server/files.js` (Task 2).
- Produces:
  - `server/errors.js`: `class ValidationError extends Error`,
    `class NotFoundError extends Error`, and
    `class NameConflictError extends Error` with a `recipe` property (the
    recipe that already has the name key).
  - `server/recipes.js`:
    - `MAX_NAME_LENGTH = 100`.
    - `cleanName(name: string): string`.
    - `nameKey(name: string): string`.
    - `createRecipes({ dataDir, enqueue })` returns:
      - `list(): Promise<Recipe[]>`: all recipes, A to Z by name key. It
        never waits for the queue, so code inside a queued task can call it.
      - `create(name: unknown): Promise<Recipe>`.
      - `update(id: string, changes: unknown): Promise<Recipe>`, where
        `changes` must be exactly `{ name }` or `{ archived }`.
    - `Recipe` is `{ id: string, name: string, archived: boolean }`.

- [ ] **Step 1: Write the failing tests**

Create `test/recipes.test.js`:

```js
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { NameConflictError, NotFoundError, ValidationError } from "../server/errors.js";
import { createQueue } from "../server/files.js";
import { cleanName, createRecipes, nameKey } from "../server/recipes.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let dataDir;
let recipes;

function recipesFile() {
  return path.join(dataDir, "v2", "recipes.json");
}

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "meals-recipes-"));
  recipes = createRecipes({ dataDir, enqueue: createQueue() });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

test("cleanName trims the name and collapses runs of whitespace", () => {
  assert.equal(cleanName("  Green \t salad\n "), "Green salad");
});

test("nameKey ignores case and accents", () => {
  assert.equal(nameKey("Café"), nameKey("CAFE"));
  assert.equal(nameKey("Ñoquis"), "noquis");
  assert.notEqual(nameKey("Cafe"), nameKey("Cafes"));
});

test("list returns an empty recipe book when there is no file", async () => {
  assert.deepEqual(await recipes.list(), []);
});

test("create stores a recipe with a UUID, the cleaned name, and archived false", async () => {
  const recipe = await recipes.create("  Gnocchi   carbonara ");

  assert.match(recipe.id, UUID);
  assert.deepEqual(recipe, { id: recipe.id, name: "Gnocchi carbonara", archived: false });
  assert.deepEqual(JSON.parse(await readFile(recipesFile(), "utf8")), { recipes: [recipe] });
  // A brand-new store over the same directory sees it too: it really is on disk.
  assert.deepEqual(await createRecipes({ dataDir, enqueue: createQueue() }).list(), [recipe]);
});

test("list sorts recipes from A to Z by name key", async () => {
  for (const name of ["omelette", "Ñoquis", "Café", "banana"]) await recipes.create(name);

  const names = (await recipes.list()).map((recipe) => recipe.name);
  assert.deepEqual(names, ["banana", "Café", "Ñoquis", "omelette"]);
});

test("create rejects a name that isn't a string, is blank, or is too long", async () => {
  for (const name of [undefined, null, 42, ["Soup"], "", "   \n "]) {
    await assert.rejects(recipes.create(name), ValidationError, String(name));
  }
  await assert.rejects(recipes.create("x".repeat(101)), ValidationError);

  // The limit counts the cleaned name.
  assert.equal((await recipes.create(` ${"x".repeat(100)} `)).name, "x".repeat(100));
  assert.equal((await recipes.list()).length, 1);
});

test("create reports blank and too long names with readable messages", async () => {
  await assert.rejects(recipes.create(" "), { message: "The name can't be empty." });
  await assert.rejects(recipes.create("x".repeat(101)), {
    message: "The name must be at most 100 characters.",
  });
});

test("create rejects a name whose key is taken, active or archived, and reports that recipe", async () => {
  const cafe = await recipes.create("Café");

  await assert.rejects(recipes.create("  cafe "), (error) => {
    assert.ok(error instanceof NameConflictError);
    assert.deepEqual(error.recipe, cafe);
    return true;
  });

  const archived = await recipes.update(cafe.id, { archived: true });
  await assert.rejects(recipes.create("CAFE"), (error) => {
    assert.ok(error instanceof NameConflictError);
    assert.deepEqual(error.recipe, archived);
    return true;
  });
  assert.equal((await recipes.list()).length, 1);
});

test("concurrent creates with the same name key store only one recipe", async () => {
  const results = await Promise.allSettled([recipes.create("Soup"), recipes.create("soup")]);

  assert.deepEqual(
    results.map((result) => result.status),
    ["fulfilled", "rejected"],
  );
  assert.ok(results[1].reason instanceof NameConflictError);
  assert.equal((await recipes.list()).length, 1);
});

test("update renames a recipe and keeps its ID", async () => {
  const soup = await recipes.create("Soup");

  const renamed = await recipes.update(soup.id, { name: " Tomato  soup " });

  assert.deepEqual(renamed, { id: soup.id, name: "Tomato soup", archived: false });
  assert.deepEqual(await recipes.list(), [renamed]);
});

test("update accepts a new name with the recipe's own name key", async () => {
  const cafe = await recipes.create("Cafe");
  assert.equal((await recipes.update(cafe.id, { name: "Café" })).name, "Café");
});

test("update rejects a name whose key another recipe has", async () => {
  const soup = await recipes.create("Soup");
  const salad = await recipes.create("Salad");

  await assert.rejects(recipes.update(salad.id, { name: "SOUP" }), (error) => {
    assert.ok(error instanceof NameConflictError);
    assert.deepEqual(error.recipe, soup);
    return true;
  });
  assert.deepEqual(await recipes.list(), [salad, soup]);
});

test("update archives and restores a recipe", async () => {
  const soup = await recipes.create("Soup");

  assert.deepEqual(await recipes.update(soup.id, { archived: true }), { ...soup, archived: true });
  assert.deepEqual(await recipes.list(), [{ ...soup, archived: true }]);
  assert.deepEqual(await recipes.update(soup.id, { archived: false }), soup);
});

test("update rejects changes that aren't exactly one valid field", async () => {
  const soup = await recipes.create("Soup");
  const invalid = [
    undefined,
    null,
    "Soup",
    [],
    {},
    { name: "Stew", archived: true },
    { color: "red" },
    { archived: "yes" },
    { archived: null },
    { name: "" },
    { name: 42 },
    { name: "x".repeat(101) },
  ];

  for (const changes of invalid) {
    await assert.rejects(recipes.update(soup.id, changes), ValidationError, String(changes));
  }
  assert.deepEqual(await recipes.list(), [soup]);
});

test("update rejects an unknown ID", async () => {
  await assert.rejects(recipes.update("no-such-id", { archived: true }), NotFoundError);
});

test("list skips malformed entries in the file", async () => {
  await mkdir(path.join(dataDir, "v2"), { recursive: true });
  await writeFile(
    recipesFile(),
    JSON.stringify({
      recipes: [
        { id: "a", name: "Soup", archived: true },
        { id: "b", name: "Salad" }, // archived missing -> false
        { id: 3, name: "Bad ID" },
        { id: "c" },
        null,
        "Tea",
      ],
    }),
  );

  assert.deepEqual(await recipes.list(), [
    { id: "b", name: "Salad", archived: false },
    { id: "a", name: "Soup", archived: true },
  ]);
});

test("a recipes file with invalid JSON makes reads and writes fail without overwriting it", async () => {
  await mkdir(path.join(dataDir, "v2"), { recursive: true });
  await writeFile(recipesFile(), "{ not json");

  await assert.rejects(recipes.list(), SyntaxError);
  await assert.rejects(recipes.create("Soup"), SyntaxError);
  assert.equal(await readFile(recipesFile(), "utf8"), "{ not json");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/recipes.test.js`
Expected: FAIL with `Cannot find module '.../server/errors.js'`.

- [ ] **Step 3: Write the errors**

Create `server/errors.js`:

```js
// Errors that the stores throw for bad input. server/app.js maps each one to
// an HTTP status, so the stores never deal with HTTP.

/** The input breaks a rule, such as an empty recipe name. */
export class ValidationError extends Error {
  name = "ValidationError";
}

/** The input names something that doesn't exist, such as an unknown recipe ID. */
export class NotFoundError extends Error {
  name = "NotFoundError";
}

/** Another recipe already has the name key. `recipe` is that recipe. */
export class NameConflictError extends Error {
  name = "NameConflictError";

  constructor(message, recipe) {
    super(message);
    this.recipe = recipe;
  }
}
```

- [ ] **Step 4: Write the recipe book store**

Create `server/recipes.js`:

```js
// The recipe book: lists, creates, renames, archives, and restores recipes.
// Names are unique by name key, across active and archived recipes. Recipes
// are never deleted, so a menu never points to a recipe that doesn't exist.

import { randomUUID } from "node:crypto";
import { NameConflictError, NotFoundError, ValidationError } from "./errors.js";
import { dataPath, readJson, writeJson } from "./files.js";

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

function byNameKey(a, b) {
  const keyA = nameKey(a.name);
  const keyB = nameKey(b.name);
  if (keyA < keyB) return -1;
  return keyA > keyB ? 1 : 0;
}

function validName(name) {
  if (typeof name !== "string") throw new ValidationError('"name" must be a string.');
  const clean = cleanName(name);
  if (clean === "") throw new ValidationError("The name can't be empty.");
  if (clean.length > MAX_NAME_LENGTH) {
    throw new ValidationError(`The name must be at most ${MAX_NAME_LENGTH} characters.`);
  }
  return clean;
}

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

// Keeps only well-formed entries, so a hand-edited file can't break the app.
function normalize(raw) {
  const entries = Array.isArray(raw?.recipes) ? raw.recipes : [];
  return entries
    .filter((entry) => typeof entry?.id === "string" && typeof entry.name === "string")
    .map((entry) => ({ id: entry.id, name: entry.name, archived: entry.archived === true }));
}

export function createRecipes({ dataDir, enqueue }) {
  const file = dataPath(dataDir, "recipes.json");

  async function readAll() {
    return normalize(await readJson(file));
  }

  // The recipe, other than `exceptId`, whose name key equals the key of `name`.
  function holderOf(all, name, exceptId) {
    const key = nameKey(name);
    return all.find((recipe) => recipe.id !== exceptId && nameKey(recipe.name) === key);
  }

  function conflict(recipe) {
    return new NameConflictError(`A recipe named "${recipe.name}" already exists.`, recipe);
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

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/recipes.test.js`
Expected: PASS, 17 tests.

- [ ] **Step 6: Check and commit**

Run: `npm run format && npm run lint && npm test`
Expected: all pass.

```bash
git add server/errors.js server/recipes.js test/recipes.test.js
git commit -m "feat(store): add the recipe book"
```

---

### Task 4: The week store with menus

**Files:**

- Create: `server/weeks.js`
- Test: `test/weeks.test.js`

**Interfaces:**

- Consumes: `dataPath`, `readJson`, `writeJson`, and `createQueue` from
  `server/files.js` (Task 2). `ValidationError` from `server/errors.js` and
  `createRecipes(...).list()` from `server/recipes.js` (Task 3).
- Produces, exported from `server/weeks.js`:
  - `DAYS`, `MEALS`: the same arrays as in `server/store.js`.
  - `MAX_ITEMS = 20`, `MIN_SERVINGS = 0.5`, `MAX_SERVINGS = 99`.
  - `isWeekId(week: unknown): boolean`: moved unchanged from
    `server/store.js`.
  - `createWeeks({ dataDir, enqueue, recipes })` returns:
    - `readWeek(week: string): Promise<Week>`: rejects with `RangeError` for
      an invalid week.
    - `saveSlot(week, day, meal, items: unknown): Promise<{ week, day, meal, items }>`:
      rejects with `RangeError` for an invalid week, day, or meal, and with
      `ValidationError` for invalid items or an unknown recipe.
  - `Week` is `{ [day]: { [meal]: { items: [{ recipeId, servings }] } } }`
    with all 7 days and 5 meals.

`server/store.js` stays until Task 5, which switches the app to the new
modules.

- [ ] **Step 1: Write the failing tests**

Create `test/weeks.test.js`:

```js
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { ValidationError } from "../server/errors.js";
import { createQueue } from "../server/files.js";
import { createRecipes } from "../server/recipes.js";
import { createWeeks, DAYS, isWeekId, MEALS } from "../server/weeks.js";

// Expected values are written out literally so the tests do not trust the module under test.
const EXPECTED_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const EXPECTED_MEALS = ["breakfast", "snack_am", "lunch", "snack_pm", "dinner"];

const WEEK = "2026-09-21";
const OTHER_WEEK = "2026-09-28";

function blankWeek() {
  return Object.fromEntries(
    EXPECTED_DAYS.map((day) => [
      day,
      Object.fromEntries(EXPECTED_MEALS.map((meal) => [meal, { items: [] }])),
    ]),
  );
}

let dataDir;
let recipes;
let weeks;
let soup;
let salad;

function weekFile(week) {
  return path.join(dataDir, "v2", "weeks", `${week}.json`);
}

async function writeWeekFile(week, content) {
  await mkdir(path.dirname(weekFile(week)), { recursive: true });
  await writeFile(weekFile(week), content);
}

function newWeeks() {
  const enqueue = createQueue();
  return createWeeks({ dataDir, enqueue, recipes: createRecipes({ dataDir, enqueue }) });
}

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "meals-weeks-"));
  const enqueue = createQueue();
  recipes = createRecipes({ dataDir, enqueue });
  weeks = createWeeks({ dataDir, enqueue, recipes });
  soup = await recipes.create("Soup");
  salad = await recipes.create("Salad");
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

test("exports the stable day and meal identifiers in order", () => {
  assert.deepEqual(DAYS, EXPECTED_DAYS);
  assert.deepEqual(MEALS, EXPECTED_MEALS);
});

test("isWeekId accepts a Monday in YYYY-MM-DD format", () => {
  for (const week of ["2026-09-21", "2026-12-28", "2027-01-04"]) {
    assert.equal(isWeekId(week), true, week);
  }
});

test("isWeekId rejects other weekdays, impossible dates, and other formats", () => {
  const invalid = [
    "2026-09-22", // Tuesday
    "2026-09-27", // Sunday
    "2026-02-30", // doesn't exist; JavaScript rolls it over to Monday, March 2
    "2026-13-07",
    "2026-9-21",
    "20260921",
    "2026-09-21T00:00:00Z",
    " 2026-09-21",
    "__proto__",
    "",
    undefined,
    21,
  ];
  for (const week of invalid) {
    assert.equal(isWeekId(week), false, String(week));
  }
});

test("readWeek returns a complete week of empty menus when the week has no file", async () => {
  assert.deepEqual(await weeks.readWeek(WEEK), blankWeek());
});

test("readWeek rejects an invalid week", async () => {
  await assert.rejects(weeks.readWeek("2026-09-22"), RangeError);
});

test("saveSlot stores the menu and it can be read back", async () => {
  const items = [
    { recipeId: soup.id, servings: 1.5 },
    { recipeId: salad.id, servings: 2 },
  ];

  const result = await weeks.saveSlot(WEEK, "mon", "lunch", items);
  assert.deepEqual(result, { week: WEEK, day: "mon", meal: "lunch", items });

  const expected = blankWeek();
  expected.mon.lunch = { items };
  assert.deepEqual(await weeks.readWeek(WEEK), expected);
  // A brand-new store over the same directory sees it too: it really is on disk.
  assert.deepEqual(await newWeeks().readWeek(WEEK), expected);
});

test("saveSlot with no items empties the slot", async () => {
  await weeks.saveSlot(WEEK, "tue", "dinner", [{ recipeId: soup.id, servings: 1 }]);
  await weeks.saveSlot(WEEK, "tue", "dinner", []);
  assert.deepEqual(await weeks.readWeek(WEEK), blankWeek());
});

test("saveSlot writes each week to its own file and leaves other weeks unchanged", async () => {
  const items = [{ recipeId: soup.id, servings: 1 }];
  await Promise.all([
    weeks.saveSlot(WEEK, "tue", "lunch", items),
    weeks.saveSlot(OTHER_WEEK, "wed", "lunch", items),
  ]);

  const first = blankWeek();
  first.tue.lunch = { items };
  const second = blankWeek();
  second.wed.lunch = { items };
  assert.deepEqual(await weeks.readWeek(WEEK), first);
  assert.deepEqual(await weeks.readWeek(OTHER_WEEK), second);
  assert.deepEqual(await weeks.readWeek("2026-10-05"), blankWeek());
});

test("concurrent saves to different slots are all kept", async () => {
  const expected = blankWeek();
  const saves = [];
  for (const day of EXPECTED_DAYS) {
    for (const [index, meal] of EXPECTED_MEALS.entries()) {
      const items = [{ recipeId: soup.id, servings: index + 1 }];
      expected[day][meal] = { items };
      saves.push(weeks.saveSlot(WEEK, day, meal, items)); // not awaited: all 35 in flight at once
    }
  }

  await Promise.all(saves);

  assert.deepEqual(await newWeeks().readWeek(WEEK), expected);
});

test("saveSlot leaves no temporary file behind", async () => {
  await weeks.saveSlot(WEEK, "tue", "lunch", [{ recipeId: soup.id, servings: 1 }]);
  assert.deepEqual(await readdir(path.join(dataDir, "v2", "weeks")), [`${WEEK}.json`]);
});

test("saveSlot rejects unknown week, day, or meal identifiers without writing", async () => {
  const items = [{ recipeId: soup.id, servings: 1 }];
  await assert.rejects(weeks.saveSlot("2026-09-22", "mon", "lunch", items), RangeError);
  await assert.rejects(weeks.saveSlot("../week", "mon", "lunch", items), RangeError);
  await assert.rejects(weeks.saveSlot(WEEK, "funday", "lunch", items), RangeError);
  await assert.rejects(weeks.saveSlot(WEEK, "mon", "brunch", items), RangeError);
  await assert.rejects(weeks.saveSlot(WEEK, "__proto__", "lunch", items), RangeError);
  assert.deepEqual(await readdir(path.join(dataDir, "v2")), ["recipes.json"]);
});

test("saveSlot rejects invalid items without writing", async () => {
  const tooMany = Array.from({ length: 21 }, (_, index) => ({ recipeId: `r${index}`, servings: 1 }));
  const invalid = [
    undefined,
    null,
    "Soup",
    {},
    tooMany,
    [null],
    [soup.id],
    [{ recipeId: soup.id }],
    [{ servings: 1 }],
    [{ recipeId: soup.id, servings: 1, note: "hot" }],
    [{ recipeId: 42, servings: 1 }],
    [{ recipeId: soup.id, servings: "1" }],
    [{ recipeId: soup.id, servings: 0 }],
    [{ recipeId: soup.id, servings: 0.25 }],
    [{ recipeId: soup.id, servings: 1.2 }],
    [{ recipeId: soup.id, servings: -1 }],
    [{ recipeId: soup.id, servings: 99.5 }],
    [{ recipeId: soup.id, servings: Number.NaN }],
    [
      { recipeId: soup.id, servings: 1 },
      { recipeId: soup.id, servings: 2 },
    ],
    [{ recipeId: "no-such-recipe", servings: 1 }],
  ];

  for (const items of invalid) {
    await assert.rejects(
      weeks.saveSlot(WEEK, "mon", "lunch", items),
      ValidationError,
      JSON.stringify(items)?.slice(0, 60),
    );
  }
  assert.deepEqual(await readdir(path.join(dataDir, "v2")), ["recipes.json"]);
});

test("saveSlot accepts the limits: 0.5 and 99 servings, and 20 menu items", async () => {
  await weeks.saveSlot(WEEK, "mon", "lunch", [
    { recipeId: soup.id, servings: 0.5 },
    { recipeId: salad.id, servings: 99 },
  ]);

  const items = [];
  for (let index = 0; index < 20; index++) {
    const recipe = await recipes.create(`Recipe ${index}`);
    items.push({ recipeId: recipe.id, servings: 1 });
  }
  const result = await weeks.saveSlot(WEEK, "mon", "dinner", items);
  assert.equal(result.items.length, 20);
});

test("saveSlot accepts an archived recipe", async () => {
  await recipes.update(soup.id, { archived: true });
  const items = [{ recipeId: soup.id, servings: 2 }];
  assert.deepEqual((await weeks.saveSlot(WEEK, "fri", "dinner", items)).items, items);
});

test("readWeek keeps only the menu items that saveSlot would accept", async () => {
  await writeWeekFile(
    WEEK,
    JSON.stringify({
      mon: {
        breakfast: {
          items: [
            { recipeId: soup.id, servings: 1 },
            { recipeId: soup.id, servings: 2 }, // repeated recipe -> dropped
            { recipeId: salad.id, servings: 0.3 }, // off the 0.5 grid -> dropped
            { recipeId: "gone", servings: 1 }, // recipe doesn't exist -> dropped
            { recipeId: 7, servings: 1 }, // not a string -> dropped
            null,
            { recipeId: salad.id, servings: 2, extra: true }, // kept without the extra key
          ],
        },
        lunch: "Paella", // free text from an earlier version -> empty menu
      },
      fri: null, // broken day -> all empty
      holiday: { lunch: { items: [] } }, // unknown day -> dropped
    }),
  );

  const expected = blankWeek();
  expected.mon.breakfast = {
    items: [
      { recipeId: soup.id, servings: 1 },
      { recipeId: salad.id, servings: 2 },
    ],
  };
  const week = await weeks.readWeek(WEEK);
  assert.deepEqual(week, expected);

  // Every slot that was read can be saved again as it is.
  for (const day of EXPECTED_DAYS) {
    for (const meal of EXPECTED_MEALS) {
      await weeks.saveSlot(WEEK, day, meal, week[day][meal].items);
    }
  }
});

test("readWeek keeps at most 20 menu items per slot", async () => {
  const items = [];
  for (let index = 0; index < 25; index++) {
    const recipe = await recipes.create(`Recipe ${index}`);
    items.push({ recipeId: recipe.id, servings: 1 });
  }
  await writeWeekFile(WEEK, JSON.stringify({ sun: { dinner: { items } } }));

  const week = await weeks.readWeek(WEEK);
  assert.deepEqual(week.sun.dinner.items, items.slice(0, 20));
});

test("readWeek rejects when the week file is not valid JSON, and saveSlot doesn't overwrite it", async () => {
  await writeWeekFile(WEEK, "{ not json");

  await assert.rejects(weeks.readWeek(WEEK), SyntaxError);
  await assert.rejects(
    weeks.saveSlot(WEEK, "mon", "lunch", [{ recipeId: soup.id, servings: 1 }]),
    SyntaxError,
  );
  assert.equal(await readFile(weekFile(WEEK), "utf8"), "{ not json");
});

test("the free-text weeks of earlier versions are never read or changed", async () => {
  const legacyWeek = path.join(dataDir, "weeks", `${WEEK}.json`);
  const legacySingleWeek = path.join(dataDir, "week.json");
  const legacyText = JSON.stringify({ mon: { lunch: "Paella" } });
  await mkdir(path.dirname(legacyWeek), { recursive: true });
  await writeFile(legacyWeek, legacyText);
  await writeFile(legacySingleWeek, legacyText);

  assert.deepEqual(await weeks.readWeek(WEEK), blankWeek());
  await weeks.saveSlot(WEEK, "mon", "lunch", [{ recipeId: soup.id, servings: 1 }]);

  assert.equal(await readFile(legacyWeek, "utf8"), legacyText);
  assert.equal(await readFile(legacySingleWeek, "utf8"), legacyText);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/weeks.test.js`
Expected: FAIL with `Cannot find module '.../server/weeks.js'`.

- [ ] **Step 3: Write the week store**

Create `server/weeks.js`:

```js
// Weeks of menus. Each slot of a week holds a menu, { items: [{ recipeId,
// servings }] }. One file per week in DATA_DIR/v2/weeks/, named after the
// week's Monday.

import { ValidationError } from "./errors.js";
import { dataPath, readJson, writeJson } from "./files.js";

// Stable identifiers shared by the API and the storage format. Order matters.
export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const MEALS = ["breakfast", "snack_am", "lunch", "snack_pm", "dinner"];

export const MAX_ITEMS = 20;
export const MIN_SERVINGS = 0.5;
export const MAX_SERVINGS = 99;

const WEEK_ID_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// A week is identified by its Monday as YYYY-MM-DD. Validation runs in UTC, so
// the answer doesn't depend on the server's time zone. An impossible date such
// as 2026-02-30 rolls over to another day, so it fails the round trip.
export function isWeekId(week) {
  if (typeof week !== "string" || !WEEK_ID_PATTERN.test(week)) return false;
  const date = new Date(`${week}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().startsWith(week) && date.getUTCDay() === 1
  );
}

// Multiples of 0.5 are exact in binary floating point, so this check is exact.
function isValidServings(servings) {
  return (
    typeof servings === "number" &&
    Number.isInteger(servings * 2) &&
    servings >= MIN_SERVINGS &&
    servings <= MAX_SERVINGS
  );
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function emptyWeek() {
  return Object.fromEntries(
    DAYS.map((day) => [day, Object.fromEntries(MEALS.map((meal) => [meal, { items: [] }]))]),
  );
}

// Keeps the menu items that saveSlot would accept, so a hand-edited file, or a
// recipe book restored from an older backup, never produces a slot that can't
// be saved again.
function normalizeMenu(raw, knownRecipeIds) {
  const items = [];
  const seen = new Set();
  for (const item of Array.isArray(raw?.items) ? raw.items : []) {
    if (items.length === MAX_ITEMS) break;
    if (!isPlainObject(item) || !isValidServings(item.servings)) continue;
    if (!knownRecipeIds.has(item.recipeId) || seen.has(item.recipeId)) continue;
    seen.add(item.recipeId);
    items.push({ recipeId: item.recipeId, servings: item.servings });
  }
  return { items };
}

// Builds a complete 7 x 5 week from whatever was parsed: unknown keys are
// dropped, and missing or broken menus become empty.
function normalize(raw, knownRecipeIds) {
  const week = emptyWeek();
  for (const day of DAYS) {
    for (const meal of MEALS) {
      week[day][meal] = normalizeMenu(raw?.[day]?.[meal], knownRecipeIds);
    }
  }
  return week;
}

// Checks the items of a PUT body, except that their recipes exist. Returns
// clean copies with only recipeId and servings.
function validItems(items) {
  if (!Array.isArray(items)) throw new ValidationError('"items" must be an array.');
  if (items.length > MAX_ITEMS) {
    throw new ValidationError(`A menu holds at most ${MAX_ITEMS} menu items.`);
  }
  const seen = new Set();
  return items.map((item, index) => {
    const where = `items[${index}]`;
    if (!isPlainObject(item) || Object.keys(item).sort().join() !== "recipeId,servings") {
      throw new ValidationError(`${where} must have exactly "recipeId" and "servings".`);
    }
    if (typeof item.recipeId !== "string") {
      throw new ValidationError(`${where}.recipeId must be a string.`);
    }
    if (seen.has(item.recipeId)) {
      throw new ValidationError(`${where} repeats recipe ${item.recipeId}.`);
    }
    seen.add(item.recipeId);
    if (!isValidServings(item.servings)) {
      throw new ValidationError(
        `${where}.servings must be a multiple of ${MIN_SERVINGS} from ${MIN_SERVINGS} to ${MAX_SERVINGS}.`,
      );
    }
    return { recipeId: item.recipeId, servings: item.servings };
  });
}

export function createWeeks({ dataDir, enqueue, recipes }) {
  function weekFile(week) {
    return dataPath(dataDir, "weeks", `${week}.json`);
  }

  async function knownRecipeIds() {
    return new Set((await recipes.list()).map((recipe) => recipe.id));
  }

  async function readWeek(week) {
    if (!isWeekId(week)) throw new RangeError(`Unknown week: ${week}`);
    const [raw, known] = await Promise.all([readJson(weekFile(week)), knownRecipeIds()]);
    return normalize(raw, known);
  }

  async function saveSlot(week, day, meal, items) {
    if (!isWeekId(week) || !DAYS.includes(day) || !MEALS.includes(meal)) {
      throw new RangeError(`Unknown slot: ${week}/${day}/${meal}`);
    }
    const clean = validItems(items);
    return enqueue(async () => {
      // Inside the queue, so no recipe write runs between this check and the save.
      const known = await knownRecipeIds();
      const unknown = clean.find((item) => !known.has(item.recipeId));
      if (unknown) throw new ValidationError(`Unknown recipe: ${unknown.recipeId}`);
      const data = await readWeek(week);
      data[day][meal] = { items: clean };
      await writeJson(weekFile(week), data);
      return { week, day, meal, items: clean };
    });
  }

  return { readWeek, saveSlot };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/weeks.test.js`
Expected: PASS, 18 tests.

- [ ] **Step 5: Check and commit**

Run: `npm run format && npm run lint && npm test`
Expected: all pass.

```bash
git add server/weeks.js test/weeks.test.js
git commit -m "feat(store): store a menu in each slot of a week"
```

---

### Task 5: The recipes and menus API

**Files:**

- Modify: `server/app.js` (whole file)
- Modify: `server/index.js` (whole file)
- Delete: `server/store.js`
- Delete: `test/store.test.js`
- Test: `test/api.test.js` (whole file)
- Modify: `README.md` (configure, back up, API reference, and project
  structure)

**Interfaces:**

- Consumes: `createQueue` (Task 2). `ValidationError`, `NotFoundError`,
  `NameConflictError`, and `createRecipes` (Task 3). `createWeeks`, `DAYS`,
  `MEALS`, and `isWeekId` (Task 4).
- Produces: `createApp({ recipes, weeks })` in `server/app.js`, and the HTTP
  API in the spec:
  - `GET /api/recipes` → `200 { recipes }`.
  - `POST /api/recipes` `{ name }` → `201 Recipe`, `400`, or
    `409 { error, recipe }`.
  - `PATCH /api/recipes/ID` `{ name }` or `{ archived }` → `200 Recipe`,
    `400`, `404`, or `409 { error, recipe }`.
  - `GET /api/weeks/WEEK` → `200 Week` or `404`.
  - `PUT /api/weeks/WEEK/DAY/MEAL` `{ items }` →
    `200 { week, day, meal, items }`, `400`, or `404`.

- [ ] **Step 1: Write the failing tests**

Replace `test/api.test.js` with:

```js
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import request from "supertest";
import { createApp } from "../server/app.js";
import { createQueue } from "../server/files.js";
import { createRecipes } from "../server/recipes.js";
import { createWeeks } from "../server/weeks.js";

const EXPECTED_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const EXPECTED_MEALS = ["breakfast", "snack_am", "lunch", "snack_pm", "dinner"];

const WEEK = "2026-09-21";
const OTHER_WEEK = "2026-09-28";
// A Tuesday, an impossible date that JavaScript rolls over to a Monday, and non-dates.
const INVALID_WEEKS = ["2026-09-22", "2026-02-30", "2026-9-21", "hello"];

function blankWeek() {
  return Object.fromEntries(
    EXPECTED_DAYS.map((day) => [
      day,
      Object.fromEntries(EXPECTED_MEALS.map((meal) => [meal, { items: [] }])),
    ]),
  );
}

let dataDir;
let app;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "meals-api-"));
  const enqueue = createQueue();
  const recipes = createRecipes({ dataDir, enqueue });
  app = createApp({ recipes, weeks: createWeeks({ dataDir, enqueue, recipes }) });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

async function addRecipe(name) {
  const res = await request(app).post("/api/recipes").send({ name });
  assert.equal(res.status, 201, name);
  return res.body;
}

function assertJsonError(res, status, label) {
  assert.equal(res.status, status, label);
  assert.match(res.headers["content-type"], /application\/json/, label);
  assert.equal(typeof res.body.error, "string", label);
}

// ---------- Recipes ----------

test("GET /api/recipes returns an empty recipe book at first", async () => {
  const res = await request(app).get("/api/recipes");

  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /application\/json/);
  assert.deepEqual(res.body, { recipes: [] });
});

test("POST /api/recipes returns 201 with the new recipe, and GET lists it", async () => {
  const res = await request(app).post("/api/recipes").send({ name: "  Gnocchi  carbonara " });

  assert.equal(res.status, 201);
  assert.equal(typeof res.body.id, "string");
  assert.deepEqual(res.body, { id: res.body.id, name: "Gnocchi carbonara", archived: false });

  const get = await request(app).get("/api/recipes");
  assert.deepEqual(get.body, { recipes: [res.body] });
});

test("GET /api/recipes lists archived recipes too, from A to Z by name key", async () => {
  const omelette = await addRecipe("omelette");
  const cafe = await addRecipe("Café");
  await request(app).patch(`/api/recipes/${omelette.id}`).send({ archived: true });

  const res = await request(app).get("/api/recipes");
  assert.deepEqual(res.body, { recipes: [cafe, { ...omelette, archived: true }] });
});

test("POST /api/recipes with an invalid name returns 400 JSON and stores nothing", async () => {
  const bodies = [{}, { name: 42 }, { name: null }, { name: "   " }, { name: "x".repeat(101) }];
  for (const body of bodies) {
    const res = await request(app).post("/api/recipes").send(body);
    assertJsonError(res, 400, JSON.stringify(body).slice(0, 40));
  }
  assertJsonError(await request(app).post("/api/recipes"), 400, "no body at all");

  const get = await request(app).get("/api/recipes");
  assert.deepEqual(get.body, { recipes: [] });
});

test("POST /api/recipes explains an empty name", async () => {
  const res = await request(app).post("/api/recipes").send({ name: " " });
  assert.deepEqual(res.body, { error: "The name can't be empty." });
});

test("POST /api/recipes with a taken name returns 409 with the recipe that has it", async () => {
  const soup = await addRecipe("Soup");

  const res = await request(app).post("/api/recipes").send({ name: "SOUP" });

  assertJsonError(res, 409, "active recipe");
  assert.deepEqual(res.body.recipe, soup);
});

test("POST /api/recipes reports an archived recipe whose name matches after cleanup", async () => {
  const cafe = await addRecipe("Café");
  await request(app).patch(`/api/recipes/${cafe.id}`).send({ archived: true });

  const res = await request(app).post("/api/recipes").send({ name: "  cafe " });

  assertJsonError(res, 409, "archived recipe");
  assert.deepEqual(res.body.recipe, { ...cafe, archived: true });
});

test("PATCH /api/recipes/ID renames a recipe", async () => {
  const soup = await addRecipe("Soup");

  const res = await request(app).patch(`/api/recipes/${soup.id}`).send({ name: "Tomato soup" });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ...soup, name: "Tomato soup" });
});

test("PATCH /api/recipes/ID accepts a name with the recipe's own name key", async () => {
  const cafe = await addRecipe("Cafe");
  const res = await request(app).patch(`/api/recipes/${cafe.id}`).send({ name: "Café" });
  assert.equal(res.status, 200);
  assert.equal(res.body.name, "Café");
});

test("PATCH /api/recipes/ID with another recipe's name returns 409 with that recipe", async () => {
  const soup = await addRecipe("Soup");
  const salad = await addRecipe("Salad");

  const res = await request(app).patch(`/api/recipes/${salad.id}`).send({ name: "soup" });

  assertJsonError(res, 409, "rename conflict");
  assert.deepEqual(res.body.recipe, soup);
});

test("PATCH /api/recipes/ID archives and restores a recipe", async () => {
  const soup = await addRecipe("Soup");

  const archive = await request(app).patch(`/api/recipes/${soup.id}`).send({ archived: true });
  assert.equal(archive.status, 200);
  assert.deepEqual(archive.body, { ...soup, archived: true });

  const restore = await request(app).patch(`/api/recipes/${soup.id}`).send({ archived: false });
  assert.deepEqual(restore.body, soup);
});

test("PATCH /api/recipes/ID with an invalid body returns 400 JSON and changes nothing", async () => {
  const soup = await addRecipe("Soup");
  const bodies = [
    {},
    { name: "Stew", archived: true },
    { color: "red" },
    { archived: "yes" },
    { name: "" },
    { name: 42 },
  ];
  for (const body of bodies) {
    const res = await request(app).patch(`/api/recipes/${soup.id}`).send(body);
    assertJsonError(res, 400, JSON.stringify(body));
  }
  assertJsonError(await request(app).patch(`/api/recipes/${soup.id}`), 400, "no body at all");

  const get = await request(app).get("/api/recipes");
  assert.deepEqual(get.body, { recipes: [soup] });
});

test("PATCH /api/recipes/ID with an unknown ID returns 404 JSON", async () => {
  const res = await request(app).patch("/api/recipes/no-such-id").send({ archived: true });
  assertJsonError(res, 404, "unknown ID");
});

test("GET /api/recipes returns 500 JSON when the recipes file is corrupt", async () => {
  await mkdir(path.join(dataDir, "v2"), { recursive: true });
  await writeFile(path.join(dataDir, "v2", "recipes.json"), "{ not json");

  const res = await request(app).get("/api/recipes");

  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: "Internal server error" });
});

// ---------- Weeks ----------

test("GET /api/weeks/WEEK returns 200 with a complete week of empty menus", async () => {
  const res = await request(app).get(`/api/weeks/${WEEK}`);

  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /application\/json/);
  assert.deepEqual(res.body, blankWeek());
});

test("PUT a valid menu returns 200 with the saved slot and a later GET reflects it", async () => {
  const soup = await addRecipe("Soup");
  const salad = await addRecipe("Salad");
  const items = [
    { recipeId: soup.id, servings: 1.5 },
    { recipeId: salad.id, servings: 2 },
  ];

  const put = await request(app).put(`/api/weeks/${WEEK}/wed/lunch`).send({ items });
  assert.equal(put.status, 200);
  assert.match(put.headers["content-type"], /application\/json/);
  assert.deepEqual(put.body, { week: WEEK, day: "wed", meal: "lunch", items });

  const get = await request(app).get(`/api/weeks/${WEEK}`);
  const expected = blankWeek();
  expected.wed.lunch = { items };
  assert.deepEqual(get.body, expected);
});

test("a PUT in one week doesn't change another week", async () => {
  const soup = await addRecipe("Soup");
  await request(app)
    .put(`/api/weeks/${WEEK}/wed/lunch`)
    .send({ items: [{ recipeId: soup.id, servings: 1 }] });

  const get = await request(app).get(`/api/weeks/${OTHER_WEEK}`);
  assert.equal(get.status, 200);
  assert.deepEqual(get.body, blankWeek());
});

test("PUT accepts an empty menu (clearing a slot)", async () => {
  const soup = await addRecipe("Soup");
  await request(app)
    .put(`/api/weeks/${WEEK}/mon/dinner`)
    .send({ items: [{ recipeId: soup.id, servings: 1 }] });

  const put = await request(app).put(`/api/weeks/${WEEK}/mon/dinner`).send({ items: [] });
  assert.equal(put.status, 200);

  const get = await request(app).get(`/api/weeks/${WEEK}`);
  assert.deepEqual(get.body.mon.dinner, { items: [] });
});

test("PUT accepts an archived recipe, so older menus stay savable", async () => {
  const soup = await addRecipe("Soup");
  await request(app).patch(`/api/recipes/${soup.id}`).send({ archived: true });

  const put = await request(app)
    .put(`/api/weeks/${WEEK}/tue/lunch`)
    .send({ items: [{ recipeId: soup.id, servings: 3 }] });

  assert.equal(put.status, 200);
});

test("PUT accepts 20 menu items and servings of 0.5 and 99", async () => {
  const items = [];
  for (let index = 0; index < 20; index++) {
    const recipe = await addRecipe(`Recipe ${index}`);
    items.push({ recipeId: recipe.id, servings: index === 0 ? 0.5 : 99 });
  }

  const put = await request(app).put(`/api/weeks/${WEEK}/sat/lunch`).send({ items });
  assert.equal(put.status, 200);
  assert.equal(put.body.items.length, 20);
});

test("GET with an invalid week returns 404 JSON", async () => {
  for (const week of INVALID_WEEKS) {
    assertJsonError(await request(app).get(`/api/weeks/${week}`), 404, week);
  }
});

test("PUT with an unknown week, day, or meal returns 404 JSON and saves nothing", async () => {
  const urls = [
    ...INVALID_WEEKS.map((week) => `/api/weeks/${week}/mon/lunch`),
    `/api/weeks/${WEEK}/funday/lunch`,
    `/api/weeks/${WEEK}/mon/brunch`,
  ];
  for (const url of urls) {
    assertJsonError(await request(app).put(url).send({ items: [] }), 404, url);
  }
  assert.deepEqual(await readdir(dataDir), []);
});

test("PUT with an invalid menu returns 400 JSON and saves nothing", async () => {
  const soup = await addRecipe("Soup");
  const url = `/api/weeks/${WEEK}/mon/lunch`;
  const bodies = [
    {},
    { text: "Soup" }, // the free-text API of earlier versions
    { items: "Soup" },
    { items: [{ recipeId: soup.id }] },
    { items: [{ recipeId: soup.id, servings: 1, note: "hot" }] },
    { items: [{ recipeId: soup.id, servings: 0.3 }] },
    { items: [{ recipeId: soup.id, servings: 100 }] },
    {
      items: [
        { recipeId: soup.id, servings: 1 },
        { recipeId: soup.id, servings: 1 },
      ],
    },
    { items: [{ recipeId: "no-such-recipe", servings: 1 }] },
    {
      items: Array.from({ length: 21 }, (_, index) => ({ recipeId: `r${index}`, servings: 1 })),
    },
  ];
  for (const body of bodies) {
    const res = await request(app).put(url).send(body);
    assertJsonError(res, 400, JSON.stringify(body).slice(0, 60));
  }
  assertJsonError(await request(app).put(url), 400, "no body at all");

  const get = await request(app).get(`/api/weeks/${WEEK}`);
  assert.deepEqual(get.body, blankWeek());
});

test("PUT with a malformed JSON body returns 400 JSON", async () => {
  const res = await request(app)
    .put(`/api/weeks/${WEEK}/mon/lunch`)
    .set("Content-Type", "application/json")
    .send('{"items":');

  assertJsonError(res, 400, "malformed JSON");
});

test("GET returns 500 JSON when the week file is corrupt", async () => {
  await mkdir(path.join(dataDir, "v2", "weeks"), { recursive: true });
  await writeFile(path.join(dataDir, "v2", "weeks", `${WEEK}.json`), "{ not json");

  const res = await request(app).get(`/api/weeks/${WEEK}`);

  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: "Internal server error" });
});

// ---------- Other routes ----------

test("unknown /api routes return 404 JSON", async () => {
  assertJsonError(await request(app).get("/api/nope"), 404, "GET /api/nope");
  assertJsonError(await request(app).delete("/api/recipes/x"), 404, "DELETE a recipe");
});

test("GET / serves the frontend page", async () => {
  const res = await request(app).get("/");

  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /text\/html/);
  assert.match(res.text, /<title>Weekly meal plan<\/title>/);
});

test("GET /dates.js serves the date helpers", async () => {
  const res = await request(app).get("/dates.js");

  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /javascript/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/api.test.js`
Expected: FAIL. Most tests fail with `404` or `400` statuses, because
`createApp` still expects `{ store }` and has no `/api/recipes` routes.

- [ ] **Step 3: Rewrite the app**

Replace `server/app.js` with:

```js
import { fileURLToPath } from "node:url";
import express from "express";
import { NameConflictError, NotFoundError, ValidationError } from "./errors.js";
import { DAYS, isWeekId, MEALS } from "./weeks.js";

const PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));

export function createApp({ recipes, weeks }) {
  const app = express();
  app.use(express.json());

  app.get("/api/recipes", async (_req, res) => {
    res.json({ recipes: await recipes.list() });
  });

  // Express 5 leaves req.body undefined when there is no JSON body. The stores
  // validate what they get and throw the errors that the handler below maps.
  app.post("/api/recipes", async (req, res) => {
    res.status(201).json(await recipes.create(req.body?.name));
  });

  app.patch("/api/recipes/:id", async (req, res) => {
    res.json(await recipes.update(req.params.id, req.body));
  });

  app.get("/api/weeks/:week", async (req, res) => {
    const { week } = req.params;
    if (!isWeekId(week)) {
      res.status(404).json({ error: `Unknown week: ${week}` });
      return;
    }
    res.json(await weeks.readWeek(week));
  });

  app.put("/api/weeks/:week/:day/:meal", async (req, res) => {
    const { week, day, meal } = req.params;
    if (!isWeekId(week) || !DAYS.includes(day) || !MEALS.includes(meal)) {
      res.status(404).json({ error: `Unknown week, day, or meal: ${week}/${day}/${meal}` });
      return;
    }
    res.json(await weeks.saveSlot(week, day, meal, req.body?.items));
  });

  // Any other /api path: JSON 404 (the API only ever answers JSON).
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use(express.static(PUBLIC_DIR));

  // Final error handler (Express 5 forwards rejected async handlers here).
  // 4xx errors from body parsing (for example, malformed JSON -> 400) keep their status.
  // Keep all four parameters: Express identifies error handlers by arity.
  app.use((err, _req, res, _next) => {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof NameConflictError) {
      res.status(409).json({ error: err.message, recipe: err.recipe });
      return;
    }
    const status =
      Number.isInteger(err.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? "Internal server error" : err.message });
  });

  return app;
}
```

- [ ] **Step 4: Wire the stores at startup**

Replace `server/index.js` with:

```js
import path from "node:path";
import { createApp } from "./app.js";
import { createQueue } from "./files.js";
import { createRecipes } from "./recipes.js";
import { createWeeks } from "./weeks.js";

const port = Number(process.env.PORT || 3000);
const dataDir = path.resolve(process.env.DATA_DIR || "data");

// One queue for every file, so a save never checks recipes while they change.
const enqueue = createQueue();
const recipes = createRecipes({ dataDir, enqueue });
const weeks = createWeeks({ dataDir, enqueue, recipes });
const app = createApp({ recipes, weeks });

app.listen(port, "0.0.0.0", (error) => {
  if (error) throw error;
  console.log(`Meals listening on http://0.0.0.0:${port} (data: ${dataDir})`);
});
```

- [ ] **Step 5: Delete the old store**

```bash
git rm server/store.js test/store.test.js
```

Its week identifier and normalization tests now live in `test/weeks.test.js`.
The `migrateLegacyWeek` tests go away with the function.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, with no test file that imports `server/store.js`.

Run: `grep -rn "store.js\|migrateLegacyWeek\|saveCell" server test`
Expected: no output.

- [ ] **Step 7: Update the README**

In `README.md`, in the `## Configure the server` table, replace the
`DATA_DIR` row with:

```markdown
| `DATA_DIR` | `./data` | The directory that stores the meal plan and the recipe book. |
```

Replace the whole `## Back up and restore data` section, including its
`### Upgrade from a single week` subsection, with:

````markdown
## Back up and restore data

The meal plan and the recipe book live in `data/v2/`:

- `data/v2/recipes.json` holds the recipe book.
- `data/v2/weeks/` holds one file per week, named after the week's Monday,
  for example `data/v2/weeks/2026-09-21.json`. The server creates a week's
  file on the first save in that week.

Git ignores the `data/` directory.

To back up your data, copy the directory:

```bash
cp -r data/v2 v2.backup
```

If a week file or `recipes.json` contains invalid JSON, the app shows an
error, such as `Couldn't load the meal plan.`, and doesn't overwrite the file.
To recover, do the following:

1. Restore a backup copy of the file, or fix the JSON by hand.
1. In the app, click **Retry**.

### Plans from earlier versions

Earlier versions stored each slot as free text, in `data/weeks/` and
`data/week.json`. The app doesn't show those plans, and the server never
reads, changes, or deletes those files. To keep them, leave them where they
are or copy them elsewhere.
````

Replace the whole `## API reference` section with:

````markdown
## API reference

The user interface depends only on this API. All responses are JSON. Errors
have the shape `{ "error": "MESSAGE" }`.

A recipe has the shape `{ "id", "name", "archived" }`. Names are unique,
ignoring case and accents, across active and archived recipes.

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
| `409`  | Another recipe has the same name. The body is `{ "error", "recipe" }`, where `recipe` is that recipe. |

### Change a recipe

`PATCH /api/recipes/ID`

Request body: `{ "name": "NAME" }` to rename the recipe, or
`{ "archived": true }` or `{ "archived": false }` to archive or restore it.

| Status | Meaning |
|--------|---------|
| `200`  | The body is the updated recipe. |
| `400`  | The body doesn't have exactly one of the two fields, or the value is invalid. |
| `404`  | No recipe has that ID. |
| `409`  | Another recipe has the same name. The body is `{ "error", "recipe" }`. |

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
| `400`  | `items` isn't an array of at most 20 menu items; a menu item doesn't have exactly `recipeId` and `servings`; a recipe doesn't exist or appears twice; or `servings` isn't a multiple of 0.5 from 0.5 to 99. Archived recipes are accepted. |
| `404`  | `WEEK`, `DAY`, or `MEAL` isn't a valid identifier. |
````

In the `## Project structure` tree, replace the `server/` entry with:

```none
server/
  app.js     # HTTP API (Express) and static files.
  errors.js  # Errors for bad input, which app.js maps to HTTP statuses.
  files.js   # Reads and writes JSON files. The only module that touches disk.
  index.js   # Startup: reads DATA_DIR and PORT and listens on 0.0.0.0.
  recipes.js # The recipe book: unique names, renaming, and archiving.
  weeks.js   # Weeks and the menu of each slot.
```

- [ ] **Step 8: Check and commit**

Run: `npm run format && npm run lint && npm test`
Expected: all pass.

```bash
git add README.md server/app.js server/index.js test/api.test.js
git commit -m "feat(api): serve the recipe book and menus"
```

The `git rm` in Step 5 already staged the deletions.

---

### Task 6: Browser helpers for menus, recipe names, and HTTP

**Files:**

- Create: `public/http.js`
- Create: `public/menus.js`
- Create: `public/recipe-search.js`
- Test: `test/http.test.js`
- Test: `test/menus.test.js`
- Test: `test/recipe-search.test.js`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `public/recipe-search.js`:
    - `nameKey(name: string): string`: same rule as the server.
    - `sortRecipes(recipes: Recipe[]): Recipe[]`: a new array, A to Z by
      name key.
    - `filterRecipes(recipes: Recipe[], query: string): Recipe[]`: the
      recipes whose name key contains the key of the trimmed query, in input
      order. A blank query matches all.
  - `public/menus.js`:
    - `MAX_ITEMS = 20`, `MIN_SERVINGS = 0.5`, `MAX_SERVINGS = 99`.
    - `emptyMenu(): Menu`, `copyMenu(menu): Menu`,
      `sameMenu(a, b): boolean`, `hasRecipe(menu, recipeId): boolean`.
    - `addItem(menu, recipeId): Menu`: appends at 1 serving; returns `menu`
      itself when the recipe is already in it or it's full.
    - `removeItem(menu, recipeId): Menu`.
    - `stepServings(menu, recipeId, steps: number): Menu`: moves by
      `steps × 0.5`, clamped to 0.5 and 99.
    - `addableRecipes(recipes, menu, query): Recipe[]`: active recipes that
      aren't in the menu, matching the query, A to Z.
    - `describeItem(name: string, servings: number): string`: `NAME × SERVINGS`.
    - None of them changes the menus it gets.
  - `public/http.js`:
    - `REQUEST_TIMEOUT_MS = 5000`.
    - `getJson(url): Promise<any>`: rejects on a network error, a timeout, or
      a status other than 2xx.
    - `sendJson(method, url, body): Promise<{ status: number, body: any }>`:
      resolves whatever the status, with `body` as `{}` when it isn't JSON;
      rejects on a network error or a timeout.

- [ ] **Step 1: Write the failing tests for recipe names**

Create `test/recipe-search.test.js`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { filterRecipes, nameKey, sortRecipes } from "../public/recipe-search.js";

function recipe(name, archived = false) {
  return { id: `id-${name}`, name, archived };
}

test("nameKey ignores case and accents, like the server", () => {
  assert.equal(nameKey("Café"), "cafe");
  assert.equal(nameKey("ÑOQUIS"), "noquis");
});

test("sortRecipes returns a new array from A to Z by name key", () => {
  const input = [recipe("omelette"), recipe("Ñoquis"), recipe("Café"), recipe("banana")];

  const sorted = sortRecipes(input);

  assert.deepEqual(
    sorted.map((entry) => entry.name),
    ["banana", "Café", "Ñoquis", "omelette"],
  );
  assert.equal(input[0].name, "omelette", "the input keeps its order");
});

test("filterRecipes matches part of the name, ignoring case, accents, and extra spaces", () => {
  const recipes = [recipe("Iced café"), recipe("Tea"), recipe("Café con leche")];

  assert.deepEqual(
    filterRecipes(recipes, "cafe").map((entry) => entry.name),
    ["Iced café", "Café con leche"],
  );
  assert.deepEqual(
    filterRecipes(recipes, "  CAFÉ   CON ").map((entry) => entry.name),
    ["Café con leche"],
  );
  assert.deepEqual(filterRecipes(recipes, "juice"), []);
});

test("filterRecipes with a blank query matches every recipe", () => {
  const recipes = [recipe("Tea"), recipe("Soup")];
  assert.deepEqual(filterRecipes(recipes, ""), recipes);
  assert.deepEqual(filterRecipes(recipes, "   "), recipes);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/recipe-search.test.js`
Expected: FAIL with `Cannot find module '.../public/recipe-search.js'`.

- [ ] **Step 3: Write the recipe name helpers**

Create `public/recipe-search.js`:

```js
// Recipe name helpers for both pages. They never touch the DOM, so tests
// import this module directly in Node.js.

/**
 * Decides matching and order. It ignores case and accents, so "Café" and
 * "cafe" share a key. The server has the same rule in server/recipes.js.
 */
export function nameKey(name) {
  return name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** A new array of `recipes`, sorted from A to Z by name key. */
export function sortRecipes(recipes) {
  return [...recipes].sort((a, b) => {
    const keyA = nameKey(a.name);
    const keyB = nameKey(b.name);
    if (keyA < keyB) return -1;
    return keyA > keyB ? 1 : 0;
  });
}

/** The recipes whose name contains `query`, ignoring case, accents, and extra spaces. */
export function filterRecipes(recipes, query) {
  const key = nameKey(query.trim().replace(/\s+/g, " "));
  return recipes.filter((recipe) => nameKey(recipe.name).includes(key));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/recipe-search.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing tests for menus**

Create `test/menus.test.js`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addableRecipes,
  addItem,
  copyMenu,
  describeItem,
  emptyMenu,
  hasRecipe,
  MAX_ITEMS,
  MAX_SERVINGS,
  MIN_SERVINGS,
  removeItem,
  sameMenu,
  stepServings,
} from "../public/menus.js";

function menu(...entries) {
  return { items: entries.map(([recipeId, servings]) => ({ recipeId, servings })) };
}

test("the limits match the API", () => {
  assert.equal(MAX_ITEMS, 20);
  assert.equal(MIN_SERVINGS, 0.5);
  assert.equal(MAX_SERVINGS, 99);
});

test("emptyMenu has no menu items", () => {
  assert.deepEqual(emptyMenu(), { items: [] });
});

test("copyMenu returns a copy that shares nothing with the original", () => {
  const original = menu(["soup", 1]);
  const copy = copyMenu(original);

  copy.items[0].servings = 2;
  copy.items.push({ recipeId: "bread", servings: 1 });

  assert.deepEqual(original, menu(["soup", 1]));
});

test("sameMenu compares recipes, servings, and order", () => {
  assert.equal(sameMenu(menu(["soup", 1]), menu(["soup", 1])), true);
  assert.equal(sameMenu(emptyMenu(), emptyMenu()), true);
  assert.equal(sameMenu(menu(["soup", 1]), menu(["soup", 1.5])), false);
  assert.equal(sameMenu(menu(["soup", 1], ["bread", 1]), menu(["bread", 1], ["soup", 1])), false);
  assert.equal(sameMenu(menu(["soup", 1]), menu(["soup", 1], ["bread", 1])), false);
});

test("hasRecipe tells whether a recipe is in the menu", () => {
  assert.equal(hasRecipe(menu(["soup", 1]), "soup"), true);
  assert.equal(hasRecipe(menu(["soup", 1]), "bread"), false);
});

test("addItem appends the recipe at 1 serving without changing the original", () => {
  const original = menu(["soup", 2]);

  const result = addItem(original, "bread");

  assert.deepEqual(result, menu(["soup", 2], ["bread", 1]));
  assert.deepEqual(original, menu(["soup", 2]));
});

test("addItem ignores a recipe that is already in the menu", () => {
  const original = menu(["soup", 2]);
  assert.equal(addItem(original, "soup"), original);
});

test("addItem ignores a full menu", () => {
  const full = menu(...Array.from({ length: 20 }, (_, index) => [`r${index}`, 1]));
  assert.equal(addItem(full, "one-more"), full);
});

test("removeItem removes the recipe and keeps the order of the others", () => {
  const original = menu(["soup", 1], ["bread", 2], ["fruit", 1]);

  assert.deepEqual(removeItem(original, "bread"), menu(["soup", 1], ["fruit", 1]));
  assert.deepEqual(original, menu(["soup", 1], ["bread", 2], ["fruit", 1]));
});

test("stepServings moves one recipe by steps of 0.5", () => {
  const original = menu(["soup", 1], ["bread", 1]);

  assert.deepEqual(stepServings(original, "soup", 1), menu(["soup", 1.5], ["bread", 1]));
  assert.deepEqual(stepServings(original, "soup", -1), menu(["soup", 0.5], ["bread", 1]));
  assert.deepEqual(original, menu(["soup", 1], ["bread", 1]));
});

test("stepServings stays within 0.5 and 99", () => {
  assert.deepEqual(stepServings(menu(["soup", 0.5]), "soup", -1), menu(["soup", 0.5]));
  assert.deepEqual(stepServings(menu(["soup", 99]), "soup", 1), menu(["soup", 99]));
});

test("addableRecipes offers active recipes that aren't in the menu, matching the query, A to Z", () => {
  const recipes = [
    { id: "russian", name: "Russian salad", archived: false },
    { id: "green", name: "Green salad", archived: false },
    { id: "old", name: "Old salad", archived: true },
    { id: "soup", name: "Soup", archived: false },
    { id: "fruit", name: "Fruit salad", archived: false },
  ];
  const current = menu(["fruit", 1]);

  assert.deepEqual(
    addableRecipes(recipes, current, "SALAD").map((recipe) => recipe.id),
    ["green", "russian"],
  );
  assert.deepEqual(
    addableRecipes(recipes, current, "").map((recipe) => recipe.id),
    ["green", "russian", "soup"],
  );
});

test("describeItem shows the name and the servings", () => {
  assert.equal(describeItem("Gnocchi carbonara", 1.5), "Gnocchi carbonara × 1.5");
  assert.equal(describeItem("Soup", 2), "Soup × 2");
});
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `node --test test/menus.test.js`
Expected: FAIL with `Cannot find module '.../public/menus.js'`.

- [ ] **Step 7: Write the menu helpers**

Create `public/menus.js`:

```js
// Menus: the content of a slot, as { items: [{ recipeId, servings }] }. These
// functions never change the menus they get: they return new ones, or the
// same menu when nothing changes. They never touch the DOM, so tests import
// this module directly in Node.js.

import { filterRecipes, sortRecipes } from "./recipe-search.js";

// The same limits the API enforces.
export const MAX_ITEMS = 20;
export const MIN_SERVINGS = 0.5;
export const MAX_SERVINGS = 99;
const SERVINGS_STEP = 0.5;

export function emptyMenu() {
  return { items: [] };
}

/** A copy that shares nothing with `menu`, so changing one never changes the other. */
export function copyMenu(menu) {
  return { items: menu.items.map((item) => ({ ...item })) };
}

/** True when both menus have the same recipes, servings, and order. */
export function sameMenu(a, b) {
  return (
    a.items.length === b.items.length &&
    a.items.every(
      (item, index) =>
        item.recipeId === b.items[index].recipeId && item.servings === b.items[index].servings,
    )
  );
}

export function hasRecipe(menu, recipeId) {
  return menu.items.some((item) => item.recipeId === recipeId);
}

/** Appends `recipeId` at 1 serving, unless it's already in the menu or the menu is full. */
export function addItem(menu, recipeId) {
  if (hasRecipe(menu, recipeId) || menu.items.length >= MAX_ITEMS) return menu;
  return { items: [...menu.items, { recipeId, servings: 1 }] };
}

export function removeItem(menu, recipeId) {
  return { items: menu.items.filter((item) => item.recipeId !== recipeId) };
}

/** Moves the servings of `recipeId` by `steps` steps of 0.5, within the limits. */
export function stepServings(menu, recipeId, steps) {
  return {
    items: menu.items.map((item) => {
      if (item.recipeId !== recipeId) return item;
      const servings = item.servings + steps * SERVINGS_STEP;
      return { ...item, servings: Math.min(MAX_SERVINGS, Math.max(MIN_SERVINGS, servings)) };
    }),
  };
}

/** The recipes the slot editor offers: active, not in `menu`, matching `query`, A to Z. */
export function addableRecipes(recipes, menu, query) {
  const offered = recipes.filter((recipe) => !recipe.archived && !hasRecipe(menu, recipe.id));
  return sortRecipes(filterRecipes(offered, query));
}

/** For example, "Gnocchi carbonara × 1.5". */
export function describeItem(name, servings) {
  return `${name} × ${servings}`;
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node --test test/menus.test.js`
Expected: PASS, 13 tests.

- [ ] **Step 9: Write the failing tests for HTTP**

Create `test/http.test.js`:

```js
import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { getJson, REQUEST_TIMEOUT_MS, sendJson } from "../public/http.js";

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  mock.restoreAll();
});

test("requests give up after 5 seconds", () => {
  assert.equal(REQUEST_TIMEOUT_MS, 5000);
});

test("getJson returns the parsed body and passes a timeout signal", async () => {
  const fetch = mock.method(globalThis, "fetch", async () => jsonResponse(200, { recipes: [] }));

  assert.deepEqual(await getJson("/api/recipes"), { recipes: [] });
  const [url, options] = fetch.mock.calls[0].arguments;
  assert.equal(url, "/api/recipes");
  assert.ok(options.signal instanceof AbortSignal);
});

test("getJson rejects on a status other than 2xx", async () => {
  mock.method(globalThis, "fetch", async () => jsonResponse(500, { error: "Internal" }));
  await assert.rejects(getJson("/api/recipes"), /HTTP 500/);
});

test("sendJson sends the body as JSON and returns the status and body, whatever the status", async () => {
  const fetch = mock.method(globalThis, "fetch", async () =>
    jsonResponse(409, { error: "Taken", recipe: { id: "1" } }),
  );

  const result = await sendJson("POST", "/api/recipes", { name: "Soup" });

  assert.deepEqual(result, { status: 409, body: { error: "Taken", recipe: { id: "1" } } });
  const [url, options] = fetch.mock.calls[0].arguments;
  assert.equal(url, "/api/recipes");
  assert.equal(options.method, "POST");
  assert.equal(options.headers["Content-Type"], "application/json");
  assert.equal(options.body, '{"name":"Soup"}');
  assert.ok(options.signal instanceof AbortSignal);
});

test("sendJson returns an empty body when the response isn't JSON", async () => {
  mock.method(globalThis, "fetch", async () => new Response("Bad gateway", { status: 502 }));
  assert.deepEqual(await sendJson("PATCH", "/api/recipes/1", { archived: true }), {
    status: 502,
    body: {},
  });
});

test("sendJson rejects on a network error", async () => {
  mock.method(globalThis, "fetch", async () => {
    throw new TypeError("Network error");
  });
  await assert.rejects(sendJson("POST", "/api/recipes", { name: "Soup" }), TypeError);
});
```

- [ ] **Step 10: Run the tests to verify they fail**

Run: `node --test test/http.test.js`
Expected: FAIL with `Cannot find module '.../public/http.js'`.

- [ ] **Step 11: Write the HTTP helpers**

Create `public/http.js`:

```js
// HTTP helpers for the pages. Every request gives up after REQUEST_TIMEOUT_MS,
// so the pages show an error instead of waiting forever.

export const REQUEST_TIMEOUT_MS = 5000;

/** The parsed body of GET `url`. Rejects on a network error, a timeout, or a status other than 2xx. */
export async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/**
 * Sends `body` as JSON. Resolves with the status and the parsed body, whatever
 * the status, so callers can read a 409's body. Rejects on a network error or
 * a timeout.
 */
export async function sendJson(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}
```

- [ ] **Step 12: Run the tests to verify they pass**

Run: `node --test test/http.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 13: Check and commit**

Run: `npm run format && npm run lint && npm test`
Expected: all pass.

```bash
git add public/http.js public/menus.js public/recipe-search.js test/http.test.js test/menus.test.js test/recipe-search.test.js
git commit -m "feat(ui): add menu, recipe name, and HTTP helpers"
```

---

### Task 7: Save menus instead of text

**Files:**

- Modify: `public/saves.js` (whole file)
- Test: `test/saves.test.js` (whole file)

**Interfaces:**

- Consumes: `copyMenu` and `sameMenu` from `public/menus.js` (Task 6).
- Produces: `createSaves({ fetch, url, readMenu, onStatus, timeoutMs })`
  with the same methods as before, `{ discard, flush, loaded, queueSave,
  settle, unsaved }`, where every text becomes a menu:
  - `readMenu(key): Menu | undefined`: `undefined` when the slot isn't
    loaded.
  - `loaded(entries: [key, Menu][])`.
  - `discard(key): Menu`: a copy of the menu the server has.
  - The PUT body is `{ "items": [...] }`.
  - The module keeps its own copies of menus, so callers may reuse or change
    the objects they pass.

`public/app.js` still calls the old `readText` until Task 8, so the meal plan
page stays broken until then. The Node.js tests don't load `app.js`.

- [ ] **Step 1: Write the failing tests**

Replace `test/saves.test.js` with:

```js
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { sameMenu } from "../public/menus.js";
import { createSaves } from "../public/saves.js";

function menu(...recipeIds) {
  return { items: recipeIds.map((recipeId) => ({ recipeId, servings: 1 })) };
}

const EMPTY = menu();
const SOUP = menu("soup");
const SOUP_AND_BREAD = menu("soup", "bread");
const SOUP_BREAD_AND_FRUIT = menu("soup", "bread", "fruit");
const RICE = menu("rice");
const FISH = menu("fish");

// A fake server: each PUT waits until the test answers it.
function fakeServer() {
  const requests = [];
  function fetch(url, options) {
    return new Promise((resolve, reject) => {
      requests.push({
        url,
        method: options.method,
        body: JSON.parse(options.body),
        keepalive: options.keepalive === true,
        ok: () => resolve({ ok: true, status: 200 }),
        fail: () => reject(new TypeError("Network error")),
      });
      options.signal?.addEventListener("abort", () => reject(options.signal.reason));
    });
  }
  // The request that carries `expected`.
  function requestWith(expected) {
    return requests.find((request) => sameMenu(request.body, expected));
  }
  return { fetch, requests, requestWith };
}

// Lets pending promise callbacks run.
function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Waits with a timer that keeps Node.js running: AbortSignal.timeout doesn't.
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setup({ timeoutMs = 1000 } = {}) {
  const server = fakeServer();
  const menus = new Map(); // what each slot shows
  const statuses = new Map(); // the last status reported per slot
  const saves = createSaves({
    fetch: server.fetch,
    url: (key) => `/api/${key}`,
    readMenu: (key) => menus.get(key),
    onStatus: (key, state) => statuses.set(key, state),
    timeoutMs,
  });
  saves.loaded([[KEY, EMPTY]]);
  menus.set(KEY, EMPTY);
  return { saves, server, menus, statuses };
}

const KEY = "mon/lunch";

beforeEach(() => {
  mock.method(console, "error", () => {}); // failed saves log on purpose
});

afterEach(() => {
  mock.restoreAll();
});

test("loaded marks every slot as idle", () => {
  const { statuses } = setup();
  assert.equal(statuses.get(KEY), "idle");
});

test("queueSave sends the current menu and marks the slot as saved", async () => {
  const { saves, server, menus, statuses } = setup();
  menus.set(KEY, SOUP);

  const done = saves.queueSave(KEY);
  await tick();
  assert.equal(statuses.get(KEY), "saving");
  assert.equal(server.requests.length, 1);
  assert.equal(server.requests[0].url, "/api/mon/lunch");
  assert.equal(server.requests[0].method, "PUT");
  assert.deepEqual(server.requests[0].body, SOUP);

  server.requests[0].ok();
  await done;
  assert.equal(statuses.get(KEY), "saved");
});

test("the PUT body holds exactly the menu items", async () => {
  const { saves, server, menus } = setup();
  menus.set(KEY, { items: [{ recipeId: "soup", servings: 1.5 }] });

  saves.queueSave(KEY);
  await tick();

  assert.deepEqual(server.requests[0].body, { items: [{ recipeId: "soup", servings: 1.5 }] });
});

test("queueSave sends nothing when the menu is unchanged", async () => {
  const { saves, server } = setup();
  await saves.queueSave(KEY);
  assert.equal(server.requests.length, 0);
});

test("an equal menu in a new object counts as unchanged", async () => {
  const { saves, server, menus } = setup();
  menus.set(KEY, menu());
  await saves.queueSave(KEY);
  assert.equal(server.requests.length, 0);
});

test("queueSave does nothing for a slot that isn't loaded", async () => {
  const { saves, server } = setup();
  await saves.queueSave("wed/lunch");
  assert.equal(server.requests.length, 0);
});

test("changing a menu object after its save doesn't change what counts as saved", async () => {
  const { saves, server, menus } = setup();
  const shown = menu("soup");
  menus.set(KEY, shown);
  const first = saves.queueSave(KEY);
  await tick();
  server.requests[0].ok();
  await first;

  shown.items.push({ recipeId: "bread", servings: 1 }); // the caller reuses the object
  saves.queueSave(KEY);
  await tick();

  assert.equal(server.requests.length, 2);
  assert.deepEqual(server.requests[1].body, SOUP_AND_BREAD);
});

test("a failed save marks the slot as an error, and a retry saves it", async () => {
  const { saves, server, menus, statuses } = setup();
  menus.set(KEY, SOUP);

  const first = saves.queueSave(KEY);
  await tick();
  server.requests[0].fail();
  await first;
  assert.equal(statuses.get(KEY), "error");

  const retry = saves.queueSave(KEY);
  await tick();
  assert.equal(server.requests.length, 2);
  server.requests[1].ok();
  await retry;
  assert.equal(statuses.get(KEY), "saved");
});

test("a save gives up after the timeout", async () => {
  const { saves, menus, statuses } = setup({ timeoutMs: 20 });
  menus.set(KEY, SOUP);
  const done = saves.queueSave(KEY); // the fake server never answers
  await sleep(50);
  await done;
  assert.equal(statuses.get(KEY), "error");
});

test("a retry with the menu the server already has clears the error", async () => {
  const { saves, server, menus, statuses } = setup();
  menus.set(KEY, SOUP);
  const first = saves.queueSave(KEY);
  await tick();
  server.requests[0].fail();
  await first;

  menus.set(KEY, EMPTY); // back to the saved menu
  await saves.queueSave(KEY);
  assert.equal(server.requests.length, 1);
  assert.equal(statuses.get(KEY), "idle");
});

test("saves of one slot run in order: a newer save waits for the older one", async () => {
  const { saves, server, menus } = setup();
  menus.set(KEY, SOUP);
  saves.queueSave(KEY);
  await tick();
  menus.set(KEY, SOUP_AND_BREAD);
  const second = saves.queueSave(KEY);
  await tick();
  assert.equal(server.requests.length, 1, "the second save waits");

  server.requests[0].ok();
  await tick();
  assert.equal(server.requests.length, 2);
  assert.deepEqual(server.requests[1].body, SOUP_AND_BREAD);
  server.requests[1].ok();
  await second;
});

test("flush sends each changed slot with keepalive and skips unchanged slots", async () => {
  const { saves, server, menus } = setup();
  saves.loaded([["tue/lunch", RICE]]);
  menus.set("tue/lunch", RICE);
  menus.set(KEY, SOUP);

  saves.flush([KEY, "tue/lunch"], { skipInFlight: false });
  await tick();
  assert.equal(server.requests.length, 1);
  assert.deepEqual(server.requests[0].body, SOUP);
  assert.equal(server.requests[0].keepalive, true);
});

test("flush skips slots that were never loaded", async () => {
  const { saves, server, menus } = setup();
  menus.set("wed/lunch", FISH);
  saves.flush(["wed/lunch"], { skipInFlight: false });
  await tick();
  assert.equal(server.requests.length, 0);
});

test("a second flush and a later queueSave don't resend the flushed menu", async () => {
  const { saves, server, menus } = setup();
  menus.set(KEY, SOUP);
  saves.flush([KEY], { skipInFlight: true });
  saves.flush([KEY], { skipInFlight: false });
  await saves.queueSave(KEY);
  assert.equal(server.requests.length, 1);
});

test("flush with skipInFlight skips a slot whose queued save carries the same menu", async () => {
  const { saves, server, menus } = setup();
  menus.set(KEY, SOUP);
  saves.queueSave(KEY);
  await tick();
  saves.flush([KEY], { skipInFlight: true });
  await tick();
  assert.equal(server.requests.length, 1);
  assert.equal(server.requests[0].keepalive, false);
});

test("flush without skipInFlight resends a menu whose queued save is in flight", async () => {
  const { saves, server, menus } = setup();
  menus.set(KEY, SOUP);
  saves.queueSave(KEY);
  await tick();
  saves.flush([KEY], { skipInFlight: false }); // pagehide may cancel the queued save
  await tick();
  assert.equal(server.requests.length, 2);
  assert.deepEqual(server.requests[1].body, SOUP);
  assert.equal(server.requests[1].keepalive, true);
});

test("after a failed flush, the next queueSave retries the menu", async () => {
  const { saves, server, menus } = setup();
  menus.set(KEY, SOUP);
  saves.flush([KEY], { skipInFlight: false });
  await tick();
  server.requests[0].fail();
  await tick();

  saves.queueSave(KEY);
  await tick();
  assert.equal(server.requests.length, 2);
  assert.deepEqual(server.requests[1].body, SOUP);
});

test("a successful flush clears an earlier error of the slot", async () => {
  const { saves, server, menus, statuses } = setup();
  menus.set(KEY, SOUP);
  const first = saves.queueSave(KEY);
  await tick();
  server.requests[0].fail();
  await first;

  saves.flush([KEY], { skipInFlight: false });
  await tick();
  server.requests[1].ok();
  await tick();
  assert.equal(statuses.get(KEY), "idle");
});

// A week change waits for every pending save, then asks about unsaved slots.

test("settle waits for queued saves and page-hide saves", async () => {
  const { saves, server, menus } = setup();
  saves.loaded([["tue/lunch", EMPTY]]);
  menus.set(KEY, SOUP);
  menus.set("tue/lunch", RICE);
  saves.queueSave(KEY);
  saves.flush(["tue/lunch"], { skipInFlight: false });
  let settled = false;
  const done = saves.settle().then(() => {
    settled = true;
  });
  await tick();

  server.requestWith(SOUP).ok();
  await tick();
  assert.equal(settled, false, "the page-hide save is still pending");
  server.requestWith(RICE).ok();
  await done;
});

test("settle also waits for page-hide saves that start while it waits", async () => {
  const { saves, server, menus, statuses } = setup();
  saves.loaded([["tue/lunch", EMPTY]]);
  menus.set(KEY, SOUP);
  saves.queueSave(KEY);
  let settled = false;
  const done = saves.settle().then(() => {
    settled = true;
  });
  await tick();

  menus.set("tue/lunch", RICE);
  saves.flush([KEY, "tue/lunch"], { skipInFlight: true }); // the page is hidden during the wait
  server.requestWith(SOUP).ok();
  await tick();
  assert.equal(settled, false, "the page-hide save that started during the wait is pending");

  server.requestWith(RICE).fail();
  await done;
  assert.equal(statuses.get("tue/lunch"), "error");
  assert.deepEqual(saves.unsaved([KEY, "tue/lunch"]), ["tue/lunch"]);
});

test("a failed page-hide save marks the slot as an error and leaves it unsaved", async () => {
  const { saves, server, menus, statuses } = setup();
  menus.set(KEY, SOUP);
  saves.flush([KEY], { skipInFlight: false });
  server.requests[0].fail();
  await saves.settle();
  assert.equal(statuses.get(KEY), "error");
  assert.deepEqual(saves.unsaved([KEY]), [KEY]);
});

test("a page-hide save gives up after the timeout", async () => {
  const { saves, menus, statuses } = setup({ timeoutMs: 20 });
  menus.set(KEY, SOUP);
  saves.flush([KEY], { skipInFlight: false }); // the fake server never answers
  await sleep(50);
  await saves.settle();
  assert.equal(statuses.get(KEY), "error");
});

test("a failed page-hide save doesn't mark the slot when a newer save replaced its menu", async () => {
  const { saves, server, menus, statuses } = setup();
  menus.set(KEY, SOUP);
  saves.flush([KEY], { skipInFlight: false });
  menus.set(KEY, SOUP_AND_BREAD);
  const newer = saves.queueSave(KEY);
  await tick();
  server.requests[1].ok();
  await newer;

  server.requests[0].fail();
  await saves.settle();
  assert.equal(statuses.get(KEY), "saved");
  assert.deepEqual(saves.unsaved([KEY]), []);
});

test("a failed page-hide save doesn't mark the slot while a newer save runs", async () => {
  const { saves, server, menus, statuses } = setup();
  menus.set(KEY, SOUP);
  saves.flush([KEY], { skipInFlight: false });
  menus.set(KEY, SOUP_AND_BREAD);
  const newer = saves.queueSave(KEY);
  await tick();

  server.requests[0].fail();
  await tick();
  assert.equal(statuses.get(KEY), "saving");
  server.requests[1].ok();
  await newer;
  assert.equal(statuses.get(KEY), "saved");
});

test("unsaved lists loaded slots whose menu differs from the saved menu", () => {
  const { saves, menus } = setup();
  saves.loaded([["tue/lunch", RICE]]);
  menus.set("tue/lunch", RICE);
  menus.set(KEY, SOUP);
  menus.set("wed/lunch", FISH); // never loaded
  assert.deepEqual(saves.unsaved([KEY, "tue/lunch", "wed/lunch"]), [KEY]);
});

test("discard returns the saved menu and clears the error, so no later save sends the discarded menu", async () => {
  const { saves, server, menus, statuses } = setup();
  menus.set(KEY, SOUP);
  const failed = saves.queueSave(KEY);
  await tick();
  server.requests[0].fail();
  await failed;

  menus.set(KEY, saves.discard(KEY));
  assert.deepEqual(menus.get(KEY), EMPTY);
  assert.equal(statuses.get(KEY), "idle");

  await saves.queueSave(KEY); // for example, a later Done without changes
  saves.flush([KEY], { skipInFlight: false });
  await tick();
  assert.equal(server.requests.length, 1);
});

test("a late successful page-hide save keeps the error of a newer menu that failed", async () => {
  const { saves, server, menus, statuses } = setup();
  menus.set(KEY, SOUP);
  saves.flush([KEY], { skipInFlight: false }); // the page is hidden; this save is slow
  menus.set(KEY, SOUP_AND_BREAD);
  const newer = saves.queueSave(KEY);
  await tick();
  server.requests[1].fail();
  await newer;
  assert.equal(statuses.get(KEY), "error");

  server.requests[0].ok();
  await saves.settle();
  assert.equal(statuses.get(KEY), "error", "the slot still has an unsaved menu");
});

test("when two page-hide saves of a slot fail, a later save sends the menu again", async () => {
  const { saves, server, menus } = setup();
  menus.set(KEY, SOUP);
  saves.flush([KEY], { skipInFlight: false });
  menus.set(KEY, SOUP_AND_BREAD);
  saves.flush([KEY], { skipInFlight: false });
  server.requests[0].fail();
  server.requests[1].fail();
  await saves.settle();

  menus.set(KEY, SOUP); // the server never received it
  saves.queueSave(KEY);
  await tick();
  assert.equal(server.requests.length, 3);
  assert.deepEqual(server.requests[2].body, SOUP);
});

test("when two page-hide saves of a slot fail, discard returns the menu the server has", async () => {
  const { saves, server, menus } = setup();
  menus.set(KEY, SOUP);
  saves.flush([KEY], { skipInFlight: false });
  menus.set(KEY, SOUP_AND_BREAD);
  saves.flush([KEY], { skipInFlight: false });
  server.requests[0].fail();
  server.requests[1].fail();
  await saves.settle();

  assert.deepEqual(saves.discard(KEY), EMPTY);
});

test("a page-hide save confirmed after a newer save doesn't replace the newer menu", async () => {
  const { saves, server, menus } = setup();
  menus.set(KEY, SOUP);
  saves.flush([KEY], { skipInFlight: false }); // sent first, answered last
  menus.set(KEY, SOUP_AND_BREAD);
  const newer = saves.queueSave(KEY);
  await tick();
  server.requests[1].ok();
  await newer;
  server.requests[0].ok();
  await saves.settle();

  menus.set(KEY, SOUP_BREAD_AND_FRUIT);
  const failed = saves.queueSave(KEY);
  await tick();
  server.requests[2].fail();
  await failed;
  assert.deepEqual(saves.discard(KEY), SOUP_AND_BREAD);
});

test("after a successful page-hide save, discard returns its menu", async () => {
  const { saves, server, menus } = setup();
  menus.set(KEY, SOUP);
  saves.flush([KEY], { skipInFlight: false });
  server.requests[0].ok();
  await saves.settle();

  menus.set(KEY, SOUP_AND_BREAD);
  const failed = saves.queueSave(KEY);
  await tick();
  server.requests[1].fail();
  await failed;
  assert.deepEqual(saves.discard(KEY), SOUP);
});

test("when an older page-hide save succeeds after a newer one failed, discard returns the older menu", async () => {
  const { saves, server, menus } = setup();
  menus.set(KEY, SOUP);
  saves.flush([KEY], { skipInFlight: false });
  menus.set(KEY, SOUP_AND_BREAD);
  saves.flush([KEY], { skipInFlight: false });
  server.requests[1].fail();
  await tick();
  server.requests[0].ok();
  await saves.settle();

  menus.set(KEY, saves.discard(KEY));
  assert.deepEqual(menus.get(KEY), SOUP);
  await saves.queueSave(KEY); // the server has this menu, so nothing to send
  assert.equal(server.requests.length, 2);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/saves.test.js`
Expected: FAIL. `createSaves` still calls `readText`, which the tests don't
pass, so most tests fail with `TypeError: readText is not a function`.

- [ ] **Step 3: Rewrite the save logic for menus**

Replace `public/saves.js` with:

```js
// Save logic for the grid: the last saved menu, pending saves, and the status
// of each slot. It never touches the DOM, so tests import this module directly
// in Node.js. app.js connects it to the page.

import { copyMenu, sameMenu } from "./menus.js";

// Like sameMenu, but a missing menu (a slot that isn't loaded) matches nothing.
function same(a, b) {
  return a !== undefined && b !== undefined && sameMenu(a, b);
}

/**
 * Creates the save state. A key identifies a slot, for example
 * "2026-09-21/mon/lunch".
 *
 * - `fetch`: sends the requests.
 * - `url(key)`: the URL to PUT a slot's menu to.
 * - `readMenu(key)`: the slot's current menu, or undefined when the slot
 *   isn't loaded. Saves read it when they run.
 * - `onStatus(key, state)`: called when a slot's status changes to "idle",
 *   "saving", "saved", or "error".
 * - `timeoutMs`: how long a save waits for the server before it gives up.
 *
 * Menus are compared by content, and this module keeps its own copies, so
 * callers may reuse or change the objects they pass.
 */
export function createSaves({ fetch, url, readMenu, onStatus, timeoutMs }) {
  /** Last menu saved, per slot, including page-hide saves still pending. */
  const lastSaved = new Map();
  /** Last menu the server confirmed, per slot. Differs from lastSaved only while a page-hide save is pending. */
  const confirmedMenu = new Map();
  /** Sequence number of the request behind confirmedMenu, per slot. */
  const confirmedSequence = new Map();
  /** Sequence number of the last PUT sent, for any slot. */
  let lastSequence = 0;
  /** Per-slot promise chain so saves of one slot run strictly in order. */
  const saveChains = new Map();
  /** Menu currently being PUT by the per-slot chain (cleared when that PUT settles). */
  const inFlight = new Map();
  /** Current status, per slot. */
  const statuses = new Map();
  /** Page-hide save promises still in flight (never reject; removed when settled). */
  const pageHideSaves = new Set();

  function setStatus(key, state) {
    statuses.set(key, state);
    onStatus(key, state);
  }

  // Records `menu` as confirmed unless the server already confirmed a newer
  // request of the slot: responses can arrive in another order than requests.
  function markConfirmed(key, menu, sequence) {
    if (sequence < confirmedSequence.get(key)) return;
    confirmedSequence.set(key, sequence);
    confirmedMenu.set(key, menu);
  }

  function put(key, menu, options) {
    return fetch(url(key), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: menu.items }),
      ...options,
    });
  }

  /** Records the menu the server returned for each slot, as [key, menu] pairs. */
  function loaded(entries) {
    for (const [key, menu] of entries) {
      const copy = copyMenu(menu);
      lastSaved.set(key, copy);
      markConfirmed(key, copy, lastSequence);
      setStatus(key, "idle");
    }
  }

  // Never rejects. Always saves the slot's CURRENT menu.
  async function saveIfChanged(key) {
    const current = readMenu(key);
    if (current === undefined) return; // not loaded: nothing to save

    if (same(current, lastSaved.get(key))) {
      // Nothing to send. If a previous attempt failed, the server already has this menu.
      if (statuses.get(key) === "error") setStatus(key, "idle");
      return;
    }

    const menu = copyMenu(current);
    setStatus(key, "saving");
    inFlight.set(key, menu);
    const sequence = ++lastSequence;
    try {
      const response = await put(key, menu, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      lastSaved.set(key, menu);
      markConfirmed(key, menu, sequence);
      setStatus(key, "saved");
    } catch (error) {
      console.error(`Couldn't save ${key}:`, error);
      setStatus(key, "error"); // the slot keeps its menu
    } finally {
      inFlight.delete(key);
    }
  }

  /** Chains saves per slot: an older PUT can never finish after a newer one. */
  function queueSave(key) {
    const previous = saveChains.get(key) ?? Promise.resolve();
    const next = previous.then(() => saveIfChanged(key));
    saveChains.set(key, next);
    return next;
  }

  // Last-chance save when the page is hidden or unloaded (reload, close, app
  // switch). Uses keepalive so the PUT survives unload, with the same timeout
  // as any other save; bypasses the per-slot chain (last write wins). Each
  // save is tracked in pageHideSaves so that settle can wait for it.
  // lastSaved is updated optimistically BEFORE the fetch so a second call
  // (visibilitychange + pagehide) or a later queueSave doesn't resend; it is
  // restored to the confirmed menu on failure so the next save retries.
  function flush(keys, { skipInFlight }) {
    for (const key of keys) {
      const current = readMenu(key);
      const previous = lastSaved.get(key);
      if (current === undefined || previous === undefined) continue; // not loaded
      if (sameMenu(current, previous)) continue; // unchanged
      // The page survives a visibilitychange, so a normal PUT already carrying
      // this menu will complete; on pagehide it may be cancelled, so resend.
      if (skipInFlight && same(inFlight.get(key), current)) continue;

      const menu = copyMenu(current);
      lastSaved.set(key, menu);
      // Returns true if it restored, that is, if no newer save replaced the menu.
      // It restores the confirmed menu, not `previous`: `previous` may be the
      // menu of an earlier page-hide save that fails too.
      const restore = () => {
        if (!same(lastSaved.get(key), menu)) return false;
        lastSaved.set(key, confirmedMenu.get(key));
        return true;
      };
      const sequence = ++lastSequence;
      const save = put(key, menu, { keepalive: true, signal: AbortSignal.timeout(timeoutMs) })
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          markConfirmed(key, menu, sequence);
          // Server now has the menu; clear a stale error badge, unless the slot
          // holds a newer menu that failed to save since.
          if (statuses.get(key) === "error" && same(readMenu(key), menu)) setStatus(key, "idle");
        })
        .catch((error) => {
          console.error(`Couldn't save ${key} on page hide:`, error);
          // Show the error so the menu can be retried, but only if the menu is
          // still unsaved and no newer save is running.
          if (restore() && statuses.get(key) !== "saving") setStatus(key, "error");
        })
        .finally(() => pageHideSaves.delete(save));
      pageHideSaves.add(save);
    }
  }

  /** Waits for every pending save, including page-hide saves that start meanwhile. */
  async function settle() {
    // Each page-hide save removes itself when it settles, so this ends.
    do {
      await Promise.all([...saveChains.values(), ...pageHideSaves]);
    } while (pageHideSaves.size > 0);
  }

  /** The loaded slots, among `keys`, whose menu differs from the saved menu. */
  function unsaved(keys) {
    return keys.filter((key) => {
      const saved = lastSaved.get(key);
      const current = readMenu(key);
      return saved !== undefined && current !== undefined && !sameMenu(current, saved);
    });
  }

  /**
   * Gives up the unsaved menu of a slot: returns a copy of the menu the server
   * has, to show instead, and clears the slot's status. No later save sends
   * the discarded menu once the slot shows the returned menu.
   */
  function discard(key) {
    lastSaved.set(key, confirmedMenu.get(key));
    setStatus(key, "idle");
    return copyMenu(confirmedMenu.get(key));
  }

  return { discard, flush, loaded, queueSave, settle, unsaved };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/saves.test.js`
Expected: PASS, 32 tests.

- [ ] **Step 5: Check and commit**

Run: `npm run format && npm run lint && npm test`
Expected: all pass.

```bash
git add public/saves.js test/saves.test.js
git commit -m "feat(ui): save menus instead of text"
```

---

### Task 8: Show menus in the grid

**Files:**

- Create: `public/dom.js`
- Modify: `public/app.js` (whole file)
- Modify: `public/index.html` (header)
- Modify: `public/styles.css` (header, slots, and the renamed `.cell` rules)
- Modify: `README.md` (intro, use the app, and project structure)

**Interfaces:**

- Consumes: `getJson` and `REQUEST_TIMEOUT_MS` from `public/http.js`, and
  `describeItem` from `public/menus.js` (Task 6). `createSaves` with
  `readMenu` (Task 7). `addDays`, `addWeeks`, `dayIndex`, `formatLongDate`,
  `formatWeekRange`, `isWeekId`, `weekIdOf`, and `weekStart` from
  `public/dates.js`.
- Produces:
  - `public/dom.js`: `createElement(tag, className?, text?)`.
  - In `public/app.js`, for Task 9: `menus` (a `Map` from slot key to
    menu), `recipesById` (a `Map` from recipe ID to recipe), `slotKey`,
    `renderSlot(slot, menu)`, `saves`, `grid`, `DAYS`, `MEALS`,
    `syncHash()`, and `goToWeek()`. Each slot is a `.slot` element with
    `data-day` and `data-meal`, holding a `.slot-label`, a `.slot-menu`
    button, and a `.status` button.

Only a browser can check the DOM code in this task. Step 6 checks it by hand,
and Task 11 adds it to `docs/manual-test-plan.md`.

- [ ] **Step 1: Add the DOM helper**

Create `public/dom.js`:

```js
// DOM helpers shared by the pages.

/**
 * A new element with an optional class and text. The text is set with
 * textContent, so recipe names never run as HTML.
 */
export function createElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
```

- [ ] **Step 2: Add the Recipes link to the page**

In `public/index.html`, replace `<h1>Weekly meal plan</h1>` with:

```html
      <div class="title-bar">
        <h1>Weekly meal plan</h1>
        <a class="page-link" href="/recipes.html">Recipes</a>
      </div>
```

- [ ] **Step 3: Style the header and the slots**

In `public/styles.css`:

After the `.page-header h1` rule, add:

```css
.title-bar {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
}

.page-link {
  color: #2e7d32;
  font-weight: 600;
}
```

Replace the `.cell` and `.cell textarea` rules with:

```css
.slot {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

/* The slot's menu: a button that opens the slot editor. */
.slot-menu {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  width: 100%;
  min-height: 5rem;
  padding: 0.4rem;
  border: 1px solid #ccc;
  border-radius: 0.3rem;
  background: #fff;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  /* A long name without spaces wraps instead of widening the grid. */
  overflow-wrap: anywhere;
}

.slot-menu:hover {
  border-color: #999;
}

.slot-empty {
  color: #888;
}
```

In the comment above `.status`, replace `Per-cell save status.` with
`Per-slot save status.`

In the desktop block (`@media (min-width: 768px)`):

- Replace the selector list `.day-bar,\n  .cell-label` with
  `.day-bar,\n  .slot-label`.
- Replace the selector `.cell {` with `.slot {`.
- Replace the selector `.cell[data-today] {` with `.slot[data-today] {`.

In the mobile block (`@media (max-width: 767.98px)`):

- Replace the selector `.cell {` with `.slot {`.
- Replace the comment and the seven `.grid[data-selected-day=...]` selectors
  with:

```css
  /* Show only the slots of the selected day (attribute set by app.js). */
  .grid[data-selected-day="mon"] .slot[data-day="mon"],
  .grid[data-selected-day="tue"] .slot[data-day="tue"],
  .grid[data-selected-day="wed"] .slot[data-day="wed"],
  .grid[data-selected-day="thu"] .slot[data-day="thu"],
  .grid[data-selected-day="fri"] .slot[data-day="fri"],
  .grid[data-selected-day="sat"] .slot[data-day="sat"],
  .grid[data-selected-day="sun"] .slot[data-day="sun"] {
    display: flex;
  }
```

- Replace the selector `.cell-label {` with `.slot-label {`.
- Delete the `.cell textarea` rule and its comment. Task 9 adds the same
  16-pixel rule for the editor's field.
- Inside the mobile block, add:

```css
  .slot-menu {
    min-height: 3rem;
  }
```

Run: `grep -n "cell\|textarea" public/styles.css`
Expected: no output.

- [ ] **Step 4: Rewrite the page script**

Replace `public/app.js` with:

```js
// Meal plan page. Depends ONLY on the HTTP API (/api/weeks and /api/recipes);
// never import from server/.

import {
  addDays,
  addWeeks,
  dayIndex,
  formatLongDate,
  formatWeekRange,
  isWeekId,
  weekIdOf,
  weekStart,
} from "./dates.js";
import { createElement } from "./dom.js";
import { getJson, REQUEST_TIMEOUT_MS } from "./http.js";
import { describeItem } from "./menus.js";
import { createSaves } from "./saves.js";

const DAYS = [
  { id: "mon", label: "Monday", short: "M" },
  { id: "tue", label: "Tuesday", short: "T" },
  { id: "wed", label: "Wednesday", short: "W" },
  { id: "thu", label: "Thursday", short: "T" },
  { id: "fri", label: "Friday", short: "F" },
  { id: "sat", label: "Saturday", short: "S" },
  { id: "sun", label: "Sunday", short: "S" },
];

const MEALS = [
  { id: "breakfast", label: "Breakfast" },
  { id: "snack_am", label: "Morning snack" },
  { id: "lunch", label: "Lunch" },
  { id: "snack_pm", label: "Afternoon snack" },
  { id: "dinner", label: "Dinner" },
];

const SAVED_BADGE_MS = 3000; // how long the "saved" check mark stays visible
const UNSAVED_QUESTION =
  "Some changes in this week couldn't be saved. Leave anyway and discard them?";

// Monochrome line icons drawn with currentColor, so CSS sets each state's color.
const ICON_PATHS = {
  saving: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  saved: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  error: '<path d="M6 6l12 12M18 6L6 18"/>',
};
// Accessible name and tooltip for each icon.
const STATUS_LABEL = {
  saving: "Saving…",
  saved: "Saved",
  error: "Couldn't save. Click to retry",
};

function statusIcon(state) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICON_PATHS[state]}</svg>`;
}

const grid = document.getElementById("grid");
const dayBar = document.getElementById("day-bar");
const loadError = document.getElementById("load-error");
const retryLoadButton = document.getElementById("retry-load");
const weekBar = document.getElementById("week-bar");
const weekRange = document.getElementById("week-range");

/** Timer that hides the "✓" badge, per slot element: it acts on what is on screen, whatever the week. */
const savedTimers = new Map();
/** The menu of each slot of the loaded week, by slot key. Saves send these. */
const menus = new Map();
/** The recipe book as last loaded, by recipe ID. */
let recipesById = new Map();

/** The week in the URL hash and the range label. Retry loads it again. */
let requestedWeek;
/** True while a week change runs, so two changes never overlap. */
let changingWeek = false;

// Keys include the week, so the same slot in two weeks never shares save state.
function slotKey(week, day, meal) {
  return `${week}/${day}/${meal}`;
}

// The slot element of `key`, or null when its week isn't on screen.
function slotOf(key) {
  const [week, day, meal] = key.split("/");
  if (week !== grid.dataset.week) return null;
  return grid.querySelector(`.slot[data-day="${day}"][data-meal="${meal}"]`);
}

const saves = createSaves({
  fetch: (url, options) => fetch(url, options),
  url: (key) => `/api/weeks/${key}`,
  readMenu: (key) => menus.get(key),
  onStatus: (key, state) => {
    const slot = slotOf(key);
    if (slot) setStatus(slot, state);
  },
  timeoutMs: REQUEST_TIMEOUT_MS,
});

function todayId() {
  return DAYS[dayIndex(new Date())].id;
}

function buildDayBar() {
  for (const day of DAYS) {
    const button = createElement("button");
    // The day number is filled in when a week loads.
    button.append(
      createElement("span", "day-letter", day.short),
      createElement("span", "day-number"),
    );
    button.type = "button";
    button.dataset.day = day.id;
    button.setAttribute("aria-label", day.label);
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => selectDay(day.id));
    dayBar.append(button);
  }
}

// DOM order = CSS grid order on desktop: corner, 7 day headers,
// then for each meal a meal header followed by its 7 slots.
function buildGrid() {
  grid.append(createElement("div", "corner"));
  for (const day of DAYS) {
    const header = createElement("div", "day-header", day.label);
    header.dataset.day = day.id;
    grid.append(header);
  }
  for (const meal of MEALS) {
    grid.append(createElement("div", "meal-header", meal.label));
    for (const day of DAYS) grid.append(buildSlot(day, meal));
  }
}

function buildSlot(day, meal) {
  const slot = createElement("div", "slot");
  slot.dataset.day = day.id;
  slot.dataset.meal = meal.id;

  // Visible only on mobile, where the meal header column is hidden. The
  // button's accessible name already says the meal.
  const label = createElement("span", "slot-label", meal.label);
  label.setAttribute("aria-hidden", "true");

  const menuButton = createElement("button", "slot-menu");
  menuButton.type = "button";

  const status = createElement("button", "status");
  status.type = "button";
  status.disabled = true;
  status.dataset.state = "idle";
  status.setAttribute("aria-live", "polite");
  // Only clickable in "error".
  status.addEventListener("click", () =>
    saves.queueSave(slotKey(grid.dataset.week, day.id, meal.id)),
  );

  slot.append(label, menuButton, status);
  return slot;
}

function recipeName(recipeId) {
  return recipesById.get(recipeId)?.name ?? "Unknown recipe";
}

// Shows `menu` in the slot, one menu item per line.
function renderSlot(slot, menu) {
  const day = DAYS.find((entry) => entry.id === slot.dataset.day);
  const meal = MEALS.find((entry) => entry.id === slot.dataset.meal);
  const lines = menu.items.map((item) => describeItem(recipeName(item.recipeId), item.servings));
  const button = slot.querySelector(".slot-menu");
  if (lines.length === 0) {
    button.replaceChildren(createElement("span", "slot-empty", "+ Add"));
  } else {
    button.replaceChildren(...lines.map((line) => createElement("span", "menu-line", line)));
  }
  const content = lines.length === 0 ? "empty" : lines.join(", ");
  button.setAttribute("aria-label", `${day.label}, ${meal.label}: ${content}`);
}

function selectDay(dayId) {
  grid.dataset.selectedDay = dayId;
  for (const button of dayBar.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.day === dayId));
  }
}

function fillWeek(week, weekData) {
  grid.dataset.week = week;
  menus.clear();
  const entries = [];
  for (const slot of grid.querySelectorAll(".slot")) {
    const { day, meal } = slot.dataset;
    const key = slotKey(week, day, meal);
    const menu = weekData[day][meal];
    menus.set(key, menu);
    renderSlot(slot, menu);
    entries.push([key, menu]);
  }
  // Sets every status to idle, which also clears a pending "✓" timer from the
  // previous week.
  saves.loaded(entries);
}

// Puts the day of the month on the desktop headers and the mobile day bar.
function showDayDates(week) {
  const monday = weekStart(week);
  for (const [index, day] of DAYS.entries()) {
    const date = addDays(monday, index);
    grid.querySelector(`.day-header[data-day="${day.id}"]`).textContent =
      `${day.label} ${date.getDate()}`;
    const button = dayBar.querySelector(`button[data-day="${day.id}"]`);
    button.querySelector(".day-number").textContent = String(date.getDate());
    button.setAttribute("aria-label", formatLongDate(date));
  }
}

// Marks today's header, slots, and day bar button when the loaded week contains today.
function markToday() {
  const todayDay = weekIdOf(new Date()) === grid.dataset.week ? todayId() : null;
  for (const element of document.querySelectorAll("[data-day]")) {
    element.toggleAttribute("data-today", element.dataset.day === todayDay);
  }
}

// The keys of the slots on screen.
function shownKeys() {
  const { week } = grid.dataset;
  return [...grid.querySelectorAll(".slot")].map((slot) =>
    slotKey(week, slot.dataset.day, slot.dataset.meal),
  );
}

// Shows a slot's save status. The status itself comes from saves.js.
function setStatus(slot, state) {
  clearTimeout(savedTimers.get(slot));

  const status = slot.querySelector(".status");
  status.dataset.state = state;
  status.disabled = state !== "error";
  if (state === "idle") {
    status.replaceChildren();
    status.removeAttribute("aria-label");
    status.removeAttribute("title");
  } else {
    status.innerHTML = statusIcon(state); // static markup, never user text
    status.setAttribute("aria-label", STATUS_LABEL[state]);
    status.title = STATUS_LABEL[state];
  }

  if (state === "saved") {
    savedTimers.set(
      slot,
      setTimeout(() => setStatus(slot, "idle"), SAVED_BADGE_MS),
    );
  }
}

async function loadWeek(week) {
  loadError.hidden = true;
  retryLoadButton.disabled = true;
  try {
    // The recipe book loads with every week, so recipes added on the Recipes
    // page show up without a reload.
    const [weekData, recipeBook] = await Promise.all([
      getJson(`/api/weeks/${week}`),
      getJson("/api/recipes"),
    ]);
    recipesById = new Map(recipeBook.recipes.map((recipe) => [recipe.id, recipe]));
    fillWeek(week, weekData);
    showDayDates(week);
    markToday();
    dayBar.hidden = false;
    grid.hidden = false;
  } catch (error) {
    console.error("Couldn't load the meal plan:", error);
    dayBar.hidden = true;
    grid.hidden = true;
    loadError.hidden = false;
  } finally {
    retryLoadButton.disabled = false;
  }
}

function syncHash() {
  // replaceState adds no history entry, so Back doesn't step through weeks.
  if (requestedWeek) history.replaceState(null, "", `#${requestedWeek}`);
}

function setChangingWeek(changing) {
  changingWeek = changing;
  for (const button of weekBar.querySelectorAll("button")) button.disabled = changing;
  grid.inert = changing; // no editing a week that is being left
}

// Waits for pending saves, then returns true if the loaded week can be left:
// every slot is saved, or the user agreed to discard what couldn't be saved.
async function leaveLoadedWeek() {
  await saves.settle();
  const unsaved = saves.unsaved(shownKeys());
  if (unsaved.length === 0) return true;
  // Let the browser paint the red crosses first: confirm() blocks painting.
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
  if (!window.confirm(UNSAVED_QUESTION)) return false;
  // Put the saved menu back, so no later page-hide save can send the
  // discarded menu.
  for (const key of unsaved) {
    const menu = saves.discard(key);
    menus.set(key, menu);
    renderSlot(slotOf(key), menu);
  }
  return true;
}

// Shows `week` without ever dropping an unsaved menu silently. On mobile, the
// selected day stays the same unless `selectToday` is set.
async function goToWeek(week, { selectToday = false } = {}) {
  if (changingWeek) return;
  // Disabling the clicked button (a week bar button or Retry) moves focus to
  // <body>; remember it so it can be refocused afterward.
  const focused = document.activeElement;
  setChangingWeek(true);
  try {
    if (week !== grid.dataset.week || grid.hidden) {
      if (!(await leaveLoadedWeek())) return;
      requestedWeek = week;
      syncHash();
      weekRange.textContent = formatWeekRange(week);
      await loadWeek(week);
    }
    if (selectToday) selectDay(todayId());
    markToday(); // covers the case where the target week was already shown
  } finally {
    setChangingWeek(false);
    // Only if focus was lost, not moved elsewhere by the user, and the button
    // is still shown (Retry hides after a successful load).
    const refocus = weekBar.contains(focused) || focused === retryLoadButton;
    if (refocus && document.activeElement === document.body && !focused.closest("[hidden]")) {
      focused.focus();
    }
    syncHash(); // also undoes a hash edit that was cancelled or ignored
  }
}

buildDayBar();
buildGrid();
selectDay(todayId());
retryLoadButton.addEventListener("click", () => goToWeek(requestedWeek));
document
  .getElementById("previous-week")
  .addEventListener("click", () => goToWeek(addWeeks(requestedWeek, -1)));
document
  .getElementById("next-week")
  .addEventListener("click", () => goToWeek(addWeeks(requestedWeek, 1)));
document
  .getElementById("today")
  .addEventListener("click", () => goToWeek(weekIdOf(new Date()), { selectToday: true }));
window.addEventListener("hashchange", () => {
  const week = location.hash.slice(1);
  if (isWeekId(week)) goToWeek(week);
  else syncHash();
});
window.addEventListener("pagehide", () => saves.flush(shownKeys(), { skipInFlight: false }));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saves.flush(shownKeys(), { skipInFlight: true });
  else markToday(); // the day may have changed while the page was hidden
});

const hashWeek = location.hash.slice(1);
goToWeek(isWeekId(hashWeek) ? hashWeek : weekIdOf(new Date()));
```

Run: `grep -n "cell\|textarea\|readText" public/app.js`
Expected: no output.

- [ ] **Step 5: Update the README**

In `README.md`, in the first paragraph, replace
`Each cell holds a free-text list of dishes, one per line.` with:

```markdown
Each slot of the grid holds a menu: a list of recipes from the recipe book,
each with a number of servings.
```

In the `## Project structure` tree, replace the `public/` entry with:

```none
public/      # User interface: HTML, CSS, and JavaScript, with no framework or build step.
  app.js     # Meal plan page: grid, week changes, and saves.
  dates.js   # Date helpers with no DOM access, so tests run them in Node.js.
  dom.js     # DOM helpers shared by the pages.
  http.js    # Requests with a timeout, with no DOM access.
  index.html # Meal plan page.
  menus.js   # Menu functions with no DOM access.
  recipe-search.js # Recipe name matching and sorting, with no DOM access.
  saves.js   # Save logic with no DOM access, so tests run it in Node.js.
  styles.css
```

- [ ] **Step 6: Check the page by hand**

Run:

```bash
mkdir -p ~/meals-check && DATA_DIR=~/meals-check npm start
```

In a second terminal, add two recipes and a menu:

```bash
soup=$(curl -s -X POST -H 'Content-Type: application/json' -d '{"name":"Lentil soup"}' http://localhost:3000/api/recipes | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
salad=$(curl -s -X POST -H 'Content-Type: application/json' -d '{"name":"<b>Green</b> salad"}' http://localhost:3000/api/recipes | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
monday=$(node -e 'const d=new Date();d.setDate(d.getDate()-((d.getDay()+6)%7));console.log(d.toLocaleDateString("sv"))')
curl -s -X PUT -H 'Content-Type: application/json' -d "{\"items\":[{\"recipeId\":\"$soup\",\"servings\":1.5},{\"recipeId\":\"$salad\",\"servings\":2}]}" "http://localhost:3000/api/weeks/$monday/mon/lunch"
```

Open `http://localhost:3000` on desktop. Expected:

- Monday's lunch shows `Lentil soup × 1.5` and `<b>Green</b> salad × 2`, with
  the tags as literal text.
- Every other slot shows `+ Add`.
- The header shows **Recipes** on the right of the title.
- In a window narrower than 768 px, Monday shows the `Lunch` label over the
  menu.

Stop the server with `Control+C`, and then delete the data:
`rm -r ~/meals-check`.

- [ ] **Step 7: Check and commit**

Run: `npm run format && npm run lint && npm test`
Expected: all pass.

```bash
git add README.md public/app.js public/dom.js public/index.html public/styles.css
git commit -m "feat(ui): show menus in the grid"
```

---

### Task 9: The slot editor

**Files:**

- Create: `public/slot-editor.js`
- Modify: `public/app.js` (imports, `buildSlot`, a new `openEditor`, the
  `hashchange` listener, and a new `beforeunload` listener)
- Modify: `public/index.html` (the dialog)
- Modify: `public/styles.css` (the dialog)
- Modify: `README.md` (use the app)

**Interfaces:**

- Consumes: `addableRecipes`, `addItem`, `copyMenu`, `MAX_ITEMS`,
  `MAX_SERVINGS`, `MIN_SERVINGS`, `removeItem`, `sameMenu`, and
  `stepServings` from `public/menus.js` (Task 6). `createElement` from
  `public/dom.js`, and `menus`, `recipesById`, `slotKey`, `renderSlot`,
  `saves`, `grid`, `DAYS`, `MEALS`, `syncHash`, and `goToWeek` from
  `public/app.js` (Task 8).
- Produces, in `public/slot-editor.js`:
  `createSlotEditor(dialog: HTMLDialogElement)` returns
  `{ open({ title, menu, recipes, opener, onDone }), isOpen(): boolean,
  hasChanges(): boolean }`. `onDone(menu)` runs only when you click
  **Done**, with the edited menu.

Only a browser can check the dialog. Step 6 checks it by hand, and Task 11
adds it to `docs/manual-test-plan.md`.

- [ ] **Step 1: Add the dialog to the page**

In `public/index.html`, before `</body>`, add:

```html
    <!-- Slot editor. Filled and opened by slot-editor.js. -->
    <dialog id="slot-editor" class="slot-editor" aria-labelledby="slot-editor-title">
      <div class="slot-editor-body">
        <h2 id="slot-editor-title" class="slot-editor-title" tabindex="-1"></h2>
        <ul class="menu-items" aria-label="Recipes in this menu"></ul>
        <label for="recipe-search">Add recipe</label>
        <input
          id="recipe-search"
          class="recipe-search"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-controls="recipe-options"
          aria-expanded="false"
          autocomplete="off"
        >
        <ul id="recipe-options" class="recipe-options" role="listbox" aria-label="Recipes" hidden></ul>
        <p class="no-match" hidden>No recipes found. Add them on the Recipes page.</p>
        <div class="dialog-actions">
          <button type="button" class="cancel">Cancel</button>
          <button type="button" class="done">Done</button>
        </div>
      </div>
    </dialog>
```

- [ ] **Step 2: Style the dialog**

In `public/styles.css`, before the desktop block
(`/* ---------- Desktop (>= 768px)`), add:

```css
/* ---------- Slot editor ---------- */

/* No padding: slot-editor.js treats a click whose target is the dialog itself
   as a click on the backdrop. The body inside carries the padding. */
.slot-editor {
  width: min(32rem, calc(100% - 2rem));
  padding: 0;
  border: 0;
  border-radius: 0.5rem;
  box-shadow: 0 0.5rem 2rem rgb(0 0 0 / 25%);
}

.slot-editor::backdrop {
  background: rgb(0 0 0 / 40%);
}

.slot-editor-body {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
}

.slot-editor-title {
  margin: 0;
  font-size: 1.1rem;
}

/* The title takes focus when the dialog opens, only so a phone doesn't open
   its keyboard. It isn't a control, so it shows no focus ring. */
.slot-editor-title:focus {
  outline: none;
}

.menu-items,
.recipe-options {
  margin: 0;
  padding: 0;
  list-style: none;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0;
  border-bottom: 1px solid #eee;
}

.menu-item .recipe-name {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.servings {
  min-width: 2.5rem;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.slot-editor button {
  padding: 0.4rem 0.8rem;
  border: 1px solid #ccc;
  border-radius: 0.4rem;
  background: #fff;
  font: inherit;
}

.slot-editor .step {
  min-width: 2.25rem;
  padding: 0.4rem 0;
}

.slot-editor .done {
  border-color: #2e7d32;
  background: #2e7d32;
  color: #fff;
}

.recipe-search {
  width: 100%;
  padding: 0.4rem;
  border: 1px solid #ccc;
  border-radius: 0.3rem;
  font: inherit;
}

.recipe-options {
  max-height: 12rem;
  overflow-y: auto;
  border: 1px solid #eee;
  border-radius: 0.3rem;
}

.recipe-option {
  padding: 0.4rem;
  cursor: pointer;
  overflow-wrap: anywhere;
}

.recipe-option:hover {
  background: #f3f3f3;
}

.recipe-option[aria-selected="true"] {
  background: #eef6ee;
}

.no-match {
  margin: 0;
  color: #666;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
```

Inside the mobile block (`@media (max-width: 767.98px)`), add:

```css
  /* The slot editor fills the screen on phones. */
  .slot-editor {
    width: 100%;
    max-width: none;
    height: 100%;
    max-height: none;
    margin: 0;
    border-radius: 0;
  }

  /* >= 16px prevents iOS Safari from zooming in on focus. */
  .recipe-search {
    font-size: 16px;
  }
```

- [ ] **Step 3: Write the editor**

Create `public/slot-editor.js`:

```js
// The slot editor: a modal dialog that edits a copy of a slot's menu. It
// follows the app's interaction rules:
// - Done confirms: it hands the edited menu back. Nothing else saves.
// - Cancel, Escape, and Android's Back discard the copy.
// - Clicking the backdrop closes the editor only when the copy has no
//   changes, so a stray click never throws work away.

import { createElement } from "./dom.js";
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
  const title = dialog.querySelector(".slot-editor-title");
  const itemList = dialog.querySelector(".menu-items");
  const search = dialog.querySelector(".recipe-search");
  const options = dialog.querySelector(".recipe-options");
  const noMatch = dialog.querySelector(".no-match");
  const doneButton = dialog.querySelector(".done");

  /** The open editing session, or null: { original, copy, recipes, names, opener, onDone }. */
  let session = null;
  /** The recipes the list offers, and the index of the highlighted one. */
  let matches = [];
  let highlighted = 0;

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
    search.value = "";
    highlighted = 0;
    renderItems();
    renderOptions();
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

  function stepButton(symbol, label) {
    const button = createElement("button", "step", symbol);
    button.type = "button";
    button.setAttribute("aria-label", label);
    return button;
  }

  function itemRow(item) {
    const name = nameOf(item.recipeId);
    const row = createElement("li", "menu-item");
    const servings = createElement("span", "servings", String(item.servings));
    servings.setAttribute("aria-live", "polite");
    const decrease = stepButton("−", `Decrease servings of ${name}`);
    const increase = stepButton("+", `Increase servings of ${name}`);
    const remove = createElement("button", "remove", "Remove");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${name}`);
    decrease.disabled = item.servings <= MIN_SERVINGS;
    increase.disabled = item.servings >= MAX_SERVINGS;
    decrease.addEventListener("click", () => step(item.recipeId, -1, row));
    increase.addEventListener("click", () => step(item.recipeId, 1, row));
    remove.addEventListener("click", () => {
      session.copy = removeItem(session.copy, item.recipeId);
      renderItems();
      renderOptions();
      search.focus();
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

  function renderItems() {
    itemList.replaceChildren(...session.copy.items.map(itemRow));
    search.disabled = isFull();
    search.placeholder = isFull() ? `A menu holds up to ${MAX_ITEMS} recipes.` : "";
  }

  function renderOptions() {
    matches = isFull() ? [] : addableRecipes(session.recipes, session.copy, search.value);
    highlighted = Math.min(highlighted, Math.max(matches.length - 1, 0));
    options.replaceChildren(
      ...matches.map((recipe, index) => {
        const option = createElement("li", "recipe-option", recipe.name);
        option.id = `recipe-option-${index}`;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(index === highlighted));
        option.addEventListener("click", () => add(recipe.id));
        return option;
      }),
    );
    options.hidden = matches.length === 0;
    noMatch.hidden = isFull() || matches.length > 0;
    search.setAttribute("aria-expanded", String(matches.length > 0));
    if (matches.length > 0) {
      search.setAttribute("aria-activedescendant", `recipe-option-${highlighted}`);
    } else {
      search.removeAttribute("aria-activedescendant");
    }
  }

  function highlight(index) {
    highlighted = index;
    renderOptions();
    options.children[index]?.scrollIntoView({ block: "nearest" });
  }

  function add(recipeId) {
    session.copy = addItem(session.copy, recipeId);
    search.value = "";
    highlighted = 0;
    renderItems();
    renderOptions();
    (search.disabled ? doneButton : search).focus();
  }

  search.addEventListener("input", () => {
    highlighted = 0;
    renderOptions();
  });

  search.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "ArrowDown" && matches.length > 0) {
      event.preventDefault();
      highlight((highlighted + 1) % matches.length);
    } else if (event.key === "ArrowUp" && matches.length > 0) {
      event.preventDefault();
      highlight((highlighted - 1 + matches.length) % matches.length);
    } else if (event.key === "Enter") {
      // Adds the highlighted recipe. It never confirms the editor.
      event.preventDefault();
      if (matches.length > 0) add(matches[highlighted].id);
    } else if (event.key === "Escape" && search.value !== "") {
      // The innermost edit is the search text: clear it and keep the editor
      // open. Cancelling the keydown stops the dialog's close request.
      event.preventDefault();
      search.value = "";
      highlighted = 0;
      renderOptions();
    }
  });

  dialog.querySelector(".cancel").addEventListener("click", () => close(false));
  doneButton.addEventListener("click", () => close(true));
  // Escape and Android's Back close the dialog: that discards the copy.
  dialog.addEventListener("close", () => close(false));
  // The dialog has no padding, so a click whose target is the dialog itself
  // landed on the backdrop.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog && !hasChanges()) close(false);
  });

  return { hasChanges, isOpen, open };
}
```

- [ ] **Step 4: Open the editor from the slots**

In `public/app.js`:

Add this import after the `import { createElement } from "./dom.js";` line:

```js
import { createSlotEditor } from "./slot-editor.js";
```

After `const weekRange = document.getElementById("week-range");`, add:

```js
const editor = createSlotEditor(document.getElementById("slot-editor"));
```

In `buildSlot`, after `menuButton.type = "button";`, add:

```js
  menuButton.addEventListener("click", () => openEditor(slot));
```

After the `renderSlot` function, add:

```js
// Opens the editor on the slot's menu. That is the menu confirmed with Done,
// even when its save failed, so a retry from the editor keeps the changes.
function openEditor(slot) {
  const { week } = grid.dataset;
  const { day, meal } = slot.dataset;
  const key = slotKey(week, day, meal);
  const dayIndexInWeek = DAYS.findIndex((entry) => entry.id === day);
  const mealLabel = MEALS.find((entry) => entry.id === meal).label;
  editor.open({
    title: `${formatLongDate(addDays(weekStart(week), dayIndexInWeek))} · ${mealLabel}`,
    menu: menus.get(key),
    recipes: [...recipesById.values()],
    opener: slot.querySelector(".slot-menu"),
    onDone: (menu) => {
      menus.set(key, menu);
      renderSlot(slot, menu);
      saves.queueSave(key);
    },
  });
}
```

In `goToWeek`, replace `if (changingWeek) return;` with:

```js
  if (changingWeek || editor.isOpen()) return;
```

Replace the `hashchange` listener with:

```js
window.addEventListener("hashchange", () => {
  const week = location.hash.slice(1);
  // The week never changes behind an open editor.
  if (isWeekId(week) && !editor.isOpen()) goToWeek(week);
  else syncHash();
});
```

After the `pagehide` listener, add:

```js
// Unconfirmed changes in the editor would be lost: ask before leaving.
window.addEventListener("beforeunload", (event) => {
  if (!editor.hasChanges()) return;
  event.preventDefault();
  event.returnValue = ""; // Safari and older browsers show the question only with this.
});
```

- [ ] **Step 5: Update the README**

In `README.md`, in `## Use the app`, replace the text from
`To plan a meal, type one dish per line in a cell.` down to, and including,
the paragraph that ends with `The cell then goes back to its last saved
text.` with:

```markdown
To plan a meal, click or tap its slot. The slot editor opens with the slot's
menu:

- To add a recipe, type part of its name in **Add recipe**. Then click the
  recipe, or select it with the arrow keys and press `Enter`. The list offers
  only recipes that aren't archived or already in the menu. To add recipes to
  the recipe book, use the **Recipes** page.
- To change the servings of a recipe, click `−` or `+`. Servings go from 0.5
  to 99 in steps of 0.5. A recipe that you add starts at 1.
- To remove a recipe from the menu, click **Remove**.

A menu holds up to 20 recipes.

To save the menu, click **Done**. To close the editor without saving, click
**Cancel** or press `Escape`. If the **Add recipe** field has text, `Escape`
clears it first. If you haven't changed anything, you can also click outside
the editor to close it. If you have, clicking outside does nothing, so you
don't lose your changes by accident. If you reload or close the page while
the editor has changes, the browser asks whether to leave.

Below each slot, an icon shows the save status:

| Icon             | Status                                                       |
|------------------|--------------------------------------------------------------|
| Gray clock       | The app is saving the slot.                                  |
| Green check mark | The slot is saved. The icon disappears after a few seconds. |
| Red cross        | The save failed. The slot keeps your menu.                   |

To retry a failed save, click the red cross. To see what an icon means, hover
over it.

Before the app changes weeks, it waits for pending saves. If a slot couldn't
be saved, the app asks whether to leave the week anyway. To stay and retry the
save, click **Cancel**. To discard the unsaved menu and change weeks, click
**OK**. The slot then goes back to its last saved menu.
```

In the next paragraph, replace `If two people edit the same cell, the last save
wins.` with `If two people edit the same slot, the last save wins.`

In the `## Project structure` tree, add after the `saves.js` line:

```none
  slot-editor.js # The slot editor dialog.
```

Run: `grep -n "cell\|dish" README.md`
Expected: no output.

- [ ] **Step 6: Check the editor by hand**

Run `mkdir -p ~/meals-check && DATA_DIR=~/meals-check npm start`, and in a
second terminal add recipes:

```bash
for name in "Gnocchi carbonara" "Green salad" "Lentil soup" "Omelette" "Russian salad"; do
  curl -s -X POST -H 'Content-Type: application/json' -d "{\"name\":\"$name\"}" http://localhost:3000/api/recipes; echo
done
```

On desktop, open `http://localhost:3000` and check:

1. Clicking an empty slot opens the editor, with a title such as
   `Monday, September 21 · Lunch`, and the five recipes from A to Z.
1. Typing `SALAD` shows only `Green salad` and `Russian salad`. `↓` and
   `Enter` adds `Russian salad` at `1`, clears the field, and removes it from
   the list.
1. `+` and `−` change the servings in steps of 0.5; `−` is disabled at 0.5.
1. **Done** closes the editor; the slot shows the menu and a check mark, and
   the slot button has focus.
1. Reopen it, click **Remove**, and click **Cancel**: the slot doesn't
   change. Reopen it, change servings, and press `Escape`: same.
1. With no changes, clicking outside closes the editor. With a change, it
   doesn't.
1. Type `sal`, press `Escape`: the field clears and the editor stays open.
   Press `Escape` again: the editor closes.
1. With a change in the editor, reload: the browser asks whether to leave.

Stop the server and run `rm -r ~/meals-check`.

- [ ] **Step 7: Check and commit**

Run: `npm run format && npm run lint && npm test`
Expected: all pass.

```bash
git add README.md public/app.js public/index.html public/slot-editor.js public/styles.css
git commit -m "feat(ui): edit the menu of a slot in a dialog"
```

---

### Task 10: The recipe book page

**Files:**

- Create: `public/recipes.html`
- Create: `public/recipes.js`
- Modify: `public/styles.css` (the recipe book)
- Modify: `test/api.test.js` (one test)
- Modify: `README.md` (manage recipes and project structure)

**Interfaces:**

- Consumes: `getJson` and `sendJson` from `public/http.js`, and
  `filterRecipes` and `sortRecipes` from `public/recipe-search.js` (Task 6).
  `createElement` from `public/dom.js` (Task 8). The recipe API (Task 5).
- Produces: the page at `/recipes.html`.

- [ ] **Step 1: Write the failing test**

In `test/api.test.js`, after the `GET / serves the frontend page` test, add:

```js
test("GET /recipes.html serves the recipe book page", async () => {
  const res = await request(app).get("/recipes.html");

  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /text\/html/);
  assert.match(res.text, /<title>Recipes<\/title>/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/api.test.js`
Expected: FAIL in `GET /recipes.html serves the recipe book page` with a
`404` status.

- [ ] **Step 3: Write the page**

Create `public/recipes.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Recipes</title>
    <link rel="stylesheet" href="styles.css">
    <script type="module" src="recipes.js"></script>
  </head>
  <body>
    <header class="page-header">
      <div class="title-bar">
        <h1>Recipes</h1>
        <a class="page-link" href="/">Meal plan</a>
      </div>
    </header>

    <div id="load-error" class="load-error" role="alert" hidden>
      <span>Couldn't load the recipes.</span>
      <button type="button" id="retry-load">Retry</button>
    </div>

    <main id="recipe-book" class="recipe-book" hidden>
      <form id="new-recipe" class="new-recipe">
        <label for="new-recipe-name">New recipe</label>
        <div class="field-row">
          <input id="new-recipe-name" type="text" autocomplete="off">
          <button type="submit" class="primary">Add</button>
        </div>
        <p id="new-recipe-message" class="field-message" role="status"></p>
      </form>

      <label for="search">Search</label>
      <input id="search" type="search" autocomplete="off">

      <p id="empty-book" class="hint" hidden>No recipes yet. Add your first one above.</p>
      <p id="no-matches" class="hint" hidden></p>
      <ul id="active-recipes" class="recipe-list" aria-label="Recipes"></ul>

      <details id="archived" class="archived" hidden>
        <summary>Archived (<span id="archived-count">0</span>)</summary>
        <ul id="archived-recipes" class="recipe-list" aria-label="Archived recipes"></ul>
      </details>
    </main>
  </body>
</html>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/api.test.js`
Expected: PASS.

- [ ] **Step 5: Style the page**

In `public/styles.css`, before the desktop block, add:

```css
/* ---------- Recipe book ---------- */

.recipe-book {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-width: 40rem;
  padding: 0 1rem 1rem;
}

.recipe-book label {
  font-weight: 600;
}

.recipe-book input {
  width: 100%;
  min-width: 0;
  padding: 0.4rem;
  border: 1px solid #ccc;
  border-radius: 0.3rem;
  font: inherit;
}

.recipe-book button {
  padding: 0.4rem 0.8rem;
  border: 1px solid #ccc;
  border-radius: 0.4rem;
  background: #fff;
  font: inherit;
}

.recipe-book .primary {
  border-color: #2e7d32;
  background: #2e7d32;
  color: #fff;
}

.new-recipe {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin-bottom: 0.75rem;
}

.field-row {
  display: flex;
  gap: 0.5rem;
}

.field-message,
.row-message {
  margin: 0;
  color: #8a1c14;
}

.field-message:empty {
  display: none;
}

.hint {
  margin: 0.5rem 0;
  color: #666;
}

.recipe-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.recipe-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0;
  border-bottom: 1px solid #ddd;
}

.recipe-row .recipe-name {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.recipe-row .rename-field {
  flex: 1;
  width: auto;
}

.row-actions {
  display: flex;
  gap: 0.5rem;
}

.row-message {
  flex-basis: 100%;
}

.archived summary {
  padding: 0.5rem 0;
  font-weight: 600;
  cursor: pointer;
}
```

Inside the desktop block, after the `body` rule, add:

```css
  /* The body is a fixed-height column on desktop, so the recipe book scrolls. */
  .recipe-book {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
```

Inside the mobile block, add:

```css
  /* >= 16px prevents iOS Safari from zooming in on focus. */
  .recipe-book input {
    font-size: 16px;
  }
```

- [ ] **Step 6: Write the page script**

Create `public/recipes.js`:

```js
// Recipe book page. Depends ONLY on the HTTP API (/api/recipes); never import
// from server/. It follows the app's interaction rules: Enter or the confirm
// button confirms, Escape or Cancel discards, and leaving a field never
// discards changes.

import { createElement } from "./dom.js";
import { getJson, sendJson } from "./http.js";
import { filterRecipes, sortRecipes } from "./recipe-search.js";

const loadError = document.getElementById("load-error");
const retryLoadButton = document.getElementById("retry-load");
const book = document.getElementById("recipe-book");
const form = document.getElementById("new-recipe");
const nameField = document.getElementById("new-recipe-name");
const addButton = form.querySelector('button[type="submit"]');
const formMessage = document.getElementById("new-recipe-message");
const search = document.getElementById("search");
const emptyBook = document.getElementById("empty-book");
const noMatches = document.getElementById("no-matches");
const activeList = document.getElementById("active-recipes");
const archived = document.getElementById("archived");
const archivedCount = document.getElementById("archived-count");
const archivedList = document.getElementById("archived-recipes");

/** Every recipe, active and archived, as the server last confirmed. */
let recipes = [];
/** Rows in rename mode, by recipe ID: { value, message, busy }. They survive renders. */
const renaming = new Map();
/** Error messages under rows, by recipe ID. */
const rowMessages = new Map();
/** Recipe IDs with an archive or restore request running. */
const busy = new Set();
/** True while render() replaces rows, so focus changes it causes are ignored. */
let rendering = false;

function quoted(name) {
  return `"${name}"`;
}

function recipeUrl(id) {
  return `/api/recipes/${encodeURIComponent(id)}`;
}

function recipeById(id) {
  return recipes.find((recipe) => recipe.id === id);
}

// Replaces or adds `recipe` in the local list.
function remember(recipe) {
  recipes = [...recipes.filter((entry) => entry.id !== recipe.id), recipe];
}

function rowElement(id) {
  return book.querySelector(`.recipe-row[data-id="${CSS.escape(id)}"]`);
}

function button(text, label, onClick) {
  const element = createElement("button", undefined, text);
  element.type = "button";
  element.setAttribute("aria-label", label);
  element.addEventListener("click", onClick);
  return element;
}

function conflictText(holder) {
  return holder.archived
    ? `${quoted(holder.name)} is archived.`
    : `${quoted(holder.name)} already exists.`;
}

// ---------- Rendering ----------

function render() {
  rendering = true;
  const matches = sortRecipes(filterRecipes(recipes, search.value));
  const archivedTotal = recipes.filter((recipe) => recipe.archived).length;
  activeList.replaceChildren(...matches.filter((recipe) => !recipe.archived).map(row));
  archivedList.replaceChildren(...matches.filter((recipe) => recipe.archived).map(row));
  archivedCount.textContent = String(archivedTotal);
  archived.hidden = archivedTotal === 0;
  emptyBook.hidden = recipes.length > 0;
  noMatches.hidden = recipes.length === 0 || matches.length > 0;
  noMatches.textContent = `No recipes match ${quoted(search.value.trim())}.`;
  rendering = false;
}

function row(recipe) {
  const item = createElement("li", "recipe-row");
  item.dataset.id = recipe.id;
  const rename = renaming.get(recipe.id);
  if (rename) {
    item.append(...renameControls(recipe, rename, item));
  } else {
    const actions = createElement("span", "row-actions");
    if (recipe.archived) {
      actions.append(
        button("Restore", `Restore ${recipe.name}`, () => setArchived(recipe.id, false)),
      );
    } else {
      actions.append(
        button("Rename", `Rename ${recipe.name}`, () => startRename(recipe.id)),
        button("Archive", `Archive ${recipe.name}`, () => setArchived(recipe.id, true)),
      );
    }
    for (const control of actions.children) control.disabled = busy.has(recipe.id);
    item.append(createElement("span", "recipe-name", recipe.name), actions);
  }
  const message = rename?.message || rowMessages.get(recipe.id);
  if (message) item.append(createElement("p", "row-message", message));
  return item;
}

// ---------- Loading ----------

async function load() {
  loadError.hidden = true;
  retryLoadButton.disabled = true;
  try {
    recipes = (await getJson("/api/recipes")).recipes;
    render();
    book.hidden = false;
  } catch (error) {
    console.error("Couldn't load the recipes:", error);
    book.hidden = true;
    loadError.hidden = false;
  } finally {
    retryLoadButton.disabled = false;
  }
}

// ---------- Adding ----------

function showFormMessage(...content) {
  formMessage.replaceChildren(...content);
}

function setFormBusy(isBusy) {
  nameField.disabled = isBusy;
  addButton.disabled = isBusy;
  for (const control of formMessage.querySelectorAll("button")) control.disabled = isBusy;
}

async function addRecipe() {
  setFormBusy(true);
  showFormMessage();
  try {
    const { status, body } = await sendJson("POST", "/api/recipes", { name: nameField.value });
    if (status === 201) {
      remember(body);
      nameField.value = "";
      render();
    } else if (status === 409 && body.recipe?.archived) {
      const restore = button("Restore it", `Restore ${body.recipe.name}`, () =>
        restoreFromForm(body.recipe.id),
      );
      showFormMessage(`${conflictText(body.recipe)} `, restore);
    } else if (status === 409 && body.recipe) {
      showFormMessage(conflictText(body.recipe));
    } else if (status === 400 && typeof body.error === "string") {
      showFormMessage(body.error);
    } else {
      throw new Error(`HTTP ${status}`);
    }
  } catch (error) {
    console.error("Couldn't add the recipe:", error);
    showFormMessage("Couldn't add the recipe. Try again."); // the text stays in the field
  } finally {
    setFormBusy(false);
    nameField.focus();
  }
}

async function restoreFromForm(id) {
  setFormBusy(true);
  try {
    const { status, body } = await sendJson("PATCH", recipeUrl(id), { archived: false });
    if (status !== 200) throw new Error(`HTTP ${status}`);
    remember(body);
    nameField.value = "";
    showFormMessage();
    render();
  } catch (error) {
    console.error("Couldn't restore the recipe:", error);
    showFormMessage("Couldn't restore the recipe. Try again.");
  } finally {
    setFormBusy(false);
    nameField.focus();
  }
}

// ---------- Renaming ----------

function renameControls(recipe, rename, item) {
  const field = createElement("input", "rename-field");
  field.type = "text";
  field.value = rename.value;
  field.disabled = rename.busy;
  field.setAttribute("aria-label", `New name for ${recipe.name}`);
  field.addEventListener("input", () => {
    rename.value = field.value;
  });
  field.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      saveRename(recipe.id);
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelRename(recipe.id);
    }
  });
  const save = button("Save", `Save the name of ${recipe.name}`, () => saveRename(recipe.id));
  const cancel = button("Cancel", `Cancel renaming ${recipe.name}`, () => cancelRename(recipe.id));
  save.disabled = rename.busy;
  cancel.disabled = rename.busy;
  // Leaving the row closes it only when the name has no changes. Moving to
  // Save or Cancel stays inside the row, so it isn't leaving.
  item.addEventListener("focusout", (event) => {
    if (rendering || !item.isConnected || rename.busy || item.contains(event.relatedTarget)) {
      return;
    }
    if (rename.value === recipe.name) cancelRename(recipe.id, { refocus: false });
  });
  return [field, save, cancel];
}

function startRename(id) {
  renaming.set(id, { value: recipeById(id).name, message: "", busy: false });
  rowMessages.delete(id);
  render();
  const field = rowElement(id).querySelector(".rename-field");
  field.focus();
  field.select();
}

function cancelRename(id, { refocus = true } = {}) {
  if (!renaming.delete(id)) return;
  render();
  if (refocus) rowElement(id)?.querySelector(".row-actions button")?.focus();
}

async function saveRename(id) {
  const rename = renaming.get(id);
  if (!rename || rename.busy) return;
  if (rename.value === recipeById(id).name) {
    cancelRename(id);
    return;
  }
  rename.busy = true;
  rename.message = "";
  render();
  let message = "Couldn't rename the recipe. Try again.";
  try {
    const { status, body } = await sendJson("PATCH", recipeUrl(id), { name: rename.value });
    if (status === 200) {
      remember(body);
      renaming.delete(id);
      render();
      rowElement(id)?.querySelector(".row-actions button")?.focus();
      return;
    }
    if (status === 409 && body.recipe) message = conflictText(body.recipe);
    else if (status === 400 && typeof body.error === "string") message = body.error;
  } catch (error) {
    console.error("Couldn't rename the recipe:", error);
  }
  rename.busy = false;
  rename.message = message; // the field stays open with the typed name
  render();
  rowElement(id)?.querySelector(".rename-field")?.focus();
}

// ---------- Archiving and restoring ----------

// After a row leaves a list, focus moves to the row now in its place, the one
// before it, or the search field.
function focusNeighbor(list, index) {
  const target = list.children[Math.min(index, list.children.length - 1)];
  (target?.querySelector(".row-actions button:last-child") ?? search).focus();
}

async function setArchived(id, archive) {
  const failure = archive
    ? "Couldn't archive the recipe. Try again."
    : "Couldn't restore the recipe. Try again.";
  const list = archive ? activeList : archivedList;
  const index = [...list.children].findIndex((element) => element.dataset.id === id);
  busy.add(id);
  rowMessages.delete(id);
  render();
  try {
    const { status, body } = await sendJson("PATCH", recipeUrl(id), { archived: archive });
    if (status !== 200) throw new Error(`HTTP ${status}`);
    remember(body);
  } catch (error) {
    console.error(failure, error);
    rowMessages.set(id, failure);
  }
  busy.delete(id);
  render();
  if (rowMessages.has(id)) rowElement(id)?.querySelector(".row-actions button:last-child")?.focus();
  else focusNeighbor(list, index);
}

// ---------- Events ----------

form.addEventListener("submit", (event) => {
  event.preventDefault();
  addRecipe();
});

nameField.addEventListener("keydown", (event) => {
  if (event.isComposing || event.key !== "Escape") return;
  nameField.value = "";
  showFormMessage();
});

search.addEventListener("input", render);
retryLoadButton.addEventListener("click", load);

load();
```

- [ ] **Step 7: Update the README**

In `README.md`, after the `## Use the app` section and before
`## Configure the server`, add:

```markdown
## Manage recipes

The recipe book holds the recipes that you can add to menus. To open it, click
**Recipes** at the top of the meal plan. To go back, click **Meal plan**.

A recipe is a name. Names are unique, ignoring case and accents, so `Café` and
`cafe` are the same name.

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
```

In the `## Project structure` tree, add after the `recipe-search.js` line:

```none
  recipes.html # Recipe book page.
  recipes.js # Recipe book page logic.
```

- [ ] **Step 8: Check the page by hand**

Run `mkdir -p ~/meals-check && DATA_DIR=~/meals-check npm start`, and open
`http://localhost:3000/recipes.html` on desktop. Check:

1. The page shows `No recipes yet. Add your first one above.`
1. Adding `Café`, `Soup`, and `Green salad` lists them from A to Z, and focus
   stays in **New recipe**.
1. Adding `  cafe ` shows `"Café" already exists.`
1. **Archive** on `Café` moves it under **Archived (1)**. Adding `CAFE` shows
   `"Café" is archived.` with **Restore it**, which restores it.
1. **Rename** on `Soup`, type `Tomato soup`, and press `Enter`: the row shows
   the new name, in its sorted place.
1. **Rename** on `Green salad`, type `x`, and click in **Search**: the field
   stays open with `x`. Press **Cancel**: the old name comes back.
1. Typing `sal` in **Search** shows only `Green salad`. Typing `zzz` shows
   `No recipes match "zzz".`
1. With the server stopped, **Add** shows
   `Couldn't add the recipe. Try again.` and keeps the text.

Stop the server and run `rm -r ~/meals-check`.

- [ ] **Step 9: Check and commit**

Run: `npm run format && npm run lint && npm test`
Expected: all pass.

```bash
git add README.md public/recipes.html public/recipes.js public/styles.css test/api.test.js
git commit -m "feat(ui): add the recipe book page"
```

---

### Task 11: Manual test plan and final check

**Files:**

- Modify: `docs/manual-test-plan.md` (whole file)

**Interfaces:**

- Consumes: everything above.
- Produces: the manual test plan for this version.

- [ ] **Step 1: Rewrite the manual test plan**

Replace `docs/manual-test-plan.md` with:

````markdown
# Manual test plan

This test plan checks the app in real browsers: the grid, the slot editor,
saves, the week bar, the week in the URL, dates on days, the today marker, and
the recipe book. The automated tests (`npm test`) cover the server, the date,
menu, recipe name, and HTTP helpers, and the save logic. This plan covers what
only a person with a browser can check. Run it before you merge a change to
the user interface.

Each test has an ID, such as `6.3`. To report a failure, give the test ID and
what you saw.

## Before you begin

You need the following:

- A desktop browser, such as Firefox or Chrome. If you have a Mac, also use
  Safari.
- A phone on the same network as the computer, with Safari on iOS or Chrome on
  Android.
- The version of the app that you want to test, checked out.

In this plan, `MONDAY` stands for the date of the current week's Monday,
formatted as `YYYY-MM-DD`, for example `2026-09-21`. `NEXT_MONDAY` is the
Monday of the following week. Tests that say "desktop" use a window that is
768 px wide or wider. Tests that say "mobile" use the real phone. To *edit a
slot* means to click it, add a recipe or change servings in the editor, and
click **Done**.

Sections 1 to 8 are required, except tests `7.4` and `7.5`, which are
optional. Sections 9 and 10 are optional.

## Set up a test server

The test server uses a copy of your data, so the tests don't change your real
meal plan or recipe book. To set up the test server, do the following:

1. If a server is running on port `3000`, stop it. In its terminal, press
   `Control+C`.
1. Copy your data to a test directory. If `data/` doesn't exist yet, the copy
   is empty, and the tests start from an empty meal plan.

   ```bash
   mkdir -p ~/meals-test && cp -r data/. ~/meals-test/ 2>/dev/null
   ```

1. Start the test server on the default port, `3000`, so that the phone can
   reach it:

   ```bash
   DATA_DIR=~/meals-test npm start
   ```

1. In a second terminal, add the test recipes. A recipe that already exists
   answers with an error, which you can ignore.

   ```bash
   for name in "Gnocchi carbonara" "Green salad" "Lentil soup" "Omelette" "Russian salad" \
     "<b>Bold</b> soup" "Supercalifragilisticexpialidocious-casserole-with-a-very-long-name"; do
     curl -s -X POST -H 'Content-Type: application/json' -d "{\"name\":\"$name\"}" \
       http://localhost:3000/api/recipes; echo
   done
   ```

Keep the server's terminal open. Several tests ask you to stop the server with
`Control+C` and start it again with the same command.

## 1. Week navigation on desktop

| ID  | Step | Expected result |
|-----|------|-----------------|
| 1.1 | Open `http://localhost:3000` with no hash. | The address ends in `#MONDAY`, and the range shows the current week, for example `Sep 21 – 27, 2026`. |
| 1.2 | Click `›`, and then click `‹`. | The range and the hash change to the next week, and then back to the current week. |
| 1.3 | In the next week, edit a slot: add `Lentil soup`. Click `‹`. | The recipe doesn't appear in the current week. When you click `›` again, the slot shows `Lentil soup × 1`. |
| 1.4 | In the next week, reload the page. | The page still shows the next week. |
| 1.5 | Click `›` five times as fast as you can. | The range, the hash, and the grid all show the same week. No menu appears in the wrong week. |
| 1.6 | Go to `http://localhost:3000/#2026-12-28`. | The range shows `Dec 28, 2026 – Jan 3, 2027`. |
| 1.7 | Click **Today**. | The page shows the current week. |
| 1.8 | Open a new tab and go to `http://localhost:3000`. Click `›` twice, and then click the browser's **Back** button. | The browser goes back to the new tab page. It doesn't step through weeks. Typing a hash by hand, as in `1.6`, does add a history entry. |

## 2. Week in the URL

| ID  | Step | Expected result |
|-----|------|-----------------|
| 2.1 | Change the hash to `#NEXT_MONDAY` by hand. | The page shows the next week. |
| 2.2 | Change the hash to `#hello`, then to a Tuesday such as `#2026-09-22`, then to `#2026-02-30`. | Each time, the hash changes back to the displayed week, and nothing else changes. |
| 2.3 | In a new tab, go to `http://localhost:3000/#hello`. | The page shows the current week, and the hash changes to `#MONDAY`. |

## 3. Dates and today marker

| ID  | Step | Expected result |
|-----|------|-----------------|
| 3.1 | On desktop, show the current week. | The day headers read like `Monday 21` through `Sunday 27`. Only today's header is green, and today's column has a light green tint. |
| 3.2 | On desktop, show the next week. | No column is marked. The day headers show the dates of that week. |
| 3.3 | On mobile, show the current week. | Each day button shows a letter over a number. Today's button has a green outline. When today is selected, its button is filled green with a white inner ring. |
| 3.4 | On mobile, select another day. | The green outline stays on today, and the green fill moves to the selected day. |

## 4. Mobile

| ID  | Step | Expected result |
|-----|------|-----------------|
| 4.1 | On the phone, go to `http://IP_ADDRESS:3000`, where `IP_ADDRESS` is the computer's address. | The page shows the current week with today selected. Each slot shows its meal name over its menu or `+ Add`. |
| 4.2 | Select Thursday and tap `›`. | Thursday of the next week is selected. |
| 4.3 | Tap **Today**. | The page shows the current week with today selected. |
| 4.4 | Go to the week of December 28, 2026. | The range `Dec 28, 2026 – Jan 3, 2027` fits on one line, and the page doesn't scroll sideways. |
| 4.5 | Tap `›` several times, very fast. | The page changes weeks and doesn't zoom. It ends on one week, and the buttons still work. |
| 4.6 | Scroll down the page. | The day bar stays at the top. The week bar scrolls away. |
| 4.7 | Tap a slot. | The editor fills the screen, and the keyboard doesn't open. |
| 4.8 | Tap **Add recipe**. | The keyboard opens, and the page doesn't zoom. |
| 4.9 | Add a recipe, switch to another app, and come back. | The editor is still open with the recipe you added. Tap **Cancel**. |
| 4.10 | Optional, on Android. Open a slot, add a recipe, and use the system **Back** gesture or button. | The editor closes without saving, and the slot doesn't change. |

## 5. Slot editor

Run these tests on desktop.

| ID  | Step | Expected result |
|-----|------|-----------------|
| 5.1 | Click an empty slot, which shows `+ Add`. | The editor opens. Its title reads like `Monday, September 21 · Lunch`. The list shows the test recipes from A to Z. |
| 5.2 | Type `SOUP`. Then type `omelétte`, with an accent. | `SOUP` shows `<b>Bold</b> soup` and `Lentil soup`. `omelétte` shows `Omelette`. |
| 5.3 | Clear the field, type `salad`, press `↓`, and press `Enter`. | `Russian salad` appears in the menu with `1`. The field clears, and the list no longer offers `Russian salad`. |
| 5.4 | Click `Green salad` in the list. | `Green salad` appears below `Russian salad`, with `1`. |
| 5.5 | On `Green salad`, click `+` three times and `−` once. | The servings read `1.5`, `2`, `2.5`, and then `2`. |
| 5.6 | On `Russian salad`, click `−` once. | The servings read `0.5`. `−` is disabled, and focus moves to `+`. |
| 5.7 | Click **Done**. | The editor closes. The slot shows `Russian salad × 0.5` and `Green salad × 2`, and a check mark. The slot has focus. |
| 5.8 | Open the slot again, click **Remove** on `Russian salad`, and click **Cancel**. | The slot doesn't change, and no save icon appears. |
| 5.9 | Open the slot, click `+`, and press `Escape`. | Same as `5.8`. |
| 5.10 | Open the slot, type `sal`, and press `Escape`. Press `Escape` again. | The first `Escape` clears the field, and the editor stays open. The second closes the editor. |
| 5.11 | Open the slot and, without changing anything, click the dark area outside the editor. | The editor closes. |
| 5.12 | Open the slot, click `+`, and click outside the editor. | The editor stays open with the change. Click **Cancel**. |
| 5.13 | Open the slot and type `xyz`. | The list disappears, and `No recipes found. Add them on the Recipes page.` appears. |
| 5.14 | Add `<b>Bold</b> soup` to a slot and click **Done**. | The slot and the editor show the name with the tags as literal text, not in bold. |
| 5.15 | Add `Supercalifragilisticexpialidocious-casserole-with-a-very-long-name` to a slot and click **Done**. Repeat on mobile. | The name wraps inside the slot and inside the editor. The page doesn't scroll sideways. |
| 5.16 | Open a slot, change the hash by hand to `#NEXT_MONDAY`. | The hash changes back, the editor stays open, and the week doesn't change. |
| 5.17 | Open a slot, add a recipe, and reload the page. | The browser asks whether to leave. Click **Cancel** or **Stay**: the editor still has the recipe. |
| 5.18 | In the editor from `5.17`, click **Cancel**, and reload the page. | The page reloads without asking. |
| 5.19 | Open a slot and press `Tab` repeatedly. | Focus moves through the editor's controls and never reaches the page behind it. |
| 5.20 | Optional. Run the command after this table to add 20 recipes, reload, and add all 20 to one slot. | After the 20th, **Add recipe** is disabled and reads `A menu holds up to 20 recipes.` Focus moves to **Done**. |

The command for `5.20`:

```bash
for index in $(seq 1 20); do
  curl -s -X POST -H 'Content-Type: application/json' -d "{\"name\":\"Filler $index\"}" \
    http://localhost:3000/api/recipes > /dev/null
done
```

## 6. Saves and unsaved changes

These tests stop and start the test server. Run them on desktop.

| ID  | Step | Expected result |
|-----|------|-----------------|
| 6.1 | Edit a slot and click `›` right after **Done**. | The page changes weeks. When you go back, the slot has the change. You might not see the check mark, because the new week appears as soon as the save succeeds. |
| 6.2 | Stop the server. Edit a slot. | The slot shows the change and a red cross. |
| 6.3 | Click the slot from `6.2`. | The editor shows the change that wasn't saved, not the saved menu. Click **Cancel**. |
| 6.4 | Click `›`. | The app asks `Some changes in this week couldn't be saved. Leave anyway and discard them?` |
| 6.5 | Click **Cancel**. | The page stays on the same week, and the slot keeps the change and the red cross. |
| 6.6 | Start the server, and click the red cross. | The slot is saved. Clicking `›` changes weeks without the question. |
| 6.7 | Click `‹`. Stop the server. Edit a slot that you didn't use in `6.2`, and click `›`. When the question appears, click **OK**. | The range changes to the next week, and the page shows `Couldn't load the meal plan.` |
| 6.8 | Start the server. Go back to the browser window and click **Retry**. Then click `‹`. | **Retry** loads the next week without the question. In the previous week, the slot from `6.7` doesn't have the discarded change. |
| 6.9 | Stop the server. Click `›` to get `Couldn't load the meal plan.` again, and then click `‹` and `›`. Start the server and click **Retry**. | While the server is stopped, the range and the hash change, and the question doesn't appear. **Retry** loads the week in the range. |

## 7. Saves when the page is hidden

When you reload, close, or hide the page, the app sends again every slot whose
save is pending or failed. It never sends the changes in an open editor.
Tests `7.4` and `7.5` are optional. They pause the server, which makes a
request wait with no answer until the app gives up after 5 seconds. In those
tests, answer the question with **Cancel** only: the paused server receives
the request later and might still save it, so **OK** can't discard it.

| ID  | Step | Expected result |
|-----|------|-----------------|
| 7.1 | On desktop, stop the server and edit a slot, so that it shows a red cross. Start the server, and reload the page. | After the reload, the slot has the change. |
| 7.2 | Stop the server and edit a slot. Start the server, close the tab, and open the app again. | The slot has the change. |
| 7.3 | On mobile, stop the server and edit a slot. Start the server, switch to another app, and come back. | The slot is saved and shows no red cross. |
| 7.4 | Optional. In the server's terminal, press `Control+Z` to pause the server. On desktop, edit a slot and click `›` right after **Done**. | After about 5 seconds, the slot shows a red cross and the question appears. Click **Cancel**. In the terminal, run `fg` to resume the server, and click the red cross: the slot is saved. |
| 7.5 | Optional. Pause the server with `Control+Z`. On mobile, edit a slot, switch to another app, and come back. Tap `›`. | Same as `7.4`. |

## 8. Recipe book

Run these tests on desktop unless a test says otherwise.

| ID  | Step | Expected result |
|-----|------|-----------------|
| 8.1 | On the meal plan, click **Recipes**. | The recipe book opens with the test recipes from A to Z, and no **Archived** section. |
| 8.2 | In **New recipe**, type `Café` and press `Enter`. | `Café` appears in its sorted place. The field clears and keeps focus. |
| 8.3 | Click **Archive** on `Café`. Then add `  cafe `. | `Café` moves under **Archived (1)**. Adding shows `"Café" is archived.` with **Restore it**. |
| 8.4 | Click **Restore it**. | `Café` is back in the main list, the message disappears, and the field is empty. |
| 8.5 | Add `GREEN SALAD`. | The page shows `"Green salad" already exists.`, and the text stays in the field. Press `Escape`: the field and the message clear. |
| 8.6 | Click **Rename** on `Lentil soup`, type `Red lentil soup`, and press `Enter`. | The row shows `Red lentil soup` in its sorted place, and its **Rename** button has focus. |
| 8.7 | Go to the meal plan, show the next week, and look at the slot from `1.3`. | It shows `Red lentil soup × 1`. |
| 8.8 | Click **Rename** on `Omelette`, and click in **Search** without typing. | The rename field closes, and the name stays `Omelette`. |
| 8.9 | Click **Rename** on `Omelette`, type `x`, and click in **Search**. | The rename field stays open with `x`. |
| 8.10 | Click **Cancel** in the row from `8.9`. | The field closes, the name stays `Omelette`, and nothing is saved. |
| 8.11 | Click **Rename** on `Omelette`, type `Green salad`, and click **Save**. | The field stays open, with `"Green salad" already exists.` below the row. Press `Escape`: the field closes. |
| 8.12 | Type `sal` in **Search**. Then type `zzz`. | `sal` shows only the salads. `zzz` shows `No recipes match "zzz".` Clear the search. |
| 8.13 | Archive `Green salad`, which the slot from `5.7` uses. Go to the meal plan. | The slot still shows `Green salad × 2`. In its editor, the list doesn't offer `Green salad`, and `+` on it followed by **Done** saves without a red cross. |
| 8.14 | Stop the server. Add a recipe, rename a recipe, and archive a recipe. | Each shows its `Couldn't … Try again.` message, and nothing changes. |
| 8.15 | Keep the server stopped and reload the recipe book. Start the server and click **Retry**. | The page shows `Couldn't load the recipes.`, and **Retry** loads the recipe book. |
| 8.16 | On mobile, open the recipe book, and tap **New recipe**. | The keyboard opens, the page doesn't zoom, and the page doesn't scroll sideways. |

## 9. Keyboard and screen readers (optional)

| ID  | Step | Expected result |
|-----|------|-----------------|
| 9.1 | On desktop, press `Tab` until `›` has focus, and press `Enter` several times. | Each press shows the next week, and focus stays on `›`. |
| 9.2 | Stop the server, press `Tab` until `›` has focus, and press `Enter`. Press `Tab` until **Retry** has focus, and press `Enter`. | **Retry** keeps focus when the load fails again. Start the server afterward. |
| 9.3 | With a screen reader, such as VoiceOver or NVDA, change weeks. | The screen reader announces the new range. The buttons read `Previous week`, `Next week`, and `Today`. |
| 9.4 | On mobile, with VoiceOver or TalkBack, move through the day bar. | The day buttons read like `Monday, September 21`. |
| 9.5 | With a screen reader, move to a slot and open it. | The slot reads like `Monday, Lunch: Green salad × 2`, or `Monday, Lunch: empty`. The editor announces its title. The stepper buttons read like `Increase servings of Green salad`, and the servings are announced when they change. |
| 9.6 | In the editor, type in **Add recipe** and press `↓`. | The screen reader announces the highlighted recipe. |

## 10. Day and week changes (optional)

These tests change the computer's clock. Set the clock back when you finish.
Don't run `10.1` and `10.2` on a Sunday: the next day starts a new week, so
the marker leaves the displayed week instead of moving.

| ID  | Step | Expected result |
|-----|------|-----------------|
| 10.1 | With the page open on the current week, set the clock to the next day. Switch to another tab and back. | The today marker moves to the new day. |
| 10.2 | Make the browser window narrower than 768 px. With the clock still set to the next day and the page visible, click **Today**. | The new day is selected in the day bar, and the marker is on the new day. |
| 10.3 | Set the clock to the next Monday, and click **Today**. | The page shows the week of `NEXT_MONDAY`. |

## Clean up

To remove the test server and its data, do the following:

1. In the test server's terminal, press `Control+C`.
1. Delete the test directory:

   ```bash
   rm -r ~/meals-test
   ```

Your real data in `data/` is unchanged.
````

- [ ] **Step 2: Check the vocabulary**

Run: `grep -rn -i "\bcell\|\bdish\|textarea\|free-text list" README.md docs/manual-test-plan.md public server test`
Expected: no output. `docs/glossary.md` and `AGENTS.md` may mention *cell* and
*dish* as words to avoid, so they aren't in the search.

- [ ] **Step 3: Run the manual test plan**

Run every required test in `docs/manual-test-plan.md` in Chrome or Firefox on
desktop and on a phone. Fix any failure with a failing automated test first
when the behavior can be tested in Node.js, and by hand otherwise. Record the
browsers and the result in the pull request description.

- [ ] **Step 4: Check and commit**

Run: `npm run format && npm run lint && npm test`
Expected: all pass.

```bash
git add docs/manual-test-plan.md
git commit -m "docs: update the manual test plan for menus and recipes"
```
