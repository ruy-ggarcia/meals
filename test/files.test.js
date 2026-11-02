import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { createQueue, dataPath, readJson, writeJson } from "../server/files.js";

/** A new empty directory that the test removes when it ends. */
async function tempDir(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "meals-files-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

describe("dataPath", () => {
  test("puts every file of the current format under v2", () => {
    assert.equal(
      dataPath("/srv/meals", "weeks", "2026-09-21.json"),
      path.join("/srv/meals", "v2", "weeks", "2026-09-21.json"),
    );
    assert.equal(
      dataPath("/srv/meals", "recipes.json"),
      path.join("/srv/meals", "v2", "recipes.json"),
    );
  });
});

describe("readJson", () => {
  test("returns undefined when the file doesn't exist", async (t) => {
    const dir = await tempDir(t);

    assert.equal(await readJson(path.join(dir, "missing", "file.json")), undefined);
  });

  test("rejects invalid JSON instead of discarding the data", async (t) => {
    const file = path.join(await tempDir(t), "broken.json");
    await writeFile(file, "{ not json");

    await assert.rejects(readJson(file), SyntaxError);
  });
});

describe("writeJson", () => {
  test("creates the missing directories of the file", async (t) => {
    const dir = await tempDir(t);

    await writeJson(path.join(dir, "a", "b", "value.json"), { list: [1, 2] });

    assert.deepEqual(await readdir(path.join(dir, "a", "b")), ["value.json"]);
  });

  test("writes a value that readJson reads back", async (t) => {
    const file = path.join(await tempDir(t), "value.json");

    await writeJson(file, { name: "Café", list: [1, 2] });

    assert.deepEqual(await readJson(file), { name: "Café", list: [1, 2] });
  });

  test("writes JSON with two spaces of indentation and a final newline", async (t) => {
    const file = path.join(await tempDir(t), "value.json");

    await writeJson(file, { name: "Café", list: [1, 2] });

    assert.equal(
      await readFile(file, "utf8"),
      '{\n  "name": "Café",\n  "list": [\n    1,\n    2\n  ]\n}\n',
    );
  });

  test("replaces the value of an existing file", async (t) => {
    const file = path.join(await tempDir(t), "value.json");

    await writeJson(file, { version: 1 });
    await writeJson(file, { version: 2 });

    assert.deepEqual(await readJson(file), { version: 2 });
  });

  test("leaves no temporary file behind", async (t) => {
    const dir = await tempDir(t);

    await writeJson(path.join(dir, "value.json"), { version: 1 });
    await writeJson(path.join(dir, "value.json"), { version: 2 });

    assert.deepEqual(await readdir(dir), ["value.json"]);
  });

  test("rejects undefined without touching the disk", async (t) => {
    const dir = await tempDir(t);

    await assert.rejects(writeJson(path.join(dir, "a", "value.json"), undefined), TypeError);

    assert.deepEqual(await readdir(dir), []);
  });
});

describe("createQueue", () => {
  test("runs tasks one at a time, in order", async () => {
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

  test("rejects a failed task and still runs the next one", async () => {
    const enqueue = createQueue();

    const failed = enqueue(async () => {
      throw new Error("disk full");
    });
    const next = enqueue(async () => "ok");

    await assert.rejects(failed, /disk full/);
    assert.equal(await next, "ok");
  });
});
