import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { dockerCalls } from "./deploy-helpers.js";
import { createHost, imageFor } from "./host-helpers.js";

let host;

beforeEach(async () => {
  host = await createHost();
});

afterEach(async () => {
  await host.cleanup();
});

test("meals-deploy deploys a newer release: pull, stop, backup, start, and verify", async () => {
  await host.addRelease("0.3.0");

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Deployed version 0\.3\.0\./);
  const env = await host.readEnv();
  assert.equal(env.MEALS_IMAGE, imageFor("0.3.0"));
  assert.equal(env.MEALS_VERSION, "0.3.0");
  assert.equal(env.MEALS_PORT, "3000");
  assert.equal((await host.readEnv(".env.previous")).MEALS_VERSION, "0.2.0");
  const backups = await host.backups();
  assert.equal(backups.length, 1);
  assert.match(backups[0], /-pre-deploy-v0\.2\.0\.tar\.gz$/);
  const calls = await dockerCalls(host);
  const pull = calls.indexOf(`docker pull --quiet ${imageFor("0.3.0")}`);
  const stop = calls.findIndex((call) => / compose .* stop$/.test(call));
  const up = calls.findIndex((call) => / compose .* up --detach --wait /.test(call));
  assert.ok(pull >= 0 && stop > pull && up > stop, calls.join("\n"));
});

test("meals-deploy only checks that the deployed version runs when it's the latest release", async () => {
  await host.addRelease("0.2.0");

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Version 0\.2\.0 is deployed already\./);
  assert.deepEqual(
    (await dockerCalls(host)).map((call) => call.replace(/ --project-directory .* ps /, " ps ")),
    ["docker compose ps --quiet app"],
  );
});

test("meals-deploy starts the deployed version when it isn't running", async () => {
  await host.addRelease("0.2.0");
  await rm(path.join(host.stubDir, "running"));

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Version 0\.2\.0 wasn't running\. Starting it\./);
  assert.ok(
    (await dockerCalls(host)).some((call) => / compose .* up --detach --wait /.test(call)),
    (await dockerCalls(host)).join("\n"),
  );
  assert.match((await host.calls()).at(-1), /^curl .*\/api\/health$/);
});

test("meals-deploy fails when the deployed version starts but reports another version", async () => {
  await host.addRelease("0.2.0");
  await rm(path.join(host.stubDir, "running"));
  await host.stub("health-version", "0.1.0\n");

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Version 0\.2\.0 didn't start healthy\./);
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
  assert.equal(await host.exists("failed"), false);
});

test("meals-deploy skips a latest release that's older than the deployed version", async () => {
  await host.addRelease("0.1.0");

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await dockerCalls(host), []);
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
});

test("meals-deploy fails, without deploying, while the latest release is a failed version", async () => {
  await host.addRelease("0.3.0");
  await host.writeRootFile("failed", "0.3.0\n");

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /The latest release, 0\.3\.0, failed before/);
  assert.deepEqual(await dockerCalls(host), []);
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
});

test("meals-deploy fails with a message when the deployed version doesn't start", async () => {
  await host.addRelease("0.2.0");
  await rm(path.join(host.stubDir, "running"));
  await host.stub("broken", "0.2.0\n");

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Version 0\.2\.0 didn't start healthy\. See docker compose logs/);
});

test("meals-deploy rejects extra arguments", async () => {
  const result = await host.run("meals-deploy", "0.1.0", "extra");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: meals-deploy \[VERSION \| --resume\]/);
  assert.deepEqual(await host.calls(), []);
});

test("meals-deploy rejects an unknown option", async () => {
  const result = await host.run("meals-deploy", "--force");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: meals-deploy \[VERSION \| --resume\]/);
  assert.deepEqual(await host.calls(), []);
});

test("meals-deploy waits while the latest release has no image.txt", async () => {
  await host.addRelease("0.3.0", { withImage: false });

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Version 0\.3\.0 has no image\.txt yet\./);
  assert.deepEqual(await dockerCalls(host), []);
});

test("meals-deploy fails without changing anything when it can't download image.txt", async () => {
  await host.addRelease("0.3.0");
  await rm(path.join(host.stubDir, "downloads"), { recursive: true });

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Error: Couldn't download the image\.txt of version 0\.3\.0\./);
  assert.deepEqual(await dockerCalls(host), []);
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
});

test("meals-deploy does nothing on hold, without asking GitHub", async () => {
  await host.addRelease("0.3.0");
  await host.writeRootFile("hold", "");

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /on hold/);
  assert.deepEqual(await host.calls(), []);
});

test("meals-deploy fails without changing anything when GitHub doesn't answer", async () => {
  const result = await host.run("meals-deploy");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Couldn't get the latest release from GitHub/);
  assert.deepEqual(await dockerCalls(host), []);
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
});

test("meals-deploy fails without changing anything when the release isn't JSON", async () => {
  await host.stub("github/releases/latest", "<html>Unicorn!</html>\n");

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Error: Couldn't read the tag of the release from GitHub\./);
  assert.deepEqual(await dockerCalls(host), []);
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
});

test("meals-deploy fails without changing anything on a tag that isn't a version", async () => {
  await host.stub("github/releases/latest", JSON.stringify({ tag_name: "nightly", assets: [] }));

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Error: The release from GitHub has the tag nightly, which isn't a version like v1\.2\.3\./,
  );
  assert.deepEqual(await dockerCalls(host), []);
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
});

test("meals-deploy fails without changing anything on a release without assets", async () => {
  await host.stub("github/releases/latest", JSON.stringify({ tag_name: "v0.3.0" }));

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Error: Couldn't read the assets of release 0\.3\.0 from GitHub\./);
  assert.deepEqual(await dockerCalls(host), []);
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
});

test("meals-deploy fails on an image.txt that isn't a reference by digest", async () => {
  await host.addRelease("0.3.0", { image: "ghcr.io/ruy-ggarcia/meals:0.3.0" });

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /isn't an image reference by digest/);
  assert.deepEqual(await dockerCalls(host), []);
});

test("the first deployment takes no backup", async () => {
  await host.cleanup();
  host = await createHost({ version: "" });
  await host.addRelease("0.2.0");

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 0, result.stderr);
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
  assert.deepEqual(await host.backups(), []);
  assert.ok(!(await dockerCalls(host)).some((call) => / compose .* stop$/.test(call)));
});

test("a deployment removes the meals images other than the current and the previous one", async () => {
  await host.addRelease("0.3.0");
  await host.stub(
    "images",
    [imageFor("0.1.0"), imageFor("0.2.0"), imageFor("0.3.0"), ""].join("\n"),
  );

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 0, result.stderr);
  const removed = (await dockerCalls(host)).filter((call) => call.startsWith("docker image rm "));
  assert.deepEqual(removed, [`docker image rm ${imageFor("0.1.0")}`]);
});

test("a deployment succeeds, and says so, when it can't remove an old image", async () => {
  await host.addRelease("0.3.0");
  await host.stub("images", [imageFor("0.1.0"), imageFor("0.3.0"), ""].join("\n"));
  await host.stub("image-rm-fails", "");

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    result.stdout.includes(`Couldn't remove the image ${imageFor("0.1.0")}.`),
    result.stdout,
  );
  assert.match(result.stdout, /Deployed version 0\.3\.0\./);
});

test("a deployment succeeds when it can't list the old images", async () => {
  await host.addRelease("0.3.0");
  await host.stub("image-ls-fails", "");

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Couldn't remove the old images\./);
  assert.match(result.stdout, /Deployed version 0\.3\.0\./);
});

test("meals-deploy waits for the lock that another script holds", async () => {
  await host.addRelease("0.3.0");
  const { released } = await host.holdLock(200);

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 0, result.stderr);
  const calls = await host.calls();
  assert.equal(calls[0], "released the lock", calls.join("\n"));
  await released;
});
