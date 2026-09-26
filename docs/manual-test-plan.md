# Manual test plan

This test plan checks the app in real browsers: the grid, saves, the week bar,
the week in the URL, dates on days, the today marker, and the upgrade from a
single week. The automated tests (`npm test`) cover the server, the date
helpers, and the save logic. This plan covers what only a person with a
browser can check. Run it before you merge a change to the user interface.

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
768 px wide or wider. Tests that say "mobile" use the real phone.

Sections 1 to 7 are required, except tests `7.4` and `7.5`, which are
optional. Sections 8 and 9 are optional.

## Set up a test server

The test server uses a copy of your meal plan, so the tests don't change your
real data. To set up the test server, do the following:

1. If a server is running on port `3000`, stop it. In its terminal, press
   `Control+C`.
1. Copy your meal plan to a test directory. If `data/` doesn't exist yet, the
   copy is empty, and the tests start from an empty plan.

   ```bash
   mkdir -p ~/meals-test && cp -r data/. ~/meals-test/ 2>/dev/null
   ```

1. Start the test server on the default port, `3000`, so that the phone can
   reach it:

   ```bash
   DATA_DIR=~/meals-test npm start
   ```

Keep this terminal open. Several tests ask you to stop the server with
`Control+C` and start it again with the same command.

## 1. Upgrade from a single week

Versions before week navigation stored one generic week in `week.json`. These
tests use a separate server on port `3001` with its own data, so that they
don't depend on your meal plan. Keep the test server from the previous
section running.

| ID  | Step | Expected result |
|-----|------|-----------------|
| 1.1 | In a second terminal, create a legacy file and start a server: `mkdir -p ~/meals-upgrade-test && printf '{"mon":{"lunch":"Paella"}}\n' > ~/meals-upgrade-test/week.json && DATA_DIR=~/meals-upgrade-test PORT=3001 npm start` | The log shows `Moved …/week.json to …/weeks/MONDAY.json.` |
| 1.2 | On desktop, go to `http://localhost:3001`. | The current week shows `Paella` for Monday's lunch. |
| 1.3 | Stop the server and start it again with the same command. | The log shows no `Moved` line. `Paella` is still there. |
| 1.4 | Stop the server, create the legacy file again with the same `printf` command, and start the server. | The log shows a warning that starts with `Didn't move`. Both `week.json` and `weeks/MONDAY.json` still exist. |
| 1.5 | Stop the server and delete its data: `rm -r ~/meals-upgrade-test` | The directory is gone. |

## 2. Week navigation on desktop

| ID  | Step | Expected result |
|-----|------|-----------------|
| 2.1 | Open `http://localhost:3000` with no hash. | The address ends in `#MONDAY`, and the range shows the current week, for example `Sep 21 – 27, 2026`. |
| 2.2 | Click `›`, and then click `‹`. | The range and the hash change to the next week, and then back to the current week. |
| 2.3 | In the next week, type in a cell and click outside it. Click `‹`. | The text doesn't appear in the current week. When you click `›` again, the text is there. |
| 2.4 | In the next week, reload the page. | The page still shows the next week. |
| 2.5 | Click `›` five times as fast as you can. | The range, the hash, and the grid all show the same week. No text appears in the wrong week. |
| 2.6 | Go to `http://localhost:3000/#2026-12-28`. | The range shows `Dec 28, 2026 – Jan 3, 2027`. |
| 2.7 | Click **Today**. | The page shows the current week. |
| 2.8 | Open a new tab and go to `http://localhost:3000`. Click `›` twice, and then click the browser's **Back** button. | The browser goes back to the new tab page. It doesn't step through weeks. Typing a hash by hand, as in `2.6`, does add a history entry. |

## 3. Week in the URL

| ID  | Step | Expected result |
|-----|------|-----------------|
| 3.1 | Change the hash to `#NEXT_MONDAY` by hand. | The page shows the next week. |
| 3.2 | Change the hash to `#hello`, then to a Tuesday such as `#2026-09-22`, then to `#2026-02-30`. | Each time, the hash changes back to the displayed week, and nothing else changes. |
| 3.3 | In a new tab, go to `http://localhost:3000/#hello`. | The page shows the current week, and the hash changes to `#MONDAY`. |

## 4. Dates and today marker

| ID  | Step | Expected result |
|-----|------|-----------------|
| 4.1 | On desktop, show the current week. | The day headers read like `Monday 21` through `Sunday 27`. Only today's header is green, and today's column has a light green tint. |
| 4.2 | On desktop, show the next week. | No column is marked. The day headers show the dates of that week. |
| 4.3 | On mobile, show the current week. | Each day button shows a letter over a number. Today's button has a green outline. When today is selected, its button is filled green with a white inner ring. |
| 4.4 | On mobile, select another day. | The green outline stays on today, and the green fill moves to the selected day. |

## 5. Mobile

| ID  | Step | Expected result |
|-----|------|-----------------|
| 5.1 | On the phone, go to `http://IP_ADDRESS:3000`, where `IP_ADDRESS` is the computer's address. | The page shows the current week with today selected. |
| 5.2 | Select Thursday and tap `›`. | Thursday of the next week is selected. |
| 5.3 | Tap **Today**. | The page shows the current week with today selected. |
| 5.4 | Go to the week of December 28, 2026. | The range `Dec 28, 2026 – Jan 3, 2027` fits on one line, and the page doesn't scroll sideways. |
| 5.5 | Tap `›` several times, very fast. | The page changes weeks and doesn't zoom. It ends on one week, and the buttons still work. |
| 5.6 | Scroll down the page. | The day bar stays at the top. The week bar scrolls away. |

## 6. Saves and unsaved changes

These tests stop and start the test server. Run them on desktop.

| ID  | Step | Expected result |
|-----|------|-----------------|
| 6.1 | Type in a cell and click `›` right away, without clicking anywhere else first. | The page changes weeks. When you go back, the text is there. You might not see the check mark, because the new week appears as soon as the save succeeds. |
| 6.2 | Repeat `6.1` in Safari. | Same as `6.1`. Safari doesn't give focus to buttons on click, so it takes a different path. |
| 6.3 | Stop the server. Type in a cell and click `›`. | The cell shows a red cross, and the app asks `Some changes in this week couldn't be saved. Leave anyway and discard them?` |
| 6.4 | Click **Cancel**. | The page stays on the same week, and the cell keeps the text and the red cross. |
| 6.5 | Start the server, and click the red cross. | The cell is saved. Clicking `›` changes weeks without the question. |
| 6.6 | Click `‹`. Stop the server. Type in a cell that you didn't use in `6.3`, and click `›`. When the question appears, click **OK**. | The range changes to the next week, and the page shows `Couldn't load the meal plan.` |
| 6.7 | Start the server. Go back to the browser window and click **Retry**. Then click `‹`. | **Retry** loads the next week without the question. In the previous week, the cell from `6.6` doesn't have the discarded text. |
| 6.8 | Stop the server. Click `›` to get `Couldn't load the meal plan.` again, and then click `‹` and `›`. Start the server and click **Retry**. | While the server is stopped, the range and the hash change, and the question doesn't appear. **Retry** loads the week in the range. |

## 7. Saves when the page is hidden

When you reload, close, or hide the page while a cell is focused, the app
saves the cell. Tests `7.4` and `7.5` are optional. They pause the server,
which makes a request wait with no answer until the app gives up after 5
seconds. In those tests, answer the question with **Cancel** only: the paused
server receives the request later and might still save it, so **OK** can't
discard it.

| ID  | Step | Expected result |
|-----|------|-----------------|
| 7.1 | On desktop, type in a cell and reload the page without leaving the cell. | After the reload, the text is there. |
| 7.2 | Type in a cell and close the tab without leaving the cell. Open the app again. | The text is there. |
| 7.3 | On mobile, type in a cell, switch to another app without leaving the cell, and come back. | The text is saved, and the cell shows no red cross. |
| 7.4 | Optional. In the server's terminal, press `Control+Z` to pause the server. On desktop, type in a cell and click `›` right away. | After about 5 seconds, the cell shows a red cross and the question appears. Click **Cancel**. In the terminal, run `fg` to resume the server, and click the red cross: the cell is saved. |
| 7.5 | Optional. Pause the server with `Control+Z`. On mobile, type in a cell, switch to another app without leaving the cell, and come back. Tap `›`. | Same as `7.4`. |

## 8. Keyboard and screen readers (optional)

| ID  | Step | Expected result |
|-----|------|-----------------|
| 8.1 | On desktop, press `Tab` until `›` has focus, and press `Enter` several times. | Each press shows the next week, and focus stays on `›`. |
| 8.2 | Stop the server, press `Tab` until `›` has focus, and press `Enter`. Press `Tab` until **Retry** has focus, and press `Enter`. | **Retry** keeps focus when the load fails again. Start the server afterward. |
| 8.3 | With a screen reader, such as VoiceOver or NVDA, change weeks. | The screen reader announces the new range. The buttons read `Previous week`, `Next week`, and `Today`. |
| 8.4 | On mobile, with VoiceOver or TalkBack, move through the day bar. | The day buttons read like `Monday, September 21`. |

## 9. Day and week changes (optional)

These tests change the computer's clock. Set the clock back when you finish.
Don't run `9.1` and `9.2` on a Sunday: the next day starts a new week, so the
marker leaves the displayed week instead of moving.

| ID  | Step | Expected result |
|-----|------|-----------------|
| 9.1 | With the page open on the current week, set the clock to the next day. Switch to another tab and back. | The today marker moves to the new day. |
| 9.2 | Make the browser window narrower than 768 px. With the clock still set to the next day and the page visible, click **Today**. | The new day is selected in the day bar, and the marker is on the new day. |
| 9.3 | Set the clock to the next Monday, and click **Today**. | The page shows the week of `NEXT_MONDAY`. |

## Clean up

To remove the test server and its data, do the following:

1. In the test server's terminal, press `Control+C`.
1. Delete the test directory:

   ```bash
   rm -r ~/meals-test
   ```

Your real meal plan in `data/` is unchanged.
