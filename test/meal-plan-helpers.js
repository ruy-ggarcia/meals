// Setup that the tests of the meal plan page (public/app.js) share: the
// tests of the week in test/meal-plan-page.test.js, and of the shopping
// list in test/shopping-list-page.test.js.

import { fakeFetch, openPage, tick, typeInto, waitFor } from "./dom-helpers.js";

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const MEALS = ["breakfast", "snack_am", "lunch", "snack_pm", "dinner"];
export const WEEK = "2026-09-21"; // a Monday

/** A week with every slot holding an empty menu. */
export function blankWeek() {
  return Object.fromEntries(
    DAYS.map((day) => [day, Object.fromEntries(MEALS.map((meal) => [meal, { items: [] }]))]),
  );
}

/** `weekData` with the menu of one slot replaced by `items`. */
export function withSlot(weekData, day, meal, items) {
  return { ...weekData, [day]: { ...weekData[day], [meal]: { items } } };
}

/**
 * Loads the meal plan page on `week`, and answers its first requests with
 * `weekData`, `recipes`, and `ingredients`. Resolves to `{ page, server }`.
 * The test `t` cleans the page up when it ends.
 *
 * @param {import("node:test").TestContext} t
 */
export async function openMealPlan(
  t,
  { week = WEEK, weekData = blankWeek(), recipes = [], ingredients = [] } = {},
) {
  const server = fakeFetch();
  const page = await openPage(t, {
    html: "index.html",
    script: "app.js",
    fetch: server.fetch,
    url: `http://localhost/#${week}`,
  });
  await tick();
  await answerWeekLoad(server, week, { weekData, recipes, ingredients });
  return { page, server };
}

/**
 * Answers the three requests that a week load sends: the week, the recipes,
 * and the ingredients.
 */
export async function answerWeekLoad(
  server,
  week,
  { weekData = blankWeek(), recipes = [], ingredients = [] } = {},
) {
  server.requestFor("GET", `/api/weeks/${week}`).respond(200, weekData);
  server.requestFor("GET", "/api/recipes").respond(200, { recipes });
  server.requestFor("GET", "/api/ingredients").respond(200, { ingredients });
  await tick();
}

/** The button of the slot of `day` and `meal`, such as `mon` and `lunch`, in `page`. */
export function slotButton(page, day, meal) {
  return page.document.querySelector(`.slot[data-day="${day}"][data-meal="${meal}"] .slot-menu`);
}

/**
 * Adds the first recipe that matches `query` to a slot with the slot editor,
 * and confirms with Done. Resolves to the save request that Done queues.
 */
export async function addWithEditor(page, server, day, meal, query) {
  slotButton(page, day, meal).click();
  typeInto(page.window, page.document.querySelector("#slot-editor .option-search"), query);
  page.document.querySelector("#slot-editor .option").click();
  page.document.querySelector("#slot-editor .done").click();
  const url = `/api/weeks/${WEEK}/${day}/${meal}`;
  await waitFor(() => server.requestFor("PUT", url) !== undefined);
  return server.requestFor("PUT", url);
}
