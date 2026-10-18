# Ingredient measures design

Date: 2026-10-18

## Context and goal

Each ingredient has one unit: `g`, `ml`, or `pcs`. Every recipe measures the
ingredient in that unit, and the shopping list sums it in that unit.

Produce breaks this model. You buy carrots, onions, potatoes, peppers, and
tomatoes by weight, because buying 1.5 kg of carrots is easier than buying
27 medium ones and 8 large ones. But you cook with them by the piece, and
pieces come in sizes: 2 medium onions, 1 large pepper, a handful of cherry
tomatoes. Today, whoever creates the ingredient first decides how every
recipe measures it. If one person creates `Carrot` in `pcs`, nobody can write
a recipe with grams of carrot, and the unit can't change while recipes use
it.

**Goal:** a recipe measures an ingredient the way you cook with it, and the
shopping list still adds everything up the way you buy it. Each ingredient
keeps its unit, and gains measures: amounts with a name that you choose, such
as `medium`, `large`, or `handful`, each with its equivalent in the
ingredient's unit. Each recipe line uses the unit or one of the ingredient's
measures. The shopping list converts every line to the unit, sums it over the
week, and shows how much of it came from each measure.

You define the measures of each ingredient in the ingredient catalog, as
data. Measuring a new ingredient by the piece never needs a code change or a
release.

### Goals

- Two recipes can measure the same ingredient differently, one in grams and
  the other in medium pieces.
- Measures are free-form: any name, any number of them per ingredient, with
  an amount in the ingredient's unit.
- The shopping list shows one line per ingredient: the total in its unit,
  followed by a breakdown by measure when recipes use measures.
- You can change the unit of an ingredient that recipes use. Its recipes keep
  their meaning, because the old unit becomes a measure.

### Non-goals

- Bundled measures or weights. You enter every measure yourself.
- Measures shared by several ingredients, such as one `tablespoon` for every
  ingredient. Each ingredient has its own measures.
- Converting totals to packages, such as nets of 4 onions. The total and its
  breakdown give you what you need to decide in the shop.
- Plural forms of measure names. The app shows the name as you typed it.

### Anti-goals

The design fails, even if it works, if any of the following happens:

- A fixed list of sizes, such as small, medium, and large.
- Adding measures to an ingredient needs a code change or a release.
- An existing recipe changes what it means without you editing it. Changing
  a unit converts quantities so that they keep the same amount.

## Glossary

`docs/glossary.md` gains one term and updates four. The other terms keep
their meaning.

| Term | Definition |
|------|------------|
| Ingredient | Something you buy and use in recipes. The ingredient catalog holds it with a stable ID, a unique name, a unit, and its measures. In a recipe, it has a quantity in its unit or in one of its measures. |
| Measure | A named amount of one ingredient, such as `medium` or `handful`, with a stable ID and its amount in the ingredient's unit: a number from 0.01 to 10000 with at most two decimals. Its name is unique within the ingredient by name key. |
| Quantity | How much of an ingredient one serving of a recipe needs, in the ingredient's unit or in one of its measures: a number from 0.01 to 10000 with at most two decimals. |
| Shopping list | For the displayed week, each ingredient with the sum of quantity × servings over every menu item, converted to its unit and rounded up to a whole number. From 1000 `g` or `ml` on, the total shows in `kg` or `l`, rounded up to tenths. When recipes use measures, the line also shows how much came from each measure. |
| Unit | How an ingredient is measured and added up in the shopping list: `g`, `ml`, or `pcs`. |

## Decisions

| Topic | Decision |
|-------|----------|
| Where measures live | In the ingredient, as a list of `{ id, name, amount }`, edited in the ingredient editor. |
| Measure names | Free text with the name rules, unique within the ingredient by name key. A measure can have the name of a unit, such as `g` in an ingredient measured in `ml`, so oil can go in recipes by weight too. |
| How a recipe refers to a measure | By the measure's ID, so renaming a measure renames it in every recipe. |
| Changing a measure's amount | Allowed at any time. Every recipe that uses the measure follows it. |
| Removing a measure | Allowed only while no recipe, active or archived, uses it. |
| Changing the unit | Allowed at any time. When the ingredient has measures or a recipe uses its unit, you enter how the old unit and the new unit relate, such as `1 pcs = 120 g`. The server converts the measures, and turns the old unit into a measure for the recipes that use it. |
| Shopping list total | In the ingredient's unit, rounded up to a whole number, as today. From 1000 `g` or `ml` on, it shows in `kg` or `l`, rounded up to tenths. |
| Shopping list breakdown | Shown only when a line of the week uses a measure. It isn't rounded. |
| Storage | Stays in `DATA_DIR/v2/`. The new fields are additive, so existing files need no migration. |

## Storage

### Ingredients file

Each ingredient gains a `measures` array:

```json
{
  "ingredients": [
    {
      "id": "9b1e4c2a-7d3f-4a8e-b5c6-1f2e3d4c5b6a",
      "name": "Onion",
      "unit": "g",
      "measures": [
        { "id": "5d2c8e1a-0b3f-4c7d-a6e9-2f1b3c4d5e6f", "name": "medium", "amount": 150 },
        { "id": "7a1b2c3d-4e5f-4061-8728-394a5b6c7d8e", "name": "large", "amount": 250 }
      ],
      "archived": false
    }
  ]
}
```

- An ingredient without `measures` reads as `measures: []`.
- Measures keep the order in which you added them.
- An ingredient holds at most 20 measures.
- On read, the store keeps only the measures that a `PATCH` would accept: a
  string `id`, a name that follows the name rules, an amount within limits,
  no repeated IDs, and no repeated name keys. It drops the others.

### Recipes file

Each recipe line gains an optional `measureId`:

```json
{ "ingredientId": "9b1e4c2a-7d3f-4a8e-b5c6-1f2e3d4c5b6a", "quantity": 2, "measureId": "5d2c8e1a-0b3f-4c7d-a6e9-2f1b3c4d5e6f" }
```

- A line without `measureId` is in the ingredient's unit, as today.
- On read, the store drops a line whose `measureId` is present but isn't a
  string, as it drops a line whose `ingredientId` isn't a string. Like
  `ingredientId`, the store doesn't check `measureId` against the catalog on
  a write, so saving one recipe never changes another.
- `GET /api/recipes` drops a line whose `measureId` isn't a measure of its
  ingredient, the same way it drops a line whose ingredient isn't in the
  catalog. Only a hand-edited file or an older backup of the catalog can
  produce such a line.

### Downgrades

An older version of the app ignores `measures` and `measureId`. It would read
`2 medium` as `2 g` and drop the measures on its next save. Deployments roll
back only when the new version fails its health check, before anyone saves
with it, and `meals-restore` already refuses a backup from a newer version.
So no extra protection is needed. `docs/deployment.md` states that deploying
an older version by hand isn't supported once a newer version has saved
data.

## API

All responses are JSON, and errors have the shape `{ "error": "MESSAGE" }`,
as today.

### Ingredients

An ingredient has the shape `{ "id", "name", "unit", "measures", "archived" }`.

`POST /api/ingredients` accepts `{ "name", "unit" }` with an optional
`measures`. Each new measure is `{ "name", "amount" }`, and the server gives
it an ID.

`PATCH /api/ingredients/ID` accepts the following shapes:

- Any combination of `name`, `unit`, `measures`, and `conversion`, applied
  together, within the rules below.
- `{ "archived": BOOLEAN }`, alone, as today.

`measures` replaces the whole list. Each entry is either
`{ "id", "name", "amount" }`, for a measure that keeps its ID, or
`{ "name", "amount" }`, for a new one. A measure of the ingredient that the
list leaves out is removed. Amounts in `measures` are always in the unit that
the ingredient has after the save.

#### Changing the unit

A unit change needs a conversion when the stored ingredient has measures or
a recipe, active or archived, has a line in its unit. Otherwise nothing
depends on the old unit, and the change works as today, with `measures` in
the same body if you like.

`conversion` is `{ "from", "to", "measureName" }` and means that `from` of the
old unit equal `to` of the new unit. Both are numbers with the quantity
limits, so you can write either `1 pcs = 120 g` or `150 g = 1 pcs`. The
factor is `to ÷ from`. `measureName` names the measure that replaces the old
unit in recipes. It's required only when a recipe has a line in the old
unit, and ignored otherwise.

The rules for the body are the following:

- `conversion` is required when the unit change needs one, and rejected with
  any other body.
- A body with `conversion` can't hold `measures`. To change the unit and edit
  the measures, you save twice. So the server never has to guess the unit of
  the amounts it receives.

With a conversion, the server does the following:

1. Multiplies the amount of every measure by the factor and rounds it to two
   decimals.
2. If a recipe has a line in the old unit, adds a measure named
   `measureName` whose amount is the factor, rounded to two decimals, and
   points those lines to it. Their quantities don't change.

If any resulting amount, before rounding, falls outside the quantity limits,
the server returns `400` and changes nothing. For example, changing from `g`
to `pcs` with `150 g = 1 pcs` while a recipe has `300 g` fails, because one
gram is less than 0.01 pieces. You first change those lines to a measure, and then the
unit. Rounding to two decimals can shift an amount by at most 0.005 of the
new unit, which is accepted.

For example, changing `Carrot` from `pcs` to `g` with
`{ "from": 1, "to": 120, "measureName": "piece" }` adds the measure `piece` of
`120 g`, and `2 pcs` in a recipe becomes `2 piece`.

| Status | Meaning |
|--------|---------|
| `200` or `201` | The body is the ingredient. |
| `400` | A field has an invalid value; two measures share a name key; a measure ID isn't one of the ingredient's; the list has more than 20 measures; `conversion` is missing when it's required or sent when it isn't; the body has both `conversion` and `measures`; `measureName` is missing when it's required, is invalid, or matches an existing measure by name key whose amount isn't `1` in the old unit; or a converted amount falls outside the limits. |
| `404` | No ingredient has that ID. |
| `409` | Another ingredient has the same name key, as today. Or `measures` leaves out a measure that a recipe, active or archived, uses, and the body is `{ "error" }`, naming the measure. |

#### Writing a unit change

A unit change with a conversion runs inside the shared queue, so no recipe
write runs between the checks and the saves. It changes two files, and each
write replaces its file atomically. The store writes in three steps, so that
a failure after any step leaves every recipe with the same meaning:

1. `ingredients.json`: adds the new measure with an amount of `1` in the old
   unit. Nothing changes meaning.
2. `recipes.json`: points the lines in the old unit to that measure. They
   keep their meaning, because the measure equals one old unit.
3. `ingredients.json`: sets the new unit and multiplies every measure,
   including the new one, by the factor.

If step 2 or 3 fails, the ingredient keeps its old unit with one extra
measure, and you can retry the change. After step 2, no recipe uses the old
unit anymore, so the retry doesn't need `measureName`.

When `measureName` matches an existing measure by name key and that measure's
amount is `1` in the old unit, the store reuses it instead of adding a new
one: it skips step 1, and step 2 points the lines to it. That measure equals
one old unit, so the lines keep their meaning. So a retry after a failed
step 2, with the same `measureName`, reuses the measure that step 1 added.

### Recipes

Each line in `ingredients` is `{ "ingredientId", "quantity" }` or
`{ "ingredientId", "quantity", "measureId" }`. `measureId` must be the ID of
a measure of that ingredient, or the server returns `400`. An ingredient still
appears at most once per recipe, in one unit or measure.

## Ingredients page

**New ingredient** becomes a button that opens the ingredient editor, empty,
as **New recipe** does on the recipe book page. You set the name, the unit,
and the measures in one place, and **Done** sends `POST`.

Each row shows the unit followed by the names of the measures, such as
`g · medium, large`.

### Ingredient editor

```none
┌─ Edit ingredient ───────────────────────────────┐
│ Name: [Onion                               ]    │
│ Unit: [g ▾]                                     │
│                                                 │
│ Measures                                        │
│ [medium          ] = [ 150 ] g        [Remove]  │
│ [large           ] = [ 250 ] g        [Remove]  │
│ [Add measure]                                   │
│                                                 │
│                             [Cancel]  [Done]    │
└─────────────────────────────────────────────────┘
```

- Each measure row has a name field, an amount field with the unit after it,
  and **Remove**. **Add measure** adds an empty row and focuses its name.
- The amount field parses `.` and `,` like the recipe quantity field.
- **Remove** is disabled on a measure that a recipe uses, with the hint
  `Used in N recipes.`
- The unit `<select>` is always enabled. When you pick another unit and the
  ingredient has measures or a recipe uses it in its unit, a conversion row
  appears:

  ```none
  [   1 ] pcs = [ 120 ] g, saved as measure [pcs          ]
  ```

  Both numbers are editable, and the first one starts at `1`. The measure
  name field appears only when a recipe uses the old unit. It starts with the
  old unit's code, and you can change it.

  While the conversion row shows, the measure rows are read-only and show
  their converted amounts in the new unit, as a preview. To edit measures
  too, you save the unit change first and then edit them.
- **Done** checks every field before it sends one request, as the recipe
  editor does. Errors appear below their row.

## Recipe editor

Each ingredient row gains a measure `<select>` after the quantity field. It
offers the ingredient's unit first, then its measures in their order, as
`medium (150 g)`. A new row starts on the unit.

```none
│ Onion                   [ 2 ] [medium (150 g) ▾]  [Remove]  │
│ Ground beef             [80 ] [g              ▾]  [Remove]  │
```

**Add ingredient** keeps offering ingredients as `Onion (g)`.

## Shopping list

For each ingredient, the total is the sum over every line of the week of
`quantity × servings × amount`, where `amount` is the measure's amount, or
`1` for a line in the unit. The total is rounded up to a whole number, as
today. The arithmetic stays in integers until the end: hundredths of a
quantity times half servings times hundredths of an amount.

A total in `g` or `ml` shows as is below 1000, and in `kg` or `l` from 1000
on, rounded up to tenths so you never buy too little: `300 g`, `1 kg`,
`1320 g` as `1.4 kg`, and `1300 g` as `1.3 kg`. A total in `pcs`
never changes unit. The part in the unit of a breakdown follows the same
rule.

When at least one line of the week uses a measure, the line shows a
breakdown in parentheses: the sum of `quantity × servings` per measure, and
the part in the unit when there is one. The unit comes first, then the
measures in the ingredient's order. Breakdown amounts aren't rounded up, and
show at most two decimals.

```none
│ Carrot                                     1.4 kg │
│ Oil                     57 ml (15 ml, 2 dash, 20 g) │
│ Onion          1.2 kg (300 g, 3 medium, 1.5 large) │
```

`shoppingList()` returns each line as
`{ ingredientId, name, unit, total, breakdown }`, where `breakdown` is an
empty array or a list of `{ measureId, name, quantity }`. The part in the
unit has `measureId: null` and the unit as its name.

## Testing

Each change follows test-driven development: a failing test first. A green
`npm test` prints no stray logs, warnings, or stack traces.

| File | Covers |
|------|--------|
| `test/api.test.js` | The new fields, every new status, and conversions through the API. |
| `test/ingredient-editor.test.js` | Measure rows, the disabled **Remove**, the conversion row, and validation. |
| `test/ingredients-page.test.js` | **New ingredient** in the editor, and rows with measures. |
| `test/ingredients.test.js` | Measure validation and normalization, removal in use, and unit conversion, including recipe updates. |
| `test/quantities.test.js` | The integer arithmetic with amounts. |
| `test/recipe-editor.test.js` | The measure `<select>`, its default, and saving `measureId`. |
| `test/recipes.test.js` | `measureId` on create, update, and read, including unknown measures. |
| `test/shopping-list.test.js` | Totals with measures, rounding, the breakdown and its order, and lines without measures. |
| `test/meal-plan-page.test.js` | Totals in `g`, `kg`, `ml`, and `l`, including the 1000 boundary and rounding up to tenths. |

`docs/manual-test-plan.md` gains tests for the measure rows and the
conversion row on a phone.

## Documentation

- `docs/glossary.md`: the terms in this design.
- `README.md`: measures on the **Ingredients** page, the measure in the
  recipe editor, the breakdown in the shopping list, and the API reference.
- `docs/deployment.md`: deploying an older version by hand isn't supported
  once a newer version has saved data.

## Left to the implementation

- The exact wording of error messages and hints not quoted here.
- The layout of measure rows on narrow screens.
