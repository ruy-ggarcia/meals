import assert from "node:assert/strict";
import { rm, utimes } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { createHost, skipAsRoot, withMode } from "./host-helpers.js";

let host;

beforeEach(async () => {
  host = await createHost();
});

afterEach(async () => {
  await host.cleanup();
});

/** The name of an old backup of KIND, taken on day DAY of January. */
function oldBackup(day, kind) {
  return `2026-01-${String(day).padStart(2, "0")}T033000Z-${kind}-v0.2.0.tar.gz`;
}

test("meals-backup archives the data directory, named after the time, the kind, and the version", async () => {
  const result = await host.run("meals-backup", "daily");

  assert.equal(result.status, 0, result.stderr);
  const backups = await host.backups();
  assert.equal(backups.length, 1);
  assert.match(backups[0], /^\d{4}-\d{2}-\d{2}T\d{6}Z-daily-v0\.2\.0\.tar\.gz$/);
  assert.ok(result.stdout.includes(`Backed up the data to backups/${backups[0]}.`));
  assert.deepEqual(host.archiveEntries(backups[0]), [
    "data/v2/ingredients.json",
    "data/v2/recipes.json",
    "data/v2/weeks/2026-09-21.json",
  ]);
});

test("meals-backup takes no backup when no version is deployed", async () => {
  await host.cleanup();
  host = await createHost({ version: "" });

  const result = await host.run("meals-backup", "daily");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No version is deployed/);
  assert.deepEqual(await host.backups(), []);
});

test("meals-backup takes no backup when .env doesn't exist", async () => {
  await rm(path.join(host.root, ".env"));

  const result = await host.run("meals-backup", "daily");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No version is deployed/);
  assert.deepEqual(await host.backups(), []);
});

test("meals-backup fails on invalid JSON, and keeps no archive or .partial file", async () => {
  await host.writeData("v2/recipes.json", "{ not json");

  const result = await host.run("meals-backup", "daily");

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Invalid JSON: v2\/recipes\.json/);
  assert.match(result.stderr, /failed validation/);
  assert.deepEqual(await host.backups(), []);
});

test("meals-backup fails, and keeps no archive or .partial file, when it can't read the data", {
  skip: skipAsRoot("root can read any directory"),
}, async () => {
  const weeks = path.join(host.root, "data", "v2", "weeks");
  const result = await withMode(weeks, 0o000, () => host.run("meals-backup", "daily"));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Error: Couldn't archive the data, so no backup was kept\./);
  assert.deepEqual(await host.backups(), []);
});

test("a pre-restore backup keeps invalid JSON, so a restore can replace damaged data", async () => {
  await host.writeData("v2/recipes.json", "{ not json");

  const result = await host.run("meals-backup", "pre-restore");

  assert.equal(result.status, 0, result.stderr);
  const backups = await host.backups();
  assert.equal(backups.length, 1);
  assert.match(backups[0], /-pre-restore-v0\.2\.0\.tar\.gz$/);
});

test("meals-backup keeps the 14 newest daily backups, and leaves other kinds and .partial files alone", async () => {
  for (let day = 1; day <= 14; day++) await host.writeBackup(oldBackup(day, "daily"), "");
  for (let day = 1; day <= 12; day++) await host.writeBackup(oldBackup(day, "pre-deploy"), "");
  await host.writeBackup(`${oldBackup(15, "daily")}.partial`, "");

  const result = await host.run("meals-backup", "daily");

  assert.equal(result.status, 0, result.stderr);
  const backups = await host.backups();
  const daily = backups.filter((name) => name.includes("-daily-") && name.endsWith(".tar.gz"));
  assert.equal(daily.length, 14);
  assert.ok(!daily.includes(oldBackup(1, "daily")), "the oldest daily backup is gone");
  assert.ok(daily.includes(oldBackup(2, "daily")));
  assert.equal(backups.filter((name) => name.includes("-pre-deploy-")).length, 12);
  assert.ok(backups.includes(`${oldBackup(15, "daily")}.partial`));
  assert.ok(
    result.stdout.includes(`Deleted the old backup backups/${oldBackup(1, "daily")}.`),
    result.stdout,
  );
});

test("meals-backup deletes nothing while a kind has no more backups than its retention", async () => {
  for (const [kind, keep] of [
    ["daily", 14],
    ["pre-deploy", 10],
  ]) {
    for (let day = 1; day < keep; day++) await host.writeBackup(oldBackup(day, kind), "");

    const result = await host.run("meals-backup", kind);

    assert.equal(result.status, 0, result.stderr);
    const ofKind = (await host.backups()).filter((name) => name.includes(`-${kind}-`));
    assert.equal(ofKind.length, keep, kind);
    assert.ok(ofKind.includes(oldBackup(1, kind)), kind);
    assert.doesNotMatch(result.stdout, /Deleted/, kind);
  }
});

test("meals-backup deletes the .partial files older than one day", async () => {
  const old = `${oldBackup(1, "daily")}.partial`;
  const fresh = `${oldBackup(2, "pre-deploy")}.partial`;
  await host.writeBackup(old, "interrupted");
  await host.writeBackup(fresh, "interrupted");
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  await utimes(path.join(host.root, "backups", old), twoDaysAgo, twoDaysAgo);

  const result = await host.run("meals-backup", "daily");

  assert.equal(result.status, 0, result.stderr);
  const backups = await host.backups();
  assert.ok(!backups.includes(old), backups.join("\n"));
  assert.ok(backups.includes(fresh), backups.join("\n"));
  assert.ok(
    result.stdout.includes(`Deleted the interrupted backup backups/${old}.`),
    result.stdout,
  );
});

test("meals-backup keeps the 10 newest pre-deploy and pre-restore backups", async () => {
  for (const kind of ["pre-deploy", "pre-restore"]) {
    for (let day = 1; day <= 10; day++) await host.writeBackup(oldBackup(day, kind), "");

    const result = await host.run("meals-backup", kind);

    assert.equal(result.status, 0, result.stderr);
    const ofKind = (await host.backups()).filter((name) => name.includes(`-${kind}-`));
    assert.equal(ofKind.length, 10, kind);
    assert.ok(!ofKind.includes(oldBackup(1, kind)), kind);
  }
});

test("meals-backup fails, and keeps no backup, when it can't create its temporary directory", async () => {
  await host.failCommand("mktemp");

  const result = await host.run("meals-backup", "daily");

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Error: Couldn't create a temporary directory for the validation, so no backup was kept\./,
  );
  assert.deepEqual(await host.backups(), []);
});

test("meals-backup fails, and keeps no .partial file, when it can't move the backup into place", async () => {
  await host.failCommand("mv", "$last == *.tar.gz");

  const result = await host.run("meals-backup", "daily");

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Error: Couldn't move the backup to backups\/\S+-daily-v0\.2\.0\.tar\.gz, so it wasn't kept\./,
  );
  assert.deepEqual(await host.backups(), []);
});

test("meals-backup keeps the new backup, and fails, when it can't list the old ones", {
  skip: skipAsRoot("root can read any directory"),
}, async () => {
  // Without read permission, backups/ takes new files but can't be listed.
  const backups = path.join(host.root, "backups");
  const result = await withMode(backups, 0o300, () => host.run("meals-backup", "daily"));

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Backed up the data to backups\//);
  assert.ok(
    result.stderr.includes(
      `Error: Couldn't list the old daily backups in ${host.root}/backups, so none were deleted.`,
    ),
    result.stderr,
  );
  assert.equal((await host.backups()).length, 1);
});

test("meals-backup fails when it can't delete an old backup", async () => {
  for (let day = 1; day <= 14; day++) await host.writeBackup(oldBackup(day, "daily"), "");
  await host.failCommand("rm", `$last == */${oldBackup(1, "daily")}`);

  const result = await host.run("meals-backup", "daily");

  assert.equal(result.status, 1);
  assert.ok(
    result.stderr.includes(
      `Error: Couldn't delete the old backup backups/${oldBackup(1, "daily")}.`,
    ),
    result.stderr,
  );
  assert.equal((await host.backups()).length, 15);
});

test("meals-backup works from a working directory that it can't read", {
  skip: skipAsRoot("root can read any directory"),
}, async () => {
  const result = await host.runFromUnreadableDir("meals-backup", "daily");

  assert.equal(result.status, 0, result.stderr);
  assert.equal((await host.backups()).length, 1);
});

test("meals-backup rejects an unknown kind", async () => {
  const result = await host.run("meals-backup", "weekly");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: meals-backup daily\|pre-deploy\|pre-restore/);
  assert.deepEqual(await host.backups(), []);
});

test("meals-backup waits for the lock that another script holds", async () => {
  // meals-backup calls no docker or curl, so date, which names the backup
  // right after the lock, logs its calls too.
  const date = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    'echo "date $*" >>"$STUB_DIR/calls"',
    'command -p date "$@"',
    "",
  ];
  await host.stub("bin/date", date.join("\n"), { executable: true });
  const { released } = await host.holdLock(200);

  const result = await host.run("meals-backup", "daily");

  assert.equal(result.status, 0, result.stderr);
  const calls = await host.calls();
  assert.equal(calls[0], "released the lock", calls.join("\n"));
  assert.ok(
    calls.some((call) => call.startsWith("date ")),
    calls.join("\n"),
  );
  await released;
});
