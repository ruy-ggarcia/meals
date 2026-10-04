import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { createHost, skipAsRoot } from "./host-helpers.js";
import { assertOriginalData as assertDataOf, BACKUP } from "./restore-helpers.js";

let host;

beforeEach(async () => {
  host = await createHost();
});

afterEach(async () => {
  await host.cleanup();
});

/** Fails unless the data directory holds exactly DATA. */
function assertOriginalData() {
  return assertDataOf(host);
}

test("meals-restore brings back the data of a backup, after a pre-restore backup", async () => {
  await host.makeBackup(BACKUP);
  await host.writeData("v2/recipes.json", '{ "recipes": [{ "id": "new" }] }\n');
  await host.writeData("v2/weeks/2026-09-28.json", "{}\n");

  const result = await host.run("meals-restore", BACKUP);

  assert.equal(result.status, 0, result.stderr);
  await assertOriginalData();
  const preRestore = (await host.backups()).filter((name) => name.includes("-pre-restore-v0.2.0"));
  assert.equal(preRestore.length, 1);
  assert.ok(host.archiveEntries(preRestore[0]).includes("data/v2/weeks/2026-09-28.json"));
  const calls = await host.calls();
  const stop = calls.findIndex((call) => / compose .* stop$/.test(call));
  const up = calls.findIndex((call) => / compose .* up --detach --wait /.test(call));
  assert.ok(stop >= 0 && up > stop, calls.join("\n"));
  assert.equal(await host.exists("data.old"), false);
  assert.match(result.stdout, /Restored 2026-10-01T033000Z-daily-v0\.2\.0\.tar\.gz/);
});

test("a backup by meals-backup and a restore by meals-restore give back identical data", async () => {
  assert.equal((await host.run("meals-backup", "daily")).status, 0);
  const [daily] = await host.backups();
  await host.writeData("v2/recipes.json", '{ "recipes": [{ "id": "new" }] }\n');
  await host.writeData("v2/weeks/2026-09-28.json", "{}\n");

  const result = await host.run("meals-restore", daily);

  assert.equal(result.status, 0, result.stderr);
  await assertOriginalData();
});

test("meals-restore replaces data with invalid JSON", async () => {
  await host.makeBackup(BACKUP);
  await host.writeData("v2/recipes.json", "{ not json");

  const result = await host.run("meals-restore", BACKUP);

  assert.equal(result.status, 0, result.stderr);
  await assertOriginalData();
});

test("meals-restore works from a working directory that it can't read", {
  skip: skipAsRoot("root can read any directory"),
}, async () => {
  await host.makeBackup(BACKUP);
  await host.writeData("v2/weeks/2026-09-28.json", "{}\n");

  const result = await host.runFromUnreadableDir("meals-restore", BACKUP);

  assert.equal(result.status, 0, result.stderr);
  await assertOriginalData();
});

test("meals-restore accepts an absolute path, and a backup from an older version", async () => {
  const older = "2026-09-01T033000Z-daily-v0.1.0.tar.gz";
  await host.makeBackup(older);
  await host.writeData("v2/recipes.json", '{ "recipes": [{ "id": "new" }] }\n');

  const result = await host.run("meals-restore", `${host.root}/backups/${older}`);

  assert.equal(result.status, 0, result.stderr);
  await assertOriginalData();
});

test("meals-restore removes the staging directories that an interrupted restore left", async () => {
  await host.makeBackup(BACKUP);
  await mkdir(path.join(host.root, ".restore.AbC123", "data"), { recursive: true });

  const result = await host.run("meals-restore", BACKUP);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(await host.exists(".restore.AbC123"), false);
  assert.match(result.stdout, /Removed \.restore\.AbC123, which an interrupted restore left\./);
});

test("meals-restore checks the health at the address that Compose publishes", async () => {
  const env = await readFile(path.join(host.root, ".env"), "utf8");
  await host.writeRootFile(".env", env.replace("MEALS_PORT=3000", "MEALS_PORT=127.0.0.1:3000"));
  await host.makeBackup(BACKUP);

  const result = await host.run("meals-restore", BACKUP);

  assert.equal(result.status, 0, result.stderr);
  assert.match((await host.calls()).at(-1), / http:\/\/127\.0\.0\.1:49153\/api\/health$/);
});

test("meals-restore checks the health on 127.0.0.1 when Compose publishes on every address", async () => {
  await host.stub("port", "0.0.0.0:3000\n");
  await host.makeBackup(BACKUP);

  const result = await host.run("meals-restore", BACKUP);

  assert.equal(result.status, 0, result.stderr);
  assert.match((await host.calls()).at(-1), / http:\/\/127\.0\.0\.1:3000\/api\/health$/);
});

test("meals-restore names the new pre-restore backup, whatever the clock says", async () => {
  // A pre-restore backup whose name sorts after the new one, as after the
  // clock went back.
  const later = "2099-01-01T000000Z-pre-restore-v0.2.0.tar.gz";
  await host.makeBackup(BACKUP);
  await host.makeBackup(later);
  await host.stub("broken", "0.2.0\n");

  const result = await host.run("meals-restore", BACKUP);

  assert.equal(result.status, 1);
  const preRestore = (await host.backups()).filter(
    (name) => name.includes("-pre-restore-v0.2.0") && name !== later,
  );
  assert.equal(preRestore.length, 1);
  assert.ok(result.stderr.includes(`meals-restore ${preRestore[0]}.`), result.stderr);
});

test("meals-restore waits for the lock that another script holds", async () => {
  await host.makeBackup(BACKUP);
  const { released } = await host.holdLock(200);

  const result = await host.run("meals-restore", BACKUP);

  assert.equal(result.status, 0, result.stderr);
  const calls = await host.calls();
  assert.equal(calls[0], "released the lock", calls.join("\n"));
  await released;
});
