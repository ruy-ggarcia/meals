# Week navigation design

Date: 2026-09-26

## Context and goal

Meals shows a single weekly grid of 7 days by 5 meals. The grid is generic:
it has no dates, and planning a new week means overwriting the previous one.

**Goal:** an unlimited number of weeks, in the past and in the future. You
move between weeks with previous, next, and today controls, and you always see
the date range of the week on screen. On desktop, the app highlights today's
column. On mobile, it marks today in the day bar.

## Decisions

| Topic | Decision |
|-------|----------|
| Week boundaries | Monday to Sunday. |
| Week identifier | The date of the week's Monday, formatted as `YYYY-MM-DD`. For example, `2026-09-21`. |
| Storage | One JSON file per week in `data/weeks/`. A week without a file is empty. |
| Existing data | On startup, the server moves `data/week.json` to the current week. |
| Editing | Every week is editable, including past weeks. |
| Today | The browser's local date decides which day and week are today. The server uses its own local date only for the migration. |
| Week in the URL | The URL hash holds the displayed week, so a reload keeps it. |
| Mobile day selection | Changing weeks keeps the selected day of the week. **Today** selects today. |
| Dates on days | Desktop day headers and mobile day bar buttons show the day of the month. |
| Unsaved changes | The app never leaves a week with unsaved text without asking first. |

## Architecture

The following tree shows the new and changed files:

```none
meals/
  data/
    weeks/
      2026-09-21.json  # One file per week, created on the first save.
  public/
    app.js             # Week navigation, today marker, URL hash.
    dates.js           # New. Pure date helpers, with no DOM access.
    index.html         # Week bar.
    saves.js           # Page-hide save waits, failed page-hide saves, discarding.
    styles.css         # Week bar, today marker, dates on days.
  server/
    app.js             # New /api/weeks routes.
    index.js           # Runs the migration before it listens.
    store.js           # Per-week files, week validation, migration.
  test/
    api.test.js
    dates.test.js      # New.
    store.test.js
```

The frontend still depends only on the HTTP API. The server and
`public/dates.js` each have their own small week helpers, so that the frontend
never imports from `server/`.

## Data model

A week file has the same format as the current `week.json`: all 7 days, each
with all 5 meals, where each meal is a string. On read, the store normalizes
the data as it does today.

A week identifier is valid when all of the following are true:

- It matches `^\d{4}-\d{2}-\d{2}$`.
- It is a real calendar date. For example, `2026-02-30` isn't valid.
- The date is a Monday.

The server validates identifiers in UTC, so the result doesn't depend on the
server's time zone.

## Server

### `server/store.js`

- `isWeekId(week)` returns `true` for a valid week identifier.
- `weekIdOf(date)` returns the identifier of the week that contains `date`,
  using the server's local time. A Sunday belongs to the week of the previous
  Monday.
- `readWeek(week)` reads `data/weeks/WEEK.json`. If the file doesn't exist, it
  returns an empty week. If the file contains invalid JSON, it throws, as it
  does today.
- `saveCell(week, day, meal, text)` works as today, on the file of the given
  week: read, change the cell, write to `WEEK.json.tmp`, and rename over
  `WEEK.json`. It creates `data/weeks/` if needed. It throws `RangeError` if
  the week, day, or meal isn't valid. All saves share one queue, so two saves
  never interleave.
- `migrateLegacyWeek(week)` handles data from the single-week version:
  - If `data/week.json` doesn't exist, it does nothing.
  - If `data/weeks/WEEK.json` doesn't exist, it moves `data/week.json` there
    with `rename` and logs the move. It doesn't parse the file, so a file with
    invalid JSON keeps its exact content.
  - If `data/weeks/WEEK.json` already exists, it leaves both files unchanged
    and logs a warning.

### `server/index.js`

Before the server listens, it calls
`store.migrateLegacyWeek(weekIdOf(new Date()))`.

### API

The `/api/week` routes are removed. Their only client is the frontend in this
repository, which changes at the same time.

| Route | Status | Meaning |
|-------|--------|---------|
| `GET /api/weeks/WEEK` | `200` | The body is the full week. A week without a file returns empty cells. |
| | `404` | `WEEK` isn't a valid week identifier. |
| `PUT /api/weeks/WEEK/DAY/MEAL` | `200` | The cell was saved. The body is `{ "week", "day", "meal", "text" }`. |
| | `400` | `text` is missing, isn't a string, or is longer than 2000 characters. |
| | `404` | `WEEK`, `DAY`, or `MEAL` isn't a valid identifier. |

Any other `/api` path returns a JSON `404`, as it does today.

## Frontend

### `public/dates.js`

This module holds all date logic. It works in the browser's local time and
never touches the DOM, so tests import it directly in Node.js.

- `dayIndex(date)` returns the position of `date` in its week, from `0` for
  Monday to `6` for Sunday.
- `weekIdOf(date)` returns the identifier of the week that contains `date`.
- `isWeekId(id)` returns `true` for a valid week identifier.
- `weekStart(id)` returns the Monday of the week as a local `Date` at
  midnight.
- `addDays(date, days)` returns a new local `Date`. It changes the calendar
  day, not the time, so a daylight saving time change doesn't shift the
  result.
- `addWeeks(id, weeks)` returns the identifier of another week.
- `formatWeekRange(id)` returns the range from Monday to Sunday. It uses
  `Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year:
  "numeric" }).formatRange`, which shares the month and year when they're the
  same:
  - Same month: `Sep 21 – 27, 2026`
  - Two months: `Sep 28 – Oct 4, 2026`
  - Two years: `Dec 28, 2026 – Jan 3, 2027`
- `formatLongDate(date)` returns the full date without the year, for example
  `Monday, September 21`.

### Week bar

The page header shows the week bar below the title, at every screen width:

```none
‹   Sep 21 – 27, 2026   ›   Today
```

- The `‹` and `›` buttons have the accessible names `Previous week` and
  `Next week`.
- The range label has `aria-live="polite"`, so screen readers announce the
  new week.
- **Today** is always enabled. It shows the current week and selects today
  in the mobile day bar.
- The week bar isn't sticky. On mobile, the day bar stays sticky as it is
  today.

### Dates on days

- On desktop, each day header shows the weekday and the day of the month, for
  example `Monday 21`.
- On mobile, each day bar button shows the weekday letter with the day of the
  month below it, for example `M` over `21`. Its accessible name is the full
  date, for example `Monday, September 21`.

### Today marker

When the displayed week contains today, the app marks today with the accent
color, the green `#2e7d32` that the day bar already uses:

- On desktop, today's day header uses the accent color, and today's cells
  have a light accent tint.
- On mobile, today's day bar button has an accent outline. The selected day
  keeps its filled green background, so the two states stay distinct. When
  today is selected, the button shows both.

The app sets a `data-today` attribute on the marked elements. It updates the
marker on every week change, including when the target week is already
displayed, and each time the page becomes visible again, so a page left open
overnight moves the marker to the new day.

### Week in the URL

- On page load, if `location.hash` holds a valid week identifier, such as
  `#2026-09-28`, the app shows that week. Otherwise, it shows the current
  week and writes its identifier to the hash.
- Each week change updates the hash with `history.replaceState`, so it adds
  no browser history entries.
- A `hashchange` event, such as when you edit the URL by hand, shows the week
  in the new hash. An invalid hash is replaced with the displayed week.

### Changing weeks

Every week change (previous, next, **Today**, and hash changes) follows these
steps, in order:

1. Disable the week bar buttons and make the grid `inert`, so that you can't
   start a second change or type while the change runs.
1. Blur the focused textarea, if any, so that its save starts.
1. Wait for all pending saves of the displayed week, including saves sent
   when the page is hidden, before or during the wait. Each save gives up
   after 5 seconds.
1. If any cell of the displayed week still has text that differs from the
   last saved text, ask with `confirm()`:

   `Some changes in this week couldn't be saved. Leave anyway and discard them?`

   - **Cancel:** stay on the week. The cells keep their text and their red
     cross, so you can retry.
   - **OK:** put the last saved text back in the unsaved cells and clear
     their status, so that no later save can send the discarded text, and
     continue.

1. Update the hash and the range label, and load the new week. On success,
   fill the grid, update the day dates and the today marker, and keep the
   selected day. On failure, hide the grid and show
   `Couldn't load the meal plan.`. **Retry** loads the same week again.
1. Enable the week bar buttons and remove `inert` from the grid.

If the target week is the displayed week, only the day selection and the
today marker change.

### Save state

`public/saves.js` keeps the save state and the status of each cell. Its keys
include the week, for example `2026-09-21/mon/lunch`, so the same cell in two
weeks never shares save state. `app.js` shows a status only when its week is
on screen. The timers that hide the check mark (`savedTimers`, in `app.js`)
belong to the cell element, because they act on what is on screen: filling
the grid with a new week clears them, so a timer from the previous week can't
hide a status in the new one. The grid stores the loaded week in `data-week`.

`saves.js` also provides what a week change needs:

- `settle()` waits for all pending saves, including page-hide saves that
  start while it waits.
- `unsaved(keys)` lists the cells whose text differs from the saved text.
- `discard(key)` returns the saved text of a cell and clears its status.

A failed page-hide save marks its cell as an error, unless a newer save
replaced its text or is running. Page-hide saves give up after the same time
as other saves.

## Testing

### Automated tests

The tests use `node:test` and `supertest`, as they do today.

- `test/store.test.js`:
  - `isWeekId` accepts a Monday and rejects another weekday, a date that
    doesn't exist, and a wrong format.
  - `weekIdOf` maps each day from Monday to Sunday to that week's Monday.
  - `readWeek` returns an empty week when the file doesn't exist.
  - A save in one week doesn't change another week.
  - An invalid week throws `RangeError`.
  - `migrateLegacyWeek` moves the file, does nothing without a legacy file,
    leaves both files unchanged when the target exists, and keeps a file with
    invalid JSON byte for byte.
- `test/api.test.js`:
  - `GET` and `PUT` on `/api/weeks/...` return `200`, `400`, and `404` as the
    API table describes.
  - A week that isn't a Monday, or isn't a date, returns `404`.
  - `GET /api/week` returns `404`.
- `test/saves.test.js`:
  - `settle` waits for queued saves and page-hide saves, including a
    page-hide save that starts during the wait.
  - A failed or timed-out page-hide save marks the cell as an error, unless
    a newer save replaced its text.
  - `unsaved` lists changed cells, and after `discard`, a save sends
    nothing.
- `test/dates.test.js`:
  - `weekIdOf` maps a Sunday to the previous Monday.
  - `addDays` across the end of daylight saving time in Europe, on
    October 25, 2026, returns midnight of the next calendar day. The test
    file sets `process.env.TZ` to `Europe/Madrid` before it creates any
    date, so the result doesn't depend on the machine's time zone.
  - `addWeeks` crosses months and years.
  - `formatWeekRange` covers a single month, two months, and two years. The
    tests replace Unicode space characters with plain spaces before they
    compare, because `Intl` output uses thin spaces around the dash.

### Manual checks

Check the following in a desktop browser and in a mobile browser, or with
mobile emulation:

- The previous, next, and **Today** buttons change the week and the range.
- Text saved in one week doesn't appear in other weeks, and it's still there
  after a reload.
- A reload keeps the displayed week.
- The today marker appears only in the current week, on desktop and mobile.
- On mobile, changing weeks keeps the selected day, and **Today** selects
  today.
- With the server stopped, editing a cell and then changing weeks shows the
  `confirm()` question. **Cancel** keeps the text. **OK** changes the week.
- On the first start after the upgrade, the existing meal plan appears in the
  current week.

## Documentation

Update `README.md`:

- **Use the app:** the week bar, the today marker, the week in the URL, and
  the question about unsaved changes.
- **Configure the server:** `DATA_DIR` stores `weeks/`.
- **Back up and restore data:** copy `data/weeks/` to back up, and restore a
  single week file to recover. Describe the automatic move of `week.json`.
- **API reference:** the `/api/weeks` routes.
- **Project structure:** `public/dates.js`.

## Out of scope

- Real-time updates from other devices.
- Copying or deleting weeks.
- A date picker or keyboard shortcuts for navigation.
