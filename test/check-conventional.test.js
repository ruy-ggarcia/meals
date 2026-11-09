import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { assertExit } from "./host-helpers.js";

const SCRIPT = fileURLToPath(new URL("../scripts/check-conventional.sh", import.meta.url));

/** Runs check-conventional.sh with SUBJECTS on its input, one per line. */
function check(...subjects) {
  return spawnSync(SCRIPT, [], {
    encoding: "utf8",
    input: subjects.map((subject) => `${subject}\n`).join(""),
  });
}

describe("check-conventional.sh", () => {
  test("accepts Conventional Commits subjects", () => {
    const result = check(
      "feat(ui): show the shopping list of the week",
      "fix(deps): bump the npm-production group with 3 updates",
      "build(deps-dev): bump happy-dom from 20.14.5 to 21.0.1",
      "ci(deps): bump the github-actions group with 2 updates",
      "chore(main): release 0.2.0",
      "docs: use Conventional Commits for pull request titles",
      "refactor!: drop the free-text weeks",
    );

    assertExit(result, 0);
    assert.equal(result.stderr, "");
  });

  test("accepts no input", () => {
    const result = check();

    assertExit(result, 0);
  });

  test("rejects a non-conforming last line without a newline", () => {
    const result = spawnSync(SCRIPT, [], { encoding: "utf8", input: "Update README.md" });

    assertExit(result, 1);
    assert.equal(result.stderr, "Not a Conventional Commits subject: Update README.md\n");
  });

  test("names every subject that doesn't follow Conventional Commits", () => {
    const result = check(
      "feat: fine",
      "Feat: Track ingredients and build a shopping list",
      "feat: Track ingredients",
      "feature: track ingredients",
      "feat(UI): show the grid",
      "feat:missing space",
      "Update README.md",
      'Revert "feat: show the grid"',
    );

    assertExit(result, 1);
    assert.deepEqual(result.stderr.trimEnd().split("\n"), [
      "Not a Conventional Commits subject: Feat: Track ingredients and build a shopping list",
      "Not a Conventional Commits subject: feat: Track ingredients",
      "Not a Conventional Commits subject: feature: track ingredients",
      "Not a Conventional Commits subject: feat(UI): show the grid",
      "Not a Conventional Commits subject: feat:missing space",
      "Not a Conventional Commits subject: Update README.md",
      'Not a Conventional Commits subject: Revert "feat: show the grid"',
    ]);
  });
});
