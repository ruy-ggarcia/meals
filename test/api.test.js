import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import request from "supertest";
import { createApp } from "../server/app.js";
import { createStore } from "../server/store.js";

const EXPECTED_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const EXPECTED_MEALS = ["breakfast", "snack_am", "lunch", "snack_pm", "dinner"];

const WEEK = "2026-09-21";
const OTHER_WEEK = "2026-09-28";
// A Tuesday, an impossible date that JavaScript rolls over to a Monday, and non-dates.
const INVALID_WEEKS = ["2026-09-22", "2026-02-30", "2026-9-21", "hello"];

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

test("GET /api/weeks/WEEK returns 200 with a complete 7 x 5 week", async () => {
  const res = await request(app).get(`/api/weeks/${WEEK}`);

  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /application\/json/);
  assert.deepEqual(res.body, blankWeek());
});

test("PUT a valid cell returns 200 with the saved cell and a later GET reflects it", async () => {
  const text = "Lentils\nFruit";

  const put = await request(app).put(`/api/weeks/${WEEK}/wed/lunch`).send({ text });
  assert.equal(put.status, 200);
  assert.match(put.headers["content-type"], /application\/json/);
  assert.deepEqual(put.body, { week: WEEK, day: "wed", meal: "lunch", text });

  const get = await request(app).get(`/api/weeks/${WEEK}`);
  const expected = blankWeek();
  expected.wed.lunch = text;
  assert.deepEqual(get.body, expected);
});

test("a PUT in one week doesn't change another week", async () => {
  await request(app).put(`/api/weeks/${WEEK}/wed/lunch`).send({ text: "Lentils" });

  const get = await request(app).get(`/api/weeks/${OTHER_WEEK}`);
  assert.equal(get.status, 200);
  assert.deepEqual(get.body, blankWeek());
});

test("PUT accepts an empty string (clearing a cell)", async () => {
  await request(app).put(`/api/weeks/${WEEK}/mon/dinner`).send({ text: "Soup" });

  const put = await request(app).put(`/api/weeks/${WEEK}/mon/dinner`).send({ text: "" });
  assert.equal(put.status, 200);

  const get = await request(app).get(`/api/weeks/${WEEK}`);
  assert.equal(get.body.mon.dinner, "");
});

test("PUT accepts text of exactly 2000 characters", async () => {
  const text = "x".repeat(2000);
  const put = await request(app).put(`/api/weeks/${WEEK}/fri/snack_pm`).send({ text });
  assert.equal(put.status, 200);
  assert.equal(put.body.text, text);
});

test("GET with an invalid week returns 404 JSON", async () => {
  for (const week of INVALID_WEEKS) {
    const res = await request(app).get(`/api/weeks/${week}`);
    assert.equal(res.status, 404, week);
    assert.match(res.headers["content-type"], /application\/json/, week);
    assert.equal(typeof res.body.error, "string", week);
  }
});

test("PUT with an unknown week, day, or meal returns 404 JSON and saves nothing", async () => {
  const urls = [
    ...INVALID_WEEKS.map((week) => `/api/weeks/${week}/mon/lunch`),
    `/api/weeks/${WEEK}/funday/lunch`,
    `/api/weeks/${WEEK}/mon/brunch`,
  ];
  for (const url of urls) {
    const res = await request(app).put(url).send({ text: "x" });
    assert.equal(res.status, 404, url);
    assert.match(res.headers["content-type"], /application\/json/, url);
    assert.equal(typeof res.body.error, "string", url);
  }
  assert.deepEqual(await readdir(dataDir), []);
});

test("PUT with missing, non-string or too long text returns 400 JSON and saves nothing", async () => {
  const url = `/api/weeks/${WEEK}/mon/lunch`;
  const bodies = [
    {},
    { text: 123 },
    { text: null },
    { text: ["Bread"] },
    { text: "x".repeat(2001) },
  ];
  for (const body of bodies) {
    const res = await request(app).put(url).send(body);
    const label = JSON.stringify(body).slice(0, 40);
    assert.equal(res.status, 400, label);
    assert.match(res.headers["content-type"], /application\/json/, label);
    assert.equal(typeof res.body.error, "string", label);
  }

  const noBody = await request(app).put(url);
  assert.equal(noBody.status, 400, "no body at all");

  const get = await request(app).get(`/api/weeks/${WEEK}`);
  assert.deepEqual(get.body, blankWeek());
});

test("PUT with a malformed JSON body returns 400 JSON", async () => {
  const res = await request(app)
    .put(`/api/weeks/${WEEK}/mon/lunch`)
    .set("Content-Type", "application/json")
    .send('{"text":');

  assert.equal(res.status, 400);
  assert.match(res.headers["content-type"], /application\/json/);
  assert.equal(typeof res.body.error, "string");
});

test("GET returns 500 JSON when the week file is corrupt", async () => {
  await mkdir(path.join(dataDir, "weeks"));
  await writeFile(path.join(dataDir, "weeks", `${WEEK}.json`), "{ not json");

  const res = await request(app).get(`/api/weeks/${WEEK}`);

  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: "Internal server error" });
});

test("the single-week routes no longer exist", async () => {
  const get = await request(app).get("/api/week");
  assert.equal(get.status, 404);
  assert.match(get.headers["content-type"], /application\/json/);

  const put = await request(app).put("/api/week/mon/lunch").send({ text: "x" });
  assert.equal(put.status, 404);
  assert.deepEqual(await readdir(dataDir), []);
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

test("GET /dates.js serves the date helpers", async () => {
  const res = await request(app).get("/dates.js");

  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /javascript/);
});
