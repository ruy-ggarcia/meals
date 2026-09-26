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

Tests marked *Optional*, and all of sections 9 and 10, are optional. Run
every other test.

## Set up a test server

The test server uses its own empty data directory, so the tests don't change
your real meal plan or recipe book. To set up the test server, do the
following:

1. If a server is running on port `3000`, stop it. In its terminal, press
   `Control+C`.
1. Create an empty test directory. If one is left from an earlier run,
   delete it first, as in [Clean up](#clean-up).

   ```bash
   mkdir ~/meals-test
   ```

1. Start the test server on the default port, `3000`, so that the phone can
   reach it:

   ```bash
   DATA_DIR=~/meals-test npm start
   ```

1. In a second terminal, add the test recipes:

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
| 4.1 | On the phone, go to `http://IP_ADDRESS:3000`, as in [Open the app](../README.md#open-the-app). | The page shows the current week with today selected. Each slot shows its meal name over its menu or `+ Add`. |
| 4.2 | Select Thursday and tap `›`. | Thursday of the next week is selected. |
| 4.3 | Tap **Today**. | The page shows the current week with today selected. |
| 4.4 | Go to the week of December 28, 2026. | The range `Dec 28, 2026 – Jan 3, 2027` fits on one line, and the page doesn't scroll sideways. |
| 4.5 | Tap `›` several times, very fast. | The page changes weeks and doesn't zoom. It ends on one week, and the buttons still work. |
| 4.6 | Scroll down the page. | The day bar stays at the top. The week bar scrolls away. |
| 4.7 | Tap a slot. | The editor fills the screen, and the keyboard doesn't open. |
| 4.8 | Open a slot with at least two recipes, and tap **Remove** on the first one. | The keyboard doesn't open. Tap **Cancel**. |
| 4.9 | Open a slot, and tap **Add recipe**. | The keyboard opens, and the page doesn't zoom. |
| 4.10 | Open a slot, type in **Add recipe**, and tap an empty area inside the editor below its buttons. | The editor stays open and keeps the text. |
| 4.11 | Add a recipe, switch to another app, and come back. | The editor is still open with the recipe you added. Tap **Cancel**. |
| 4.12 | Optional, on Android. Open a slot, add a recipe, and use the system **Back** gesture or button. | The editor closes without saving, and the slot doesn't change. |

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
| 5.8 | Open the slot, click `+`, click the editor's title, and press `Enter`. | Same as **Done**: the editor closes and saves the change. |
| 5.9 | Open the slot again, click **Remove** on `Russian salad`, and click **Cancel**. | The slot doesn't change, and no save icon appears. |
| 5.10 | Open a slot, add `Russian salad` and `Green salad`, and click **Remove** on `Russian salad`. Then click **Remove** again. | Each time, focus moves to the **Remove** button of the row now in that place; after the second click, the list is empty and focus moves to the editor's title. Click **Cancel**. |
| 5.11 | Open the slot, click `+`, and press `Escape`. | Same as `5.9`. |
| 5.12 | Open the slot, type `sal`, and press `Escape`. Press `Escape` again. | The first `Escape` clears the field, and the editor stays open. The second closes the editor. |
| 5.13 | Open the slot and, without changing anything, click the dark area outside the editor. | The editor closes. |
| 5.14 | Open the slot, click `+`, and click outside the editor. | The editor stays open with the change. Click **Cancel**. |
| 5.15 | Open the slot, type `sal` in **Add recipe**, press the mouse button down in the field, drag out to the dark area outside the editor, and release the button there. | The editor stays open and keeps the text. |
| 5.16 | Open the slot and type `xyz`. | The list disappears, and `No recipes found. Add them on the Recipes page.` appears. |
| 5.17 | Add `<b>Bold</b> soup` to a slot and click **Done**. | The slot and the editor show the name with the tags as literal text, not in bold. |
| 5.18 | Add `Supercalifragilisticexpialidocious-casserole-with-a-very-long-name` to a slot and click **Done**. Repeat on mobile. | The name wraps inside the slot and inside the editor. The page doesn't scroll sideways. |
| 5.19 | Open a slot, change the hash by hand to `#NEXT_MONDAY`. | The hash changes back, the editor stays open, and the week doesn't change. |
| 5.20 | Open a slot, add a recipe, and reload the page. | The browser asks whether to leave. Click **Cancel** or **Stay**: the editor still has the recipe. |
| 5.21 | In the editor from `5.20`, click **Cancel**, and reload the page. | The page reloads without asking. |
| 5.22 | Open a slot and press `Tab` repeatedly. | Focus moves through the editor's controls and never reaches the page behind it. |
| 5.23 | Optional. Run the command after this table to add 20 recipes, reload, and add all 20 to one slot. | After the 20th, **Add recipe** is disabled and reads `A menu holds up to 20 recipes.` Focus moves to **Done**. |

The command for `5.23`:

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
Tests `7.4` and `7.5` pause the server, which makes a request wait with no
answer until the app gives up after 5 seconds. In those tests, answer the
question with **Cancel** only: the paused server receives the request later
and might still save it, so **OK** can't discard it.

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
| 8.11 | Click **Rename** on `Omelette`, type `y`, press `Tab` to move focus to **Save**, and press `Escape`. | The field closes, the name stays `Omelette`, and nothing is saved. |
| 8.12 | Click **Rename** on `Omelette`, type `Green salad`, and click **Save**. | The field stays open, with `"Green salad" already exists.` below the row. Press `Escape`: the field closes. |
| 8.13 | Click **Rename** on one recipe, don't type, and then click **Archive** on another recipe. | The rename field closes, and the other recipe is archived with that single click. |
| 8.14 | Click **Rename** on one recipe, don't type, and press `Tab`. | The rename field closes, and focus moves to the next control, not to the top of the page. |
| 8.15 | Optional. Pause the server with `Control+Z`, click **Archive** on a recipe, and start typing in **Search**. Run `fg` in the server's terminal. | The recipe is archived, and focus stays in **Search** with your text. |
| 8.16 | Type `sal` in **Search**. Then type `zzz`. | `sal` shows only the salads. `zzz` shows `No recipes match "zzz".` Clear the search. |
| 8.17 | Archive `Green salad`, which the slot from `5.7` uses. Go to the meal plan. | The slot still shows `Green salad × 2`. In its editor, the list doesn't offer `Green salad`, and `+` on it followed by **Done** saves without a red cross. |
| 8.18 | Stop the server. Add a recipe, rename a recipe, and archive a recipe. | Each shows its `Couldn't … Try again.` message, and nothing changes. |
| 8.19 | Start the server. In **New recipe**, add a recipe with a new name. | The recipe is added, and the archive error message from `8.18` disappears from its row. |
| 8.20 | Archive `Omelette`. In **New recipe**, type `Omelette`, and press `Enter`. | `Omelette` moves under **Archived**. Adding shows `"Omelette" is archived.` with **Restore it**. |
| 8.21 | Stop the server, and click **Restore it**. | After a moment, `Couldn't restore the recipe. Try again.` appears, followed by **Restore it**, which is still there. |
| 8.22 | Start the server, and click **Restore it** again. | `Omelette` is restored, the message disappears, and the field is empty. |
| 8.23 | Stop the server again, and reload the recipe book. Start the server and click **Retry**. | The page shows `Couldn't load the recipes.`, and **Retry** loads the recipe book. |
| 8.24 | On mobile, open the recipe book, and tap **New recipe**. | The keyboard opens, the page doesn't zoom, and the page doesn't scroll sideways. |

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
