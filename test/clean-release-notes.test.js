import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { assertExit } from "./host-helpers.js";

const SCRIPT = fileURLToPath(new URL("../scripts/clean-release-notes.js", import.meta.url));

// Fixed identities and dates, and no inherited GIT_* variable, so the
// repository doesn't depend on the machine's Git configuration.
const GIT_ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))),
  GIT_AUTHOR_DATE: "2026-11-27T12:00:00Z",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_AUTHOR_NAME: "Test",
  GIT_COMMITTER_DATE: "2026-11-27T12:00:00Z",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

/** A changelog entry in release-please's format that links to SHA. */
function entry(sha) {
  return `* **ui:** a change ([${sha.slice(0, 7)}](https://github.com/ruy-ggarcia/meals/commit/${sha}))`;
}

describe("scripts/clean-release-notes.js", () => {
  /** @type {string} */
  let repo;
  /** A commit with one parent. */
  let branchCommit;
  /** A merge commit, with two parents. */
  let mergeCommit;

  function git(...args) {
    return execFileSync("git", args, { cwd: repo, encoding: "utf8", env: GIT_ENV }).trim();
  }

  /** Runs the script in the repository with INPUT on its standard input. */
  function clean(input) {
    return spawnSync("node", [SCRIPT], { cwd: repo, encoding: "utf8", env: GIT_ENV, input });
  }

  before(() => {
    repo = mkdtempSync(path.join(os.tmpdir(), "meals-release-notes-"));
    git("init", "--quiet", "--initial-branch=main");
    git("commit", "--quiet", "--allow-empty", "--message=first");
    git("switch", "--quiet", "--create=topic");
    git("commit", "--quiet", "--allow-empty", "--message=feat(ui): a change");
    branchCommit = git("rev-parse", "HEAD");
    git("switch", "--quiet", "main");
    git("merge", "--quiet", "--no-ff", "--message=Merge pull request #1 from topic", "topic");
    mergeCommit = git("rev-parse", "HEAD");
  });

  after(() => rmSync(repo, { recursive: true, force: true }));

  test("removes the entry of a merge commit", () => {
    const result = clean(`### Features\n\n${entry(branchCommit)}\n${entry(mergeCommit)}\n`);

    assertExit(result, 0);
    assert.equal(result.stdout, `### Features\n\n${entry(branchCommit)}\n`);
  });

  test("removes a section that loses all its entries", () => {
    const heading =
      "## [1.0.0](https://github.com/ruy-ggarcia/meals/compare/v0.9.0...v1.0.0) (2026-11-27)";
    const result = clean(
      `${heading}\n\n\n### Features\n\n${entry(mergeCommit)}\n\n\n### Bug Fixes\n\n${entry(branchCommit)}\n`,
    );

    assertExit(result, 0);
    assert.equal(result.stdout, `${heading}\n\n\n### Bug Fixes\n\n${entry(branchCommit)}\n`);
  });

  test("keeps a section whose entries link to no commit", () => {
    const notes = `### ⚠ BREAKING CHANGES\n\n* **ui:** a change\n\n\n### Features\n\n${entry(branchCommit)}\n`;
    const result = clean(notes);

    assertExit(result, 0);
    assert.equal(result.stdout, notes);
  });

  test("keeps the line endings of the input", () => {
    const result = clean(`### Features\r\n\r\n${entry(branchCommit)}\r\n${entry(mergeCommit)}`);

    assertExit(result, 0);
    assert.equal(result.stdout, `### Features\r\n\r\n${entry(branchCommit)}\r\n`);
  });

  test("keeps a last line without a newline", () => {
    const result = clean(`### Features\n\n${entry(mergeCommit)}\n${entry(branchCommit)}`);

    assertExit(result, 0);
    assert.equal(result.stdout, `### Features\n\n${entry(branchCommit)}`);
  });

  test("changes nothing in its own output", () => {
    const first = clean(
      `### Features\n\n${entry(mergeCommit)}\n\n\n### Bug Fixes\n\n${entry(branchCommit)}\n${entry(mergeCommit)}\n`,
    );
    assertExit(first, 0);
    const second = clean(first.stdout);

    assertExit(second, 0);
    assert.equal(second.stdout, first.stdout);
  });

  test("fails on a commit that Git doesn't know", () => {
    const unknown = "f".repeat(40);
    const result = clean(`### Features\n\n${entry(unknown)}\n`);

    assertExit(result, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, new RegExp(`Unknown commit ${unknown}`));
  });
});
