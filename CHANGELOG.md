# Changelog

## 0.1.0 (2026-09-26)

Initial release. Meals is a weekly meal planner for the home network: a
grid of 7 days by 5 meals, shared by every desktop and mobile browser on the
network.

### Features

* Plan any week, past or future, with previous, next, and Today controls.
* Keep the displayed week in the URL, show the dates in the day headers, and
  mark today.
* Save each slot when you leave it, change days or weeks, or hide the page,
  and show its save status. Changing weeks never discards unsaved text
  without asking.
* Store each week in its own JSON file under `data/weeks/`, written
  atomically.
