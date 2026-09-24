# Meals

Meals is a web app for planning a family's weekly menu. It shows a grid of 7
days by 5 meals (breakfast, morning snack, lunch, afternoon snack, and dinner).
Each cell holds a free-text list of dishes, one per line.

The app runs on a computer at home. Any device on the same network, desktop or
mobile, can use it from a browser.

## Before you begin

Install the following:

- Node.js 22 or later. To check your version, run `node --version`.
- npm. To check that it's installed, run `npm --version`.

## Start the server

1. Install the dependencies:

   ```bash
   npm install
   ```

1. Start the server:

   ```bash
   npm start
   ```

   The server prints a line similar to the following:

   ```none
   Meals listening on http://0.0.0.0:3000 (data: /path/to/meals/data)
   ```

To stop the server, press `Control+C`.

## Open the app

- On the computer that runs the server, go to `http://localhost:3000`.
- On a phone or another device on the home network, do the following:

  1. On the computer that runs the server, find its local IP address:

     ```bash
     hostname -I | awk '{print $1}'
     ```

     The output is an address such as `192.168.1.23`.

  1. On the device, connect to the same Wi-Fi network as the computer.
  1. In the device's browser, go to `http://IP_ADDRESS:3000`, where
     `IP_ADDRESS` is the address from the first step.

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

## Use the app

- **Desktop** (windows 768 px wide or wider): the full grid shows one column
  per day and one row per meal.
- **Mobile:** the app shows one day at a time. To switch days, tap a letter in
  the day bar (`M T W T F S S`). When the page opens, it shows the current day.

To plan a meal, type one dish per line in a cell. The app saves the cell when
you leave it, switch days, reload the page, or close the page. Below the cell,
an icon shows the save status:

| Icon             | Status                                                       |
|------------------|--------------------------------------------------------------|
| Gray clock       | The app is saving the cell.                                  |
| Green check mark | The cell is saved. The icon disappears after a few seconds. |
| Red cross        | The save failed. The cell keeps your text.                   |

To retry a failed save, click the red cross. To see what an icon means, hover
over it.

Changes from other devices don't appear in real time. To see them, reload the
page. If two people edit the same cell, the last save wins.

## Configure the server

The server reads the following environment variables:

| Variable   | Default  | Description                           |
|------------|----------|---------------------------------------|
| `DATA_DIR` | `./data` | The directory that stores `week.json`. |
| `PORT`     | `3000`   | The port that the server listens on.  |

For example, to store data in `/srv/meals` and listen on port 8080, run the
following command:

```bash
DATA_DIR=/srv/meals PORT=8080 npm start
```

## Back up and restore data

The whole meal plan lives in one file, `data/week.json`. The server creates it
on the first save. Git ignores it.

To back up the meal plan, copy the file:

```bash
cp data/week.json week.backup.json
```

If the file contains invalid JSON, the app shows
`Couldn't load the meal plan.` and doesn't overwrite the file. To recover, do
the following:

1. Restore a backup copy of `data/week.json`, or fix the JSON by hand.
1. In the app, click **Retry**.

## Check your changes

Before you commit, check your changes:

1. Apply the code format and safe lint fixes:

   ```bash
   npm run format
   ```

1. Check the code style. This command doesn't change any files, and it fails
   if the code has lint errors or isn't formatted:

   ```bash
   npm run lint
   ```

1. Run the tests:

   ```bash
   npm test
   ```

[Biome](https://biomejs.dev) checks the style of JavaScript, CSS, and JSON
files. The settings are in `biome.json`.

## Continuous integration

GitHub Actions runs `npm run lint` and `npm test` with Node.js 22 on every pull
request and on every push to `main`. The workflow is in
`.github/workflows/ci.yml`.

Changes reach `main` only through pull requests that pass the `ci` check, and
each pull request is integrated with a merge commit.

## Project structure

```none
.github/
  workflows/
    ci.yml   # Continuous integration: lint and tests.
public/      # User interface: HTML, CSS, and JavaScript, with no framework or build step.
server/
  app.js     # HTTP API (Express) and static files.
  index.js   # Startup: reads DATA_DIR and PORT and listens on 0.0.0.0.
  store.js   # Reads and writes week.json. The only module that touches disk.
test/        # Tests that use node:test and supertest.
biome.json   # Lint and format settings.
```

## API reference

The user interface depends only on this API.

### Get the week

`GET /api/week`

Returns `200` with the full week. The response contains the days `mon` through
`sun`. Each day contains the meals `breakfast`, `snack_am`, `lunch`,
`snack_pm`, and `dinner`, and each meal is a string.

### Save a cell

`PUT /api/week/DAY/MEAL`

Request body: `{ "text": "TEXT" }`

| Status | Meaning |
|--------|---------|
| `200`  | The cell was saved. The body is `{ "day", "meal", "text" }`. |
| `400`  | `text` is missing, isn't a string, or is longer than 2000 characters. Length is counted in UTF-16 code units, like JavaScript's `String.length`. |
| `404`  | `DAY` or `MEAL` isn't a valid identifier. |
