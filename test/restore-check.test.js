import assert from "node:assert/strict";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { createHost, DATA, imageFor, skipAsRoot, withMode } from "./host-helpers.js";

const OLDER = "2026-10-01T033000Z-daily-v0.2.0.tar.gz";
const LATEST = "2026-10-02T033000Z-pre-deploy-v0.2.0.tar.gz";

let host;

beforeEach(async () => {
  host = await createHost();
});

afterEach(async () => {
  await host.cleanup();
});

/** DATA with the weeks WEEKS instead of its own. */
function withWeeks(...weeks) {
  const files = {
    "v2/ingredients.json": DATA["v2/ingredients.json"],
    "v2/recipes.json": DATA["v2/recipes.json"],
  };
  for (const week of weeks) files[`v2/weeks/${week}.json`] = "{}\n";
  return files;
}

async function requestedPaths() {
  return (await host.calls())
    .filter((call) => call.startsWith("curl "))
    .map((call) => call.split(" ").at(-1).replace("http://127.0.0.1:49153", ""));
}

async function leftovers() {
  return (await readdir(host.root)).filter((name) => name.startsWith(".restore-check."));
}

/** Whether the stub docker runs the deployed app, or the check's app with CHECK. */
async function appRuns({ check = false } = {}) {
  try {
    await access(path.join(host.stubDir, check ? "running-meals-restore-check" : "running"));
    return true;
  } catch {
    return false;
  }
}

test("meals-restore-check checks the latest backup, each of its weeks, and cleans up", async () => {
  await host.makeBackup(OLDER, withWeeks("2026-09-21"));
  await host.makeBackup(LATEST, withWeeks("2026-09-28", "2026-10-05"));
  await host.writeBackup("2026-10-03T033000Z-daily-v0.2.0.tar.gz.partial", "interrupted");

  const result = await host.run("meals-restore-check");

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await requestedPaths(), [
    "/api/health",
    "/api/recipes",
    "/api/ingredients",
    "/api/weeks/2026-09-28",
    "/api/weeks/2026-10-05",
  ]);
  const docker = (await host.calls()).filter((call) => call.startsWith("docker "));
  const project = `--project-name meals-restore-check --project-directory ${host.root}/.restore-check.`;
  const compose = docker.filter((call) => call.includes(project));
  assert.deepEqual(compose, docker, "every docker call stays off the live meals project");
  assert.ok(
    compose.some((call) => call.includes(" up --detach --wait ")),
    compose.join("\n"),
  );
  assert.ok(compose.at(-1).endsWith(" down"), compose.join("\n"));
  assert.equal(await appRuns({ check: true }), false, "the check's app stopped");
  assert.equal(await appRuns(), true, "the deployed app still runs");
  assert.deepEqual(await leftovers(), []);
  assert.ok(
    result.stdout.includes(`The backup ${LATEST} restores into version 0.2.0:`),
    result.stdout,
  );
});

test("meals-restore-check runs the deployed image as the app's user, on a free loopback port", async () => {
  await host.makeBackup(LATEST);

  const result = await host.run("meals-restore-check");

  assert.equal(result.status, 0, result.stderr);
  // Not the live port 3000, and not on every address.
  assert.equal(
    await readFile(path.join(host.stubDir, "up-env"), "utf8"),
    `MEALS_GID=1000 MEALS_IMAGE=${imageFor("0.2.0")} MEALS_PORT=127.0.0.1:0 MEALS_UID=1000\n`,
  );
});

test("meals-restore-check first removes what an interrupted check left", async () => {
  await host.makeBackup(LATEST);
  await mkdir(path.join(host.root, ".restore-check.AbC123", "data"), { recursive: true });

  const result = await host.run("meals-restore-check");

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await leftovers(), []);
  assert.match(result.stdout, /Removed \.restore-check\.AbC123, which an interrupted check left\./);
  const docker = (await host.calls()).filter((call) => call.startsWith("docker "));
  assert.ok(docker[0].endsWith(" down"), docker.join("\n"));
});

test("meals-restore-check goes on, and says so, when it can't remove a stale copy", {
  skip: skipAsRoot("root can remove any file"),
}, async () => {
  await host.makeBackup(LATEST);
  // As after a backup with a read-only directory: its files can't go.
  const stale = path.join(host.root, ".restore-check.AbC123");
  const readOnly = path.join(stale, "data", "v2");
  await mkdir(readOnly, { recursive: true });
  await writeFile(path.join(readOnly, "recipes.json"), "{}\n");
  const result = await withMode(readOnly, 0o555, () => host.run("meals-restore-check"));

  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    result.stdout.includes(
      `Couldn't remove ${stale}, which an interrupted check left. To free the space, run sudo rm -rf ${stale}.`,
    ),
    result.stdout,
  );
  assert.ok(
    result.stdout.includes(`The backup ${LATEST} restores into version 0.2.0:`),
    result.stdout,
  );
});

test("meals-restore-check removes what an interrupted check left, also with nothing to check", async () => {
  const stale = path.join(".restore-check.AbC123", "data");
  await mkdir(path.join(host.root, stale), { recursive: true });

  const noBackup = await host.run("meals-restore-check");

  assert.equal(noBackup.status, 0, noBackup.stderr);
  assert.match(noBackup.stdout, /There are no backups to check\./);
  assert.match(
    noBackup.stdout,
    /Removed \.restore-check\.AbC123, which an interrupted check left\./,
  );
  assert.deepEqual(await leftovers(), []);
  const docker = (await host.calls()).filter((call) => call.startsWith("docker "));
  assert.ok(docker[0].endsWith(" down"), docker.join("\n"));

  await host.cleanup();
  host = await createHost({ version: "" });
  await host.makeBackup(LATEST);
  await mkdir(path.join(host.root, stale), { recursive: true });

  const noVersion = await host.run("meals-restore-check");

  assert.equal(noVersion.status, 0, noVersion.stderr);
  assert.match(noVersion.stdout, /No version is deployed/);
  assert.match(
    noVersion.stdout,
    /Removed \.restore-check\.AbC123, which an interrupted check left\./,
  );
  assert.deepEqual(await leftovers(), []);
  // Without an image, Compose can't read compose.yaml.
  assert.deepEqual(await host.calls(), []);
});

test("meals-restore-check fails when it can't remove the containers of an interrupted check", async () => {
  await host.makeBackup(LATEST);
  await host.stub("stop-fails", "");

  const result = await host.run("meals-restore-check");

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Error: Couldn't remove the containers that an interrupted check left\./,
  );
  assert.ok(!(await host.calls()).some((call) => call.includes(" up ")));
  assert.deepEqual(await leftovers(), []);
});

test("meals-restore-check fails, and cleans up, when a request fails", async () => {
  await host.makeBackup(LATEST, withWeeks("2026-09-28"));
  await host.stub("failing-paths", "/api/weeks/2026-09-28\n");

  const result = await host.run("meals-restore-check");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /GET \/api\/weeks\/2026-09-28 failed/);
  assert.ok((await host.calls()).at(-1).endsWith(" down"));
  assert.equal(await appRuns({ check: true }), false, "the check's app stopped");
  assert.equal(await appRuns(), true, "the deployed app still runs");
  assert.deepEqual(await leftovers(), []);
});

for (const [damage, writeLatest] of [
  ["isn't an archive", () => host.writeBackup(LATEST, "not an archive")],
  ["has invalid JSON", () => host.makeBackup(LATEST, { ...DATA, "v2/recipes.json": "{ not json" })],
]) {
  test(`meals-restore-check fails, and checks no older backup, when the latest backup ${damage}`, async () => {
    await host.makeBackup(OLDER);
    await writeLatest();

    const result = await host.run("meals-restore-check");

    assert.equal(result.status, 1);
    assert.ok(
      result.stderr.includes(`Error: The backup ${LATEST} failed validation.`),
      result.stderr,
    );
    assert.ok(!(await host.calls()).some((call) => call.includes(" up ")));
    assert.ok(!`${result.stdout}${result.stderr}`.includes(OLDER), result.stdout);
    assert.deepEqual(await leftovers(), []);
  });
}

test("meals-restore-check fails when the app doesn't become healthy on the backup", async () => {
  await host.makeBackup(LATEST);
  await host.stub("broken", "0.2.0\n");

  const result = await host.run("meals-restore-check");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /didn't become healthy/);
  assert.deepEqual(await leftovers(), []);
});

test("meals-restore-check fails, and cleans up, when it can't get the address of the app", async () => {
  for (const [file, content] of [
    ["port-fails", ""],
    ["port", ""],
  ]) {
    await host.cleanup();
    host = await createHost();
    await host.makeBackup(LATEST);
    await host.stub(file, content);

    const result = await host.run("meals-restore-check");

    assert.equal(result.status, 1, file);
    assert.ok(
      result.stderr.includes(
        `Error: Couldn't get the address of version 0.2.0 on the backup ${LATEST}.`,
      ),
      `${file}: ${result.stderr}`,
    );
    assert.ok((await host.calls()).at(-1).endsWith(" down"), file);
    assert.deepEqual(await leftovers(), [], file);
  }
});

test("meals-restore-check fails when it can't create the directory for the copy", {
  skip: skipAsRoot("root can write to any directory"),
}, async () => {
  await host.makeBackup(LATEST);
  await host.writeRootFile(".lock", "");
  const result = await withMode(host.root, 0o555, () => host.run("meals-restore-check"));

  assert.equal(result.status, 1);
  assert.ok(
    result.stderr.includes(
      `Error: Couldn't create a directory for the copy of the backup in ${host.root}.`,
    ),
    result.stderr,
  );
  assert.deepEqual(await host.calls(), []);
});

test("meals-restore-check fails when it can't list the backups", {
  skip: skipAsRoot("root can read any directory"),
}, async () => {
  await host.makeBackup(LATEST);
  const backups = path.join(host.root, "backups");
  const result = await withMode(backups, 0o300, () => host.run("meals-restore-check"));

  assert.equal(result.status, 1);
  assert.ok(
    result.stderr.includes(`Error: Couldn't list the backups in ${host.root}/backups.`),
    result.stderr,
  );
  assert.ok(!(await host.calls()).some((call) => call.includes(" up ")));
});

test("meals-restore-check does nothing without a deployed version or a backup", async () => {
  const noBackup = await host.run("meals-restore-check");
  assert.equal(noBackup.status, 0, noBackup.stderr);
  assert.match(noBackup.stdout, /There are no backups to check\./);

  await host.cleanup();
  host = await createHost({ version: "" });
  await host.makeBackup(LATEST);
  const noVersion = await host.run("meals-restore-check");
  assert.equal(noVersion.status, 0, noVersion.stderr);
  assert.match(noVersion.stdout, /No version is deployed/);
  assert.deepEqual(await host.calls(), []);
});

test("meals-restore-check waits for the lock that another script holds", async () => {
  await host.makeBackup(LATEST);
  const { released } = await host.holdLock(200);

  const result = await host.run("meals-restore-check");

  assert.equal(result.status, 0, result.stderr);
  const calls = await host.calls();
  assert.equal(calls[0], "released the lock", calls.join("\n"));
  await released;
});
