import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { assertExit } from "./host-helpers.js";

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
