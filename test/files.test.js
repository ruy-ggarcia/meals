import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { createQueue, dataPath, readJson, writeJson } from "../server/files.js";

let dir;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "meals-files-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("dataPath puts every file of the current format under v2", () => {
  assert.equal(
    dataPath("/srv/meals", "weeks", "2026-09-21.json"),
    path.join("/srv/meals", "v2", "weeks", "2026-09-21.json"),
  );
  assert.equal(
    dataPath("/srv/meals", "recipes.json"),
    path.join("/srv/meals", "v2", "recipes.json"),
  );
});

test("readJson returns undefined when the file doesn't exist", async () => {
  assert.equal(await readJson(path.join(dir, "missing", "file.json")), undefined);
});

test("readJson rejects invalid JSON (never silently discards data)", async () => {
  const file = path.join(dir, "broken.json");
  await writeFile(file, "{ not json");
  await assert.rejects(readJson(file), SyntaxError);
});

test("writeJson creates the directory, and readJson reads the value back", async () => {
  const file = path.join(dir, "a", "b", "value.json");

  await writeJson(file, { name: "Café", list: [1, 2] });

  assert.deepEqual(await readJson(file), { name: "Café", list: [1, 2] });
  assert.equal(
    await readFile(file, "utf8"),
    '{\n  "name": "Café",\n  "list": [\n    1,\n    2\n  ]\n}\n',
  );
});

test("writeJson replaces the file and leaves no temporary file behind", async () => {
  const file = path.join(dir, "value.json");

  await writeJson(file, { version: 1 });
  await writeJson(file, { version: 2 });

  assert.deepEqual(await readJson(file), { version: 2 });
  assert.deepEqual(await readdir(dir), ["value.json"]);
});

test("writeJson rejects undefined without touching disk (undefined isn't JSON)", async () => {
  const file = path.join(dir, "a", "value.json");

  await assert.rejects(writeJson(file, undefined), TypeError);

  assert.deepEqual(await readdir(dir), []);
});

test("the queue runs tasks one at a time, in order", async () => {
  const enqueue = createQueue();
  const events = [];
  let finishFirst;
  const first = enqueue(
    () =>
      new Promise((resolve) => {
        events.push("first starts");
        finishFirst = () => {
          events.push("first ends");
          resolve("one");
        };
      }),
  );
  const second = enqueue(async () => {
    events.push("second runs");
    return "two";
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["first starts"]);

  finishFirst();
  assert.equal(await first, "one");
  assert.equal(await second, "two");
  assert.deepEqual(events, ["first starts", "first ends", "second runs"]);
});

test("a failed task rejects, and the next task still runs", async () => {
  const enqueue = createQueue();

  const failed = enqueue(async () => {
    throw new Error("disk full");
  });
  const next = enqueue(async () => "ok");

  await assert.rejects(failed, /disk full/);
  assert.equal(await next, "ok");
});
