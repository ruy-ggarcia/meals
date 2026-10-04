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
768 px wide or wider. Tests that say "mobile" use the real phone. To *edit a
slot* means to click it, add a recipe or change servings in the editor, and
click **Done**.

Tests marked *Optional*, and all of sections 11 and 12, are optional. Run
every other test.

## Set up a test server

The test server uses its own empty data directory, so the tests don't change
your real meal plan or recipe book. To set up the test server, do the
following:

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
| 1.3 | In the next week, edit a slot: add `Lentil soup`. Click `‹`. | The recipe doesn't appear in the current week. When you click `›` again, the slot shows `Lentil soup × 1`. |
| 1.4 | In the next week, reload the page. | The page still shows the next week. |
| 1.5 | Click `›` five times as fast as you can. | The range, the hash, and the grid all show the same week. No menu appears in the wrong week. |
| 1.6 | Go to `http://localhost:3001/#2026-12-28`. | The range shows `Dec 28, 2026 – Jan 3, 2027`. |
| 1.7 | Click **Today**. | The page shows the current week. |
| 1.8 | Open a new tab and go to `http://localhost:3001`. Click `›` twice, and then click the browser's **Back** button. | The browser goes back to the new tab page. It doesn't step through weeks. Typing a hash by hand, as in `1.6`, does add a history entry. |

## 2. Week in the URL

| ID  | Step | Expected result |
|-----|------|-----------------|
| 2.1 | Change the hash to `#hello`, then to a Tuesday such as `#2026-09-22`, then to `#2026-02-30`. | Each time, the hash changes back to the displayed week, and nothing else changes. |
| 2.2 | In a new tab, go to `http://localhost:3001/#hello`. | The page shows the current week, and the hash changes to `#MONDAY`. |

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
| 4.1 | On the phone, go to `http://IP_ADDRESS:3001`, as in [Open the app](../README.md#open-the-app). | The page shows the current week with today selected. Each slot shows its meal name over its menu or `+ Add`. |
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
| 5.8 | Open the slot, type `sal` in **Add recipe**, press the mouse button down in the field, drag out to the dark area outside the editor, and release the button there. | The editor stays open and keeps the text. |
| 5.9 | Open a slot, type `sal`, and press `Escape`. Press `Escape` again. | The first `Escape` clears the field, and the editor stays open. The second closes the editor without saving. |
| 5.10 | Open a slot and, without changing anything, click the dark area outside the editor. | The editor closes. |
| 5.11 | Open a slot, click `+`, and click the dark area outside the editor. | The editor stays open with the change. Click **Cancel**. |
| 5.12 | Open the slot and type `xyz`. | The list disappears, and `No matching recipes. To add recipes, use the Recipes page.` appears. |
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
| 8.1 | On the meal plan, click **Recipes**. | The recipe book opens with the test recipes from A to Z, each with a warning icon, and no **Archived** section. The title bar links to **Meal plan** and **Ingredients**. |
| 8.2 | Look at the row for `Omelette`, then hover over its warning icon. | The icon sits at the right end of the row, next to **Edit**. The tooltip reads `No ingredients`. |
| 8.3 | Click **New recipe**. | The editor opens, titled `New recipe`, with focus in **Name** and the text `No ingredients yet.` |
| 8.4 | Type `Tortilla`. In **Add ingredient**, type `eg`, and press `Enter`. | `Egg` appears with `pcs` and an empty quantity field, which has focus. |
| 8.5 | Type `1,25` in the quantity, and press `Enter`. | The editor closes. `Tortilla` appears in its sorted place without a warning icon, and its **Edit** button has focus. |
| 8.6 | Click **Edit** on `Tortilla`. | The quantity reads `1.25`, and focus is on the title. |
| 8.7 | Replace the quantity with `1.255`, and click **Done**. | `Enter a quantity from 0.01 to 10000, with up to two decimals.` appears below the row, focus moves to the field, and the editor stays open. |
| 8.8 | Click the dark area outside the editor. | The editor stays open. Click **Cancel**: the editor closes, nothing is saved, and focus is on the **Edit** button of `Tortilla`. |
| 8.9 | Click **Edit** on `Lentil soup`, change the name to `Red lentil soup`, and press `Enter`. | The row shows `Red lentil soup` in its sorted place. |
| 8.10 | Go to the meal plan, show the next week, and look at the slot from `1.3`. | It shows `Red lentil soup × 1`. |
| 8.11 | On the recipe book, click **Edit** on `Omelette`, change the name to `Green salad`, and click **Done**. | The editor stays open with `"Green salad" already exists.` below **Name**. Press `Escape`: the editor closes. |
| 8.12 | Archive `Omelette`. Click **New recipe**, type `Omelette`, and click **Done**. | `Omelette` moves under **Archived**, and the editor reads `"Omelette" is archived. To use it, restore it from Archived.` Click **Cancel**. |
| 8.13 | Click **New recipe**, type a name, and reload the page. | The browser asks whether to leave. Click **Cancel** or **Stay**: the editor keeps the name. Click **Cancel** in the editor. |
| 8.14 | Archive `Green salad`, which the slot from `5.7` uses. Go to the meal plan. | The slot still shows `Green salad × 2`. In its editor, `+` on `Green salad` followed by **Done** saves without a red cross. |
| 8.15 | Stop the server. Click **Edit** on a recipe, change its name, and click **Done**. Then archive a recipe. | The editor shows `Couldn't save the recipe. Try again.` and keeps your change. Archiving shows `Couldn't archive the recipe. Try again.` below the row. |
| 8.16 | Start the server, and click **Done** in the editor from `8.15`. | The recipe is saved, and the editor closes. |
| 8.17 | Stop the server again, and reload the recipe book. Start the server and click **Retry**. | The page shows `Couldn't load the recipes.`, and **Retry** loads the recipe book. |
| 8.18 | On mobile, open the recipe book, and tap **New recipe**. | The editor fills the screen, the keyboard opens for **Name**, and the page doesn't zoom or scroll sideways. |
| 8.19 | On mobile, add an ingredient to the recipe, and tap its quantity field. | The keyboard offers digits and a decimal separator. `0,25` is accepted when you tap **Done**. |

## 9. Ingredients

Run these tests on desktop unless a test says otherwise.

| ID  | Step | Expected result |
|-----|------|-----------------|
| 9.1 | Click **Ingredients** in the title bar. | The page lists `Egg pcs`, `Milk ml`, `Onion g`, and `Rice g`, with each unit next to its **Edit** button. The title bar links to **Meal plan** and **Recipes**. |
| 9.2 | In **New ingredient**, type `Flour`, and press `Enter`. | `Choose a unit.` appears, focus moves to the unit, and nothing is added. |
| 9.3 | Choose `g`, and click **Add**. | `Flour g` appears in its sorted place. The name clears, the unit goes back to `Choose a unit`, and focus returns to the name. |
| 9.4 | Type `ONION`, choose `pcs`, and click **Add**. | `"Onion" already exists.` appears. |
| 9.5 | Archive `Flour`. Type `flour`, choose `g`, and click **Add**. | `"Flour" is archived.` appears with **Restore it**. Click it: `Flour` is back in the list, and the field is empty. |
| 9.6 | Click **Edit** on `Egg`. | The editor shows `Egg` and `pcs`. **Unit** is disabled, with `Used in 1 recipe. To change the unit, remove the ingredient from that recipe first.` |
| 9.7 | Click **Cancel**. Click **Edit** on `Milk`, choose `g`, and click **Done**. Then change it back to `ml`. | `Milk` shows `g`, and then `ml` again. |
| 9.8 | Open the recipe book in a second tab, and add `Milk` to a recipe. In the first tab, click **Edit** on `Milk`, choose `g`, and click **Done**. | The editor stays open with `"Milk" is used in recipes. To change its unit, remove it from those recipes first.` Click **Cancel**. |
| 9.9 | Stop the server. Type a name, choose a unit, and click **Add**. | `Couldn't add the ingredient. Try again.` appears, and the name and the unit stay. |
| 9.10 | Reload the page. Start the server, and click **Retry**. | The page shows `Couldn't load the ingredients.`, and **Retry** loads the catalog. |
| 9.11 | On mobile, open the Ingredients page, and tap **Edit** on an ingredient. | The editor fills the screen, and no keyboard opens until you tap **Name**. |

## 10. Shopping list

| ID  | Step | Expected result |
|-----|------|-----------------|
| 10.1 | In the next week, add `Tortilla` to Tuesday's lunch with 2 servings. Click **Shopping list**. | The dialog is titled `Shopping list ·` and the week's range, and lists `Egg 3 pcs`. Below, a warning icon and `Not included: these recipes have no ingredients.` list the week's other recipes with their slots, such as `Red lentil soup`. |
| 10.2 | Press `Escape`. | The dialog closes, and **Shopping list** has focus. |
| 10.3 | Show a week with no menus, and click **Shopping list**. | The dialog reads `This week has no menus yet.` Click outside the dialog: it closes. |
| 10.4 | Stop the server. In the week from `10.1`, change `Tortilla` to 3 servings, and click **Done**. When the red cross appears, click **Shopping list**. | The list shows `Egg 4 pcs`: 1.25 × 3 = 3.75, rounded up. Close it, start the server, and retry the save. |
| 10.5 | With the shopping list open, change the week in the address bar, and press `Enter`. | The address goes back, and the dialog stays open on the same week. |
| 10.6 | On mobile, tap **Shopping list** in a week with many ingredients. | The dialog fills the screen, the list scrolls inside it, and the page doesn't scroll sideways. The week bar shows **Shopping list** on its own row. |

## 11. Keyboard and screen readers (optional)

| ID  | Step | Expected result |
|-----|------|-----------------|
| 11.1 | On desktop, press `Tab` until `›` has focus, and press `Enter` several times. | Each press shows the next week, and focus stays on `›`. |
| 11.2 | Stop the server, press `Tab` until `›` has focus, and press `Enter`. Press `Tab` until **Retry** has focus, and press `Enter`. | **Retry** keeps focus when the load fails again. Start the server afterward. |
| 11.3 | With a screen reader, such as VoiceOver or NVDA, change weeks. | The screen reader announces the new range. The buttons read `Previous week`, `Next week`, and `Today`. |
| 11.4 | On mobile, with VoiceOver or TalkBack, move through the day bar. | The day buttons read like `Monday, September 21`. |
| 11.5 | With a screen reader, move to a slot and open it. | The slot reads like `Monday, Lunch: Green salad × 2`, or `Monday, Lunch: empty`. The editor announces its title. The stepper buttons read like `Increase servings of Green salad`, and the servings are announced when they change. |
| 11.6 | In the editor, type in **Add recipe** and press `↓`. | The screen reader announces the highlighted recipe. |

## 12. Day and week changes (optional)

These tests change the computer's clock. Set the clock back when you finish.
Don't run `12.1` and `12.2` on a Sunday: the next day starts a new week, so
the marker leaves the displayed week instead of moving.

| ID  | Step | Expected result |
|-----|------|-----------------|
| 12.1 | With the page open on the current week, set the clock to the next day. Switch to another tab and back. | The today marker moves to the new day. |
| 12.2 | Make the browser window narrower than 768 px. With the clock still set to the next day and the page visible, click **Today**. | The new day is selected in the day bar, and the marker is on the new day. |
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
| 13.5 | Run `sudo -u deployer meals-deploy` with an older release's version, such as `0.2.0`. Then run `sudo -u deployer meals-deploy --resume` and `sudo systemctl start meals-deploy`. | The health check reports the older version and `hold` exists. After the resume, it reports the latest version again. |
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
