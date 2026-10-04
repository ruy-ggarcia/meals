import assert from "node:assert/strict";
import { mkdir, readFile, rename, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { createHost, DATA, skipAsRoot, withMode } from "./host-helpers.js";
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

test("meals-restore starts the app again when the pre-restore backup fails", {
  skip: skipAsRoot("root can write to any directory"),
}, async () => {
  await host.makeBackup(BACKUP);
  await host.writeData("v2/weeks/2026-09-28.json", "{}\n");
  const backups = path.join(host.root, "backups");
  const result = await withMode(backups, 0o555, () => host.run("meals-restore", BACKUP));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /The pre-restore backup failed, so nothing changed/);
  assert.equal(await host.exists("data/v2/weeks/2026-09-28.json"), true);
  assert.match((await host.calls()).at(-1), / compose .* up --detach$/);
});

test("meals-restore says so when the app doesn't start again after a failed pre-restore backup", {
  skip: skipAsRoot("root can write to any directory"),
}, async () => {
  await host.makeBackup(BACKUP);
  await host.stub("broken", "0.2.0\n");
  const backups = path.join(host.root, "backups");
  const result = await withMode(backups, 0o555, () => host.run("meals-restore", BACKUP));

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /The pre-restore backup failed, so nothing changed, but version 0\.2\.0 didn't start again/,
  );
  assert.doesNotMatch(result.stderr, /runs again/);
});

test("meals-restore fails without changing anything when the app doesn't stop", async () => {
  await host.makeBackup(BACKUP);
  await host.writeData("v2/weeks/2026-09-28.json", "{}\n");
  await host.stub("stop-fails", "");

  const result = await host.run("meals-restore", BACKUP);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Couldn't stop version 0\.2\.0, so nothing changed/);
  assert.deepEqual(await host.backups(), [BACKUP]);
  assert.equal(await host.exists("data/v2/weeks/2026-09-28.json"), true);
});

test("meals-restore fails without changing anything when it can't create its staging directory", async () => {
  await host.makeBackup(BACKUP);
  await host.failCommand("mktemp");

  const result = await host.run("meals-restore", BACKUP);

  assert.equal(result.status, 1);
  assert.ok(
    result.stderr.includes(
      `Error: Couldn't create a staging directory in ${host.root}, so nothing changed.`,
    ),
    result.stderr,
  );
  assert.deepEqual(await host.calls(), []);
});

test("meals-restore fails without changing anything when it can't list the backups", {
  skip: skipAsRoot("root can read any directory"),
}, async () => {
  await host.makeBackup(BACKUP);
  // Without read permission, backups/ still gives access to BACKUP by name.
  const backups = path.join(host.root, "backups");
  const result = await withMode(backups, 0o300, () => host.run("meals-restore", BACKUP));

  assert.equal(result.status, 1);
  assert.ok(
    result.stderr.includes(
      `Error: Couldn't list the backups in ${host.root}/backups, so nothing changed.`,
    ),
    result.stderr,
  );
  assert.deepEqual(await host.calls(), []);
});

test("meals-restore starts the app again when the retention deletes the new pre-restore backup", async () => {
  // Ten pre-restore backups whose names sort after the new one, as after the
  // clock went back, so the retention deletes the new one right away.
  for (let day = 1; day <= 10; day++) {
    await host.writeBackup(
      `2099-01-${String(day).padStart(2, "0")}T000000Z-pre-restore-v0.2.0.tar.gz`,
      "",
    );
  }
  await host.makeBackup(BACKUP);
  await host.writeData("v2/weeks/2026-09-28.json", "{}\n");

  const result = await host.run("meals-restore", BACKUP);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Error: Couldn't find the new pre-restore backup, so nothing changed, and version 0\.2\.0 runs again\./,
  );
  assert.equal(await host.exists("data/v2/weeks/2026-09-28.json"), true);
  assert.match((await host.calls()).at(-1), / compose .* up --detach$/);
});

test("meals-restore starts the app again when it can't list the backups after the pre-restore backup", async () => {
  await host.makeBackup(BACKUP);
  await host.writeData("v2/weeks/2026-09-28.json", "{}\n");
  // Fails on the third listing of the pre-restore backups, after the one
  // before the stop and the one in the retention of meals-backup.
  const find = [
    "#!/usr/bin/env bash",
    'if [[ " $* " == *" *-pre-restore-v*.tar.gz "* ]]; then',
    '  echo listed >>"$STUB_DIR/listings"',
    '  if [[ $(wc -l <"$STUB_DIR/listings") == 3 ]]; then exit 1; fi',
    "fi",
    'command -p find "$@"',
    "",
  ];
  await host.stub("bin/find", find.join("\n"), { executable: true });

  const result = await host.run("meals-restore", BACKUP);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Error: Couldn't find the new pre-restore backup, so nothing changed, and version 0\.2\.0 runs again\./,
  );
  assert.equal(await host.exists("data/v2/weeks/2026-09-28.json"), true);
  assert.match((await host.calls()).at(-1), / compose .* up --detach$/);
});

test("meals-restore keeps data/ and says how to start the app when the swap fails", {
  skip: skipAsRoot("root can move any directory"),
}, async () => {
  // A read-only directory can't move to another parent directory, so the
  // swap fails after it moved data/ aside.
  await host.makeBackup(BACKUP, {}, { dataMode: 0o555 });
  await host.writeData("v2/weeks/2026-09-28.json", "{}\n");

  const result = await host.run("meals-restore", BACKUP);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /data\/ wasn't replaced, and the app is stopped\./);
  // meals-deploy might not start it: the host can be on hold, GitHub can be
  // down, or the latest release can be a failed version.
  assert.ok(
    result.stderr.includes(
      `run cd ${host.root} && sudo -u deployer docker compose --project-directory ${host.root} --file ${host.root}/compose.yaml up --detach.`,
    ),
    result.stderr,
  );
  for (const [relPath, content] of Object.entries(DATA)) {
    assert.equal(await host.readData(relPath), content, relPath);
  }
  assert.equal(await host.exists("data/v2/weeks/2026-09-28.json"), true);
  assert.equal(await host.exists("data.old"), false);
});

test("meals-restore says where the data is when it can't move data.old back", {
  skip: skipAsRoot("root can move any directory"),
}, async () => {
  // The swap fails as in the test above, and then data.old can't move back.
  await host.makeBackup(BACKUP, {}, { dataMode: 0o555 });
  await host.failCommand("mv", "$1 == */data.old");

  const result = await host.run("meals-restore", BACKUP);

  assert.equal(result.status, 1);
  assert.ok(
    result.stdout.includes(
      `Couldn't move data.old back to data/. The data is in ${host.root}/data.old: move it back to ${host.root}/data before you start the app.`,
    ),
    result.stdout,
  );
  // Without data/, the start command alone would fail.
  assert.ok(
    result.stderr.includes(
      `Error: The restore failed, so the data is in ${host.root}/data.old, and the app is stopped. Move it back to ${host.root}/data before you start the app.`,
    ),
    result.stderr,
  );
  assert.doesNotMatch(result.stderr, /wasn't replaced|To start it again/);
  for (const [relPath, content] of Object.entries(DATA)) {
    assert.equal(
      await readFile(path.join(host.root, "data.old", relPath), "utf8"),
      content,
      relPath,
    );
  }
});

test("meals-restore restores the data, and says so, when it can't set the mode of data/", async () => {
  await host.makeBackup(BACKUP);
  await host.writeData("v2/weeks/2026-09-28.json", "{}\n");
  await host.failCommand("chmod");

  const result = await host.run("meals-restore", BACKUP);

  assert.equal(result.status, 0, result.stderr);
  await assertOriginalData();
  assert.ok(
    result.stdout.includes(
      `Couldn't set the mode of data/ to 2775. To set it, run sudo chmod 2775 ${host.root}/data.`,
    ),
    result.stdout,
  );
  assert.equal(await host.exists("data.old"), false);
});

test("meals-restore restores the data, and says so, when it can't remove data.old", async () => {
  await host.makeBackup(BACKUP);
  await host.writeData("v2/weeks/2026-09-28.json", "{}\n");
  // Fails on data.old once it exists, that is, after the swap.
  await host.failCommand("rm", "$last == */data.old && -e $last");

  const result = await host.run("meals-restore", BACKUP);

  assert.equal(result.status, 0, result.stderr);
  await assertOriginalData();
  assert.ok(
    result.stdout.includes(`Couldn't remove the old data in ${host.root}/data.old.`),
    result.stdout,
  );
});

test("meals-restore keeps data.old when data/ is missing", async () => {
  // As if a crash during an earlier swap left only data.old. A dangling
  // symbolic link lets the pre-restore backup succeed, so the restore reaches
  // the swap without a data directory.
  await host.makeBackup(BACKUP);
  await rename(path.join(host.root, "data"), path.join(host.root, "data.old"));
  await symlink("no-such-directory", path.join(host.root, "data"));

  const result = await host.run("meals-restore", BACKUP);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /data\/ wasn't replaced, and the app is stopped\./);
  for (const [relPath, content] of Object.entries(DATA)) {
    assert.equal(
      await readFile(path.join(host.root, "data.old", relPath), "utf8"),
      content,
      relPath,
    );
  }
});

test("meals-restore fails without changing anything when no version is deployed", async () => {
  await host.cleanup();
  host = await createHost({ version: "" });
  await host.makeBackup(BACKUP);

  const result = await host.run("meals-restore", BACKUP);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /No version is deployed\. .*meals-deploy VERSION/);
  assert.deepEqual(await host.calls(), []);
});

test("meals-restore fails without changing anything on a damaged archive", async () => {
  await host.writeBackup(BACKUP, "not an archive");

  const result = await host.run("meals-restore", BACKUP);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /The archive is damaged/);
  assert.deepEqual(await host.calls(), []);
  await assertOriginalData();
});

test("meals-restore fails without changing anything on invalid JSON", async () => {
  await host.makeBackup(BACKUP, { ...DATA, "v2/recipes.json": "{ not json" });
  await host.writeData("v2/weeks/2026-09-28.json", "{}\n");

  const result = await host.run("meals-restore", BACKUP);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Invalid JSON: v2\/recipes\.json/);
  assert.deepEqual(await host.calls(), []);
  assert.equal(await host.exists("data/v2/weeks/2026-09-28.json"), true);
});

test("meals-restore refuses a backup from a newer version", async () => {
  await host.makeBackup("2026-10-01T033000Z-daily-v0.10.0.tar.gz");

  const result = await host.run("meals-restore", "2026-10-01T033000Z-daily-v0.10.0.tar.gz");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /from version 0\.10\.0, which is newer .* meals-deploy 0\.10\.0/);
  assert.deepEqual(await host.calls(), []);
});

test("meals-restore fails on a backup that doesn't exist", async () => {
  const result = await host.run("meals-restore", "no-such-backup.tar.gz");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /No backup named no-such-backup\.tar\.gz/);
  assert.deepEqual(await host.calls(), []);
});

test("meals-restore fails without changing anything on a backup name without a version", async () => {
  await host.makeBackup("foo.tar.gz");

  const result = await host.run("meals-restore", "foo.tar.gz");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Error: The name of foo\.tar\.gz has no version\./);
  assert.deepEqual(await host.calls(), []);
});

test("meals-restore rejects anything but one backup", async () => {
  await host.makeBackup(BACKUP);

  for (const args of [[], [BACKUP, BACKUP]]) {
    const result = await host.run("meals-restore", ...args);

    assert.equal(result.status, 1, `${args.length} arguments`);
    assert.match(result.stderr, /Error: Usage: meals-restore BACKUP/, `${args.length} arguments`);
  }
  assert.deepEqual(await host.calls(), []);
});

test("meals-restore names the pre-restore backup when the app doesn't come back healthy", async () => {
  await host.makeBackup(BACKUP);
  await host.writeData("v2/weeks/2026-09-28.json", "{}\n");
  await host.stub("broken", "0.2.0\n");

  const result = await host.run("meals-restore", BACKUP);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /didn't come back healthy/);
  await assertOriginalData();
  const preRestore = (await host.backups()).filter((name) => name.includes("-pre-restore-v0.2.0"));
  assert.equal(preRestore.length, 1);
  assert.ok(result.stderr.includes(`meals-restore ${preRestore[0]}`), result.stderr);
});

test("meals-restore goes on, and says so, when it can't remove a stale staging directory", {
  skip: skipAsRoot("root can remove any file"),
}, async () => {
  await host.makeBackup(BACKUP);
  await host.writeData("v2/weeks/2026-09-28.json", "{}\n");
  // As after an archive with a read-only directory: its files can't go.
  const stale = path.join(host.root, ".restore.AbC123");
  const readOnly = path.join(stale, "data", "v2");
  await mkdir(readOnly, { recursive: true });
  await writeFile(path.join(readOnly, "recipes.json"), "{}\n");
  const result = await withMode(readOnly, 0o555, () => host.run("meals-restore", BACKUP));

  assert.equal(result.status, 0, result.stderr);
  await assertOriginalData();
  assert.ok(
    result.stdout.includes(
      `Couldn't remove ${stale}, which an interrupted restore left. To free the space, run sudo rm -rf ${stale}.`,
    ),
    result.stdout,
  );
});
