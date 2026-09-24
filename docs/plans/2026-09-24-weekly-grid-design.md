# Weekly grid design

Date: 2026-09-24

## Context and goal

Meals is a web app for planning a family's weekly menu. It runs in desktop and
mobile browsers.

**Goal:** a single grid of 7 days by 5 meals, where each cell stores a list
of dishes as free text. Every device on the home network shares the same grid.

## Decisions

| Topic | Decision |
|-------|----------|
| Hosting | A server on the local network (LAN), without authentication. |
| Time scope | A single generic week (Monday to Sunday) that gets overwritten. |
| Meals | Breakfast, Morning snack, Lunch, Afternoon snack, Dinner. |
| Cell editing | One `<textarea>` per cell, with one dish per line. |
| Stack | Node.js and Express, plain HTML, CSS, and JavaScript with no framework or build step, and a JSON file for storage. |
| Contract | The HTTP API is the stable contract between the frontend and the backend. |

## Architecture

```
meals/
  data/
    week.json     # Created on the first save. Ignored by Git.
  public/
    app.js
    index.html
    styles.css
  server/
    app.js        # Creates the Express app (API routes and static files).
    index.js      # Startup: listens on 0.0.0.0:${PORT:-3000}.
    store.js      # The only module that touches disk: reads the week and saves cells.
  test/
    api.test.js
    store.test.js
  package.json
```

- `app.js` receives the store through dependency injection
  (`createApp({ store })`), so that tests can run it against a temporary
  directory.
- `store.js` is created with `createStore({ dataDir })`. The `DATA_DIR`
  environment variable sets the data directory. The default is `./data`.
- The frontend depends only on the HTTP API, not on any server module.

## Data model

The API and the storage format use these stable identifiers:

- Days: `mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun`
- Meals: `breakfast`, `snack_am`, `lunch`, `snack_pm`, `dinner`

Display labels live only in the frontend.

A week (`week.json` and the `GET /api/week` response) is an object with all 7
days. Each day has all 5 meals, and each meal is a string. An empty cell is
`""`.

```json
{
  "mon": { "breakfast": "Toast\nJuice", "snack_am": "", "lunch": "", "snack_pm": "", "dinner": "" },
  "tue": { "breakfast": "", "snack_am": "", "lunch": "", "snack_pm": "", "dinner": "" }
}
```

This example shows 2 days. A real response always includes all 7 days and all
5 meals.

On read, the store normalizes the data: any day or meal that is missing from
the file is returned as `""`, so the response is always complete.

## API contract

All responses are JSON.

### `GET /api/week`

- `200`: the full 7 × 5 week. If the file doesn't exist, the week is empty.

### `PUT /api/week/:day/:meal`

- Body: `{ "text": "<string>" }`
- `200`: `{ "day": "<day>", "meal": "<meal>", "text": "<string>" }`
- `404`: `{ "error": "..." }` if `day` or `meal` isn't a valid identifier.
- `400`: `{ "error": "..." }` if `text` is missing, isn't a string, or is longer
  than 2000 characters.

The server stores the text exactly as received, without trimming or other
changes.

## Persistence and concurrency

- Writes are atomic: the store writes `week.json.tmp` and then renames it to
  `week.json`.
- Writes are serialized in-process through a promise queue, so two concurrent
  `PUT` requests can't overwrite each other's read-modify-write cycle.
- Between users, the last write to a cell wins. There's no real-time sync;
  other people's changes appear after a page reload.

## User interface

**Desktop (768 px wide or more):** a grid of 7 columns (days) by 5 rows
(meals). Each cell is a `<textarea>`. The day and meal headers stay fixed
while scrolling (`position: sticky`).

**Mobile (less than 768 px wide):** a single-day view. A bar at the top has 7
buttons (M T W T F S S) for switching days. Below it, the day's 5 meals are
stacked, each with its own text area. The current day is shown by default. The
HTML is the same for both layouts; CSS switches the layout, and JavaScript
manages a selected-day attribute.

**Saving:** when a text area loses focus and its value changed since the last
save, the frontend sends a `PUT` request. Each cell shows its status:
`Saving…`, then `✓`, which disappears after a few seconds, or
`Couldn't save. Retry`, which is clickable. On error, the text stays in the
cell.

**Loading:** when the page opens, the frontend sends `GET /api/week`. If the
request fails, a message appears at the top with a **Retry** button, and the
grid isn't editable until the week loads.

## Tests

- `test/store.test.js` (with `node:test` and a temporary directory):
  - Returns an empty, complete week if the file doesn't exist.
  - Saves a cell and reads it back.
  - Normalizes an incomplete file.
  - Leaves no `.tmp` file behind after a save.
  - Keeps every save when saves to different cells run concurrently.
- `test/api.test.js` (with `node:test` and `supertest`):
  - `GET /api/week` returns `200` and a 7 × 5 week.
  - A valid `PUT` returns `200`, and a later `GET` reflects it.
  - An invalid day or meal returns `404`.
  - A missing, non-string, or longer-than-2000-character `text` returns `400`.
- Frontend: manual verification in desktop and mobile browsers.

To run the tests, use `npm test`. To start the server, use `npm start`.

## Out of scope

Dated weeks and history, structured dishes, real-time sync, authentication,
and deployment outside the LAN.
