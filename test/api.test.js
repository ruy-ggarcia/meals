import assert from "node:assert/strict";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { setImmediate } from "node:timers/promises";
import request from "supertest";
import { createApp } from "../server/app.js";
import {
  ConflictError,
  NameConflictError,
  NotFoundError,
  ValidationError,
} from "../server/errors.js";
import { createStores } from "../server/stores.js";
import { blankWeek, collectingLogger, within } from "./helpers.js";

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
  app = createApp(createStores({ dataDir }));
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

// ---------- Logs ----------

test("each /api request is logged with its method, path, status, and duration", async () => {
  const { entries, logger } = collectingLogger();
  const loggedApp = createApp(createStores({ dataDir }), { logger });

  await request(loggedApp).get("/api/recipes?ignored=1");
  await request(loggedApp).put(`/api/weeks/${WEEK}/mon/lunch`).send({ items: [] });
  await request(loggedApp).get("/api/nope");

  assert.deepEqual(
    entries.map((entry) => ({ ...entry, ms: typeof entry.ms })),
    [
      {
        level: "info",
        msg: "request",
        method: "GET",
        path: "/api/recipes",
        status: 200,
        ms: "number",
      },
      {
        level: "info",
        msg: "request",
        method: "PUT",
        path: `/api/weeks/${WEEK}/mon/lunch`,
        status: 200,
        ms: "number",
      },
      {
        level: "info",
        msg: "request",
        method: "GET",
        path: "/api/nope",
        status: 404,
        ms: "number",
      },
    ],
  );
  assert.ok(entries.every(({ ms }) => Number.isInteger(ms) && ms >= 0));
});

test("errors that map to a 4xx status are logged as requests, and not as failures", async () => {
  const { entries, logger } = collectingLogger();
  let thrown;
  const throwing = {
    recipes: {
      list: async () => {
        throw thrown;
      },
    },
    weeks: {},
  };
  const loggedApp = createApp(throwing, { logger });
  const cases = [
    [new ValidationError("Invalid"), 400],
    [new NotFoundError("Missing"), 404],
    [new NameConflictError("Taken", "recipe", { id: "r1" }), 409],
    [new ConflictError("In use"), 409],
    [Object.assign(new Error("Gone"), { status: 404 }), 404],
  ];

  for (const [error, status] of cases) {
    thrown = error;
    assert.equal((await request(loggedApp).get("/api/recipes")).status, status, error.name);
  }
  const malformed = await request(loggedApp)
    .post("/api/recipes")
    .set("Content-Type", "application/json")
    .send('{"name":');
  assert.equal(malformed.status, 400);

  assert.deepEqual(
    entries.map(({ level, msg, status }) => ({ level, msg, status })),
    [...cases.map(([, status]) => status), 400].map((status) => ({
      level: "info",
      msg: "request",
      status,
    })),
  );
});

test("a request that the client aborts is logged once", async () => {
  const { entries, logger } = collectingLogger();
  const logged = Promise.withResolvers();
  const handlerStarted = Promise.withResolvers();
  const release = Promise.withResolvers();
  const handlerDone = Promise.withResolvers();
  const loggingInfo = logger.info;
  logger.info = (msg, fields) => {
    loggingInfo(msg, fields);
    logged.resolve();
  };
  const slow = {
    recipes: {
      list: async () => {
        handlerStarted.resolve();
        await release.promise;
        handlerDone.resolve();
        return [];
      },
    },
  };
  const server = createApp(slow, { logger }).listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const socket = net.connect(server.address().port, "127.0.0.1");
    socket.write("GET /api/recipes HTTP/1.1\r\nHost: localhost\r\n\r\n");
    await handlerStarted.promise;
    socket.destroy();
    await within(logged.promise, "The request wasn't logged after the client aborted it");
    // Let the handler finish after the abort, to catch a second entry for the same request.
    release.resolve();
    await handlerDone.promise;
    await setImmediate();
    await setImmediate();
  } finally {
    server.close();
  }

  assert.deepEqual(
    entries.map((entry) => ({ ...entry, ms: typeof entry.ms })),
    [
      {
        level: "info",
        msg: "request",
        method: "GET",
        path: "/api/recipes",
        aborted: true,
        ms: "number",
      },
    ],
  );
  assert.equal("status" in entries[0], false);
});

test("static files aren't logged", async () => {
  const { entries, logger } = collectingLogger();
  const loggedApp = createApp(createStores({ dataDir }), { logger });

  assert.equal((await request(loggedApp).get("/")).status, 200);
  assert.equal((await request(loggedApp).get("/styles.css")).status, 200);

  assert.deepEqual(entries, []);
});

// ---------- Health ----------

test("GET /api/health returns 200 with the version when the data directory is writable", async () => {
  const healthApp = createApp(createStores({ dataDir }), { dataDir, version: "1.2.3" });

  const res = await request(healthApp).get("/api/health");

  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /application\/json/);
  assert.deepEqual(res.body, { status: "ok", version: "1.2.3" });
});

test("GET /api/health returns 503 when the data directory isn't writable", async (t) => {
  if (process.getuid?.() === 0) {
    t.skip("root can write to any directory");
    return;
  }
  // afterEach removes the directory, which is empty, so the mode can stay.
  await chmod(dataDir, 0o500);
  const healthApp = createApp(createStores({ dataDir }), { dataDir, version: "1.2.3" });

  const res = await request(healthApp).get("/api/health");

  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { status: "error", version: "1.2.3" });
});

test("GET /api/health returns 503 when the data directory can't be entered", async (t) => {
  if (process.getuid?.() === 0) {
    t.skip("root can enter any directory");
    return;
  }
  // afterEach removes the directory, which is empty, so the mode can stay.
  await chmod(dataDir, 0o600);
  const healthApp = createApp(createStores({ dataDir }), { dataDir, version: "1.2.3" });

  const res = await request(healthApp).get("/api/health");

  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { status: "error", version: "1.2.3" });
});

test("GET /api/health returns 503 when the data directory doesn't exist", async () => {
  const missing = path.join(dataDir, "missing");
  const healthApp = createApp(createStores({ dataDir: missing }), {
    dataDir: missing,
    version: "1.2.3",
  });

  const res = await request(healthApp).get("/api/health");

  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { status: "error", version: "1.2.3" });
});

test("successful health checks aren't logged, and failed ones are, with the error code", async () => {
  const { entries, logger } = collectingLogger();
  const missing = path.join(dataDir, "missing");

  await request(createApp(createStores({ dataDir }), { dataDir, logger })).get("/api/health");
  await request(createApp(createStores({ dataDir: missing }), { dataDir: missing, logger })).get(
    "/api/health",
  );

  assert.deepEqual(
    entries.map((entry) => ({
      level: entry.level,
      msg: entry.msg,
      path: entry.path,
      status: entry.status,
      error: entry.error,
    })),
    [
      {
        level: "error",
        msg: "health check failed",
        path: undefined,
        status: undefined,
        error: "ENOENT",
      },
      { level: "info", msg: "request", path: "/api/health", status: 503, error: undefined },
    ],
  );
});

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
  assert.deepEqual(res.body, {
    id: res.body.id,
    name: "Gnocchi carbonara",
    archived: false,
    ingredients: [],
  });

  const get = await request(app).get("/api/recipes");
  assert.deepEqual(get.body, { recipes: [res.body] });
});

test("POST /api/recipes with fields other than name and ingredients returns 400", async () => {
  const res = await request(app).post("/api/recipes").send({ name: "Soup", archived: false });

  assertJsonError(res, 400, "extra field");
  assert.deepEqual((await request(app).get("/api/recipes")).body, { recipes: [] });
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

test("a thrown string is logged as the error of a failed request", async () => {
  const { entries, logger } = collectingLogger();
  const throwing = {
    recipes: {
      list: async () => {
        throw "disk on fire";
      },
    },
  };

  const res = await request(createApp(throwing, { logger })).get("/api/recipes");

  assert.equal(res.status, 500);
  const failures = entries.filter((entry) => entry.msg === "request failed");
  assert.equal(failures.length, 1);
  assert.equal(failures[0].error, "disk on fire");
});

test("GET /api/recipes returns 500 JSON when the recipes file is corrupt, and logs the error", async () => {
  const { entries, logger } = collectingLogger();
  const loggedApp = createApp(createStores({ dataDir }), { logger });
  await mkdir(path.join(dataDir, "v2"), { recursive: true });
  await writeFile(path.join(dataDir, "v2", "recipes.json"), "{ not json");

  const res = await request(loggedApp).get("/api/recipes");

  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: "Internal server error" });
  const failures = entries.filter((entry) => entry.msg === "request failed");
  assert.equal(failures.length, 1);
  assert.equal(failures[0].level, "error");
  assert.equal(failures[0].method, "GET");
  assert.equal(failures[0].path, "/api/recipes");
  assert.match(failures[0].error, /^SyntaxError/);
});

test("an error with a status outside 400-499 maps to 500", async () => {
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

// ---------- Ingredients ----------

async function addIngredient(name, unit = "g") {
  const res = await request(app).post("/api/ingredients").send({ name, unit });
  assert.equal(res.status, 201, name);
  return res.body;
}

test("GET /api/ingredients returns an empty catalog at first", async () => {
  const res = await request(app).get("/api/ingredients");

  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /application\/json/);
  assert.deepEqual(res.body, { ingredients: [] });
});

test("POST /api/ingredients returns 201 with the new ingredient, and GET lists them all from A to Z", async () => {
  const res = await request(app).post("/api/ingredients").send({ name: " Onion ", unit: "g" });

  assert.equal(res.status, 201);
  assert.deepEqual(res.body, { id: res.body.id, name: "Onion", unit: "g", archived: false });

  const egg = await addIngredient("Egg", "pcs");
  await request(app).patch(`/api/ingredients/${egg.id}`).send({ archived: true });
  const get = await request(app).get("/api/ingredients");
  assert.deepEqual(get.body, { ingredients: [{ ...egg, archived: true }, res.body] });
});

test("POST /api/ingredients with an invalid body returns 400 JSON and stores nothing", async () => {
  const bodies = [
    {},
    { name: "Onion" },
    { name: "Onion", unit: "kg" },
    { name: "", unit: "g" },
    { name: "Onion", unit: "g", archived: false },
  ];
  for (const body of bodies) {
    assertJsonError(
      await request(app).post("/api/ingredients").send(body),
      400,
      JSON.stringify(body),
    );
  }
  assertJsonError(await request(app).post("/api/ingredients"), 400, "no body");
  assert.deepEqual((await request(app).get("/api/ingredients")).body, { ingredients: [] });
});

test("POST /api/ingredients with a taken name returns 409 with that ingredient", async () => {
  const onion = await addIngredient("Onion");

  const res = await request(app).post("/api/ingredients").send({ name: "ONION", unit: "pcs" });

  assertJsonError(res, 409, "taken name");
  assert.deepEqual(res.body.ingredient, onion);
  assert.equal(res.body.recipe, undefined);
});

test("PATCH /api/ingredients/ID renames, changes the unit, and archives", async () => {
  const milk = await addIngredient("Milk");

  const both = await request(app)
    .patch(`/api/ingredients/${milk.id}`)
    .send({ name: "Whole milk", unit: "ml" });
  assert.equal(both.status, 200);
  assert.deepEqual(both.body, { ...milk, name: "Whole milk", unit: "ml" });

  const archived = await request(app).patch(`/api/ingredients/${milk.id}`).send({ archived: true });
  assert.deepEqual(archived.body, { ...both.body, archived: true });
});

test("PATCH /api/ingredients/ID returns 400, 404, and 409 JSON errors", async () => {
  const onion = await addIngredient("Onion");
  const egg = await addIngredient("Egg", "pcs");

  assertJsonError(
    await request(app).patch(`/api/ingredients/${egg.id}`).send({ archived: true, unit: "g" }),
    400,
    "archived with unit",
  );
  assertJsonError(
    await request(app).patch("/api/ingredients/no-such-id").send({ archived: true }),
    404,
    "unknown ID",
  );
  const conflict = await request(app).patch(`/api/ingredients/${egg.id}`).send({ name: "onion" });
  assertJsonError(conflict, 409, "taken name");
  assert.deepEqual(conflict.body.ingredient, onion);
});

test("PATCH /api/ingredients/ID with a new unit returns 409 while a recipe uses it", async () => {
  const onion = await addIngredient("Onion");
  await request(app)
    .post("/api/recipes")
    .send({ name: "Soup", ingredients: [{ ingredientId: onion.id, quantity: 100 }] });

  const res = await request(app).patch(`/api/ingredients/${onion.id}`).send({ unit: "pcs" });

  assertJsonError(res, 409, "unit in use");
  assert.deepEqual(Object.keys(res.body), ["error"]);
  assert.equal((await request(app).get("/api/ingredients")).body.ingredients[0].unit, "g");
});

test("POST and PATCH /api/recipes save ingredients, and GET returns them", async () => {
  const onion = await addIngredient("Onion");
  const egg = await addIngredient("Egg", "pcs");

  const created = await request(app)
    .post("/api/recipes")
    .send({ name: "Omelette", ingredients: [{ ingredientId: egg.id, quantity: 2 }] });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.ingredients, [{ ingredientId: egg.id, quantity: 2 }]);

  const updated = await request(app)
    .patch(`/api/recipes/${created.body.id}`)
    .send({
      name: "Onion omelette",
      ingredients: [
        { ingredientId: egg.id, quantity: 2 },
        { ingredientId: onion.id, quantity: 50.5 },
      ],
    });
  assert.equal(updated.status, 200);
  assert.deepEqual((await request(app).get("/api/recipes")).body, { recipes: [updated.body] });
});

test("POST /api/recipes with invalid or unknown ingredients returns 400 JSON", async () => {
  const onion = await addIngredient("Onion");
  const bodies = [
    { name: "Soup", ingredients: "Onion" },
    { name: "Soup", ingredients: [{ ingredientId: onion.id, quantity: 1.255 }] },
    { name: "Soup", ingredients: [{ ingredientId: "gone", quantity: 1 }] },
  ];

  for (const body of bodies) {
    assertJsonError(await request(app).post("/api/recipes").send(body), 400, JSON.stringify(body));
  }
});

test("a corrupt ingredients file makes GET /api/ingredients and GET /api/recipes return 500", async () => {
  await mkdir(path.join(dataDir, "v2"), { recursive: true });
  await writeFile(path.join(dataDir, "v2", "ingredients.json"), "{ not json");

  for (const url of ["/api/ingredients", "/api/recipes"]) {
    const res = await request(app).get(url);
    assert.equal(res.status, 500, url);
    assert.deepEqual(res.body, { error: "Internal server error" });
  }
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

test("GET returns 500 JSON when the week file is corrupt, and logs the error", async () => {
  const { entries, logger } = collectingLogger();
  const loggedApp = createApp(createStores({ dataDir }), { logger });
  await mkdir(path.join(dataDir, "v2", "weeks"), { recursive: true });
  await writeFile(path.join(dataDir, "v2", "weeks", `${WEEK}.json`), "{ not json");

  const res = await request(loggedApp).get(`/api/weeks/${WEEK}`);

  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: "Internal server error" });
  assert.equal(entries.filter((entry) => entry.msg === "request failed").length, 1);
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
