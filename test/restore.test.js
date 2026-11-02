import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  assertExit,
  assertOriginalData,
  assertWaitsForLock,
  BACKUP,
  composeCall,
  createHost,
  skipAsRoot,
} from "./host-helpers.js";

let host;

beforeEach(async () => {
  host = await createHost();
});

afterEach(async () => {
  await host.cleanup();
});

test("a backup by meals-backup and a restore by meals-restore give back identical data", async () => {
  assertExit(await host.run("meals-backup", "daily"), 0);
  const [daily] = await host.backups();
  await host.writeData("v2/recipes.json", '{ "recipes": [{ "id": "new" }] }\n');
  await host.writeData("v2/weeks/2026-09-28.json", "{}\n");

  const result = await host.run("meals-restore", daily);

  assertExit(result, 0);
  await assertOriginalData(host);
});

test("meals-restore replaces data with invalid JSON", async () => {
  await host.makeBackup(BACKUP);
  await host.writeData("v2/recipes.json", "{ not json");

  const result = await host.run("meals-restore", BACKUP);

  assertExit(result, 0);
  await assertOriginalData(host);
});

test("meals-restore works from a working directory that it can't read", {
  skip: skipAsRoot("root can read any directory"),
}, async () => {
  await host.makeBackup(BACKUP);
  await host.writeData("v2/weeks/2026-09-28.json", "{}\n");

  const result = await host.runFromUnreadableDir("meals-restore", BACKUP);

  assertExit(result, 0);
  await assertOriginalData(host);
});

test("meals-restore removes the staging directories that an interrupted restore left", async () => {
  await host.makeBackup(BACKUP);
  await mkdir(path.join(host.root, ".restore.AbC123", "data"), { recursive: true });

  const result = await host.run("meals-restore", BACKUP);

  assertExit(result, 0);
  assert.equal(await host.exists(".restore.AbC123"), false);
  assert.match(result.stdout, /Removed \.restore\.AbC123, which an interrupted restore left\./);
});

test("meals-restore checks the health at the address that Compose publishes", async () => {
  const env = await readFile(path.join(host.root, ".env"), "utf8");
  await host.writeRootFile(".env", env.replace("MEALS_PORT=3000", "MEALS_PORT=127.0.0.1:3000"));
  await host.makeBackup(BACKUP);

  const result = await host.run("meals-restore", BACKUP);

  assertExit(result, 0);
  assert.match((await host.calls()).at(-1), / http:\/\/127\.0\.0\.1:49153\/api\/health$/);
});

test("meals-restore checks the health on 127.0.0.1 when Compose publishes on every address", async () => {
  await host.stub("port", "0.0.0.0:3000\n");
  await host.makeBackup(BACKUP);

  const result = await host.run("meals-restore", BACKUP);

  assertExit(result, 0);
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

  assertExit(result, 1);
  const preRestore = (await host.backups()).filter(
    (name) => name.includes("-pre-restore-v0.2.0") && name !== later,
  );
  assert.equal(preRestore.length, 1);
  assert.ok(result.stderr.includes(`meals-restore ${preRestore[0]}.`), result.stderr);
});

/**
 * Restores BACKUP over data that changed after the backup, and checks that
 * the script succeeds.
 */
async function restoreChangedData() {
  await host.makeBackup(BACKUP);
  await host.writeData("v2/recipes.json", '{ "recipes": [{ "id": "new" }] }\n');
  await host.writeData("v2/weeks/2026-09-28.json", "{}\n");

  const result = await host.run("meals-restore", BACKUP);

  assertExit(result, 0);
  return result;
}

describe("meals-restore", () => {
  test("replaces the data with the data of the backup", async () => {
    await restoreChangedData();

    await assertOriginalData(host);
  });

  test("takes a pre-restore backup of the previous data", async () => {
    await restoreChangedData();

    const preRestore = (await host.backups()).filter((name) =>
      name.includes("-pre-restore-v0.2.0"),
    );
    assert.equal(preRestore.length, 1);
    assert.ok(host.archiveEntries(preRestore[0]).includes("data/v2/weeks/2026-09-28.json"));
  });

  test("stops the app before it starts it again", async () => {
    await restoreChangedData();

    const calls = await host.calls();
    const stop = calls.findIndex((call) => composeCall("stop").test(call));
    const up = calls.findIndex((call) => composeCall("up --wait").test(call));
    assert.ok(stop >= 0 && up > stop, calls.join("\n"));
  });

  test("leaves no data.old", async () => {
    await restoreChangedData();

    assert.equal(await host.exists("data.old"), false);
  });

  test("says which backup it restored", async () => {
    const result = await restoreChangedData();

    assert.match(result.stdout, /Restored 2026-10-01T033000Z-daily-v0\.2\.0\.tar\.gz/);
  });

  test("accepts the absolute path of a backup", async () => {
    await host.makeBackup(BACKUP);
    await host.writeData("v2/recipes.json", '{ "recipes": [{ "id": "new" }] }\n');

    const result = await host.run("meals-restore", `${host.root}/backups/${BACKUP}`);

    assertExit(result, 0);
    await assertOriginalData(host);
  });

  test("restores a backup of an older version", async () => {
    const older = "2026-09-01T033000Z-daily-v0.1.0.tar.gz";
    await host.makeBackup(older);
    await host.writeData("v2/recipes.json", '{ "recipes": [{ "id": "new" }] }\n');

    const result = await host.run("meals-restore", older);

    assertExit(result, 0);
    await assertOriginalData(host);
  });

  test("waits for the lock that another script holds", async (t) => {
    await host.makeBackup(BACKUP);

    await assertWaitsForLock(t, host, "meals-restore", [BACKUP]);
  });
});
