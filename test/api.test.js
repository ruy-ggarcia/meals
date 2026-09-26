import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import request from "supertest";
import { createApp } from "../server/app.js";
import { createStore, weekIdOf } from "../server/store.js";

const EXPECTED_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const EXPECTED_MEALS = ["breakfast", "snack_am", "lunch", "snack_pm", "dinner"];

function blankWeek() {
  return Object.fromEntries(
    EXPECTED_DAYS.map((day) => [day, Object.fromEntries(EXPECTED_MEALS.map((meal) => [meal, ""]))]),
  );
}

let dataDir;
let app;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "meals-api-"));
  app = createApp({ store: createStore({ dataDir }) });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

test("GET /api/week returns 200 with a complete 7 x 5 week", async () => {
  const res = await request(app).get("/api/week");

  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /application\/json/);
  assert.deepEqual(res.body, blankWeek());
});

test("PUT a valid cell returns 200 with the saved cell and a later GET reflects it", async () => {
  const text = "Lentils\nFruit";

  const put = await request(app).put("/api/week/wed/lunch").send({ text });
  assert.equal(put.status, 200);
  assert.match(put.headers["content-type"], /application\/json/);
  assert.deepEqual(put.body, { day: "wed", meal: "lunch", text });

  const get = await request(app).get("/api/week");
  const expected = blankWeek();
  expected.wed.lunch = text;
  assert.deepEqual(get.body, expected);
});

test("PUT accepts an empty string (clearing a cell)", async () => {
  await request(app).put("/api/week/mon/dinner").send({ text: "Soup" });

  const put = await request(app).put("/api/week/mon/dinner").send({ text: "" });
  assert.equal(put.status, 200);

  const get = await request(app).get("/api/week");
  assert.equal(get.body.mon.dinner, "");
});

test("PUT accepts text of exactly 2000 characters", async () => {
  const text = "x".repeat(2000);
  const put = await request(app).put("/api/week/fri/snack_pm").send({ text });
  assert.equal(put.status, 200);
  assert.equal(put.body.text, text);
});

test("PUT with an unknown day or meal returns 404 JSON", async () => {
  for (const url of ["/api/week/funday/lunch", "/api/week/mon/brunch"]) {
    const res = await request(app).put(url).send({ text: "x" });
    assert.equal(res.status, 404, url);
    assert.match(res.headers["content-type"], /application\/json/, url);
    assert.equal(typeof res.body.error, "string", url);
  }
});

test("PUT with missing, non-string or too long text returns 400 JSON and saves nothing", async () => {
  const bodies = [
    {},
    { text: 123 },
    { text: null },
    { text: ["Bread"] },
    { text: "x".repeat(2001) },
  ];
  for (const body of bodies) {
    const res = await request(app).put("/api/week/mon/lunch").send(body);
    const label = JSON.stringify(body).slice(0, 40);
    assert.equal(res.status, 400, label);
    assert.match(res.headers["content-type"], /application\/json/, label);
    assert.equal(typeof res.body.error, "string", label);
  }

  const noBody = await request(app).put("/api/week/mon/lunch");
  assert.equal(noBody.status, 400, "no body at all");

  const get = await request(app).get("/api/week");
  assert.deepEqual(get.body, blankWeek());
});

test("PUT with a malformed JSON body returns 400 JSON", async () => {
  const res = await request(app)
    .put("/api/week/mon/lunch")
    .set("Content-Type", "application/json")
    .send('{"text":');

  assert.equal(res.status, 400);
  assert.match(res.headers["content-type"], /application\/json/);
  assert.equal(typeof res.body.error, "string");
});

test("GET /api/week returns 500 JSON when the week file is corrupt", async () => {
  await mkdir(path.join(dataDir, "weeks"));
  await writeFile(path.join(dataDir, "weeks", `${weekIdOf(new Date())}.json`), "{ not json");

  const res = await request(app).get("/api/week");

  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: "Internal server error" });
});

test("unknown /api routes return 404 JSON", async () => {
  const res = await request(app).get("/api/nope");

  assert.equal(res.status, 404);
  assert.match(res.headers["content-type"], /application\/json/);
  assert.equal(typeof res.body.error, "string");
});

test("GET / serves the frontend page", async () => {
  const res = await request(app).get("/");

  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /text\/html/);
  assert.match(res.text, /<title>Weekly meal plan<\/title>/);
});
