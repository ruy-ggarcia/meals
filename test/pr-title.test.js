import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/pr-title.sh", import.meta.url));

/** Runs pr-title.sh with TITLE and returns its output without the newline. */
function prTitle(title) {
  const result = spawnSync(SCRIPT, [title], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return result.stdout.replace(/\n$/, "");
}

test("pr-title.sh capitalizes the type and the subject, and drops the scope", () => {
  assert.equal(
    prTitle("fix(deps): bump the npm group with 3 updates"),
    "Fix: Bump the npm group with 3 updates",
  );
  assert.equal(
    prTitle("build(deps-dev): bump happy-dom from 20.14.5 to 21.0.1"),
    "Build: Bump happy-dom from 20.14.5 to 21.0.1",
  );
  assert.equal(
    prTitle("ci(deps): bump the github-actions group with 2 updates"),
    "CI: Bump the github-actions group with 2 updates",
  );
});

test("pr-title.sh keeps a breaking change marker out of the title", () => {
  assert.equal(prTitle("fix(deps)!: bump node to 24"), "Fix: Bump node to 24");
});

test("pr-title.sh leaves a title that isn't a Conventional Commits subject as it is", () => {
  assert.equal(
    prTitle("Fix: Bump the npm group with 3 updates"),
    "Fix: Bump the npm group with 3 updates",
  );
  assert.equal(
    prTitle("Bump lodash from 4.17.20 to 4.17.21"),
    "Bump lodash from 4.17.20 to 4.17.21",
  );
});
