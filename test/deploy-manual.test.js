import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  assertExit,
  blockEnvWrite,
  composeCall,
  createHost,
  imageFor,
  replaceHost,
} from "./host-helpers.js";

let host;

beforeEach(async () => {
  host = await createHost();
});

afterEach(async () => {
  await host.cleanup();
});

/** Replaces the host with one that runs version 0.1.0 on hold, and has releases 0.1.0 and 0.2.0. */
async function holdOldVersion(t) {
  host = await replaceHost(t, host, { version: "0.1.0" });
  await host.addRelease("0.1.0", { latest: false });
  await host.addRelease("0.2.0");
  await host.writeRootFile("hold", "");
}

describe("meals-deploy", () => {
  test("doesn't put the host on hold when the data has invalid JSON", async () => {
    await host.addRelease("0.3.0");
    await host.writeData("v2/recipes.json", "{ not json");

    const result = await host.run("meals-deploy", "0.3.0");

    assertExit(result, 1);
    assert.match(result.stderr, /The data failed validation/);
    assert.equal(await host.exists("hold"), false);
    assert.deepEqual(await host.composeCalls("stop"), []);
  });

  test("doesn't put the host on hold when the pre-deploy backup fails", async () => {
    await host.addRelease("0.3.0");
    await host.failArchiving();

    const result = await host.run("meals-deploy", "0.3.0");

    assertExit(result, 1);
    assert.match(result.stderr, /The pre-deploy backup failed, so version 0\.2\.0 runs again/);
    assert.equal(await host.exists("hold"), false);
  });

  test("keeps the hold when the new version fails the verification", async () => {
    await host.addRelease("0.3.0");
    await host.stub("broken", "0.3.0\n");

    const result = await host.run("meals-deploy", "0.3.0");

    assertExit(result, 1);
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

  test("restarts the previous version without a hold when it can't write .env", async () => {
    await host.addRelease("0.3.0");
    await blockEnvWrite(host);

    const result = await host.run("meals-deploy", "0.3.0");

    assertExit(result, 1);
    assert.match(result.stderr, /Couldn't write \.env, so version 0\.2\.0 runs again\./);
    const env = await host.readEnv();
    assert.equal(env.MEALS_IMAGE, imageFor("0.2.0"));
    assert.equal(env.MEALS_VERSION, "0.2.0");
    assert.equal(await host.exists("hold"), false);
    assert.equal(await host.exists("failed"), false);
    assert.match((await host.dockerCalls()).at(-1), composeCall("up"));
    assert.match(result.stdout, /Put the host on hold/);
    assert.match(result.stdout, /Ended the hold, because version 0\.3\.0 wasn't deployed\./);
  });

  test("keeps a hold that it didn't create when it can't write .env", async () => {
    await host.addRelease("0.3.0");
    await host.writeRootFile("hold", "");
    await blockEnvWrite(host);

    const result = await host.run("meals-deploy", "0.3.0");

    assertExit(result, 1);
    assert.match(result.stderr, /Couldn't write \.env, so version 0\.2\.0 runs again\./);
    assert.equal(await host.exists("hold"), true);
    assert.doesNotMatch(result.stdout, /Ended the hold/);
  });

  test("says how to end the hold when it can't remove it", async () => {
    await host.addRelease("0.3.0");
    await blockEnvWrite(host);
    await host.failCommand("rm", "$last == */hold");

    const result = await host.run("meals-deploy", "0.3.0");

    assertExit(result, 1);
    assert.match(result.stdout, /Couldn't end the hold\. To end it, run meals-deploy --resume\./);
    assert.match(result.stderr, /Error: Couldn't write \.env, so version 0\.2\.0 runs again\./);
    assert.equal(await host.exists("hold"), true);
  });

  test("fails on a release without image.txt", async () => {
    await host.addRelease("0.3.0", { withImage: false });

    const result = await host.run("meals-deploy", "0.3.0");

    assertExit(result, 1);
    assert.match(result.stderr, /Error: Version 0\.3\.0 has no image\.txt\./);
    assert.deepEqual(await host.dockerCalls(), []);
    assert.equal(await host.exists("hold"), false);
  });

  test("doesn't put the host on hold when the pull fails", async () => {
    await host.addRelease("0.1.0", { latest: false });
    await host.stub("pull-fails", "");

    const result = await host.run("meals-deploy", "0.1.0");

    assertExit(result, 1);
    assert.equal(await host.exists("hold"), false);
    assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
  });

  test("deploys a version that failed before", async () => {
    await host.addRelease("0.3.0");
    await host.writeRootFile("failed", "0.3.0\n");

    const result = await host.run("meals-deploy", "0.3.0");

    assertExit(result, 0);
    assert.match(result.stdout, /Deployed version 0\.3\.0\./);
    assert.equal((await host.readEnv()).MEALS_VERSION, "0.3.0");
    assert.equal(await host.exists("hold"), true);
  });

  test("accepts a version with its tag prefix", async () => {
    await host.addRelease("0.1.0", { latest: false });

    const result = await host.run("meals-deploy", "v0.1.0");

    assertExit(result, 0);
    assert.equal((await host.readEnv()).MEALS_VERSION, "0.1.0");
  });

  test("fails on a release that doesn't exist", async () => {
    const result = await host.run("meals-deploy", "9.9.9");

    assertExit(result, 1);
    assert.match(result.stderr, /Couldn't get release v9\.9\.9 from GitHub/);
    assert.equal(await host.exists("hold"), false);
  });

  test("deploys an older release and puts the host on hold", async () => {
    await host.addRelease("0.1.0", { latest: false });

    const result = await host.run("meals-deploy", "0.1.0");

    assertExit(result, 0);
    assert.equal((await host.readEnv()).MEALS_VERSION, "0.1.0");
    assert.equal(await host.exists("hold"), true);
  });

  test("keeps the held version when it gets no version argument", async (t) => {
    await holdOldVersion(t);

    const result = await host.run("meals-deploy");

    assertExit(result, 0);
    assert.equal((await host.readEnv()).MEALS_VERSION, "0.1.0");
  });

  test("ends the hold with --resume", async (t) => {
    await holdOldVersion(t);

    const result = await host.run("meals-deploy", "--resume");

    assertExit(result, 0);
    assert.match(result.stdout, /Resumed the automatic deployments\./);
    assert.equal(await host.exists("hold"), false);
  });

  test("deploys the latest release once the hold ends", async (t) => {
    await holdOldVersion(t);
    await rm(path.join(host.root, "hold"));

    const result = await host.run("meals-deploy");

    assertExit(result, 0);
    assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
  });
});
