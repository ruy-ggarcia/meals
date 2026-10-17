import assert from "node:assert/strict";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  blockEnvWrite,
  dockerCalls,
  migrateOnUp,
  runWithReadOnlyBackups,
} from "./deploy-helpers.js";
import { createHost, DATA, imageFor, skipAsRoot, withMode } from "./host-helpers.js";

let host;

beforeEach(async () => {
  host = await createHost();
});

afterEach(async () => {
  await host.cleanup();
});

test("meals-deploy fails without stopping the app when the data has invalid JSON", async () => {
  await host.addRelease("0.3.0");
  await host.writeData("v2/recipes.json", "{ not json");

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Invalid JSON: v2\/recipes\.json/);
  assert.match(result.stderr, /The data failed validation, so version 0\.3\.0 wasn't deployed\./);
  assert.match(result.stderr, /Nothing changed\./);
  assert.ok(
    !(await dockerCalls(host)).some((call) => / compose .* stop$/.test(call)),
    (await dockerCalls(host)).join("\n"),
  );
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
  assert.deepEqual(await host.backups(), []);
  assert.equal(await host.exists("failed"), false);
});

test("meals-deploy fails without stopping the app when it can't read the data", {
  skip: skipAsRoot("root can read any directory"),
}, async () => {
  await host.addRelease("0.3.0");
  const weeks = path.join(host.root, "data", "v2", "weeks");
  const result = await withMode(weeks, 0o000, () => host.run("meals-deploy"));

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Couldn't read every file in /);
  assert.match(result.stderr, /The data failed validation, so version 0\.3\.0 wasn't deployed\./);
  assert.ok(
    !(await dockerCalls(host)).some((call) => / compose .* stop$/.test(call)),
    (await dockerCalls(host)).join("\n"),
  );
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
});

test("meals-deploy starts the previous version again when the pre-deploy backup fails", {
  skip: skipAsRoot("root can write to any directory"),
}, async () => {
  await host.addRelease("0.3.0");

  const result = await runWithReadOnlyBackups(host);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /The pre-deploy backup failed, so version 0\.2\.0 runs again/);
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
  assert.equal(await host.exists("failed"), false);
  assert.match((await dockerCalls(host)).at(-1), / compose .* up --detach$/);
});

test("meals-deploy says when the previous version doesn't start again after the pre-deploy backup fails", {
  skip: skipAsRoot("root can write to any directory"),
}, async () => {
  await host.addRelease("0.3.0");
  await host.stub("broken", "0.2.0\n");

  const result = await runWithReadOnlyBackups(host);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /The pre-deploy backup failed, so nothing changed, but version 0\.2\.0 didn't start again\./,
  );
  assert.doesNotMatch(result.stderr, /runs again/);
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
  assert.equal(await host.exists("failed"), false);
});

test("meals-deploy starts the previous version again when the retention deletes the new backup", async () => {
  // Ten pre-deploy backups whose names sort after the new one, as after the
  // clock went back, so the retention deletes the new one right away.
  for (let day = 1; day <= 10; day++) {
    await host.writeBackup(
      `2099-01-${String(day).padStart(2, "0")}T000000Z-pre-deploy-v0.2.0.tar.gz`,
      "",
    );
  }
  await host.addRelease("0.3.0");

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Error: Couldn't find the new pre-deploy backup, so version 0\.2\.0 runs again\./,
  );
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
  assert.equal(await host.exists("failed"), false);
  assert.match((await dockerCalls(host)).at(-1), / compose .* up --detach$/);
});

test("meals-deploy says so when it can't record the version that failed", async () => {
  await host.addRelease("0.3.0");
  await host.stub("broken", "0.3.0\n");
  await mkdir(path.join(host.root, "failed"));

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Rolled back to version 0\.2\.0 and its data\./);
  assert.ok(
    result.stderr.includes(
      `Error: Version 0.3.0 failed, but ${host.root}/failed couldn't record it, so the timer might deploy it again.`,
    ),
    result.stderr,
  );
});

test("meals-deploy changes nothing when it can't stop the previous version", async () => {
  await host.addRelease("0.3.0");
  await host.stub("stop-fails", "");

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Couldn't stop version 0\.2\.0, so nothing changed\./);
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
  assert.deepEqual(await host.backups(), []);
  assert.equal(await host.exists("failed"), false);
});

test("meals-deploy says when the previous version doesn't start again after it can't write .env", async () => {
  await host.addRelease("0.3.0");
  await blockEnvWrite(host);
  await host.stub("broken", "0.2.0\n");

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Couldn't write \.env, so nothing changed, but version 0\.2\.0 didn't start again\./,
  );
  assert.doesNotMatch(result.stderr, /runs again/);
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
});

test("a first deployment that can't write .env starts nothing", async () => {
  await host.cleanup();
  host = await createHost({ version: "" });
  await host.addRelease("0.2.0");
  await blockEnvWrite(host);

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Couldn't write \.env, so version 0\.2\.0 wasn't deployed\./);
  assert.equal((await host.readEnv()).MEALS_VERSION, "");
  assert.ok(!(await dockerCalls(host)).some((call) => call.includes(" compose ")));
});

test("meals-deploy changes nothing, and doesn't record a failed version, when the pull fails", async () => {
  await host.addRelease("0.3.0");
  await host.stub("pull-fails", "");

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Couldn't pull/);
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
  assert.deepEqual(await host.backups(), []);
  assert.equal(await host.exists("failed"), false);
  assert.deepEqual(
    (await dockerCalls(host)).filter((call) => call.includes(" compose ")),
    [],
  );
});

test("meals-deploy rolls back the image and the data when the new version isn't healthy", async () => {
  await host.addRelease("0.3.0");
  await host.stub("broken", "0.3.0\n");
  await host.stub("on-up", migrateOnUp("0.3.0"), { executable: true });

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Rolled back to version 0\.2\.0 and its data\./);
  assert.match(result.stderr, /Version 0\.3\.0 failed/);
  const env = await host.readEnv();
  assert.equal(env.MEALS_IMAGE, imageFor("0.2.0"));
  assert.equal(env.MEALS_VERSION, "0.2.0");
  assert.equal(await host.readData("v2/recipes.json"), DATA["v2/recipes.json"]);
  assert.equal(await readFile(path.join(host.root, "failed"), "utf8"), "0.3.0\n");
  assert.deepEqual(
    (await host.backups()).map((name) => name.replace(/^.*Z-/, "")),
    ["pre-deploy-v0.2.0.tar.gz"],
  );
  assert.equal(await host.exists(".env.previous"), false);
});

test("meals-deploy leaves the data alone when it can't stop the version that failed", async () => {
  await host.addRelease("0.3.0");
  await host.stub("broken", "0.3.0\n");
  // Once version 0.3.0 starts, it migrates the data and doesn't stop.
  const onUp = [
    migrateOnUp("0.3.0"),
    "if grep -qx 'MEALS_VERSION=0.3.0' \"$MEALS_ROOT/.env\"; then",
    '  touch "$STUB_DIR/stop-fails"',
    "fi",
    "",
  ];
  await host.stub("on-up", onUp.join("\n"), { executable: true });

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 1);
  assert.match(result.stdout, /The rollback failed too\./);
  assert.doesNotMatch(result.stdout, /Rolled back/);
  assert.match(result.stderr, /Version 0\.3\.0 failed/);
  assert.equal(await host.readData("v2/recipes.json"), '{ "recipes": "migrated" }\n');
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
  assert.equal(await readFile(path.join(host.root, "failed"), "utf8"), "0.3.0\n");
  assert.match((await dockerCalls(host)).at(-1), / compose .* stop$/);
});

test("meals-deploy rolls back when the new version reports another version", async () => {
  await host.addRelease("0.3.0");
  await host.stub("health-version", "0.2.0\n");

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Rolled back to version 0\.2\.0 and its data\./);
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
  assert.equal(await readFile(path.join(host.root, "failed"), "utf8"), "0.3.0\n");
});

test("meals-deploy says so when the previous version doesn't start again in the rollback", async () => {
  await host.addRelease("0.3.0");
  await host.stub("broken", "0.2.0\n0.3.0\n");

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 1);
  assert.match(result.stdout, /The rollback failed too\./);
  assert.doesNotMatch(result.stdout, /Rolled back/);
  assert.match(result.stderr, /Version 0\.3\.0 failed/);
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
  assert.equal(await readFile(path.join(host.root, "failed"), "utf8"), "0.3.0\n");
  assert.match((await dockerCalls(host)).at(-1), / compose .* up --detach --wait /);
});

test("meals-deploy leaves the data alone when the pre-deploy backup fails validation in the rollback", async () => {
  await host.addRelease("0.3.0");
  await host.stub("broken", "0.3.0\n");
  // Once version 0.3.0 starts, it migrates the data, and the pre-deploy
  // backup gets invalid JSON.
  const onUp = [
    migrateOnUp("0.3.0"),
    "if grep -qx 'MEALS_VERSION=0.3.0' \"$MEALS_ROOT/.env\"; then",
    "  dir=$(mktemp -d)",
    '  mkdir -p "$dir/data/v2"',
    "  echo '{ not json' >\"$dir/data/v2/recipes.json\"",
    '  tar -C "$dir" -czf "$MEALS_ROOT"/backups/*-pre-deploy-*.tar.gz data',
    '  rm -rf "$dir"',
    "fi",
    "",
  ];
  await host.stub("on-up", onUp.join("\n"), { executable: true });

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Invalid JSON: v2\/recipes\.json/);
  assert.match(result.stdout, /The rollback failed too\./);
  assert.doesNotMatch(result.stdout, /Rolled back/);
  assert.equal(await host.readData("v2/recipes.json"), '{ "recipes": "migrated" }\n');
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
  assert.equal(await readFile(path.join(host.root, "failed"), "utf8"), "0.3.0\n");
  assert.deepEqual(
    (await readdir(host.root)).filter((name) => name.startsWith(".restore.")),
    [],
  );
});

test("a failed first deployment leaves the data as it is and starts nothing", async () => {
  await host.cleanup();
  host = await createHost({ version: "" });
  await host.addRelease("0.2.0");
  await host.stub("broken", "0.2.0\n");
  await host.stub("on-up", migrateOnUp("0.2.0"), { executable: true });

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 1);
  const env = await host.readEnv();
  assert.equal(env.MEALS_IMAGE, "");
  assert.equal(env.MEALS_VERSION, "");
  assert.equal(await host.readData("v2/recipes.json"), '{ "recipes": "migrated" }\n');
  assert.deepEqual(await host.backups(), []);
  assert.equal(await readFile(path.join(host.root, "failed"), "utf8"), "0.2.0\n");
  assert.match((await dockerCalls(host)).at(-1), / compose .* stop$/);
});
