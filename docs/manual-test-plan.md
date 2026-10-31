# Manual test plan

This plan checks what only a real browser or device can check: layout and
scrolling, native browser behavior such as the focus trap in a dialog and
the leave-page prompt, real network timing, screen readers, and the system
clock. The automated tests (`npm test`) cover the rest, including the page
scripts against a simulated DOM. Run sections 1 to 10 before you merge a
change to the user interface. Run section 13 on the host before you merge a
change to `deploy/` or `scripts/`, and when you move an installation.

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
1000 px wide or wider. Tests that say "mobile" use the real phone. To *edit a
slot* means to click it, add a recipe or change servings in the editor, and
click **Done**.

Tests marked *Optional*, and all of sections 11 and 12, are optional. Run
every other test.

## Set up a test server

The test server uses its own empty data directory, so the tests don't change
your real data. To set up the test server, do the following:

1. If a development server is running on port `3001`, stop it. In its
   terminal, press `Control+C`. A deployed Meals on port `3000` can keep
   running.
1. Create an empty test directory. If one is left from an earlier run,
   delete it first, as in [Clean up](#clean-up).

   ```bash
   mkdir ~/meals-test
   ```

1. Start the test server on port `3001`. If the phone can't reach it,
   open the port as in [Open the app](../README.md#open-the-app), with
   `3001` instead of `3000`.

   ```bash
   DATA_DIR=~/meals-test PORT=3001 npm start
   ```

1. In a second terminal, add the test recipes:

   ```bash
   for name in "Gnocchi carbonara" "Green salad" "Lentil soup" "Omelette" "Russian salad" \
     "<b>Bold</b> soup" "Supercalifragilisticexpialidocious-casserole-with-a-very-long-name"; do
     curl -s -X POST -H 'Content-Type: application/json' -d "{\"name\":\"$name\"}" \
       http://localhost:3001/api/recipes; echo
   done
   ```

1. Add the test ingredients:

   ```bash
   for entry in Egg:pcs Milk:ml Onion:g Rice:g; do
     curl -s -X POST -H 'Content-Type: application/json' \
       -d "{\"name\":\"${entry%%:*}\",\"unit\":\"${entry##*:}\"}" \
       http://localhost:3001/api/ingredients; echo
   done
   ```

Keep the server's terminal open. Several tests ask you to stop the server with
`Control+C` and start it again with the same command.

## 1. Week navigation on desktop

| ID  | Step | Expected result |
|-----|------|-----------------|
| 1.1 | Open `http://localhost:3001` with no hash. | The address ends in `#MONDAY`, and the range shows the current week, for example `Sep 21 – 27, 2026`. |
| 1.2 | Click `›`, and then click `‹`. | The range and the hash change to the next week, and then back to the current week. |
| 1.3 | In the next week, edit a slot: add `Lentil soup`. Click `‹`. | The recipe doesn't appear in the current week. When you click `›` again, the slot shows `Lentil soup` with `×1`. |
| 1.4 | In the next week, reload the page. | The page still shows the next week. |
| 1.5 | Click `›` five times as fast as you can. | The range, the hash, and the grid all show the same week. No menu appears in the wrong week. |
| 1.6 | Go to `http://localhost:3001/#2026-12-28`. | The range shows `Dec 28, 2026 – Jan 3, 2027`. |
| 1.7 | Click **Today**. | The page shows the current week. |
| 1.8 | Open a new tab and go to `http://localhost:3001`. Click `›` twice, and then click the browser's **Back** button. | The browser goes back to the new tab page. It doesn't step through weeks. Typing a hash by hand, as in `1.6`, does add a history entry. |
| 1.9 | Look at the sidebar. Click the sidebar button at its top. Reload the page. | The sidebar lists **Meal plan**, **Recipes** with the number of active recipes, and **Ingredients** with the number of active ingredients, and marks **Meal plan**. The button hides the sidebar, and the grid widens. After the reload, the sidebar stays hidden. |
| 1.10 | Click the sidebar button in the toolbar. Make the window 800 px wide, and reload. | The sidebar shows again. At 800 px, it still shows, because you chose to show it. |

## 2. Week in the URL

| ID  | Step | Expected result |
|-----|------|-----------------|
| 2.1 | Change the hash to `#hello`, then to a Tuesday such as `#2026-09-22`, then to `#2026-02-30`. | Each time, the hash changes back to the displayed week, and nothing else changes. |
| 2.2 | In a new tab, go to `http://localhost:3001/#hello`. | The page shows the current week, and the hash changes to `#MONDAY`. |

## 3. Dates and today marker

| ID  | Step | Expected result |
|-----|------|-----------------|
| 3.1 | On desktop, show the current week. | The day headers read like `MON 21` through `SUN 27`. Only today's name is green, with its number in a green circle. A light green band shades today's column, from its header to its last slot, behind the slots. |
| 3.2 | On desktop, show the next week. | No column is marked. The day headers show the dates of that week. |
| 3.3 | On mobile, show the current week. | Each day button shows a letter over a number, and a gray dot marks the days with menus. Today's letter and number are green, and when today is selected, its number is in a green circle. The title above the day bar names today and its date, followed by `· Today`. |
| 3.4 | On mobile, select another day. | Today stays green, and a black circle marks the selected day. The title names the selected day and its date, without `· Today`. |
| 3.5 | Switch the system to the dark appearance, and look at each page and editor. Switch it back. | The pages and the editors turn dark, and every text stays readable. They turn light again. |

## 4. Mobile

| ID  | Step | Expected result |
|-----|------|-----------------|
| 4.1 | On the phone, go to `http://IP_ADDRESS:3001`, as in [Open the app](../README.md#open-the-app). | The page shows the current week with today selected. Each meal shows its name over a card with its menu and **Add**. A tab bar at the bottom lists **Meal plan**, **Recipes**, and **Ingredients**. |
| 4.2 | Select Thursday and tap `›`. | Thursday of the next week is selected. |
| 4.3 | Tap **Today**. | The page shows the current week with today selected. |
| 4.4 | Go to the week of December 28, 2026. | The toolbar shows `Dec 28 – Jan 3` between `‹` and `›`, and the page doesn't scroll sideways. |
| 4.5 | Tap `›` several times, very fast. | The page changes weeks and doesn't zoom. It ends on one week, and the buttons still work. |
| 4.6 | Scroll down the page. | The toolbar and the tab bar stay in place, and the page scrolls under them. The last meal scrolls clear of the tab bar. |
| 4.7 | Tap a slot. | The editor rises from the bottom and fills the screen below the status bar, and the keyboard doesn't open. |
| 4.8 | Open a slot with at least two recipes, and tap the red button before the first one. | The keyboard doesn't open. Tap **Cancel**. |
| 4.9 | Open a slot, and tap **Add recipe**. | The keyboard opens, and the page doesn't zoom. |
| 4.10 | Open a slot, type in **Add recipe**, and tap an empty area inside the editor below its buttons. | The editor stays open and keeps the text. |
| 4.11 | Add a recipe, switch to another app, and come back. | The editor is still open with the recipe you added. Tap **Cancel**. |
| 4.12 | Optional, on Android. Open a slot, add a recipe, and use the system **Back** gesture or button. | The editor closes without saving, and the slot doesn't change. |
| 4.13 | In Safari, tap **Share**, and then **Add to Home Screen**. Open Meals from the Home Screen. | The Home Screen shows the Meals icon. The app opens without the browser's bars. The toolbar clears the status bar, and the tab bar clears the home indicator. |
| 4.14 | Stop the server. Select a day that already has menus, edit one of its slots, and select another day. Tap `›`. | The dot under the edited day is red, not gray. The alert appears in the middle of the screen, **Stay** has focus, and the keyboard doesn't open. On Android, the system **Back** gesture closes the alert like **Stay**. Tap **Stay**, start the server, and tap **Retry**. |

## 5. Slot editor

Run these tests on desktop.

| ID  | Step | Expected result |
|-----|------|-----------------|
| 5.1 | Click an empty slot, which shows `+`. | The editor opens, titled with the meal, such as `Lunch`, over the day, such as `Monday, Sep 21`. The menu reads `Nothing planned. Add a recipe below.`, and the list under **Add recipe** shows the test recipes from A to Z. |
| 5.2 | Type `SOUP`. Then type `omelétte`, with an accent. | `SOUP` shows `<b>Bold</b> soup` and `Lentil soup`. `omelétte` shows `Omelette`. |
| 5.3 | Clear the field, type `salad`, press `↓`, and press `Enter`. | `Russian salad` appears in the menu with `1`. The field clears, and the list no longer offers `Russian salad`. |
| 5.4 | Click `Green salad` in the list. | `Green salad` appears below `Russian salad`, with `1`. |
| 5.5 | On `Green salad`, click `+` three times and `−` once. | The servings read `1.5`, `2`, `2.5`, and then `2`. |
| 5.6 | On `Russian salad`, click `−` once. | The servings read `0.5`. `−` is disabled, and focus moves to `+`. |
| 5.7 | Click **Done**. | The editor closes. The slot shows `Russian salad` with `×0.5` and `Green salad` with `×2`. The toolbar shows `Saving…` and then `All changes saved`, which disappears after a few seconds. The slot has focus. |
| 5.8 | Open the slot, type `sal` in **Add recipe**, press the mouse button down in the field, drag out to the dark area outside the editor, and release the button there. | The editor stays open and keeps the text. |
| 5.9 | Open a slot, type `sal`, and press `Escape`. Press `Escape` again. | The first `Escape` clears the field, and the editor stays open. The second closes the editor without saving. |
| 5.10 | Open a slot and, without changing anything, click the dark area outside the editor. | The editor closes. |
| 5.11 | Open a slot, click `+`, and click the dark area outside the editor. | The editor stays open with the change. Click **Cancel**. |
| 5.12 | Open the slot and type `xyz`. | The list disappears, and `No active recipes match. Add recipes on the Recipes page.` appears. |
| 5.13 | Add `Supercalifragilisticexpialidocious-casserole-with-a-very-long-name` to a slot and click **Done**. Repeat on mobile. | The name wraps inside the slot and inside the editor. The page doesn't scroll sideways. |
| 5.14 | Open a slot, add a recipe, and reload the page. | The browser asks whether to leave. Click **Cancel** or **Stay**: the editor still has the recipe. |
| 5.15 | In the editor from `5.14`, click **Cancel**, and reload the page. | The page reloads without asking. |
| 5.16 | Open a slot and press `Tab` repeatedly. | Focus moves through the editor's controls and never reaches the page behind it. |
| 5.17 | Optional. Run the command after this table to add 20 recipes, reload, and add all 20 to one slot. | After the 20th, focus moves to **Done**. |

The command for `5.17`:

```bash
for index in $(seq 1 20); do
  curl -s -X POST -H 'Content-Type: application/json' -d "{\"name\":\"Filler $index\"}" \
    http://localhost:3001/api/recipes > /dev/null
done
```

## 6. Saves and unsaved changes

These tests stop and start the test server. Run them on desktop.

| ID  | Step | Expected result |
|-----|------|-----------------|
| 6.1 | Edit a slot and click `›` right after **Done**. | The page changes weeks. When you go back, the slot has the change. You might not see `All changes saved`, because the new week appears as soon as the save succeeds. |
| 6.2 | Stop the server. Edit a slot. | The slot shows the change with a red outline and **Retry**. Its day header has a red dot, and the toolbar shows `1 not saved · Retry`. |
| 6.3 | Click the slot from `6.2`. | The editor shows the change that wasn't saved, not the saved menu. Click **Cancel**. |
| 6.4 | Click `›`. | An alert titled `1 meal wasn't saved` names the slot, such as `Monday lunch couldn't be saved. If you leave this week, it goes back to its last saved menu.` **Stay** has focus. |
| 6.5 | Click **Stay**. | The page stays on the same week, and the slot keeps the change and **Retry**. |
| 6.6 | Start the server, and click **Retry** on the slot. | The slot is saved. Clicking `›` changes weeks without the question. |
| 6.7 | Click `‹`. Stop the server. Edit a slot that you didn't use in `6.2`, and click `›`. When the question appears, click **Leave Without Saving**. | The range changes to the next week, and the page shows `Couldn't load the meal plan.` |
| 6.8 | Start the server. Go back to the browser window and click **Retry**. Then click `‹`. | **Retry** loads the next week without the question. In the previous week, the slot from `6.7` doesn't have the discarded change. |
| 6.9 | Stop the server. Click `›` to get `Couldn't load the meal plan.` again, and then click `‹` and `›`. Start the server and click **Retry**. | While the server is stopped, the range and the hash change, and the question doesn't appear. **Retry** loads the week in the range. |
| 6.10 | Stop the server, and edit two slots. Start the server, and click `2 not saved · Retry` in the toolbar. | Both slots are saved, and the toolbar shows `All changes saved`. |
| 6.11 | Stop the server, edit a slot, and click `›`. Press `Tab` several times, and then press `Escape`. Start the server afterward, and click **Retry**. | Focus starts on **Stay** and moves only between **Stay** and **Leave Without Saving**, never to the page behind. `Escape` closes the alert, and the page stays on the week with **Retry** on the slot. |

## 7. Saves when the page is hidden

When you reload, close, or hide the page, the app sends again every slot whose
save is pending or failed. It never sends the changes in an open editor.
Tests `7.4` and `7.5` pause the server, which makes a request wait with no
answer until the app gives up after 5 seconds. In those tests, answer the
question with **Stay** only: the paused server receives the request later
and might still save it, so **Leave Without Saving** can't discard it.

| ID  | Step | Expected result |
|-----|------|-----------------|
| 7.1 | On desktop, stop the server and edit a slot, so that it shows **Retry**. Start the server, and reload the page. | After the reload, the slot has the change. |
| 7.2 | Stop the server and edit a slot. Start the server, close the tab, and open the app again. | The slot has the change. |
| 7.3 | On mobile, stop the server and edit a slot. Start the server, switch to another app, and come back. | The slot is saved and shows no **Retry**. |
| 7.4 | Optional. In the server's terminal, press `Control+Z` to pause the server. On desktop, edit a slot and click `›` right after **Done**. | After about 5 seconds, the slot shows **Retry** and the question appears. Click **Stay**. In the terminal, run `fg` to resume the server, and click **Retry**: the slot is saved. |
| 7.5 | Optional. Pause the server with `Control+Z`. On mobile, edit a slot, switch to another app, and come back. Tap `›`. | Same as `7.4`. |

## 8. Recipe book

Run these tests on desktop unless a test says otherwise.

| ID  | Step | Expected result |
|-----|------|-----------------|
| 8.1 | On the meal plan, click **Recipes** in the sidebar. | The recipe book opens, titled `Recipes` with the number of active recipes, and the sidebar marks **Recipes**. It lists the test recipes from A to Z, and has no **Archived** section. |
| 8.2 | Look at the row for `Omelette`. | A warning icon and `No ingredients · not in shopping list` show in orange under the name, and a chevron sits at the right end of the row. |
| 8.3 | Click **New recipe** in the toolbar. | The editor opens, titled `New recipe`, with focus in **Name** and the text `No ingredients yet. You can save it, but the shopping list can't count it.` |
| 8.4 | Type `Tortilla`. In **Add ingredient**, type `eg`, and press `Enter`. | `Egg` appears with `pcs` and an empty quantity field, which has focus. |
| 8.5 | Type `1,25` in the quantity, and press `Enter`. | The editor closes. `Tortilla` appears in its sorted place with `Egg` under its name, and its row has focus. |
| 8.6 | Click the row of `Tortilla`. | The quantity reads `1.25`, and focus is on the title. |
| 8.7 | Replace the quantity with `1.255`, and click **Done**. Then type `1.3` instead. | `Enter a quantity from 0.01 to 10000, with up to two decimals.` appears below the row, focus moves to the field, and the editor stays open. The message disappears as you type the corrected quantity, and focus stays in the field. |
| 8.8 | Click the dark area outside the editor. | The editor stays open. Click **Cancel**: the editor closes, nothing is saved, and focus is on the row of `Tortilla`. |
| 8.9 | Click the row of `Lentil soup`, change the name to `Red lentil soup`, and press `Enter`. | The row shows `Red lentil soup` in its sorted place. |
| 8.10 | Go to the meal plan, show the next week, and look at the slot from `1.3`. | It shows `Red lentil soup` with `×1`. |
| 8.11 | On the recipe book, click the row of `Omelette`, change the name to `Green salad`, and click **Done**. | The editor stays open with `"Green salad" already exists.` below **Name**. Press `Escape`: the editor closes. |
| 8.12 | Open `Omelette`, and click **Archive** at the end of the editor. Click **New recipe**, type `Omelette`, and click **Done**. | The editor closes, `Omelette` moves under **Archived**, and the counts in the title and the sidebar go down by one. The new editor reads `"Omelette" is archived. To use it, restore it from Archived.` Click **Cancel**. |
| 8.13 | Click **New recipe**, type a name, and reload the page. | The browser asks whether to leave. Click **Cancel** or **Stay**: the editor keeps the name. Click **Cancel** in the editor. |
| 8.14 | Open `Green salad`, which the slot from `5.7` uses, and click **Archive**. Go to the meal plan. | The slot still shows `Green salad` with `×2`. In its editor, `+` on `Green salad` followed by **Done** saves without **Retry**. |
| 8.15 | Open a recipe, and change its name. Stop the server, and click **Done**. Then click **Archive**. Click **Cancel**, and click **Restore** on `Green salad`. | The editor shows `Couldn't save the recipe. Try again.` and keeps your change. **Archive** shows `Couldn't archive the recipe. Try again.`, and the editor stays open. **Restore** shows `Couldn't restore the recipe. Try again.` below the row. |
| 8.16 | Start the server, open a recipe, change its name, and click **Done**. | The recipe is saved, and the editor closes. |
| 8.17 | Stop the server again, and click the row of a recipe. Then reload the recipe book. Start the server and click **Retry**. | The editor doesn't open: the page shows `Couldn't load the recipes.` with focus on **Retry**. After the reload, the page shows the same message, and **Retry** loads the recipe book. |
| 8.18 | On mobile, open the recipe book from the tab bar, and tap `+` in the toolbar. | The editor rises from the bottom and fills the screen, the keyboard opens for **Name**, and the page doesn't zoom or scroll sideways. |
| 8.19 | On mobile, add an ingredient to the recipe, and tap its quantity field. | The keyboard offers digits and a decimal separator. `0,25` is accepted when you tap **Done**. |
| 8.20 | On desktop, open `Tortilla`, change its name, and click **Archive**. Click **Keep Editing**. Then click **Archive** again, and click **Archive Without Saving**. | An alert titled `Archive without saving?` appears over the editor, with focus on **Keep Editing**. **Keep Editing** closes the alert and keeps the new name in the editor. **Archive Without Saving** archives `Tortilla` with its old name. Click **Restore** under **Archived**. |

## 9. Ingredients

Run these tests on desktop unless a test says otherwise. They build on the
earlier sections, and section 10 builds on them.

| ID   | Step | Expected result |
|------|------|-----------------|
| 9.1  | Click **Ingredients** in the sidebar. | The page lists `Egg pcs`, `Milk ml`, `Onion g`, and `Rice g`, with each unit at the right end of its row, before the chevron. The sidebar marks **Ingredients**. |
| 9.2  | Click **New ingredient** in the toolbar. | The editor opens, titled `New ingredient`, with focus in **Name**. **Unit** shows `g`, `ml`, and `pcs`, with none chosen. The editor shows **Measures** with no rows and **Add measure**. |
| 9.3  | Type `Flour`, and click **Done**. | `Choose a unit.` appears, focus moves to `g` in **Unit**, and the editor stays open. |
| 9.4  | Choose `g`, click **Add measure**, and click **Done**. | A measure row appears with focus in its name, and `g` after its amount field. After **Done**, `Enter a name.` appears below the row, and focus moves to the name. |
| 9.5  | Type `cup` as the name and `0` as the amount, and click **Done**. Then type `120,5` as the amount, and click **Done**. | The first **Done** shows `Enter an amount from 0.01 to 10000, with up to two decimals.` below the row. The message disappears as you type the corrected amount, and focus stays in the field. The second **Done** closes the editor. `Flour` appears in its sorted place as `g · cup`, and its row has focus. |
| 9.6  | Click **New ingredient**, type `ONION`, choose `pcs`, and click **Done**. | `"Onion" already exists.` appears below **Name**. Click **Cancel**. |
| 9.7  | Open `Flour`, and click **Archive**. Click **New ingredient**, type `flour`, choose `g`, and click **Done**. Click **Cancel**, and then click **Restore** under **Archived**. | The editor shows `"Flour" is archived. To use it, restore it from Archived.` below **Name**. After **Restore**, `Flour` is back in the list. |
| 9.8  | Open `Onion`. Add the measures `medium` with `150` and `large` with `250`. Add a third measure named `MEDIUM` with `100`, and click **Done**. | `"MEDIUM" is already a measure.` appears below the third row. Click the red button on that row: focus moves to the red button on `large`. Click **Done**: the editor closes, and `Onion` reads `g · medium, large`. |
| 9.9  | In the recipe book, open `Russian salad`. In **Add ingredient**, type `oni` and look at the list. Add `Onion`. | The list offers `Onion (g)`. The new row shows a measure list after the quantity, which starts on `g` and offers `g`, `medium (150 g)`, and `large (250 g)`. |
| 9.10 | Choose `medium (150 g)`, type `2` as the quantity, and click **Done**. Open `Russian salad` again. | The editor shows `Onion` with `2` and `medium (150 g)`. Click **Cancel**. |
| 9.11 | In **Ingredients**, open `Onion`. | On `medium`, the red button is disabled, with `Used in 1 recipe.` below the row. On `large`, the red button is enabled. Click **Cancel**. |
| 9.12 | Open `Onion`, and choose `pcs` in **Unit**. | A conversion row appears, reading `1 g = [ ] pcs`. It has no **Saved as measure** field, because no recipe has `Onion` in grams. The measure rows are read-only, and the red buttons and **Add measure** are disabled. |
| 9.13 | Type `150` in the first field of the conversion row and `1` in the second. Then choose `g` in **Unit**. | The conversion row reads `150 g = 1 pcs`, and the measures show `1` and `1.67`. After you choose `g`, the conversion row disappears and the measures read `150` and `250` again. Click **Cancel**. |
| 9.14 | Click **New ingredient**, type `Carrot`, choose `pcs`, and click **Done**. In the recipe book, add `Carrot` with the quantity `2` to `Gnocchi carbonara`. | `Carrot` appears as `pcs`. In the recipe, `Carrot` has no measure list, only the unit `pcs`. |
| 9.15 | Keep the recipe book open in this tab, tab A. Open **Ingredients** in a second tab, tab B. Open `Carrot`, and choose `g` in **Unit**. | A conversion row appears, reading `1 pcs = [ ] g`, with a **Saved as measure** field that reads `pcs`. **Unit** is enabled. |
| 9.16 | Click **Done** with the second field empty. Then type `120` in it, and click **Done**. | The first **Done** shows `Enter a number from 0.01 to 10000, with up to two decimals.` and moves focus to the empty field. The second closes the editor, and `Carrot` reads `g · pcs`. |
| 9.17 | In tab A, which loaded before the conversion, open `Gnocchi carbonara`, change the quantity of `Carrot` to `3`, and click **Done**. Then change it back to `2` the same way. | The editor first shows `Carrot` with `2` and `pcs (120 g)`, and then with `3` and `pcs (120 g)`, so the recipe keeps its meaning. Close tab A, and continue in tab B. |
| 9.18 | Open `Egg`, and choose `g` in **Unit**. | The conversion row reads `1 pcs = [ ] g`, with `pcs` in its **Saved as measure** field, because `Tortilla` uses `Egg` in `pcs`. Click **Cancel**: `Egg` still reads `pcs`. |
| 9.19 | Open `Milk`, choose `g`, and click **Done**. Then change it back to `ml`. | No conversion row appears, because `Milk` has no measures and no recipe uses it. `Milk` shows `g`, and then `ml` again. |
| 9.20 | Open `Milk`. Open the recipe book in a second tab, and add `Milk` to a recipe. In the first tab, choose `g`, and click **Done**. | The editor stays open with `"Milk" has measures or recipes in ml. Reload the page to change its unit.` Click **Cancel**, open `Milk` again, and choose `g`: the conversion row appears, with `ml` in **Saved as measure**. Click **Cancel**. |
| 9.21 | Click **New ingredient**, type a name, and choose a unit. Stop the server, and click **Done**. | `Couldn't save the ingredient. Try again.` appears, and the name and the unit stay. |
| 9.22 | Click **Cancel**, and reload the page. Start the server, and click **Retry**. | The page shows `Couldn't load the ingredients.`, and **Retry** loads the catalog. |
| 9.23 | On mobile, open the Ingredients page from the tab bar, and tap an ingredient. | The editor fills the screen, and no keyboard opens until you tap **Name**. |
| 9.24 | On mobile, tap `Onion`, choose `pcs` in **Unit**, and tap **Cancel**. Then tap `Egg`, and choose `g`. | Every measure row and conversion row fits the width with all its fields and buttons, including **Saved as measure** for `Egg`. The page doesn't scroll sideways. |
| 9.25 | On mobile, tap the amount of a measure, and then a field of the conversion row. | The keyboard offers digits and a decimal separator. `0,25` is accepted when you tap **Done**. |
| 9.26 | On mobile, tap the name of a measure, the amount of a measure, a field of the conversion row, and **Saved as measure**. Then edit a recipe, and tap the measure list of an ingredient. | Each time, the page doesn't zoom. |
| 9.27 | On mobile, in the recipe book, edit `Russian salad`, and choose `large (250 g)` for `Onion`. | The measure list fits the row with its long label, and the row doesn't push the quantity off the screen. The page doesn't scroll sideways. |
| 9.28 | Open `Onion`, press `Tab` until **Unit** has focus, and press `→` twice. Click **Cancel**. | A focus ring shows on `g`, and the choice moves to `ml` and then to `pcs`. |

## 10. Shopping list

| ID  | Step | Expected result |
|-----|------|-----------------|
| 10.1 | In the next week, add `Tortilla` to Tuesday's lunch with 2 servings. Click **Shopping list**. | The list is titled `Shopping list` over the week's range, reads `1 ingredient · from A to Z · totals rounded up`, and lists `Egg 3 pcs`. Below, a warning icon and `Not included: these recipes have no ingredients.` list the week's other recipes with their slots, such as `Red lentil soup`. |
| 10.2 | Press `Escape`. | The dialog closes, and **Shopping list** has focus. |
| 10.3 | Show a week with no menus, and click **Shopping list**. | The dialog reads `This week has no menus yet.` Click outside the dialog: it closes. |
| 10.4 | Stop the server. In the week from `10.1`, change `Tortilla` to 3 servings, and click **Done**. When **Retry** appears, click **Shopping list**. | The list shows `Egg 4 pcs`: 1.25 × 3 = 3.75, rounded up. Close it, start the server, and retry the save. |
| 10.5 | With the shopping list open, change the week in the address bar, and press `Enter`. | The address goes back, and the dialog stays open on the same week. |
| 10.6 | In the recipe book, edit `Red lentil soup`: add `Onion`, keep `g`, and type `220`. Edit `Gnocchi carbonara`: add `Onion`, choose `large (250 g)`, and type `1`. | Both recipes are saved. |
| 10.7 | In the next week, add `Russian salad` with 2 servings and `Gnocchi carbonara` with 1 serving to Wednesday's lunch. Click **Shopping list**. | The list reads `Carrot 240 g` over `(2 pcs)`, `Egg 4 pcs`, and `Onion 1.1 kg` over `(220 g, 4 medium, 1 large)`: 220 g + 4 × 150 g + 250 g = 1070 g. The **Not included** section no longer appears. |
| 10.8 | In **Ingredients**, edit `Onion` and change `medium` to `300`. Go back to the week, and click **Shopping list**. | `Onion` reads `1.7 kg (220 g, 4 medium, 1 large)`: 1670 g, rounded up to tenths. |
| 10.9 | Change `medium` to `132.5`, and open the shopping list. Then change it to `132`, and open the list again. | With `132.5`, `Onion` reads `1 kg (220 g, 4 medium, 1 large)`: 1000 g. With `132`, it reads `998 g (220 g, 4 medium, 1 large)`. |
| 10.10 | On mobile, tap **Shopping list** in a week with many ingredients. | The list rises from the bottom and fills the screen, scrolls inside it, and the page doesn't scroll sideways. A line with a breakdown stays inside the list. |

## 11. Keyboard and screen readers (optional)

| ID  | Step | Expected result |
|-----|------|-----------------|
| 11.1 | On desktop, press `Tab` until `›` has focus, and press `Enter` several times. | Each press shows the next week, and focus stays on `›`. |
| 11.2 | Stop the server, press `Tab` until `›` has focus, and press `Enter`. Press `Tab` until **Retry** has focus, and press `Enter`. | **Retry** keeps focus when the load fails again. Start the server afterward. |
| 11.3 | With a screen reader, such as VoiceOver or NVDA, change weeks. | The screen reader announces the new range. The buttons read `Previous week`, `Next week`, and `Today`. |
| 11.4 | On mobile, with VoiceOver or TalkBack, move through the day bar. | The day buttons read like `Monday, September 21`. |
| 11.5 | With a screen reader, move to a slot and open it. | The slot reads like `Monday, Lunch: Green salad × 2`, or `Monday, Lunch: empty`. The editor announces its title. The stepper buttons read like `Increase servings of Green salad`, and the servings are announced when they change. |
| 11.6 | In the editor, type in **Add recipe** and press `↓`. | The screen reader announces the highlighted recipe. |
| 11.7 | With a screen reader, edit a slot. Then stop the server, and edit it again. | The screen reader announces `Saving Monday lunch` and `Saved Monday lunch`, and then `Couldn't save Monday lunch`, with the slot's day and meal. Start the server afterward. |
| 11.8 | With a screen reader, move through the rows of the recipe book. | Each row reads like `Edit Omelette`, followed by its ingredients or `No ingredients · not in shopping list`. |

## 12. Day and week changes (optional)

These tests change the computer's clock. Set the clock back when you finish.
Don't run `12.1` and `12.2` on a Sunday: the next day starts a new week, so
the marker leaves the displayed week instead of moving.

| ID  | Step | Expected result |
|-----|------|-----------------|
| 12.1 | With the page open on the current week, set the clock to the next day. Switch to another tab and back. | The today marker moves to the new day. |
| 12.2 | Make the browser window narrower than 700 px. With the clock still set to the next day and the page visible, click **Today**. | The new day is selected in the day bar, and the marker is on the new day. |
| 12.3 | Set the clock to the next Monday, and click **Today**. | The page shows the week of `NEXT_MONDAY`. |

## 13. Host

Run these tests on the host, from a checkout of the branch or release
that you test. Tests `13.4`, `13.5`, `13.9`, and `13.10` need published
releases.

CI already checks the units with `npm run test:units` and `npm test`, and
runs `meals-backup`, `meals-restore`, and `meals-restore-check` against
Docker with `npm run test:host`. These tests check only what needs the real
host: systemd, the `deployer` user, the real data, GitHub, and GHCR.

| ID   | Step | Expected result |
|------|------|-----------------|
| 13.1 | On a host with no earlier installation, run `sudo scripts/install.sh`. Then run `id deployer` and `stat -c '%A %U:%G %n' /opt/server /opt/server/meals /opt/server/meals/data`. | `id` shows the group `docker`. The output reads `drwxrwsr-x root:docker /opt/server`, and `drwxrwsr-x deployer:docker` for the other two. `/opt/server/meals/hold` exists. |
| 13.2 | Run `systemctl list-timers 'meals-*'`. | The list shows `meals-backup.timer`, `meals-deploy.timer`, and `meals-restore-check.timer`, each with a next run. |
| 13.3 | Run `sudo scripts/install.sh` again, and compare `/opt/server/meals/.env` with its content before. | The file is unchanged, and `hold` still exists. |
| 13.4 | Move the data in, as in [Move an existing installation](deployment.md#move-an-existing-installation). | `curl http://localhost:3000/api/health` returns `ok` and the release's version, every week, recipe, and ingredient is there, and `stat -c '%A' /opt/server/meals/data` reads `drwxrwsr-x`. |
| 13.5 | On an installation whose data has no measures, run `sudo -u deployer meals-deploy` with an older release's version, such as `0.2.0`. Then run `sudo -u deployer meals-deploy --resume` and `sudo systemctl start meals-deploy`. | The health check reports the older version and `hold` exists. After the resume, it reports the latest version again. |
| 13.6 | Rename a recipe in the app. Run `sudo systemctl start meals-backup`, rename the recipe again, and restore the new `daily` backup with `sudo -u deployer meals-restore`. | The recipe has the first new name, and `backups/` has a new `pre-restore` backup. |
| 13.7 | Run `sudo systemctl start meals-restore-check`, and then `journalctl -u meals-restore-check -n 5`. | The journal reads `The backup ... restores into version ...`. `docker ps -a` lists no `meals-restore-check` container. |
| 13.8 | Reboot the host. | Within 2 minutes after boot, `curl http://localhost:3000/api/health` returns `ok`, and `systemctl list-timers 'meals-*'` lists the three timers. |
| 13.9 | Remove the image of an older release with `docker image rm`, and block GHCR with `echo '127.0.0.1 ghcr.io' \| sudo tee -a /etc/hosts`. Run `sudo -u deployer meals-deploy` with that release's version. Then delete the line from `/etc/hosts`. | The command fails with `Couldn't pull`. The health check still reports the same version, `hold` doesn't exist, and `failed` doesn't list the release. |
| 13.10 | Merge a release pull request. When `gh release view` lists `image.txt`, wait 5 minutes without running any command on the host. | `curl http://localhost:3000/api/health` reports the new version, and `journalctl -u meals-deploy` shows `Deployed version`. |

## Clean up

To remove the test server and its data, do the following:

1. In the test server's terminal, press `Control+C`.
1. Delete the test directory:

   ```bash
   rm -r ~/meals-test
   ```

Your real data in `data/` is unchanged.
