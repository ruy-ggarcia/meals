import assert from "node:assert/strict";
import { access, cp } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  assertDataFiles,
  assertExit,
  assertOriginalData,
  composeCall,
  createHost,
  replaceHost,
} from "./host-helpers.js";

describe("assertExit", () => {
  test("passes when the status is the expected one", () => {
    assertExit({ status: 1, stdout: "", stderr: "" }, 1);
  });

  test("fails with the status, the standard output, and the standard error", () => {
    assert.throws(
      () => assertExit({ status: 1, stdout: "backed up\n", stderr: "No space left.\n" }, 0),
      /expected exit status 0, got 1\nstdout:\nbacked up\n\nstderr:\nNo space left\.\n/,
    );
  });

  test("fails with the context of the run", () => {
    assert.throws(
      () => assertExit({ status: 0, stdout: "", stderr: "" }, 1, "2 arguments"),
      /expected exit status 1, got 0 \(2 arguments\)/,
    );
  });

  test("fails with the error of a script that didn't start", () => {
    const result = { status: null, stdout: null, stderr: null, error: new Error("spawn ENOENT") };

    assert.throws(() => assertExit(result, 0), /got null.*\nstdout:\n\nstderr:\nspawn ENOENT/s);
  });
});

describe("createHost", () => {
  test("deploys version 0.2.0 unless it gets another version", async (t) => {
    const host = await createHost();
    t.after(() => host.cleanup());

    assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
  });
});

describe("replaceHost", () => {
  test("creates the host of the options that it gets", async (t) => {
    const host = await replaceHost(t, await createHost(), { version: "" });

    assert.equal((await host.readEnv()).MEALS_VERSION, "");
  });

  test("removes the old host at once, and the new one when its test ends", async () => {
    /** @type {(() => unknown)[]} */
    const hooks = [];
    const t = /** @type {any} */ ({ after: (hook) => hooks.push(hook) });
    const old = await createHost();

    const host = await replaceHost(t, old, { version: "" });

    await assert.rejects(access(old.root), { code: "ENOENT" });
    await access(host.root);
    for (const hook of hooks) await hook();
    await assert.rejects(access(host.root), { code: "ENOENT" });
  });
});

const PROJECT = "--project-directory /srv --file /srv/compose.yaml";
const PS = `docker compose ${PROJECT} ps --quiet app`;
const STOP = `docker compose ${PROJECT} stop`;
const UP = `docker compose ${PROJECT} up --detach`;
const UP_WAIT = `docker compose ${PROJECT} up --detach --wait --wait-timeout 5`;
const PULL = "docker pull --quiet image";

/** Creates a host before each test, with the calls above in its log, and cleans it up. */
function useLoggedCalls() {
  const logged = { host: undefined };

  beforeEach(async () => {
    logged.host = await createHost();
    const calls = [PS, STOP, UP, UP_WAIT, PULL, "curl http://localhost/api/health", ""];
    await logged.host.stub("calls", calls.join("\n"));
  });

  afterEach(async () => {
    await logged.host.cleanup();
  });

  return logged;
}

describe("dockerCalls", () => {
  const logged = useLoggedCalls();

  test("returns the calls of docker, and no other call", async () => {
    assert.deepEqual(await logged.host.dockerCalls(), [PS, STOP, UP, UP_WAIT, PULL]);
  });
});

describe("composeCalls", () => {
  const logged = useLoggedCalls();

  test("returns every call of docker compose without a kind", async () => {
    assert.deepEqual(await logged.host.composeCalls(), [PS, STOP, UP, UP_WAIT]);
  });

  test("returns the stop call for the kind stop", async () => {
    assert.deepEqual(await logged.host.composeCalls("stop"), [STOP]);
  });

  test("leaves out the call that waits for the kind up", async () => {
    assert.deepEqual(await logged.host.composeCalls("up"), [UP]);
  });

  test("returns only the call that waits for the kind up --wait", async () => {
    assert.deepEqual(await logged.host.composeCalls("up --wait"), [UP_WAIT]);
  });
});

describe("composeCall", () => {
  test("gives the pattern that composeCalls uses", () => {
    assert.ok(composeCall("up").test(UP));
    assert.ok(!composeCall("up").test(UP_WAIT));
  });
});

describe("assertOriginalData", () => {
  let host;

  beforeEach(async () => {
    host = await createHost();
  });

  afterEach(async () => {
    await host.cleanup();
  });

  test("passes for the data that the host starts with", async () => {
    await assertOriginalData(host);
  });

  test("fails with the file whose content changed", async () => {
    await host.writeData("v2/recipes.json", "{ not json");

    await assert.rejects(assertOriginalData(host), { message: /v2\/recipes\.json/ });
  });

  test("fails when the data holds a week that the original doesn't", async () => {
    await host.writeData("v2/weeks/2026-09-28.json", "{}\n");

    await assert.rejects(assertOriginalData(host), { actual: true, expected: false });
  });

  test("checks data.old when it gets that directory", async () => {
    await cp(path.join(host.root, "data"), path.join(host.root, "data.old"), { recursive: true });
    await host.writeData("v2/recipes.json", "{ not json");

    await assertOriginalData(host, "data.old");
    await assert.rejects(assertOriginalData(host, "data"), { message: /v2\/recipes\.json/ });
  });
});

describe("assertDataFiles", () => {
  let host;

  beforeEach(async () => {
    host = await createHost();
  });

  afterEach(async () => {
    await host.cleanup();
  });

  test("accepts a week that the original doesn't have", async () => {
    await host.writeData("v2/weeks/2026-09-28.json", "{}\n");

    await assertDataFiles(host);
  });

  test("fails with the file whose content changed", async () => {
    await host.writeData("v2/ingredients.json", "{}\n");

    await assert.rejects(assertDataFiles(host), { message: /v2\/ingredients\.json/ });
  });
});
