import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { describe, test } from "node:test";
import { assertExit, createHost, replaceHost } from "./host-helpers.js";

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
