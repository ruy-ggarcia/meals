import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { blockEnvWrite, dockerCalls, runWithReadOnlyBackups } from "./deploy-helpers.js";
import { createHost, imageFor, skipAsRoot } from "./host-helpers.js";

let host;

beforeEach(async () => {
  host = await createHost();
});

afterEach(async () => {
  await host.cleanup();
});

test("meals-deploy VERSION doesn't put the host on hold when the data has invalid JSON", async () => {
  await host.addRelease("0.3.0");
  await host.writeData("v2/recipes.json", "{ not json");

  const result = await host.run("meals-deploy", "0.3.0");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /The data failed validation/);
  assert.equal(await host.exists("hold"), false);
  assert.ok(!(await dockerCalls(host)).some((call) => / compose .* stop$/.test(call)));
});

test("meals-deploy VERSION doesn't put the host on hold when the pre-deploy backup fails", {
  skip: skipAsRoot("root can write to any directory"),
}, async () => {
  await host.addRelease("0.3.0");

  const result = await runWithReadOnlyBackups(host, "0.3.0");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /The pre-deploy backup failed, so version 0\.2\.0 runs again/);
  assert.equal(await host.exists("hold"), false);
});

test("meals-deploy VERSION keeps the hold when the new version fails the verification", async () => {
  await host.addRelease("0.3.0");
  await host.stub("broken", "0.3.0\n");

  const result = await host.run("meals-deploy", "0.3.0");

  assert.equal(result.status, 1);
  // True on hold too: the timer deploys nothing then, and the failed
  // version neither after a resume.
  assert.ok(
    result.stderr.includes(
      `Error: Version 0.3.0 failed. ${host.root}/failed records it, so the timer won't deploy it.`,
    ),
    result.stderr,
  );
  assert.equal(await host.exists("hold"), true);
});

test("meals-deploy VERSION starts the previous version again, without a hold, when it can't write .env", async () => {
  await host.addRelease("0.3.0");
  await blockEnvWrite(host);

  const result = await host.run("meals-deploy", "0.3.0");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Couldn't write \.env, so version 0\.2\.0 runs again\./);
  const env = await host.readEnv();
  assert.equal(env.MEALS_IMAGE, imageFor("0.2.0"));
  assert.equal(env.MEALS_VERSION, "0.2.0");
  assert.equal(await host.exists("hold"), false);
  assert.equal(await host.exists("failed"), false);
  assert.match((await dockerCalls(host)).at(-1), / compose .* up --detach$/);
  assert.match(result.stdout, /Put the host on hold/);
  assert.match(result.stdout, /Ended the hold, because version 0\.3\.0 wasn't deployed\./);
});

test("meals-deploy VERSION keeps a hold that it didn't create when it can't write .env", async () => {
  await host.addRelease("0.3.0");
  await host.writeRootFile("hold", "");
  await blockEnvWrite(host);

  const result = await host.run("meals-deploy", "0.3.0");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Couldn't write \.env, so version 0\.2\.0 runs again\./);
  assert.equal(await host.exists("hold"), true);
  assert.doesNotMatch(result.stdout, /Ended the hold/);
});

test("meals-deploy VERSION says how to end the hold when it can't remove it", async () => {
  await host.addRelease("0.3.0");
  await blockEnvWrite(host);
  await host.failCommand("rm", "$last == */hold");

  const result = await host.run("meals-deploy", "0.3.0");

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Couldn't end the hold\. To end it, run meals-deploy --resume\./);
  assert.match(result.stderr, /Error: Couldn't write \.env, so version 0\.2\.0 runs again\./);
  assert.equal(await host.exists("hold"), true);
});

test("meals-deploy VERSION fails on a release without image.txt", async () => {
  await host.addRelease("0.3.0", { withImage: false });

  const result = await host.run("meals-deploy", "0.3.0");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Error: Version 0\.3\.0 has no image\.txt\./);
  assert.deepEqual(await dockerCalls(host), []);
  assert.equal(await host.exists("hold"), false);
});

test("meals-deploy VERSION doesn't put the host on hold when the pull fails", async () => {
  await host.addRelease("0.1.0", { latest: false });
  await host.stub("pull-fails", "");

  const result = await host.run("meals-deploy", "0.1.0");

  assert.equal(result.status, 1);
  assert.equal(await host.exists("hold"), false);
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
});

test("meals-deploy VERSION deploys an older release and holds it, and --resume ends the hold", async () => {
  await host.addRelease("0.1.0", { latest: false });
  await host.addRelease("0.2.0");

  const manual = await host.run("meals-deploy", "0.1.0");
  assert.equal(manual.status, 0, manual.stderr);
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.1.0");
  assert.equal(await host.exists("hold"), true);

  const held = await host.run("meals-deploy");
  assert.equal(held.status, 0, held.stderr);
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.1.0");

  const resume = await host.run("meals-deploy", "--resume");
  assert.equal(resume.status, 0, resume.stderr);
  assert.match(resume.stdout, /Resumed the automatic deployments\./);
  assert.equal(await host.exists("hold"), false);

  const latest = await host.run("meals-deploy");
  assert.equal(latest.status, 0, latest.stderr);
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
});

test("meals-deploy VERSION deploys a version that failed before", async () => {
  await host.addRelease("0.3.0");
  await host.writeRootFile("failed", "0.3.0\n");

  const result = await host.run("meals-deploy", "0.3.0");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Deployed version 0\.3\.0\./);
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.3.0");
  assert.equal(await host.exists("hold"), true);
});

test("meals-deploy accepts a version with its tag prefix", async () => {
  await host.addRelease("0.1.0", { latest: false });

  const result = await host.run("meals-deploy", "v0.1.0");

  assert.equal(result.status, 0, result.stderr);
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.1.0");
});

test("meals-deploy VERSION fails on a release that doesn't exist", async () => {
  const result = await host.run("meals-deploy", "9.9.9");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Couldn't get release v9\.9\.9 from GitHub/);
  assert.equal(await host.exists("hold"), false);
});
