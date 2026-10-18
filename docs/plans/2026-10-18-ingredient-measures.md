# Ingredient measures implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each ingredient gets named measures, such as `medium` = 150 g,
recipes measure ingredients in the unit or in a measure, the shopping list
converts everything to the unit with a breakdown by measure, and an
ingredient that recipes use can change its unit.

**Architecture:** Measures live inside each ingredient in
`ingredients.json`, and recipe lines point to them by `measureId`. The
ingredient store asks the recipe store how an ingredient is used, and drives
the three-step unit change through it, inside the shared write queue. The
browser computes the shopping list in integers, as today, and formats totals
in `kg` or `l` from 1000 on.

**Tech stack:** Node.js 22 with Express 5, plain ES modules in the browser,
`node:test` with `supertest` and `happy-dom`, and Biome.

**Spec:** `docs/plans/2026-10-18-ingredient-measures-design.md`. Read it
before any task: the plan argues from it and doesn't repeat it.

## Global constraints

- Every artifact is in US English: code, comments, user interface text,
  tests, and docs.
- Use the glossary terms: *measure*, *unit*, *quantity*, *ingredient*, and
  *shopping list*. When a task adds or changes a concept, it changes
  `docs/glossary.md` in the same commit.
- Commit messages follow Conventional Commits, with no attribution trailers.
- Before every commit, `npm run lint` and `npm test` pass, and a green
  `npm test` prints no stray logs, warnings, or stack traces.
- Test-driven development: write the failing test, watch it fail, and then
  make it pass.
- Measure amounts, quantities, and conversion numbers: from `0.01` to
  `10000`, with at most two decimals.
- At most `20` measures per ingredient. Measure names follow the name rules
  (`validName` in `server/names.js`), and are unique within the ingredient by
  name key.
- Storage stays in `DATA_DIR/v2/`. Existing files need no migration: a
  missing `measures` reads as `[]`, and a line without `measureId` is in the
  unit.
- Every write and every check that reads another file runs inside the shared
  queue.

## Review focus

These are the inputs that a person meets and no other test covers. Each one
has a test in the task that owns the code.

1. **Renaming a measure that recipes use:** the recipes follow the new name.
   The editor must send the measure's `id`, never a new measure. Task 6 tests
   it.
2. **A decimal comma in an amount or a conversion**, such as `1,09`: it
   parses like a recipe quantity. Tasks 6 and 7 test it.
3. **`Medium` and `medium` in the same ingredient:** the server and the
   editor reject the second one by name key. Tasks 1 and 6 test it.
4. **A measure that only an archived recipe uses:** you still can't remove
   it. Task 2 tests it.
5. **A unit change that fails after its first write:** a retry succeeds
   without `measureName`, and no recipe changes meaning. Task 3 tests it.

---

### Task 1: Measures in the ingredient catalog

**Files:**
- Create: `server/quantities.js`
- Modify: `docs/glossary.md`, `server/ingredients.js`, `server/recipes.js`,
  `server/stores.js`
- Test: `test/ingredients.test.js`

**Interfaces:**
- Produces, in `server/quantities.js`: `MIN_QUANTITY`, `MAX_QUANTITY`, and
  `cleanQuantity(value) → number | undefined`, moved unchanged from
  `server/recipes.js`, which imports them from here now.
- Produces, in `server/ingredients.js`: `MAX_MEASURES = 20`. An ingredient is
  `{ id, name, unit, measures: [{ id, name, amount }], archived }`.
- Produces: `createIngredients({ dataDir, enqueue, usageOf })` replaces the
  `isInUse` parameter. `usageOf(ingredientId)` resolves to
  `{ inUnit: boolean, measureIds: Set<string> }`. Task 2 provides the real
  one. Until then, `server/stores.js` passes a stub that builds it from
  `recipes.usesIngredient`: `{ inUnit: used, measureIds: new Set() }`.

- [ ] **Step 1: Write the failing tests** in `test/ingredients.test.js`. The
  stub becomes `usageOf: async (id) => usage.get(id) ?? { inUnit: false, measureIds: new Set() }`,
  where `usage` is a `Map` that each test fills. Tests:
  - `create stores measures with new UUIDs, cleaned names, and rounded amounts`:
    `{ name: "Onion", unit: "g", measures: [{ name: " medium ", amount: 150 }] }`
    gives `measures: [{ id: <UUID>, name: "medium", amount: 150 }]`.
  - `create without measures stores an empty list`.
  - `list reads an ingredient without measures as an empty list`, from a
    hand-written file.
  - `list drops measures with a bad id, name, or amount, a repeated id, or a repeated name key`.
  - `update replaces the measures, keeping sent IDs and giving new ones IDs`.
  - `update rejects a measure ID that isn't the ingredient's`
    (`ValidationError`).
  - `update rejects two measures whose names share a name key`: `Mediana`
    and `mediana` (`ValidationError`). This is review focus 3.
  - `update rejects more than 20 measures` (`ValidationError`), and accepts
    exactly 20.
  - `update rejects an amount outside 0.01 to 10000 or with three decimals`.
  - `create and update reject measure entries with other keys, and create rejects an id`.
  - `update that leaves out a measure a recipe uses throws a ConflictError naming it`:
    the message includes `"medium"`. The file doesn't change.
  - `update that drops a measure and adds a new one with the same name still conflicts when recipes use the old one`.
  - `update can send name, unit, and measures together`.
  - The existing unit-in-use tests now fill `usage` with
    `{ inUnit: true, measureIds: new Set() }`, and keep expecting
    `ConflictError`. Task 3 changes this rule.

- [ ] **Step 2: Run them and watch them fail.**
  Run: `node --test test/ingredients.test.js`.
  Expected: the new tests fail, because there's no `measures` field.

- [ ] **Step 3: Implement.** In `server/ingredients.js`:
  - `validMeasures(raw, existing)`: an array of at most `MAX_MEASURES`. Each
    entry has exactly `name` and `amount`, or `id`, `name`, and `amount`. An
    `id` must be in `existing`, which is `[]` on create. Names go through
    `validName`, and amounts through `cleanQuantity`. Name keys and IDs are
    unique. New entries get `randomUUID()`. Error messages point at the entry,
    as `validIngredients` does: `measures[2].amount must be …`.
  - `validNewIngredient` accepts an optional `measures`. `validChanges`
    accepts any non-empty combination of `name`, `unit`, and `measures`.
    Check the IDs of `measures` inside the queue, against the stored
    ingredient.
  - `normalize` keeps only the well-formed measures, by the same rules,
    dropping the bad ones.
  - In `update`, inside the queue: the removed IDs are the stored IDs that
    the new list leaves out. If any is in `(await usageOf(id)).measureIds`,
    throw
    `ConflictError(`"${measure.name}" is used in recipes. To remove it, change those recipes first.`)`.
    The unit rule stays: a new unit while `usage.inUnit` or
    `usage.measureIds.size > 0` throws the existing `ConflictError`.

  Add **Measure** to `docs/glossary.md`, and update **Ingredient** and
  **Unit**, with the text from the design's glossary.

- [ ] **Step 4: Run the tests and watch them pass.**
  Run: `npm test`.
  Expected: all pass, including `test/api.test.js` through the stub in
  `server/stores.js`.

- [ ] **Step 5: Commit.**
  `git commit -m "feat(server): add measures to ingredients"`

### Task 2: Recipe lines in a measure

**Files:**
- Modify: `docs/glossary.md`, `server/recipes.js`, `server/stores.js`
- Test: `test/recipes.test.js`, `test/api.test.js`

**Interfaces:**
- Consumes: `ingredients.list()` with `measures` (Task 1).
- Produces: a recipe line is `{ ingredientId, quantity }` or
  `{ ingredientId, quantity, measureId }`. The key is absent for a line in
  the unit, never `null`.
- Produces: `recipes.usageOf(ingredientId) → Promise<{ inUnit, measureIds }>`.
  It reads every recipe, active and archived, and never waits for the queue.
  It replaces `usesIngredient`.
- Produces: `recipes.moveUnitLinesToMeasure(ingredientId, measureId) → Promise<number>`.
  It points every line of that ingredient without `measureId` to
  `measureId`, writes `recipes.json` once if any line changed, and returns
  how many lines changed. It never enqueues: the caller is already inside the
  queue. Its doc comment says so.

- [ ] **Step 1: Write the failing tests.** In `test/recipes.test.js`:
  - `create and update store measureId, and keep lines without it in the unit`.
  - `a measureId that isn't a measure of its ingredient is rejected`
    (`ValidationError`, `Unknown measure: ID`).
  - `an ingredient still appears once, even in two different measures`
    (`ValidationError`).
  - `a line with measureId and other extra keys is rejected`.
  - `list drops a line whose measureId the catalog doesn't have`, from a
    hand-written `recipes.json`, and keeps it in the file.
  - `a stored line keeps its measureId only when it's a string`.
  - `usageOf reports lines in the unit and the measures used, archived recipes included`.
    An archived recipe that alone uses `medium` puts it in `measureIds`.
    This is review focus 4.
  - `moveUnitLinesToMeasure points only that ingredient's unit lines to the measure, in every recipe`.

  In `test/api.test.js`:
  - `PATCH /api/ingredients/ID removing a measure that an archived recipe uses returns 409`,
    end to end through the real wiring.
  - `POST /api/recipes with a measureId returns it in GET /api/recipes`.
  - `POST /api/ingredients with measures returns them with IDs`.

- [ ] **Step 2: Run them and watch them fail.**
  Run: `node --test test/recipes.test.js test/api.test.js`.

- [ ] **Step 3: Implement** in `server/recipes.js`:
  - `validIngredients` accepts the key sets `ingredientId,quantity` and
    `ingredientId,measureId,quantity`. `measureId` must be a string.
  - `normalizeIngredients` keeps a string `measureId`.
  - `knownIngredientIds()` becomes `knownMeasures()`, a
    `Map<ingredientId, Set<measureId>>` built from `ingredients.list()`.
    `checkIngredientsExist` and `withKnownIngredients` also check the
    measure.

  In `server/stores.js`, pass `usageOf: (id) => recipes.usageOf(id)`, and
  drop the stub from Task 1.

  Update **Quantity** in `docs/glossary.md`.

- [ ] **Step 4: Run the tests and watch them pass.** Run `npm test`, which
  must pass with no failures.

- [ ] **Step 5: Commit.**
  `git commit -m "feat(server): measure recipe ingredients in a measure"`

### Task 3: Change the unit with a conversion

**Files:**
- Modify: `server/ingredients.js`, `server/stores.js`
- Test: `test/ingredients.test.js`, `test/api.test.js`

**Interfaces:**
- Consumes: `usageOf` and `moveUnitLinesToMeasure` (Task 2).
  `createIngredients` gains the parameter `moveUnitLinesToMeasure`, which
  `server/stores.js` wires lazily, like `usageOf`.
- Produces: `PATCH` accepts
  `conversion: { from, to, measureName? }`, with the rules in the design's
  "Changing the unit" section.

- [ ] **Step 1: Write the failing tests** in `test/ingredients.test.js`. The
  stub for `moveUnitLinesToMeasure` records its calls. Tests:
  - `a unit change with no measures and no unit lines needs no conversion`:
    a plain `{ unit: "g" }` succeeds when the ingredient has no measures and
    `usage` reports no lines.
  - `a unit change on an ingredient with measures needs a conversion`
    (`ValidationError`). The same holds when `usage.inUnit` is true. This
    replaces the old in-use `ConflictError` tests.
  - `a conversion without a unit change is rejected`, and so is a conversion
    when none is needed.
  - `a conversion together with measures is rejected`.
  - `pcs to g with 1 = 120 multiplies measures and turns unit lines into a measure`:
    with measures `[{ net, 4 }]` and `inUnit: true`, the result is
    `unit: "g"`, measures `[{ net, 480 }, { piece, 120 }]`, and one call to
    `moveUnitLinesToMeasure(id, <piece id>)`.
  - `150 g = 1 pcs converts with the factor to ÷ from`: `medium` of `150 g`
    becomes `1 pcs`.
  - `measureName is required only when a recipe uses the unit`: missing
    gives `ValidationError`, and it's ignored when `inUnit` is false.
  - `measureName that matches an existing measure by name key is rejected`.
  - `a converted amount outside the limits rejects the change and writes nothing`:
    `g` to `pcs` with `150 = 1` and `inUnit: true`, where the new `g` measure
    would be `0.0067 pcs`. The check uses the amount before rounding, which
    would otherwise round it up to the valid `0.01`. The file is unchanged.
  - `the three steps keep every recipe's meaning when step 2 fails, and a retry needs no measureName`:
    `moveUnitLinesToMeasure` rejects once. The ingredient keeps its old unit,
    with an extra measure of amount `1`. Then `usage` reports
    `inUnit: false` and the measure in use, and a retry with
    `{ unit, conversion: { from, to } }` succeeds. This is review focus 5.

  In `test/api.test.js`, test
  `PATCH unit with a conversion moves recipe lines to the new measure`, end
  to end, and check `GET /api/recipes`.

- [ ] **Step 2: Run them and watch them fail.**
  Run: `node --test test/ingredients.test.js test/api.test.js`.

- [ ] **Step 3: Implement** in `server/ingredients.js`. Use
  `factor = to / from` and `round2(x) = Math.round(x * 100) / 100`. Run all
  checks before the first write. Then follow the three steps in the design's
  "Writing a unit change" section:
  1. If `usage.inUnit`, append the new measure with amount `1`, and write.
  2. Call `moveUnitLinesToMeasure`.
  3. Set the unit and any new name, multiply every amount by the factor, and
     write.

  Check each converted amount against the limits before rounding it. An
  out-of-limits amount names the measure in its message:
  ``"${name}" would be ${amount} ${unit}, outside 0.01 to 10000.``

- [ ] **Step 4: Run the tests and watch them pass.** Run `npm test`, which
  must pass with no failures.

- [ ] **Step 5: Commit.**
  `git commit -m "feat(server): change the unit of an ingredient in use with a conversion"`

### Task 4: Shopping list with measures, kilograms, and liters

**Files:**
- Modify: `docs/glossary.md`, `public/quantities.js`,
  `public/shopping-dialog.js`, `public/shopping-list.js`
- Test: `test/meal-plan-page.test.js`, `test/quantities.test.js`,
  `test/shopping-list.test.js`

**Interfaces:**
- Produces, in `public/quantities.js`: `scaledAmount(quantity, servings, amount = 1)`
  replaces `twoHundredths`. It returns
  `Math.round(quantity * 100) * Math.round(servings * 2) * Math.round(amount * 100)`,
  in 1/20000 of the unit. `wholeUnits(scaled)` now divides by `20000`.
  `MAX_MEASURES = 20` mirrors the server.
- Produces, in `public/shopping-list.js`: each line is
  `{ ingredientId, name, unit, total, breakdown }`. `total` is whole units,
  rounded up. `breakdown` is `[]` when no line of the week uses a measure, or
  else is `[{ measureId, name, quantity }]`, with the unit part first
  (`measureId: null`, `name: unit`, `quantity` in whole units rounded up)
  and then the measures in the ingredient's order (`quantity` = Σ quantity ×
  servings, rounded to two decimals, not up). A line whose `measureId` isn't
  in the ingredient's measures is skipped.
- Produces: `formatTotal(total, unit) → string` and
  `lineAmount(line) → string`, the text that the dialog shows.

- [ ] **Step 1: Write the failing tests.** In `test/shopping-list.test.js`,
  the `ingredient()` helper gains `measures`, and `recipe()` accepts
  `[ingredientId, quantity, measureId]`. Tests:
  - `converts measures to the unit and sums them`, with the design's onion:
    `300 g` + `3 medium (150)` + `1.5 large (250)` = `1125`, and the breakdown
    `[{null, "g", 300}, {medium, 3}, {large, 1.5}]`.
  - `a week without measure lines has an empty breakdown`.
  - `a breakdown without a unit part starts with the first measure`.
  - `half servings give measure quantities with decimals`: `0.25 × 0.5`
    shows `0.13`.
  - `skips a line whose measure isn't in the catalog`.
  - `formatTotal shows g and ml below 1000, and kg and l from 1000, rounded up to tenths`:
    `999 g`, `1000 → 1 kg`, `1300 → 1.3 kg`, `1320 → 1.4 kg`,
    `1001 ml → 1.1 l`, and `5 pcs` stays.
  - `lineAmount`: `1.2 kg (300 g, 3 medium, 1.5 large)` and
    `57 ml (15 ml, 2 dash, 20 g)`.

  In `test/quantities.test.js`, rewrite the `twoHundredths` cases for
  `scaledAmount`, keeping the exact cases: `4.4 × 12.5 → 55`,
  `0.56 × 12.5 → 7`, and `0.1 + 2.7 + 0.2 → 3`.

  In `test/meal-plan-page.test.js`, test
  `the shopping list shows kilograms and a measure breakdown`: one line reads
  `Onion` and `1.2 kg (300 g, 3 medium, 1.5 large)`.

- [ ] **Step 2: Run them and watch them fail.**
  Run: `node --test test/shopping-list.test.js test/quantities.test.js test/meal-plan-page.test.js`.

- [ ] **Step 3: Implement.** `formatTotal`: for `g` or `ml` and
  `total >= 1000`, it shows `Math.ceil(total / 100) / 10` with `kg` or `l`.
  Otherwise it shows `total` and the unit. `shopping-dialog.js` uses
  `lineAmount(line)` instead of `` `${total} ${unit}` ``.

  Update **Shopping list** in `docs/glossary.md`.

- [ ] **Step 4: Run the tests and watch them pass.** Run `npm test`, which
  must pass with no failures.

- [ ] **Step 5: Commit.**
  `git commit -m "feat(ui): convert measures and show kilograms and liters in the shopping list"`

### Task 5: New ingredient in the editor

**Files:**
- Modify: `public/ingredient-editor.js`, `public/ingredients.html`,
  `public/ingredients.js`
- Test: `test/ingredient-editor.test.js`, `test/ingredients-page.test.js`

**Interfaces:**
- Produces: `editor.open({ ingredient, usage, restoreFocus, onSaved })`.
  `ingredient` is `undefined` for a new one. `usage` is
  `{ recipes: number, inUnit: boolean, measures: Map<measureId, number> }`.
  `recipes` counts the recipes that use the ingredient, `inUnit` tells
  whether any line is in the unit, and `measures` counts the recipes per
  measure, archived recipes included.
- Produces, in `public/ingredients.js`: `countUsage(recipes)` returns a
  `Map<ingredientId, usage>`, and an unused ingredient gets
  `{ recipes: 0, inUnit: false, measures: new Map() }`.

- [ ] **Step 1: Write the failing tests.** In
  `test/ingredient-editor.test.js`, `openEditor()` passes `usage` instead of
  `usedIn`. Tests:
  - `a new ingredient opens titled New ingredient, empty, with Choose a unit, and focus in Name`.
  - `Done on a new ingredient without a unit shows Choose a unit. and sends nothing`.
  - `Done on a new ingredient sends POST with the name and the unit, then closes`.
  - `a 409 with an archived ingredient says to restore it from Archived`.

  In `test/ingredients-page.test.js`, the form tests (`adding …`,
  `Escape clears New ingredient`) become:
  - `New ingredient opens the editor, and a saved one appears in its sorted place with its Edit focused`.
  - `Cancel on a new ingredient returns focus to New ingredient`.

- [ ] **Step 2: Run them and watch them fail.**
  Run: `node --test test/ingredient-editor.test.js test/ingredients-page.test.js`.

- [ ] **Step 3: Implement.** `ingredients.html` replaces the form with
  `<button type="button" id="new-ingredient" class="primary new-entry-button">New ingredient</button>`,
  as `recipes.html` does. The editor's unit `<select>` gains
  `<option value="">Choose a unit</option>`. The editor sends `POST` for a
  new ingredient, and keeps disabling **Unit** when `usage.recipes > 0`
  until Task 7. The page loses `addIngredient`, `restoreFromForm`, and their
  helpers.

- [ ] **Step 4: Run the tests and watch them pass.** Run `npm test`, which
  must pass with no failures.

- [ ] **Step 5: Commit.**
  `git commit -m "feat(ui): add ingredients in the ingredient editor"`

### Task 6: Edit measures

**Files:**
- Modify: `public/ingredient-editor.js`, `public/ingredients.html`,
  `public/ingredients.js`, `public/styles.css`
- Test: `test/ingredient-editor.test.js`, `test/ingredients-page.test.js`

**Interfaces:**
- Consumes: `usage.measures` (Task 5), `parseQuantity` and `MAX_MEASURES`
  (`public/quantities.js`), and `nameKey` (`public/name-search.js`).
- Produces: markup inside the editor, after **Unit**:
  `<h3 class="dialog-subtitle">Measures</h3>`,
  `<ul class="measure-rows" aria-label="Measures"></ul>`, and
  `<button type="button" class="add-measure">Add measure</button>`. Each row
  is an `li.measure-row` holding `input.measure-name` (`aria-label`
  `Measure name`), `input.measure-amount` (`inputmode="decimal"`,
  `aria-label` `Amount of NAME in UNIT`), `span.unit`, and `button.remove`
  (`aria-label` `Remove NAME`). A row's errors go in `p.row-message`, and
  its use in `p.row-hint`.

- [ ] **Step 1: Write the failing tests** in `test/ingredient-editor.test.js`:
  - `opens with a row per measure, in order, with the unit after each amount`.
  - `Add measure adds an empty row and focuses its name; at 20 rows it's disabled`.
  - `changing the unit of a new ingredient updates the unit after each amount`.
  - `Remove is disabled on a measure that recipes use, with Used in 2 recipes.`
    (and `Used in 1 recipe.`).
  - `Done with an empty name or an invalid amount shows a message under its row and sends nothing`.
  - `Done with two names that share a name key shows "medium" is already a measure.`.
    This is review focus 3.
  - `an amount typed as 1,09 is sent as 1.09`. This is review focus 2.
  - `renaming a measure sends its id with the new name`: the body has
    `measures: [{ id: "m1", name: "mediana", amount: 150 }]`. This is review
    focus 1.
  - `Done sends measures only when they changed, new ones without id`.
  - `Enter in a measure field confirms, the same as Done`.
  - `hasChanges is true after editing, adding, or removing a measure`.

  In `test/ingredients-page.test.js`, test
  `a row shows the unit followed by the measure names`, which reads
  `g · medium, large`.

- [ ] **Step 2: Run them and watch them fail.**
  Run: `node --test test/ingredient-editor.test.js test/ingredients-page.test.js`.

- [ ] **Step 3: Implement.** The session keeps rows as
  `{ id?, name, amountText, message }`. Compare them with
  `ingredient.measures` in order, by `id`, the cleaned name, and the amount,
  to build the body and `hasChanges`. The amount message reads
  `Enter an amount from 0.01 to 10000, with up to two decimals.` The
  `details` of a row in `ingredients.js` renders `.entry-unit` with
  `` `${unit} · ${names.join(", ")}` `` when there are measures. Lay out
  measure rows with the existing `.ingredient-row` styles where they fit.

- [ ] **Step 4: Run the tests and watch them pass.** Run `npm test`, which
  must pass with no failures.

- [ ] **Step 5: Commit.**
  `git commit -m "feat(ui): edit the measures of an ingredient"`

### Task 7: Change the unit in the editor

**Files:**
- Modify: `public/ingredient-editor.js`, `public/ingredients.html`
- Test: `test/ingredient-editor.test.js`

**Interfaces:**
- Consumes: `usage.inUnit` (Task 5), the measure rows (Task 6), and the
  `conversion` API (Task 3).
- Produces: markup after **Unit**: `div.conversion[hidden]` holding
  `input.conversion-from` (`aria-label` `Amount in the old unit`),
  `span.conversion-from-unit`, `input.conversion-to` (`aria-label`
  `Amount in the new unit`), `span.conversion-to-unit`, and
  `label.conversion-measure[hidden]` with `input.conversion-measure-name`.
  Errors go in `p.conversion-message`. The old `.unit-hint` goes away.

- [ ] **Step 1: Write the failing tests:**
  - `Unit is enabled even when recipes use the ingredient`.
  - `picking another unit shows the conversion row only when there are measures or unit lines`.
  - `the conversion row starts at 1 and asks for the measure name only when recipes use the unit`,
    prefilled with the old unit's code.
  - `while the conversion row shows, measure rows are read-only previews in the new unit`:
    `net` of `4 pcs`, with `1 = 120`, shows `480` and `g`.
  - `picking a unit that needs a conversion with unsaved measure changes keeps the old unit and explains why`:
    the unit goes back, and the message reads
    `Save your changes to the measures before you change the unit.`
  - `Done sends unit and conversion, without measures`:
    `{ unit: "g", conversion: { from: 1, to: 120, measureName: "piece" } }`.
  - `a conversion typed as 1,5 is sent as 1.5`. This is review focus 2.
  - `an invalid conversion number or an empty measure name shows a message and sends nothing`.
  - `going back to the old unit hides the conversion row and makes measure rows editable again`.
  - `a 400 from the server shows its message`.

- [ ] **Step 2: Run them and watch them fail.**
  Run: `node --test test/ingredient-editor.test.js`.

- [ ] **Step 3: Implement.** A conversion is needed when the editor edits an
  existing ingredient, the selected unit differs from the stored one, and
  `ingredient.measures.length > 0 || usage.inUnit`. A conversion number
  that isn't valid shows
  `Enter a number from 0.01 to 10000, with up to two decimals.` The preview
  amount is `Math.round(amount * to / from * 100) / 100` once both numbers
  parse, and the stored amount until then.

- [ ] **Step 4: Run the tests and watch them pass.** Run `npm test`, which
  must pass with no failures.

- [ ] **Step 5: Commit.**
  `git commit -m "feat(ui): change the unit of an ingredient with a conversion"`

### Task 8: Choose a measure in the recipe editor

**Files:**
- Modify: `public/recipe-editor.js`
- Test: `test/recipe-editor.test.js`

**Interfaces:**
- Consumes: ingredients with `measures`, and recipe lines with `measureId`.
- Produces: in each row, after the quantity field,
  `select.measure-field` (`aria-label` `Measure of NAME`). Its first option
  is `value=""`, with the unit as its text, followed by one option per
  measure, with the measure ID as its value and `NAME (AMOUNT UNIT)` as its
  text. An ingredient without measures keeps `span.unit`, as today.

- [ ] **Step 1: Write the failing tests:**
  - `a row offers the unit and then each measure, as medium (150 g)`.
  - `a new row starts on the unit`.
  - `an existing line opens on its measure`.
  - `Done sends measureId for a line in a measure and leaves it out for the unit`.
  - `changing only the measure counts as a change and is sent`.
  - `an ingredient without measures shows its unit as text`.

- [ ] **Step 2: Run them and watch them fail.**
  Run: `node --test test/recipe-editor.test.js`.

- [ ] **Step 3: Implement.** Rows gain `measureId`, which is `""` for the
  unit. `rowsOf`, `hasChanges`, `sameIngredients`, and `readIngredients`
  include it.

- [ ] **Step 4: Run the tests and watch them pass.** Run `npm test`, which
  must pass with no failures.

- [ ] **Step 5: Commit.**
  `git commit -m "feat(ui): measure recipe ingredients in a measure"`

### Task 9: Documentation

**Files:**
- Modify: `README.md`, `docs/deployment.md`, `docs/manual-test-plan.md`

- [ ] **Step 1: Update `README.md`:**
  - **View the shopping list:** the totals in `kg` and `l`, and the
    breakdown.
  - **Manage recipes:** the quantity in the unit or in a measure.
  - **Manage ingredients:** **New ingredient** opens the editor, how to add,
    rename, and remove measures, and how to change the unit with a
    conversion.
  - **Project structure:** `server/quantities.js`.
  - **API reference:** the ingredient shape with `measures`, `measures` and
    `conversion` in **Add an ingredient** and **Change an ingredient**, with
    their statuses, and `measureId` in recipe lines.

- [ ] **Step 2: Update `docs/deployment.md`.** In "Deploy a version by
  hand," state that deploying an older version by hand isn't supported once
  a newer version has saved data.

- [ ] **Step 3: Update `docs/manual-test-plan.md`.**
  - Rewrite section 9 for **New ingredient** in the editor, measure rows,
    and the conversion row. Include the `pcs` to `g` conversion of a used
    ingredient, and its recipes afterward.
  - Add to section 10 a week with measures, a total from 1000 g on, and its
    breakdown.
  - Add mobile checks: the layout of measure rows and the conversion row on
    a phone, and the decimal keyboard in amount fields.

- [ ] **Step 4: Check.** `npm run lint` and `npm test` must pass, and every
  term must match `docs/glossary.md`.

- [ ] **Step 5: Commit.**
  `git commit -m "docs: document ingredient measures"`
