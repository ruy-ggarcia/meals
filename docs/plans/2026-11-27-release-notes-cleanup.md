# Release notes cleanup implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The release pull request's `CHANGELOG.md` and body lose every
entry that links to a merge commit, each time release-please updates them.

**Architecture:** A Node script filters Markdown from standard input to
standard output and asks Git for the parents of each linked commit. A step
of the `release-please` job runs it on the release branch's `CHANGELOG.md`
and on the pull request body, and pushes the result with the app token.

**Tech Stack:** Node 22 built-ins only (`node:child_process`, `node:fs`),
`node:test`, GitHub Actions, `gh`.

**Spec:** `docs/plans/2026-11-27-release-notes-cleanup-design.md`

## Global Constraints

- US English everywhere; Google developer documentation style in docs.
- Commits follow Conventional Commits; these changes use `ci` and `docs`, so
  they release nothing.
- The script imports only Node built-ins: the job runs no `npm ci`.
- The `release-please` job keeps `permissions: {}`; every write uses
  `steps.app-token.outputs.token`.
- No `${{ }}` expression with pull request text inside a `run:` script; pass
  values through `env:` and files.
- Actions are pinned by SHA, as in the other workflows: checkout
  `3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`, setup-node
  `949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0`.
- `npm run lint`, `npm run typecheck`, and `npm test` pass after each task,
  with clean test output.

## Review Focus

- A body that the owner edited on GitHub has CRLF line endings: the script
  keeps each line's ending (test in Task 1).
- A body without a final newline comes back without one (test in Task 1).
- Running the script on its own output changes nothing (test in Task 1).
- A merge commit in `### ⚠ BREAKING CHANGES` loses its entry and the
  heading like any other section (covered by the heading test in Task 1,
  which uses a generic `###` heading).
- An update with nothing to clean pushes nothing and doesn't edit the body
  (Task 2 compares before it writes).

---

### Task 1: The cleanup script

**Files:**
- Create: `scripts/clean-release-notes.js`
- Test: `test/clean-release-notes.test.js`

**Interfaces:**
- Produces: `node scripts/clean-release-notes.js < IN > OUT`, run in a Git
  working tree. Exit 0 with the cleaned text on standard output. Exit 1
  with `Unknown commit SHA` on standard error, and nothing on standard
  output, when a linked commit isn't in the repository.

An entry is a line that starts with `* ` and contains
`https://github.com/ruy-ggarcia/meals/commit/` followed by 40 hex
characters. A section is a line that starts with `### `, up to the next
line that starts with `#` or `---`, or the end. A section that had entries
and loses all of them is dropped with all its lines; the lines before its
heading stay. A commit is a merge commit when
`git rev-list --parents -n 1 SHA` prints more than two words.

The tests build a temporary repository with `git init`, one commit `A`, a
branch commit `B`, and a merge commit `M` (`git merge --no-ff`), with
`GIT_AUTHOR_*`/`GIT_COMMITTER_*` set in `env` so they don't depend on the
machine's Git config, and run the script with `spawnSync("node", [SCRIPT],
{ cwd, input })`. A helper `entry(sha)` returns
`* **ui:** a change ([${sha.slice(0, 7)}](https://github.com/ruy-ggarcia/meals/commit/${sha}))`.

- [ ] **Step 1: Write the failing tests** in `describe("scripts/clean-release-notes.js")`:
  - "removes the entry of a merge commit": input
    `### Features\n\n${entry(B)}\n${entry(M)}\n`, output
    `### Features\n\n${entry(B)}\n`.
  - "removes a section that loses all its entries": input
    `## [1.0.0](URL) (2026-11-27)\n\n\n### Features\n\n${entry(M)}\n\n\n### Bug Fixes\n\n${entry(B)}\n`,
    output `## [1.0.0](URL) (2026-11-27)\n\n\n### Bug Fixes\n\n${entry(B)}\n`.
  - "keeps the line endings of the input": input
    `### Features\r\n\r\n${entry(B)}\r\n${entry(M)}` (CRLF, no final
    newline), output `### Features\r\n\r\n${entry(B)}\r\n`.
  - "keeps a last line without a newline": input
    `### Features\n\n${entry(M)}\n${entry(B)}`, output
    `### Features\n\n${entry(B)}`.
  - "changes nothing in its own output": the output of the first test,
    run again, comes back identical.
  - "fails on a commit that Git doesn't know": an entry with
    `"f".repeat(40)`; `assertExit(result, 1)`, stdout `""`, stderr
    contains `Unknown commit ffffffffffffffffffffffffffffffffffffffff`.
  Each test asserts `assertExit(result, 0)` (from `./host-helpers.js`)
  and the exact stdout.

- [ ] **Step 2: Run the tests and watch them fail**

  Run: `node --test test/clean-release-notes.test.js`
  Expected: FAIL, the script doesn't exist.

- [ ] **Step 3: Write `scripts/clean-release-notes.js`**

  A header comment says what it removes and why (the merge commit body
  repeats the pull request title, and release-please lists it as one more
  change). Read all of standard input with `readFileSync(0, "utf8")`,
  split it into lines that keep their endings
  (`text.match(/[^\n]*\n|[^\n]+$/g) ?? []`), filter, and write the join
  with `process.stdout.write`. Ask Git with `execFileSync("git",
  ["rev-list", "--parents", "-n", "1", sha])`; on failure, write the
  error to standard error and set `process.exitCode = 1` without output.

- [ ] **Step 4: Run the tests and watch them pass**

  Run: `node --test test/clean-release-notes.test.js`, then `npm run lint`,
  `npm run typecheck`, and `npm test`.
  Expected: all pass, with no stray output.

- [ ] **Step 5: Try it on the release pull request**

  In the main checkout, which has the full history of `main`:
  `gh pr view 42 --json body --jq .body | node .worktrees/fix-annotations/scripts/clean-release-notes.js`
  Expected: the lines of `ad5fa2f` and `aafb77a` are gone, and nothing
  else changes (`diff` against the input shows exactly those two lines).

- [ ] **Step 6: Commit**

  ```bash
  git add scripts/clean-release-notes.js test/clean-release-notes.test.js
  git commit -m "ci: add a script that removes merge commit entries from release notes"
  ```

### Task 2: Clean the release pull request in the release workflow

**Files:**
- Modify: `.github/workflows/release.yml` (job `release-please`, after the
  step `release`)
- Modify: `README.md` (the paragraph that starts "On every push to
  `main`, `.github/workflows/release.yml`")

**Interfaces:**
- Consumes: `scripts/clean-release-notes.js` from Task 1;
  `steps.release.outputs.prs_created` (`"true"` when release-please created
  or updated a pull request) and `steps.release.outputs.pr`, a JSON object
  with `headBranchName` and `number`.

- [ ] **Step 1: Add the steps**, all with
  `if: steps.release.outputs.prs_created == 'true'`:
  1. `actions/checkout` with `ref: ${{ fromJSON(steps.release.outputs.pr).headBranchName }}`,
     `fetch-depth: 0`, and `token: ${{ steps.app-token.outputs.token }}`.
     A comment says that the token pushes the cleaned commit so the
     required checks run on it.
  1. `actions/setup-node` with `node-version: 22`, no cache.
  1. "Remove the merge commit entries from the changelog": run the script
     from `CHANGELOG.md` to a temporary file; if `cmp -s` finds a
     difference, move it into place, `git commit --amend --no-edit`, and
     `git push --force-with-lease`. Set `GIT_COMMITTER_NAME` and
     `GIT_COMMITTER_EMAIL` to `github-actions[bot]` and
     `41898282+github-actions[bot]@users.noreply.github.com` in `env:`;
     the author stays release-please's.
  1. "Remove the merge commit entries from the pull request": with
     `GH_TOKEN` from the app token and `PR` from
     `fromJSON(steps.release.outputs.pr).number` in `env:`, save
     `gh pr view "$PR" --json body --jq .body` to a file, clean it into
     another, and run `gh pr edit "$PR" --body-file` only if they differ.
  A comment above the steps says why: release-please reads the pull
  request title in each merge commit body as one more change, and the
  GitHub Release takes its notes from this body.

- [ ] **Step 2: Check the workflow**

  Run: `npm run lint` (actionlint runs in it).
  Expected: pass.

- [ ] **Step 3: Update the README**

  After "keeps a release pull request up to date, and publishes a release
  when you merge it.", add: "After each update, it removes from the
  release pull request the changelog entries of merge commits, whose body
  repeats the pull request title, with `scripts/clean-release-notes.js`."
  Keep the "See [Release a version]" sentence after it.

- [ ] **Step 4: Run every check**

  Run: `npm run lint`, `npm run typecheck`, and `npm test`.
  Expected: all pass, with no stray output.

- [ ] **Step 5: Commit**

  ```bash
  git add .github/workflows/release.yml README.md
  git commit -m "ci: remove the merge commit entries from the release pull request"
  ```

### Task 3: Finish the branch

- [ ] **Step 1: Drop the rebase commit and fold the fixups**

  Rebase on `origin/main` with `--autosquash`, dropping
  `docs: merge pull requests by rebase` through `GIT_SEQUENCE_EDITOR`.
  Expected: the branch holds, in order, the Biome, runner, required
  checks, and changelog commits, the design and plan commits, and the two
  commits of Tasks 1 and 2; every commit passes `npm run lint`.

- [ ] **Step 2: Remove the design and the plan**

  ```bash
  git rm docs/plans/2026-11-27-release-notes-cleanup-design.md docs/plans/2026-11-27-release-notes-cleanup.md
  git commit -m "docs: remove the release notes cleanup design and plan"
  ```
