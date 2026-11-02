import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { assertExit, createHost } from "./host-helpers.js";

const COMMON = fileURLToPath(new URL("../scripts/lib/common.sh", import.meta.url));

let host;
let dir;

/**
 * Runs the bash SCRIPT after it sources common.sh, with the host as MEALS_ROOT.
 * The C locale keeps the messages of find and bash in English, as the tests
 * expect them, whatever language the machine speaks.
 */
function runWithCommon(script) {
  return spawnSync("bash", ["-c", `source "${COMMON}"\n${script}`], {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C", MEALS_ROOT: host.root },
  });
}

beforeEach(async () => {
  host = await createHost();
  dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "meals-probe-")));
});

afterEach(async () => {
  await host.cleanup();
  await rm(dir, { recursive: true, force: true });
});

test("MEALS_SCRIPTS is the directory of a script run by a relative path", async () => {
  await writeFile(
    path.join(dir, "probe"),
    `#!/usr/bin/env bash\nsource "${COMMON}"\nprintf '%s\\n' "$MEALS_SCRIPTS"\n`,
  );
  await chmod(path.join(dir, "probe"), 0o755);

  const result = spawnSync("./probe", {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, MEALS_ROOT: host.root },
  });

  assertExit(result, 0);
  assert.equal(result.stdout, `${dir}\n`);
});

test("validate_data fails when it can't read a directory under the data", () => {
  // As find does for an unreadable directory: it lists the other files, and fails.
  const result = runWithCommon(
    'find() { command find "$@"; return 1; }\nvalidate_data "$MEALS_ROOT/data"',
  );

  assertExit(result, 1);
  assert.equal(result.stdout, `Couldn't read every file in ${host.root}/data.\n`);
});

describe("validate_data", () => {
  test("fails with its message when find fails before it lists a file", () => {
    // The scripts run with set -e, which ends the subshell of find before it
    // prints the status of find.
    const result = runWithCommon('set -e\nfind() { return 1; }\nvalidate_data "$MEALS_ROOT/data"');

    assertExit(result, 1);
    assert.equal(result.stdout, `Couldn't read every file in ${host.root}/data.\n`);
  });
});

test("validate_data says so when jq isn't installed", () => {
  // A PATH with find but without jq.
  const result = runWithCommon(
    `ln -s "$(command -v find)" "${dir}/find"\nPATH="${dir}" validate_data "$MEALS_ROOT/data"`,
  );

  assertExit(result, 1);
  assert.match(result.stderr, /jq: command not found/);
});
