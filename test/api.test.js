import assert from "node:assert/strict";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
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
import { blankWeek, collectingLogger, skipAsRoot, within } from "./helpers.js";

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
  assert.deepEqual(
    entries.filter(({ ms }) => !(Number.isInteger(ms) && ms >= 0)),
    [],
    "the entries whose ms isn't a whole number of milliseconds from 0",
  );
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
  /** @type {[Error, number][]} */
  const cases = [
    [new ValidationError("Invalid"), 400],
    [new NotFoundError("Missing"), 404],
    [new NameConflictError("Taken", "recipe", { id: "r1" }), 409],
    [new ConflictError("In use"), 409],
    [Object.assign(new Error("Gone"), { status: 404 }), 404],
  ];

  for (const [error] of cases) {
    thrown = error;
    await request(loggedApp).get("/api/recipes");
  }
  await request(loggedApp)
    .post("/api/recipes")
    .set("Content-Type", "application/json")
    .send('{"name":');

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
  /** @type {PromiseWithResolvers<void>} */
  const logged = Promise.withResolvers();
  /** @type {PromiseWithResolvers<void>} */
  const handlerStarted = Promise.withResolvers();
  /** @type {PromiseWithResolvers<void>} */
  const release = Promise.withResolvers();
  /** @type {PromiseWithResolvers<void>} */
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

describe("GET /manifest.webmanifest", () => {
  test("serves the web app manifest with its media type", async () => {
    const res = await request(app).get("/manifest.webmanifest");

    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /^application\/manifest\+json/);
  });

  test("serves every icon that the manifest names with its type", async () => {
    const manifest = JSON.parse((await request(app).get("/manifest.webmanifest")).text);

    for (const icon of manifest.icons) {
      const file = await request(app).get(`/${icon.src}`);
      assert.equal(file.status, 200, icon.src);
      assert.equal(file.headers["content-type"], icon.type, icon.src);
    }
  });
});

// ---------- Health ----------

test("GET /api/health returns 200 with the version when the data directory is writable", async () => {
  const healthApp = createApp(createStores({ dataDir }), { dataDir, version: "1.2.3" });

  const res = await request(healthApp).get("/api/health");

  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /application\/json/);
  assert.deepEqual(res.body, { status: "ok", version: "1.2.3" });
});

test("GET /api/health returns 503 when the data directory isn't writable", {
  skip: skipAsRoot("root can write to any directory"),
}, async () => {
  // afterEach removes the directory, which is empty, so the mode can stay.
  await chmod(dataDir, 0o500);
  const healthApp = createApp(createStores({ dataDir }), { dataDir, version: "1.2.3" });

  const res = await request(healthApp).get("/api/health");

  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { status: "error", version: "1.2.3" });
});

test("GET /api/health returns 503 when the data directory can't be entered", {
  skip: skipAsRoot("root can enter any directory"),
}, async () => {
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

describe("GET /api/health", () => {
  test("logs nothing for a successful check", async () => {
    const { entries, logger } = collectingLogger();

    await request(createApp(createStores({ dataDir }), { dataDir, logger })).get("/api/health");

    assert.deepEqual(entries, []);
  });

  test("logs the error code of a failed check, and then the request", async () => {
    const { entries, logger } = collectingLogger();
    const missing = path.join(dataDir, "missing");

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

describe("POST /api/recipes", () => {
  test("returns 400 JSON without a body", async () => {
    assertJsonError(await request(app).post("/api/recipes"), 400, "no body at all");
  });
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

test("PATCH /api/recipes/ID archives and restores a recipe", async () => {
  const soup = await addRecipe("Soup");

  const archive = await request(app).patch(`/api/recipes/${soup.id}`).send({ archived: true });
  assert.equal(archive.status, 200);
  assert.deepEqual(archive.body, { ...soup, archived: true });

  const restore = await request(app).patch(`/api/recipes/${soup.id}`).send({ archived: false });
  assert.deepEqual(restore.body, soup);
});

describe("PATCH /api/recipes/:id", () => {
  test("returns 400 JSON without a body", async () => {
    const soup = await addRecipe("Soup");

    assertJsonError(await request(app).patch(`/api/recipes/${soup.id}`), 400, "no body at all");
  });
});

/**
 * An app whose only store, the recipe book, throws `error` when a request lists it.
 * @param {Error} error
 * @param {{ logger?: import("../server/logger.js").Logger }} [options]
 */
function appThrowing(error, options) {
  return createApp(
    {
      recipes: {
        list: async () => {
          throw error;
        },
      },
      weeks: {},
    },
    options,
  );
}

describe("createApp", () => {
  test("maps a ValidationError to 400 JSON with its message", async () => {
    const res = await request(appThrowing(new ValidationError("Invalid"))).get("/api/recipes");

    assertJsonError(res, 400, "ValidationError");
    assert.deepEqual(res.body, { error: "Invalid" });
  });

  test("maps a NotFoundError to 404 JSON with its message", async () => {
    const res = await request(appThrowing(new NotFoundError("Missing"))).get("/api/recipes");

    assertJsonError(res, 404, "NotFoundError");
    assert.deepEqual(res.body, { error: "Missing" });
  });

  test("maps a NameConflictError to 409 JSON with the entity under its kind", async () => {
    for (const kind of ["recipe", "ingredient"]) {
      const error = new NameConflictError("Taken", kind, { id: "x1", name: "Soup" });

      const res = await request(appThrowing(error)).get("/api/recipes");

      assertJsonError(res, 409, kind);
      assert.deepEqual(res.body, { error: "Taken", [kind]: { id: "x1", name: "Soup" } }, kind);
    }
  });

  test("maps a ConflictError to 409 JSON with its message only", async () => {
    const res = await request(appThrowing(new ConflictError("In use"))).get("/api/recipes");

    assertJsonError(res, 409, "ConflictError");
    assert.deepEqual(res.body, { error: "In use" });
  });

  test("logs a failed request with its method, path, and error", async () => {
    const { entries, logger } = collectingLogger();

    await request(appThrowing(new SyntaxError("boom"), { logger })).get("/api/recipes");

    const failures = entries.filter((entry) => entry.msg === "request failed");
    assert.equal(failures.length, 1);
    assert.equal(failures[0].level, "error");
    assert.equal(failures[0].method, "GET");
    assert.equal(failures[0].path, "/api/recipes");
    assert.match(failures[0].error, /^SyntaxError: boom/);
  });
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

describe("POST /api/ingredients", () => {
  test("returns 201 with the new ingredient", async () => {
    const res = await request(app).post("/api/ingredients").send({ name: " Onion ", unit: "g" });

    assert.equal(res.status, 201);
    assert.deepEqual(res.body, {
      id: res.body.id,
      name: "Onion",
      unit: "g",
      measures: [],
      archived: false,
    });
  });

  test("returns 400 JSON without a body", async () => {
    assertJsonError(await request(app).post("/api/ingredients"), 400, "no body at all");
  });
});

describe("PATCH /api/ingredients/:id", () => {
  test("renames an ingredient", async () => {
    const milk = await addIngredient("Milk");

    const res = await request(app)
      .patch(`/api/ingredients/${milk.id}`)
      .send({ name: "Whole milk" });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ...milk, name: "Whole milk" });
  });

  test("changes the unit of an ingredient that no recipe uses", async () => {
    const milk = await addIngredient("Milk");

    const res = await request(app).patch(`/api/ingredients/${milk.id}`).send({ unit: "ml" });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ...milk, unit: "ml" });
  });

  test("archives an ingredient", async () => {
    const milk = await addIngredient("Milk");

    const res = await request(app).patch(`/api/ingredients/${milk.id}`).send({ archived: true });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ...milk, archived: true });
  });
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

async function addOnionWithMedium() {
  const res = await request(app)
    .post("/api/ingredients")
    .send({ name: "Onion", unit: "g", measures: [{ name: "medium", amount: 150 }] });
  assert.equal(res.status, 201);
  return res.body;
}

test("POST /api/ingredients with measures returns them with IDs", async () => {
  const onion = await addOnionWithMedium();

  assert.equal(onion.measures.length, 1);
  assert.equal(typeof onion.measures[0].id, "string");
  assert.deepEqual(onion.measures[0], { id: onion.measures[0].id, name: "medium", amount: 150 });
});

test("POST /api/recipes with a measureId returns it in GET /api/recipes", async () => {
  const onion = await addOnionWithMedium();
  const line = { ingredientId: onion.id, measureId: onion.measures[0].id, quantity: 2 };

  const created = await request(app)
    .post("/api/recipes")
    .send({ name: "Soup", ingredients: [line] });

  assert.equal(created.status, 201);
  assert.deepEqual((await request(app).get("/api/recipes")).body.recipes[0].ingredients, [line]);
});

test("PATCH /api/ingredients/ID removing a measure that an archived recipe uses returns 409", async () => {
  const onion = await addOnionWithMedium();
  const line = { ingredientId: onion.id, measureId: onion.measures[0].id, quantity: 1 };
  const soup = await request(app)
    .post("/api/recipes")
    .send({ name: "Soup", ingredients: [line] });
  await request(app).patch(`/api/recipes/${soup.body.id}`).send({ archived: true });

  const res = await request(app).patch(`/api/ingredients/${onion.id}`).send({ measures: [] });

  assertJsonError(res, 409, "measure in use");
  assert.match(res.body.error, /medium/);
  const listed = await request(app).get("/api/ingredients");
  assert.deepEqual(listed.body.ingredients[0].measures, onion.measures);
});

test("a corrupt ingredients file makes GET /api/ingredients and GET /api/recipes return 500", async () => {
  await mkdir(path.join(dataDir, "v2"), { recursive: true });
  await writeFile(path.join(dataDir, "v2", "ingredients.json"), "{ not json");

  for (const url of ["/api/ingredients", "/api/recipes"]) {
    const res = await request(app).get(url);
    assert.equal(res.status, 500, url);
    assert.deepEqual(res.body, { error: "Internal server error" }, url);
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

describe("PUT /api/weeks/:week/:day/:meal", () => {
  test("returns 400 JSON without a body", async () => {
    const res = await request(app).put(`/api/weeks/${WEEK}/mon/lunch`);

    assertJsonError(res, 400, "no body at all");
  });
});

test("PUT with a malformed JSON body returns 400 JSON", async () => {
  const res = await request(app)
    .put(`/api/weeks/${WEEK}/mon/lunch`)
    .set("Content-Type", "application/json")
    .send('{"items":');

  assertJsonError(res, 400, "malformed JSON");
});

// ---------- Other routes ----------

test("unknown /api routes return 404 JSON", async () => {
  assertJsonError(await request(app).get("/api/nope"), 404, "GET /api/nope");
  assertJsonError(await request(app).delete("/api/recipes/x"), 404, "DELETE a recipe");
});

describe("GET /:file", () => {
  test("serves the files of public/ with their media type", async () => {
    const files = [
      { url: "/", file: "index.html", mediaType: /^text\/html/ },
      { url: "/recipes.html", file: "recipes.html", mediaType: /^text\/html/ },
      { url: "/dates.js", file: "dates.js", mediaType: /^text\/javascript/ },
      { url: "/styles.css", file: "styles.css", mediaType: /^text\/css/ },
    ];
    for (const { url, file, mediaType } of files) {
      const res = await request(app).get(url);

      assert.equal(res.status, 200, url);
      assert.match(res.headers["content-type"], mediaType, url);
      assert.equal(
        res.text,
        await readFile(new URL(`../public/${file}`, import.meta.url), "utf8"),
        url,
      );
    }
  });
});
