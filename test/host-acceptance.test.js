// The guards of scripts/host-acceptance.sh, which installs Meals for real.
// The tests only reach the guards that refuse to run, so they never install
// anything, also on a GitHub Actions runner.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { skipAsRoot } from "./host-helpers.js";

const SCRIPT = fileURLToPath(new URL("../scripts/host-acceptance.sh", import.meta.url));

/** Runs the script with ENV, and returns its status and output. */
function runAcceptance(env) {
  const result = spawnSync(SCRIPT, [], { encoding: "utf8", env });
  // A script that doesn't exist yet fails with ENOENT instead of a status.
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr || result.error?.message,
  };
}

test("host acceptance refuses to run outside GitHub Actions", () => {
  const env = { ...process.env };
  delete env.GITHUB_ACTIONS;

  const result = runAcceptance(env);

  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "Run the host acceptance test only on a GitHub Actions runner.\n");
});

test("host acceptance refuses to run as a user other than root", {
  skip: skipAsRoot("the test runs as root"),
}, () => {
  const result = runAcceptance({ ...process.env, GITHUB_ACTIONS: "true" });

  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "Run the host acceptance test as root.\n");
});
