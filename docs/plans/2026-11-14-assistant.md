# Assistant implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a chat assistant inside Meals that proposes menus and changes
to recipes and ingredients as pending changes, which the user applies or
discards.

**Architecture:** The server keeps conversations in memory and runs each
turn against a provider adapter (Anthropic or OpenAI) with tools. Read tools
read the stores, and proposal tools only stage pending changes. One pure
function computes the next state of the data from the pending changes, and
staging, the read overlay, and **Apply** all use it. The pages load one
module that adds a floating button and window and polls the conversation.

**Tech stack:** Node.js 22, Express 5, plain JavaScript modules with JSDoc
types, `node:test`, supertest, happy-dom, and Playwright. No new dependency.

**Spec:** `docs/plans/2026-11-14-assistant-design.md`. Read it before any
task.

## Global constraints

- Follow `AGENTS.md` and `docs/testing.md` for every change: US English,
  glossary terms, TDD, test names, helpers per layer, and no flaky tests.
- Before every commit: `npm run format`, `npm run lint`, `npm run
  typecheck`, and `npm test` pass, and `npm test` prints no stray output.
  Tasks 9 to 11 also run `npm run test:e2e`.
- Commit messages use Conventional Commits and carry no attribution trailer.
- No new dependency in `package.json`.
- No test calls a real provider. No test waits for real time: time comes
  from an injected clock.
- The API key never appears in a response, a log, or an error message.
- The existing routes and their behavior don't change. Every existing test
  passes without changes, except where a task says so.
- Limits, copied from the spec: 5 attachments per message; 10 MB per
  attachment; 20 MB of attachments per conversation; PDF, JPEG, and PNG
  only; 20 conversations; 24 hours of inactivity; 30 tool rounds and
  3 minutes per turn; family preferences up to 10,000 characters.
- User interface text, exactly: **Assistant**, **New conversation**,
  **Apply**, **Discard**, **View details**, **Retry**, **Settings**,
  **Family preferences**, **Cancel**, **Done**, "Thinking…", "Pending
  changes", and "The assistant couldn't answer."

## Review focus

Each line is pinned by a test in the task named at its end.

1. A phone on a slow connection sends a 15 MB PDF: the upload must not hit
   the 5-second request timeout of `public/http.js`. (Task 10)
2. Someone edits a recipe by hand while it has a pending change: **Apply**
   saves nothing and names that recipe. (Task 3)
3. The provider answers with a tool call for an unknown tool, or with
   arguments that aren't an object: the turn continues with a tool error,
   and the server doesn't crash. (Task 6)
4. Two devices share one conversation identifier, or a second tab sends a
   message during a turn: the second message gets 409 and the conversation
   isn't corrupted. (Task 7)
5. A model writes a recipe name with different capitalization than an
   existing one ("pumpkin soup" and "Pumpkin Soup"): the proposal is
   rejected with the name conflict, as the recipe API does. (Task 3)

---

## File structure

```none
deploy/compose.yaml                 # Modify: optional assistant.env.
docs/deployment.md                  # Modify: turn the assistant on.
docs/glossary.md                    # Modify: four terms.
e2e/assistant.js                    # Create: scripted provider and page helpers.
e2e/assistant.spec.js               # Create.
e2e/assistant.mobile.spec.js        # Create.
e2e/settings.spec.js                # Create.
public/assistant-view.js            # Create: pure functions of the window.*
public/assistant.js                 # Create: the button and the window.
public/settings.js                  # Create: the Settings dialog.
server/assistant/config.js          # Create: reads the three variables.
server/assistant/conversations.js   # Create: conversations and their life cycle.
server/assistant/instructions.js    # Create: the instructions and the guides.
server/assistant/pending.js         # Create: pending changes and the next state.
server/assistant/providers/anthropic.js  # Create.
server/assistant/providers/openai.js     # Create.
server/assistant/providers/errors.js     # Create: ProviderError.
server/assistant/tools.js           # Create: tool definitions and how they run.
server/assistant/turn.js            # Create: the loop of one turn.
server/preferences.js               # Create: the family preferences store.
test/assistant-helpers.js           # Create: scripted provider, fake clock (backend layer).
```

Each task lists the files it modifies.

---

### Task 1: Next-state rules and a transaction in the stores

Refactor only: the stores gain pure functions that compute the next content
of a file, and a way to read and write several files in one queue task.

**Files:**
- Modify: `server/ingredients.js`, `server/recipes.js`, `server/stores.js`,
  `server/weeks.js`
- Test: `test/ingredients-rules.test.js`, `test/recipes-rules.test.js`,
  `test/stores.test.js`, `test/weeks-rules.test.js`

**Interfaces:**
- Produces, in `server/ingredients.js`:
  - `withNewIngredient(all, fields, id) → { all, ingredient }`: `fields` as
    `POST /api/ingredients` takes them. Throws what `create` throws.
  - `withIngredientChanges(all, id, changes, usage) → { all, ingredient }`:
    `changes` as `PATCH` takes them, without `unit` and `conversion`, which
    throw `ValidationError('The unit of an ingredient changes in the
    ingredient editor.')`. `usage` is `{ inUnit, measureIds }` of that
    ingredient.
- Produces, in `server/recipes.js`:
  - `withNewRecipe(all, fields, known, id) → { all, recipe }` and
    `withRecipeChanges(all, id, changes, known) → { all, recipe }`, where
    `known` is the result of `measureIdsByIngredient`.
- Produces, in `server/weeks.js`:
  - `withSlot(raw, day, meal, items, knownRecipeIds) → data`: the week as
    `saveSlot` writes it.
- Produces, in `server/stores.js`, on the object that `createStores`
  returns:
  - `read(weekIds: string[]) → Promise<State>`, which never waits for the
    queue.
  - `transaction(weekIds, compute: (state: State) => { state: State, result:
    any }) → Promise<result>`: one queue task that reads the state, calls
    `compute`, and writes `ingredients.json`, `recipes.json`, and each week
    file, in that order, only where `compute` returned a different object. If
    `compute` throws, nothing is written and the error propagates.
  - `State` is `{ ingredients: Ingredient[], recipes: Recipe[], weeks:
    Record<string, WeekData> }`, as stored: recipes with every ingredient
    line, and weeks by structure only (`normalizeStructure`).
- All four returned arrays and objects are new. The inputs aren't changed.

- [ ] **Step 1: Write failing tests for the pure functions.** In the three
  `*-rules.test.js` files, one `describe` per function. Pin at least:
  `withNewIngredient` rejects a name whose name key exists with
  `NameConflictError`; `withIngredientChanges` rejects `{ unit: "ml" }` with
  the message above, and rejects removing a measure whose ID is in
  `usage.measureIds` with `ConflictError`; `withNewRecipe` rejects an unknown
  ingredient with `ValidationError("Unknown ingredient: x")`; `withSlot`
  rejects an item whose recipe isn't in `knownRecipeIds` with
  `ValidationError("Unknown recipe: x")` and leaves the other slots of `raw`
  as they were; none of them changes its input (`structuredClone` before,
  `deepEqual` after).
- [ ] **Step 2: Run them and watch them fail.** `npm test`: the new tests
  fail because the functions don't exist.
- [ ] **Step 3: Implement the functions, and make `create`, `update`, and
  `saveSlot` call them.** `ingredients.update` keeps its own path for a
  change of unit. The message and the class of every existing error stay the
  same.
- [ ] **Step 4: Write failing tests for `read` and `transaction`** in
  `test/stores.test.js`: `transaction` writes the three kinds of files that
  `compute` replaced and returns `result`; it writes nothing when `compute`
  throws; it writes only the files whose object changed (check the
  modification time of an untouched file stays equal); a `saveSlot` queued
  during a transaction runs after it.
- [ ] **Step 5: Implement `read` and `transaction`.** Each store exposes
  what `stores.js` needs to read and write its file without enqueueing.
- [ ] **Step 6: Run every check.** `npm run format && npm run lint && npm
  run typecheck && npm test`. Expected: all pass, with every test that
  existed before unchanged.
- [ ] **Step 7: Commit.** `refactor(server): compute the next state of the
  data without writing it`

### Task 2: Family preferences

**Files:**
- Create: `server/preferences.js`
- Modify: `README.md` (**Data files**, **API reference**),
  `docs/glossary.md`, `server/app.js`, `server/stores.js`
- Test: `test/api.test.js`, `test/preferences.test.js`

**Interfaces:**
- Produces: `createPreferences({ dataDir, enqueue }) → { read():
  Promise<string>, save(text): Promise<string> }`, on the stores as
  `stores.preferences`. `MAX_PREFERENCES = 10000`, exported.
- File: `DATA_DIR/v2/preferences.json`, as `{ "text": "..." }`. A missing
  file reads as `""`. A file that isn't an object with a string `text`
  rejects, as the other stores do for a wrong shape.
- Routes: `GET /api/preferences → 200 { text }`; `PUT /api/preferences` with
  `{ text }` `→ 200 { text }`. A body that isn't exactly `{ text: string }`,
  or a text longer than 10,000 characters, answers 400 with
  `"text" must be a string of at most 10000 characters.`

- [ ] **Step 1: Write the failing tests.** Store: reads `""` without a
  file; saves and reads back a text with line breaks and accents unchanged;
  rejects 10,001 characters and accepts 10,000. API: the two routes, the 400
  cases (`{}`, `{ text: 1 }`, `{ text: "a", other: 1 }`), and that the routes
  answer when the app has no assistant.
- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Implement the store and the routes.**
- [ ] **Step 4: Document.** Add *Family preferences* to `docs/glossary.md`
  with the definition in the spec, `preferences.json` to **Data files**, and
  the two routes to **API reference**.
- [ ] **Step 5: Run every check and commit.** `feat(server): store the
  family preferences`

### Task 3: Pending changes

**Files:**
- Create: `server/assistant/pending.js`
- Modify: `docs/glossary.md` (*Assistant*, *Conversation*, *Pending change*)
- Test: `test/pending.test.js`

**Interfaces:**
- Consumes: the Task 1 functions and `State`.
- A pending change is one of:
  - `{ kind: "ingredient", action: "create", id, fields }`
  - `{ kind: "ingredient", action: "update", id, changes, base }`
  - `{ kind: "recipe", action: "create", id, fields }`
  - `{ kind: "recipe", action: "update", id, changes, base }`
  - `{ kind: "menu", week, day, meal, items, base }`

  `id` of a create is a new UUID, made when the change is staged. It's the
  ID that the entry gets when applied, so later proposals use it as any
  other ID. New measures get their IDs when staged too. `base` is the stored
  target when the change was staged: the ingredient, the recipe, or the
  slot's `items`.
- Produces:
  - `targetOf(change) → string`: `ingredient:<id>`, `recipe:<id>`, or
    `menu:<week>/<day>/<meal>`.
  - `nextState(state, changes) → { state, problems }`, where `problems` is
    `{ target, message }[]`. It applies the changes by kind (ingredients,
    then recipes, then menus), each in list order, through the Task 1
    functions. A change that throws a store error becomes a problem and is
    skipped. An update or a menu whose `base` doesn't deep-equal the stored
    target becomes the problem `<Name> changed after the assistant proposed
    this.`, with the stored name, or the slot as `Tuesday dinner`. Anything
    that isn't a store error propagates.
  - `stage(state, changes, proposal) → { changes, change }`: `proposal` is
    `{ kind, id?, fields?, changes?, week?, day?, meal?, items? }`. Without
    `id`, an ingredient or a recipe is a create. With the `id` of a pending
    create, it replaces that create and keeps the ID. With the `id` of a
    stored entry, it's an update. It throws the `ValidationError` of the new
    change when `nextState` reports a problem for its target, and
    `NotFoundError` for an unknown `id`. Problems of other targets don't
    stop it. A change for a target that has one replaces it in place.
  - `withdraw(state, changes, target) → changes`: throws
    `NotFoundError` for an unknown target, and `ConflictError("Other pending
    changes depend on this one. Withdraw them first.")` when removing it
    gives another target a problem that it didn't have.
  - `weeksOf(changes) → string[]`: the weeks that the menus name.
  - `describe(state, changes, problems) → PendingView[]`, what a page shows:
    - `{ target, kind: "menu", week, day, meal, items: [{ name, servings }],
      problem? }`
    - `{ target, kind: "recipe", action, name, ingredients: [{ name,
      quantity, unit }], problem? }`, where `unit` is the measure's name or
      the ingredient's unit
    - `{ target, kind: "ingredient", action, name, unit, measures: [{ name,
      amount }], problem? }`

    `action` is `create`, `change`, `archive`, or `restore`. Names come
    from `nextState`'s state, so they include pending entries.

- [ ] **Step 1: Write the failing tests** in `test/pending.test.js`, with
  small literal states. One test per guarantee:
  - stages a recipe that uses a pending ingredient and a pending measure
  - stages a menu that holds a pending recipe
  - replaces the pending change of the same slot
  - replaces a pending create and keeps its ID
  - rejects a recipe whose name key matches a stored recipe ("pumpkin soup"
    against "Pumpkin Soup") with `NameConflictError`
  - rejects a recipe whose name key matches a pending recipe
  - rejects a change of unit
  - rejects a menu with 21 items, and one with servings of 0.25
  - reports a problem when the stored recipe changed after staging
  - reports a problem when the stored slot changed after staging
  - reports no problem when another slot of the week changed after staging
  - rejects a withdrawal that others depend on
  - applies ingredients before recipes before menus, whatever the list order
  - describes a menu with the names of pending recipes
- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Implement `server/assistant/pending.js`.** Every function
  is pure: no disk, no clock except `randomUUID`.
- [ ] **Step 4: Add the three glossary terms**, with the definitions in the
  spec.
- [ ] **Step 5: Run every check and commit.** `feat(assistant): stage
  pending changes and compute what they save`

### Task 4: Tools

**Files:**
- Create: `server/assistant/tools.js`
- Test: `test/assistant-tools.test.js`

**Interfaces:**
- Consumes: Task 1 `stores.read`, Task 3.
- Produces:
  - `TOOLS`: `{ name, description, parameters }[]`, with `parameters` as a
    JSON Schema object. Names: `list_ingredients`, `list_recipes`,
    `propose_ingredient`, `propose_menus`, `propose_recipe`, `read_week`,
    `withdraw_pending_change`.
  - `runTool(name, input, { stores, pending }) → Promise<{ output: object,
    isError: boolean, pending }>`: never throws for bad input. A store error
    or a malformed input gives `{ output: { error: message }, isError: true
    }` and the same `pending`.
- Arguments:
  - `list_ingredients` and `list_recipes`: none.
  - `read_week`: `{ week }`.
  - `propose_ingredient`: `{ id?, name?, unit?, measures?, archived? }`.
  - `propose_recipe`: `{ id?, name?, ingredients?, archived? }`.
  - `propose_menus`: `{ menus: [{ week, day, meal, items: [{ recipeId,
    servings }] }] }`. All the menus are staged, or none.
  - `withdraw_pending_change`: `{ target }`.
- Read results come from `nextState(await stores.read(...), pending).state`,
  shaped as the API shapes them (recipes without unknown ingredients, A to
  Z), and each entry or slot with a pending change has `pending: true`.
- A proposal returns `{ target, id? }` and, for a recipe or an ingredient,
  the entry as it would be saved.

- [ ] **Step 1: Write the failing tests**, on a real data directory
  (`useDataDir`): each read tool shows a pending create marked `pending:
  true`; `read_week` shows a pending menu; `propose_menus` with one invalid
  menu of three stages none and names the invalid slot; an unknown tool
  name, an input that is `null`, an array, or a string, and a `week` that
  isn't a Monday each return `isError: true` without throwing; `TOOLS` is
  sorted by name and every `parameters` has `type: "object"`.
- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Implement.** Write each `description` for the model: what
  the tool does, that proposals aren't saved until the user applies them,
  and the limits of the glossary (servings, quantities, 20 items, units).
- [ ] **Step 4: Run every check and commit.** `feat(assistant): add the
  tools that read data and propose changes`

### Task 5: Provider adapters

**Files:**
- Create: `server/assistant/providers/anthropic.js`,
  `server/assistant/providers/errors.js`,
  `server/assistant/providers/openai.js`, `test/assistant-helpers.js`
- Test: `test/provider-anthropic.test.js`, `test/provider-openai.test.js`

**Interfaces:**
- Produces:
  - `class ProviderError extends Error`, with `kind`: `"auth"`,
    `"network"`, `"overloaded"`, `"rate_limit"`, `"timeout"`, `"too_long"`,
    or `"other"`. Its message never holds the key.
  - `createAnthropicProvider({ apiKey, model, baseUrl =
    "https://api.anthropic.com", fetch = globalThis.fetch, timeoutMs =
    120000 })` and `createOpenAIProvider({ apiKey, model, baseUrl =
    "https://api.openai.com", fetch, timeoutMs })`, each returning
    `Provider`:
    `{ name: "anthropic" | "openai", model, complete({ system, messages,
    tools, signal }) → Promise<{ text: string, toolCalls: { id, name, input
    }[], usage: { inputTokens, outputTokens } }> }`.
  - `messages` is the common shape:
    - `{ role: "user", text, attachments: { name, mediaType, data }[] }`,
      with `data` in base64
    - `{ role: "assistant", text, toolCalls }`
    - `{ role: "tool", results: { id, name, output: string, isError }[] }`
  - `input` of a tool call is the parsed arguments, or `null` when they
    don't parse.
  - In `test/assistant-helpers.js`: `stubProviderServer(t, handler) → {
    baseUrl, requests }`, an HTTP server on `127.0.0.1` that records each
    request's headers and parsed body and answers with `handler(request)`.

- [ ] **Step 1: Check the request and response formats.** Before writing
  fixtures, read each provider's current documentation for a request with
  tools, a PDF, and an image, and for tool calls and tool results in the
  history. For Anthropic, load the `claude-api` skill. Use the Messages API
  for Anthropic and the Responses API for OpenAI, with `store: false`. Send
  no sampling parameters. Record in each adapter's header comment the
  documentation page and the date you read it.
- [ ] **Step 2: Write the failing tests**, one file per adapter, against
  `stubProviderServer`. Per adapter:
  - sends the key in the provider's header, and the model, the system
    instructions, and the tools in the provider's format
  - sends a PDF and a PNG attachment in the provider's format
  - sends earlier tool calls and their results in the provider's format
  - returns the text and the tool calls of an answer in the common shape
  - returns `input: null` for tool arguments that aren't valid JSON
  - maps 401 and 403 to `auth`, 429 to `rate_limit`, 500 and above to
    `overloaded`, the provider's context-length error to `too_long`, a
    refused connection to `network`, and an answer cut off by the output
    limit to `other`
  - rejects with `timeout` when the stub holds the answer and `timeoutMs`
    is 1
  - rejects with the abort reason when `signal` aborts
  - never puts the key in an error message (use the key `sk-test-secret` and
    assert that no error's `message` or `stack` contains it)
- [ ] **Step 3: Run them and watch them fail.**
- [ ] **Step 4: Implement the two adapters** with `fetch`. Each is a
  translation in and a translation out, with no shared state.
- [ ] **Step 5: Run every check and commit.** `feat(assistant): call the
  Anthropic and OpenAI APIs`

### Task 6: Instructions and the turn

**Files:**
- Create: `server/assistant/instructions.js`, `server/assistant/turn.js`
- Modify: `test/assistant-helpers.js`
- Test: `test/assistant-instructions.test.js`, `test/assistant-turn.test.js`

**Interfaces:**
- Consumes: Task 4 `TOOLS` and `runTool`, Task 5 `Provider` and
  `ProviderError`.
- Produces:
  - `instructions({ preferences, today, week }) → string`. `today` is
    `YYYY-MM-DD`, and `week` is a week ID or `undefined`.
  - `runTurn({ provider, system, messages, pending, stores, signal,
    maxRounds = 30 }) → Promise<{ messages, pending, usage, rounds }>`:
    `messages` are the new ones only, the assistant's and the tools'. It
    calls `provider.complete`, runs every tool call of the answer in order
    with `runTool`, and repeats until an answer has no tool calls. After
    `maxRounds` answers with tool calls, it rejects with `TurnLimitError`.
    It checks `signal` before each provider call and each tool. It doesn't
    change its `messages` or `pending` arguments.
  - `class TurnLimitError extends Error`.
  - In `test/assistant-helpers.js`: `scriptedProvider(steps) → Provider & {
    calls }`. Each step is an answer `{ text?, toolCalls? }`, an `Error` to
    reject with, or a function `(request) → answer`. `calls` records each
    request. A call beyond the script rejects with an error that says so.

- [ ] **Step 1: Write the failing tests for the instructions:** the result
  contains the preferences text verbatim; today's date; the displayed week
  when given, and no week line when not; the three guide titles; each rule
  of "What the model reads" in the spec is present (assert a distinctive
  phrase of each, chosen when you write the text).
- [ ] **Step 2: Write the failing tests for the turn**, with
  `scriptedProvider` and a real data directory:
  - returns the answer when the model calls no tool
  - runs two tool calls of one answer in order and sends both results back
  - returns the pending changes that the tools staged
  - continues with a tool error when the model calls an unknown tool
  - continues with a tool error when a tool call has `input: null`
  - rejects with `TurnLimitError` after 30 rounds of tool calls
  - rejects with the provider's error and leaves its arguments unchanged
  - stops before the next provider call when the signal aborts
- [ ] **Step 3: Run them and watch them fail.**
- [ ] **Step 4: Implement both modules.** Write the instructions as prose
  for the model, with the role, the domain terms and limits from the
  glossary, the three guides, and the rules of the spec.
- [ ] **Step 5: Run every check and commit.** `feat(assistant): run a turn
  with tools and instructions`

### Task 7: Conversations

**Files:**
- Create: `server/assistant/conversations.js`
- Modify: `test/assistant-helpers.js`
- Test: `test/conversations.test.js`

**Interfaces:**
- Consumes: Tasks 3, 4, and 6, and `stores.transaction`.
- Produces: `createConversations({ provider, stores, logger, clock,
  maxConversations = 20, idleMs = 86400000, turnMs = 180000 })`, with
  `clock = { now(), setTimeout(fn, ms), clearTimeout(handle) }` and the real
  clock by default. It returns:
  - `create() → { id }`
  - `view(id) → Promise<ConversationView>`
  - `send(id, { text, attachments, week }) → void`: starts a turn and
    returns at once
  - `retry(id) → void`
  - `apply(id) → Promise<{ applied: true } | { applied: false, problems }>`
  - `discard(id) → void`
  - `end(id) → void`
  - `settled(id) → Promise<void>`: resolves when no turn runs, for tests
  - `stop() → Promise<void>`: cancels every turn and every timer
- Errors: `NotFoundError` for an unknown or ended `id`;
  `ConflictError("The assistant is still answering.")` for `send`, `retry`,
  `apply`, or `discard` during a turn; `ConflictError` for `retry` without a
  failed message; `ValidationError` for a bad message, with these messages:
  - `A message needs text or an attachment.`
  - `A message holds at most 5 attachments.`
  - `"<name>" isn't a PDF, a JPEG, or a PNG.`, decided by the first bytes of
    the file, not by its declared type
  - `"<name>" is larger than 10 MB.`
  - `The attachments of a conversation total at most 20 MB. Start a new
    conversation to attach more.`
- `ConversationView`: `{ id, status: "idle" | "working" | "failed", error?:
  "limit" | "provider" | "too_long", messages: { role: "user" | "assistant",
  text, attachments?: string[], failed?: true }[], pending: PendingView[] }`.
  An assistant message appears for each answer that has text. `pending`
  comes from `describe`, with the problems of the last rejected `apply`
  until the pending changes change.
- Behavior:
  - `send` adds the user message, snapshots the pending changes, and runs
    `runTurn` with `instructions({ preferences: await
    stores.preferences.read(), today, week })`. On success it appends the
    turn's messages and takes its pending changes. On failure or
    cancellation it restores the snapshot, drops the turn's messages, marks
    the user message `failed`, and sets `error`: `too_long` for that
    provider error, `limit` for `TurnLimitError` and the 3 minutes, and
    `provider` otherwise.
  - `retry` clears the `failed` mark of the last user message and runs the
    turn again.
  - Consecutive user messages go to the provider merged into one. What
    `apply` and `discard` record, and the problems of a rejected `apply`,
    go to the provider as a line at the start of the next user message,
    such as `(Meals: the user applied the pending changes.)`.
  - `apply` calls `stores.transaction(weeksOf(pending), ...)` with
    `nextState`. With problems, the transaction writes nothing.
  - A message, `apply`, and `discard` set the last activity. A conversation
    ends 24 hours after it. `view` doesn't count.
  - `create` with 20 conversations ends the one with the oldest activity,
    and cancels its turn.
  - One log line per turn: `logger.info("assistant turn", { provider, model,
    rounds, inputTokens, outputTokens, ms, outcome })`, with `outcome` one
    of `ok`, `canceled`, `limit`, `provider`, or `too_long`. A provider
    failure also logs `logger.error("assistant turn failed", { kind, error
    })`. No log holds message text, attachment names, or the key.
- In `test/assistant-helpers.js`: `fakeClock(start) → clock & {
  advance(ms) }`, which runs the due timers in order.

- [ ] **Step 1: Write the failing tests**, with `scriptedProvider`,
  `fakeClock`, and a real data directory. One test per guarantee:
  - shows the user's message and the assistant's answer after a turn
  - shows the names of the attachments and never their content
  - shows no tool calls
  - rejects a message during a turn with `ConflictError`, and keeps the
    conversation as it was (two `send` calls, one after the other, with the
    first provider call held)
  - rejects `apply` and `discard` during a turn
  - restores the pending changes when a turn fails after staging some
  - marks the message as failed, and `retry` runs it again with its
    attachments
  - fails the turn with `limit` when the clock passes 3 minutes
  - rejects each bad message with its text (one test each, with a file of
    exactly 10 MB accepted and one byte more rejected, and a text file
    declared as `application/pdf` rejected)
  - applies a week, a new recipe, and a new ingredient to disk
  - saves nothing and reports the problem when a recipe changed by hand
    after the assistant proposed changing it
  - tells the model about the rejected `apply` in the next message
  - ends a conversation 24 hours after the last message, and not 24 hours
    after the last `view`
  - ends the conversation with the oldest activity when a 21st starts
  - cancels the turn when the conversation ends, and logs `canceled`
  - cancels every turn on `stop`, and leaves no timer (the fake clock has
    no pending timer)
  - logs token counts and never the message text or the key
- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run every check and commit.** `feat(assistant): keep
  conversations and their pending changes in memory`

### Task 8: Routes, configuration, and startup

**Files:**
- Create: `server/assistant/config.js`
- Modify: `README.md` (**Configure the server**, **API reference**,
  **Project structure**), `deploy/compose.yaml`, `docs/deployment.md`,
  `server/app.js`, `server/index.js`, `server/start.js`
- Test: `test/api.test.js` or a new `test/assistant-api.test.js`,
  `test/assistant-config.test.js`, `test/server.test.js`

**Interfaces:**
- Consumes: Task 5 factories, Task 7.
- Produces:
  - `readAssistantConfig(env) → { provider, model, apiKey } | { problem:
    string } | undefined`. Unset and empty are the same. `undefined` when
    all three are unset. `problem` names the missing variables or the
    unknown provider, never the key.
  - `start({ ..., provider? })`: with a provider, it creates the
    conversations, passes them to `createApp`, and `stop()` calls
    `conversations.stop()` before it closes the server.
  - `createApp(stores, { ..., assistant? })`, where `assistant` is the
    object of Task 7.
- Routes, as the spec's table lists them:
  - `GET /api/assistant → 200 { enabled }`, always.
  - Without `assistant`, every other `/api/assistant/...` route answers 404
    `{ error: "Not found" }`.
  - `POST /api/assistant/conversations → 201 { id }`.
  - `GET .../:id → 200 ConversationView`.
  - `POST .../:id/messages` with `{ text, attachments: [{ name, mediaType,
    data }], week? } → 202 {}`. Only this route parses a JSON body of up to
    `30mb`. A `week` that isn't a week ID is 400.
  - `POST .../:id/retry → 202 {}`.
  - `POST .../:id/apply → 200 { applied: true }`, or `409 { error, problems
    }`.
  - `POST .../:id/discard → 200 {}`.
  - `DELETE .../:id → 204`.
  - The existing error handler maps the store errors: 400, 404, and 409.
- The request log skips `GET /api/assistant/conversations/:id` with status
  200.
- `server/index.js` reads the configuration, logs
  `logger.error("assistant not configured", { problem })` for a problem, and
  adds `assistant: "anthropic" | "openai" | "off"` to the `server started`
  line.
- `deploy/compose.yaml`: the service reads an optional
  `/opt/server/meals/assistant.env` with `env_file` and `required: false`.
  The host's `.env` is readable by every user of the host, so the key
  doesn't go there.

- [ ] **Step 1: Write the failing tests.**
  - Configuration: the eight combinations of set and unset variables;
    empty strings; an unknown provider; no problem text contains the key.
  - API, with supertest and `scriptedProvider`: each route's success;
    `enabled: false` and 404s without an assistant; 404 for an unknown
    conversation on each route; 409 for a message during a turn; 409 with
    `problems` for a rejected `apply`; 400 for each bad message; a 12 MB
    attachment is accepted; a 12 MB body on `PUT /api/preferences` is
    rejected with 413; the log skips a successful read of a conversation and
    logs a failed one.
  - Server: `stop()` resolves while a turn waits for the provider (hold the
    scripted provider, call `stop()`, and use `within`).
- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Check the compose file.** Run `MEALS_IMAGE=x MEALS_PORT=1
  MEALS_UID=1 MEALS_GID=1 docker compose --file deploy/compose.yaml config`
  in a directory without `assistant.env`. Expected: it prints the service
  with no error. Then run `npm run test:image`. Expected: it passes.
- [ ] **Step 5: Document.**
  - `README.md`: the three variables in **Configure the server**, the
    routes in **API reference**, and the new server files in **Project
    structure**.
  - `docs/deployment.md`: a section **Turn on the assistant**, with numbered
    steps: create `/opt/server/meals/assistant.env` with the three
    variables, owned by `deployer:docker` with mode `0640`; run the
    installer of this release, which brings the new `compose.yaml`; restart
    the app; check the `server started` line. Also: what the provider
    receives, that the provider bills by use and a monthly spending limit in
    its console is recommended, that the host needs outbound HTTPS to the
    provider, and that the rule to keep the host on a private network
    stays. Add `assistant.env` to the directory tree, and the two new log
    messages to **Logs**.
- [ ] **Step 6: Run every check and commit.** `feat(assistant): serve
  conversations over the API`

### Task 9: Settings

**Files:**
- Create: `e2e/settings.spec.js`, `public/settings.js`
- Modify: `README.md`, `e2e/accessibility.js`, `public/index.html`,
  `public/ingredients.html`, `public/recipes.html`, `public/shell.js`,
  `public/styles.css`, `test/dom-helpers.js`
- Test: `test/settings.test.js`

**Interfaces:**
- Consumes: Task 2 routes, `GET /api/assistant`.
- Produces: `setUpSettings()` in `public/settings.js`, which
  `setUpShell()` calls. Each page's toolbar gets, as its last control,
  `<button type="button" class="open-settings glass icon-button"
  aria-label="Settings">` with a gear icon. On the meal plan it follows
  **Shopping list**.
- The dialog is built by `settings.js`, as `alert.js` builds its alert: a
  `<dialog class="dialog" aria-labelledby=...>` with the sheet header of the
  editors (**Cancel**, the title **Settings**, **Done**), the section title
  **Family preferences** as the label of a `<textarea maxlength="10000">`,
  and the hint "The assistant reads this text in every conversation."
- Behavior:
  - Opening loads `GET /api/preferences`. While it loads, the button is
    disabled. A failed load shows "Couldn't load the settings. Try again."
    in an alert role near the button, and opens nothing.
  - **Done** sends `PUT /api/preferences` when the text changed, and closes
    after a 200. A failure shows "Couldn't save the settings. Try again."
    and keeps the dialog open. While it saves, the controls are disabled and
    `Escape` doesn't close.
  - **Cancel**, `Escape`, and a click on the backdrop behave as in the
    editors: the backdrop closes only without changes. A page with unsaved
    changes in Settings asks before it unloads.
  - When `GET /api/assistant` says `enabled: false`, the dialog also shows
    "The assistant isn't set up on this server."
  - Closing returns the focus to the gear button.
- `test/dom-helpers.js`: `fakeFetch()` answers `GET /api/assistant` with
  `{ enabled: false }` by itself and doesn't record it, so the existing page
  tests see no new request. `fakeFetch({ assistant: "manual" })` leaves it
  to the test.

- [ ] **Step 1: Change `fakeFetch` first, and run `npm test`.** Expected:
  every existing test passes.
- [ ] **Step 2: Write the failing happy-dom tests** in
  `test/settings.test.js`, on `recipes.html`: one test per behavior above,
  plus "shows the button on the meal plan after Shopping list" on
  `index.html` and "shows the button on the ingredients page".
- [ ] **Step 3: Run them and watch them fail.**
- [ ] **Step 4: Implement** the markup of the button on the three pages,
  `settings.js`, and the styles. Reuse `.dialog`, `.sheet-header`, `.card`,
  and `.section-title`. On phones, the toolbar must still fit at 360 px:
  check `public/styles.css` at the `max-width: 699.98px` block.
- [ ] **Step 5: Write the browser tests** in `e2e/settings.spec.js`: saves
  the preferences and shows them after a reload; focus moves into the dialog
  and back to the button; the toolbar's controls don't overlap at the Pixel
  7 and iPhone 15 widths (`e2e/layout.js` has the helpers). Add the state
  "settings" to `STATES` in `e2e/accessibility.js`.
- [ ] **Step 6: Run them under load.** `npm run test:e2e --
  e2e/settings.spec.js --repeat-each=10 --workers=12`. Expected: all pass.
- [ ] **Step 7: Document.** `README.md`: a section **Change the settings**
  after **Manage ingredients**, and `settings.js` in **Project structure**.
- [ ] **Step 8: Run every check, with `npm run test:e2e`, and commit.**
  `feat(ui): edit the family preferences in Settings`

### Task 10: The assistant's window

**Files:**
- Create: `public/assistant-view.js`, `public/assistant.js`
- Modify: `README.md`, `public/app.js`, `public/http.js`,
  `public/ingredients.js`, `public/recipes.js`, `public/shell.js`,
  `public/styles.css`
- Test: `test/assistant-view.test.js`, `test/assistant-window.test.js`,
  `test/http.test.js`

**Interfaces:**
- Consumes: Task 8 routes.
- Produces:
  - `sendJson(method, url, body, { timeoutMs = REQUEST_TIMEOUT_MS } = {})`.
    The message route uses `UPLOAD_TIMEOUT_MS = 120000`, exported from
    `public/http.js`.
  - `public/assistant-view.js`, pure, with no DOM:
    - `summarize(pending) → { label, detail }[]`: one line per week with
      menus (`Week of Nov 16`, `31 slots` or `1 slot`), then one line per
      recipe and per ingredient (`New recipe`, `Changed recipe`, `Archived
      recipe`, `Restored recipe`, and the same for ingredients, with the
      name as the detail), each group from A to Z.
    - `hasMark({ open, messages, seen, pending }) → boolean`: collapsed, and
      either more assistant messages than `seen` or any pending change.
    - `displayedWeek(location) → string | undefined`: the week in the hash,
      only on the meal plan's path.
    - `attachmentProblem(files, usedBytes) → string | undefined`, with the
      limits and the texts of Task 7.
  - `setUpAssistant()` in `public/assistant.js`, which `setUpShell()` calls
    after `setUpSettings()`. It asks `GET /api/assistant` and does nothing
    more when the assistant is off.
  - `localStorage` keys: `meals.assistant.conversation` (the identifier),
    `meals.assistant.open` (`"true"` or `"false"`), and
    `meals.assistant.seen` (a number). Blocked storage must not break the
    page: follow `readChoice` in `public/shell.js`.
  - After a successful **Apply**, the window dispatches the event
    `meals:data-changed` on `window`. `recipes.js` and `ingredients.js` call
    their `load`. `app.js` loads the displayed week again unless it has
    slots that aren't saved or the slot editor is open, in which case it
    loads when it next changes weeks, as today.
- Markup, built by `assistant.js`:
  - The button: `<button class="assistant-button glass"
    aria-label="Assistant" aria-expanded aria-controls>`, with a `.mark`
    when `hasMark`. Its accessible name is "Assistant, new activity" while
    it has the mark.
  - The window: `<section class="assistant-window" role="dialog"
    aria-label="Assistant">`, not modal, with the header (the title, **New
    conversation**, and the collapse button with the label "Collapse"), the
    message list (`role="log"`), the pending changes card, and the message
    field (`<textarea>`, an attach button over a hidden `<input type="file"
    multiple accept="application/pdf,image/jpeg,image/png">`, and a send
    button with the label "Send").
- Behavior:
  - On load with a stored identifier, read the conversation. A 404 clears
    the identifier and shows an empty chat.
  - Sending creates the conversation first when there's none. `Enter` sends
    and `Shift+Enter` adds a line, except while the input method composes.
  - While `status` is `working`, the list ends with "Thinking…", and send,
    **Apply**, and **Discard** are disabled. The window reads the
    conversation again 1 second after each answer until the status changes,
    also while collapsed. A failed read tries again and shows nothing.
  - `failed` shows "The assistant couldn't answer." with **Retry**. For
    `too_long`, it shows "This conversation is too long. Start a new
    conversation." without **Retry**. For `limit`, "The assistant took too
    long." with **Retry**.
  - **Apply** on a 409 shows each problem on its pending change, inside
    **View details**, which it opens.
  - **New conversation** asks with `askBeforeLosing` when there are pending
    changes: title "Start a new conversation?", message "The pending
    changes aren't saved. If you start a new conversation, they're lost.",
    and the buttons "Keep Conversation" and "Discard and Start".
  - `Escape` inside the window collapses it. Opening focuses the message
    field. Collapsing focuses the button.
- Styles: the spec's **Style** section. The button sits at the lower right
  inside the safe areas, above the tab bar on phones. At 700 px or wider the
  window is anchored to the lower right corner, at most 400 px wide. Below,
  it's a sheet from the bottom that leaves the top of the page visible.
  `@media (prefers-reduced-transparency: reduce)` gives the button and the
  window a solid `var(--surface)` background with no backdrop filter.
  `@media (prefers-reduced-motion: reduce)` removes their transitions.

- [ ] **Step 1: Write the failing unit tests** for `assistant-view.js` and
  for `sendJson`'s `timeoutMs` (with `AbortSignal.timeout` mocked, assert the
  milliseconds it's called with: 5000 by default, 120000 when asked).
- [ ] **Step 2: Implement them, and watch the tests pass.**
- [ ] **Step 3: Write the failing happy-dom tests** in
  `test/assistant-window.test.js`, with `fakeFetch({ assistant: "manual"
  })`. One test per behavior above. Include:
  - adds no button when the assistant is off
  - sends a message with a 15 MB PDF through the upload timeout (assert the
    `timeoutMs` that the request used)
  - rejects a sixth attachment before it sends
  - keeps the conversation when another page loads (open `recipes.html`
    with the stored identifier, and answer the read)
  - reads again while collapsed until the turn ends (use `mock.timers` for
    the 1-second timer)
  - reloads the recipes after **Apply**
  - keeps an unsaved slot after **Apply** on the meal plan
  - works with `localStorage` blocked
- [ ] **Step 4: Run them and watch them fail.**
- [ ] **Step 5: Implement `assistant.js`, the styles, and the
  `meals:data-changed` listeners.**
- [ ] **Step 6: Document.** `README.md`: a section **Ask the assistant**
  after **Change the settings**, and the two files in **Project structure**
  (`assistant-view.js` with the `*` of modules that tests import in
  Node.js).
- [ ] **Step 7: Run every check and commit.** `feat(ui): chat with the
  assistant in a floating window`

### Task 11: Browser tests of the assistant

**Files:**
- Create: `e2e/assistant.js`, `e2e/assistant.mobile.spec.js`,
  `e2e/assistant.spec.js`
- Modify: `docs/testing.md`, `e2e/accessibility.js`, `e2e/fixtures.js`

**Interfaces:**
- Consumes: `start({ provider })` of Task 8.
- Produces: in `e2e/assistant.js`, a scripted provider for the browser
  tests (its own code: helpers don't cross layers) with `hold()` and
  `release()` to keep a turn running, and page helpers such as
  `openAssistant(page)`. In `e2e/fixtures.js`, the option `assistant`,
  `"off"` by default, which a test sets with `test.use({ assistant: [...]
  })` to start its server with that script.

- [ ] **Step 1: Write the tests.**
  - `e2e/assistant.spec.js`:
    - plans a week: the answer, the pending changes card, **View details**,
      and after **Apply** the grid shows the menus without a reload
    - keeps the conversation and the open window from the meal plan to the
      recipes page
    - shows the mark on the button when the answer arrives while collapsed
    - keeps the meal plan usable while the window is open (open the slot
      editor of a slot that the window doesn't cover)
    - moves the focus to the message field on open, and to the button on
      `Escape`
    - attaches a PDF and shows its name
    - asks before **New conversation** discards pending changes
    - shows the problem when a recipe changed by hand before **Apply**
    - shows no button when the assistant is off
  - `e2e/assistant.mobile.spec.js`:
    - places the button above the tab bar, with neither covering the other
    - opens the window as a sheet that leaves the toolbar visible
    - keeps the message field above the bottom safe area
  - `e2e/accessibility.js`: the states "assistant window" and "assistant
    window with pending changes", in both appearances.
- [ ] **Step 2: Run them.** `npm run test:e2e -- e2e/assistant`. Expected:
  they pass on the five projects. A failure here is a bug in Tasks 8 to 10:
  write the failing test at the lowest level that reproduces it, and fix it
  there.
- [ ] **Step 3: Run them under load.** `npm run test:e2e --
  e2e/assistant.spec.js e2e/assistant.mobile.spec.js --repeat-each=10
  --workers=12`. Expected: all pass. A test that fails once is a finding:
  fix the cause or narrow what the test promises.
- [ ] **Step 4: Document.** `docs/testing.md`: in **Integration** and **End
  to end**, that the assistant's tests use a scripted provider and never
  call a real one, and that the adapters run against a local stub server.
- [ ] **Step 5: Run every check, with the whole `npm run test:e2e`, and
  commit.** `test(e2e): cover the assistant in real browsers`

### Task 12: Try it with real providers

No automated test calls a provider, so this task is a manual check. It
changes no file unless it finds a bug.

- [ ] **Step 1:** Ask the repository owner for a key of each provider and a
  model for each. Never write a key to a file in the repository or to a log.
- [ ] **Step 2:** For each provider, start a development server on a copy
  of the data (`PORT=3001 DATA_DIR=<copy>` with the three variables in the
  environment of that command only), and in the browser: plan a week with a
  PDF attached; ask for a change to one slot; apply; create a recipe with a
  new ingredient; archive a recipe; discard.
- [ ] **Step 3:** For each failure, write the failing test at the lowest
  level that reproduces it, typically an adapter test with the provider's
  real answer as the fixture, fix it, and commit it as `fix(assistant):
  ...`, folded into the commit of the task it belongs to.
- [ ] **Step 4:** Report to the owner what you tried and what you saw, per
  provider.
