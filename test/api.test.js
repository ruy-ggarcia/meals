import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import request from "supertest";
import { createApp } from "../server/app.js";
import { createQueue } from "../server/files.js";
import { createRecipes } from "../server/recipes.js";
import { createWeeks } from "../server/weeks.js";
import { blankWeek } from "./helpers.js";

const EXPECTED_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const EXPECTED_MEALS = ["breakfast", "snack_am", "lunch", "snack_pm", "dinner"];

const WEEK = "2026-09-21";
const OTHER_WEEK = "2026-09-28";
// A Tuesday, an impossible date that JavaScript rolls over to a Monday, and non-dates.
const INVALID_WEEKS = ["2026-09-22", "2026-02-30", "2026-9-21", "hello"];

let dataDir;
let app;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "meals-api-"));
  const enqueue = createQueue();
  const recipes = createRecipes({ dataDir, enqueue });
  app = createApp({ recipes, weeks: createWeeks({ dataDir, enqueue, recipes }) });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

async function addRecipe(name) {
  const res = await request(app).post("/api/recipes").send({ name });
  assert.equal(res.status, 201, name);
  return res.body;
}

function assertJsonError(res, status, label) {
  assert.equal(res.status, status, label);
  assert.match(res.headers["content-type"], /application\/json/, label);
  assert.equal(typeof res.body.error, "string", label);
}

// ---------- Recipes ----------

test("GET /api/recipes returns an empty recipe book at first", async () => {
  const res = await request(app).get("/api/recipes");

  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /application\/json/);
  assert.deepEqual(res.body, { recipes: [] });
});

test("POST /api/recipes returns 201 with the new recipe, and GET lists it", async () => {
  const res = await request(app).post("/api/recipes").send({ name: "  Gnocchi  carbonara " });

  assert.equal(res.status, 201);
  assert.equal(typeof res.body.id, "string");
  assert.deepEqual(res.body, { id: res.body.id, name: "Gnocchi carbonara", archived: false });

  const get = await request(app).get("/api/recipes");
  assert.deepEqual(get.body, { recipes: [res.body] });
});

test("GET /api/recipes lists archived recipes too, from A to Z by name key", async () => {
  const omelette = await addRecipe("omelette");
  const cafe = await addRecipe("Café");
  await request(app).patch(`/api/recipes/${omelette.id}`).send({ archived: true });

  const res = await request(app).get("/api/recipes");
  assert.deepEqual(res.body, { recipes: [cafe, { ...omelette, archived: true }] });
});

test("POST /api/recipes with an invalid name returns 400 JSON and stores nothing", async () => {
  const bodies = [{}, { name: 42 }, { name: null }, { name: "   " }, { name: "x".repeat(101) }];
  for (const body of bodies) {
    const res = await request(app).post("/api/recipes").send(body);
    assertJsonError(res, 400, JSON.stringify(body).slice(0, 40));
  }
  assertJsonError(await request(app).post("/api/recipes"), 400, "no body at all");

  const get = await request(app).get("/api/recipes");
  assert.deepEqual(get.body, { recipes: [] });
});

test("POST /api/recipes explains an empty name", async () => {
  const res = await request(app).post("/api/recipes").send({ name: " " });
  assert.deepEqual(res.body, { error: "The name can't be empty." });
});

test("POST /api/recipes with a taken name returns 409 with the recipe that has it", async () => {
  const soup = await addRecipe("Soup");

  const res = await request(app).post("/api/recipes").send({ name: "SOUP" });

  assertJsonError(res, 409, "active recipe");
  assert.deepEqual(res.body.recipe, soup);
});

test("POST /api/recipes reports an archived recipe whose name matches after cleanup", async () => {
  const cafe = await addRecipe("Café");
  await request(app).patch(`/api/recipes/${cafe.id}`).send({ archived: true });

  const res = await request(app).post("/api/recipes").send({ name: "  cafe " });

  assertJsonError(res, 409, "archived recipe");
  assert.deepEqual(res.body.recipe, { ...cafe, archived: true });
});

test("PATCH /api/recipes/ID renames a recipe", async () => {
  const soup = await addRecipe("Soup");

  const res = await request(app).patch(`/api/recipes/${soup.id}`).send({ name: "Tomato soup" });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ...soup, name: "Tomato soup" });
});

test("PATCH /api/recipes/ID accepts a name with the recipe's own name key", async () => {
  const cafe = await addRecipe("Cafe");
  const res = await request(app).patch(`/api/recipes/${cafe.id}`).send({ name: "Café" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ...cafe, name: "Café" });
});

test("PATCH /api/recipes/ID with another recipe's name returns 409 with that recipe", async () => {
  const soup = await addRecipe("Soup");
  const salad = await addRecipe("Salad");

  const res = await request(app).patch(`/api/recipes/${salad.id}`).send({ name: "soup" });

  assertJsonError(res, 409, "rename conflict");
  assert.deepEqual(res.body.recipe, soup);
});

test("PATCH /api/recipes/ID archives and restores a recipe", async () => {
  const soup = await addRecipe("Soup");

  const archive = await request(app).patch(`/api/recipes/${soup.id}`).send({ archived: true });
  assert.equal(archive.status, 200);
  assert.deepEqual(archive.body, { ...soup, archived: true });

  const restore = await request(app).patch(`/api/recipes/${soup.id}`).send({ archived: false });
  assert.deepEqual(restore.body, soup);
});

test("PATCH /api/recipes/ID with an invalid body returns 400 JSON and changes nothing", async () => {
  const soup = await addRecipe("Soup");
  const bodies = [
    {},
    { name: "Stew", archived: true },
    { color: "red" },
    { archived: "yes" },
    { name: "" },
    { name: 42 },
  ];
  for (const body of bodies) {
    const res = await request(app).patch(`/api/recipes/${soup.id}`).send(body);
    assertJsonError(res, 400, JSON.stringify(body));
  }
  assertJsonError(await request(app).patch(`/api/recipes/${soup.id}`), 400, "no body at all");

  const get = await request(app).get("/api/recipes");
  assert.deepEqual(get.body, { recipes: [soup] });
});

test("PATCH /api/recipes/ID with an unknown ID returns 404 JSON", async () => {
  const res = await request(app).patch("/api/recipes/no-such-id").send({ archived: true });
  assertJsonError(res, 404, "unknown ID");
});

test("GET /api/recipes returns 500 JSON when the recipes file is corrupt", async (t) => {
  const error = t.mock.method(console, "error", () => {});
  await mkdir(path.join(dataDir, "v2"), { recursive: true });
  await writeFile(path.join(dataDir, "v2", "recipes.json"), "{ not json");

  const res = await request(app).get("/api/recipes");

  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: "Internal server error" });
  assert.equal(error.mock.callCount(), 1);
});

test("an error with a status outside 400-499 maps to 500", async (t) => {
  t.mock.method(console, "error", () => {});
  const boomApp = createApp({
    recipes: {
      list: async () => {
        throw Object.assign(new Error("boom"), { status: 501 });
      },
    },
    weeks: {},
  });

  const res = await request(boomApp).get("/api/recipes");

  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: "Internal server error" });
});

test("an error with a 4xx status keeps that status and its own message", async () => {
  const notFoundApp = createApp({
    recipes: {
      list: async () => {
        throw Object.assign(new Error("Gone"), { status: 404 });
      },
    },
    weeks: {},
  });

  const res = await request(notFoundApp).get("/api/recipes");

  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: "Gone" });
});

// ---------- Weeks ----------

test("GET /api/weeks/WEEK returns 200 with a complete week of empty menus", async () => {
  const res = await request(app).get(`/api/weeks/${WEEK}`);

  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /application\/json/);
  assert.deepEqual(res.body, blankWeek(EXPECTED_DAYS, EXPECTED_MEALS));
});

test("PUT a valid menu returns 200 with the saved slot and a later GET reflects it", async () => {
  const soup = await addRecipe("Soup");
  const salad = await addRecipe("Salad");
  const items = [
    { recipeId: soup.id, servings: 1.5 },
    { recipeId: salad.id, servings: 2 },
  ];

  const put = await request(app).put(`/api/weeks/${WEEK}/wed/lunch`).send({ items });
  assert.equal(put.status, 200);
  assert.match(put.headers["content-type"], /application\/json/);
  assert.deepEqual(put.body, { week: WEEK, day: "wed", meal: "lunch", items });

  const get = await request(app).get(`/api/weeks/${WEEK}`);
  const expected = blankWeek(EXPECTED_DAYS, EXPECTED_MEALS);
  expected.wed.lunch = { items };
  assert.deepEqual(get.body, expected);
});

test("a PUT in one week doesn't change another week", async () => {
  const soup = await addRecipe("Soup");
  await request(app)
    .put(`/api/weeks/${WEEK}/wed/lunch`)
    .send({ items: [{ recipeId: soup.id, servings: 1 }] });

  const get = await request(app).get(`/api/weeks/${OTHER_WEEK}`);
  assert.equal(get.status, 200);
  assert.deepEqual(get.body, blankWeek(EXPECTED_DAYS, EXPECTED_MEALS));
});

test("PUT accepts an empty menu (clearing a slot)", async () => {
  const soup = await addRecipe("Soup");
  await request(app)
    .put(`/api/weeks/${WEEK}/mon/dinner`)
    .send({ items: [{ recipeId: soup.id, servings: 1 }] });

  const put = await request(app).put(`/api/weeks/${WEEK}/mon/dinner`).send({ items: [] });
  assert.equal(put.status, 200);

  const get = await request(app).get(`/api/weeks/${WEEK}`);
  assert.deepEqual(get.body.mon.dinner, { items: [] });
});

test("PUT accepts an archived recipe, so older menus stay savable", async () => {
  const soup = await addRecipe("Soup");
  await request(app).patch(`/api/recipes/${soup.id}`).send({ archived: true });

  const put = await request(app)
    .put(`/api/weeks/${WEEK}/tue/lunch`)
    .send({ items: [{ recipeId: soup.id, servings: 3 }] });

  assert.equal(put.status, 200);
});

test("PUT accepts 20 menu items and servings of 0.5 and 99", async () => {
  const items = [];
  for (let index = 0; index < 20; index++) {
    const recipe = await addRecipe(`Recipe ${index}`);
    items.push({ recipeId: recipe.id, servings: index === 0 ? 0.5 : 99 });
  }

  const put = await request(app).put(`/api/weeks/${WEEK}/sat/lunch`).send({ items });
  assert.equal(put.status, 200);
  assert.equal(put.body.items.length, 20);
});

test("GET with an invalid week returns 404 JSON", async () => {
  for (const week of INVALID_WEEKS) {
    assertJsonError(await request(app).get(`/api/weeks/${week}`), 404, week);
  }
});

test("PUT with an unknown week, day, or meal returns 404 JSON and saves nothing", async () => {
  const urls = [
    ...INVALID_WEEKS.map((week) => `/api/weeks/${week}/mon/lunch`),
    `/api/weeks/${WEEK}/funday/lunch`,
    `/api/weeks/${WEEK}/mon/brunch`,
  ];
  for (const url of urls) {
    assertJsonError(await request(app).put(url).send({ items: [] }), 404, url);
  }
  assert.deepEqual(await readdir(dataDir), []);
});

test("PUT with an invalid menu returns 400 JSON and saves nothing", async () => {
  const soup = await addRecipe("Soup");
  const url = `/api/weeks/${WEEK}/mon/lunch`;
  const bodies = [
    {},
    { text: "Soup" }, // the free-text API of earlier versions
    { items: "Soup" },
    { items: [{ recipeId: soup.id }] },
    { items: [{ recipeId: soup.id, servings: 1, note: "hot" }] },
    { items: [{ recipeId: soup.id, servings: 0.3 }] },
    { items: [{ recipeId: soup.id, servings: 100 }] },
    {
      items: [
        { recipeId: soup.id, servings: 1 },
        { recipeId: soup.id, servings: 1 },
      ],
    },
    { items: [{ recipeId: "no-such-recipe", servings: 1 }] },
    {
      items: Array.from({ length: 21 }, (_, index) => ({ recipeId: `r${index}`, servings: 1 })),
    },
  ];
  for (const body of bodies) {
    const res = await request(app).put(url).send(body);
    assertJsonError(res, 400, JSON.stringify(body).slice(0, 60));
  }
  assertJsonError(await request(app).put(url), 400, "no body at all");

  const get = await request(app).get(`/api/weeks/${WEEK}`);
  assert.deepEqual(get.body, blankWeek(EXPECTED_DAYS, EXPECTED_MEALS));
});

test("PUT with a malformed JSON body returns 400 JSON", async () => {
  const res = await request(app)
    .put(`/api/weeks/${WEEK}/mon/lunch`)
    .set("Content-Type", "application/json")
    .send('{"items":');

  assertJsonError(res, 400, "malformed JSON");
});

test("GET returns 500 JSON when the week file is corrupt", async (t) => {
  const error = t.mock.method(console, "error", () => {});
  await mkdir(path.join(dataDir, "v2", "weeks"), { recursive: true });
  await writeFile(path.join(dataDir, "v2", "weeks", `${WEEK}.json`), "{ not json");

  const res = await request(app).get(`/api/weeks/${WEEK}`);

  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: "Internal server error" });
  assert.equal(error.mock.callCount(), 1);
});

// ---------- Other routes ----------

test("unknown /api routes return 404 JSON", async () => {
  assertJsonError(await request(app).get("/api/nope"), 404, "GET /api/nope");
  assertJsonError(await request(app).delete("/api/recipes/x"), 404, "DELETE a recipe");
});

test("GET / serves the frontend page", async () => {
  const res = await request(app).get("/");

  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /text\/html/);
  assert.match(res.text, /<title>Weekly meal plan<\/title>/);
});

test("GET /recipes.html serves the recipe book page", async () => {
  const res = await request(app).get("/recipes.html");

  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /text\/html/);
  assert.match(res.text, /<title>Recipes<\/title>/);
});

test("GET /dates.js serves the date helpers", async () => {
  const res = await request(app).get("/dates.js");

  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /javascript/);
});
