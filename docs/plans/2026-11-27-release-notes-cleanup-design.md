# Release notes cleanup design

## Intent

The changelog and the notes of each GitHub Release list every change once,
with no manual step, while every pull request keeps merging with a merge
commit.

Today each merge commit carries the pull request title: its title is
`Merge pull request #N from BRANCH` and its body is the pull request title.
GitHub accepts only three combinations of merge commit title and message,
and all of them keep the pull request title in the title or the body.
release-please reads every Conventional Commits line in a commit body as one
more change, so each `feat` or `fix` pull request reaches the changelog
twice: once with its own commits, and once with its merge commit.

## Goals

- The release pull request's `CHANGELOG.md` and body lose every entry that
  links to a merge commit.
- The cleanup runs every time release-please creates or updates the release
  pull request, and running it again changes nothing.
- The GitHub Release, which release-please builds from the body of the
  merged release pull request, comes out clean with no extra step.

## Non-goals

- Changing how pull requests merge, or the merge commit settings.
- Cleaning GitHub Releases that are already published. The v0.4.0 Release
  is edited by hand once.
- Avoiding the second `CodeQL` run on each update of the release pull
  request.

## Anti-goals

- Removing an entry of a commit that isn't a merge commit.
- Leaving a section heading with no entries.
- Letting the text of the pull request body reach a shell command line.

## Constraints

- release-please rewrites the release branch and the pull request body on
  every push to `main`, so the cleanup runs after it each time.
- Pushes to the release branch use the GitHub App token, so the required
  checks run on the cleaned commit. A push with `GITHUB_TOKEN` starts no
  workflow.
- `main` is protected, so a cleanup after the release would need its own
  pull request.

## Approaches

- **Chosen: a step in the `release-please` job, right after the action.**
  It cleans the release branch and the pull request body with the app
  token. The first check runs of each update start on release-please's
  commit, and the `concurrency` groups of `ci` and `conventional` cancel
  them when the cleaned commit arrives seconds later. Only `CodeQL`, from
  the default setup, runs twice, for about a minute.
- Rejected: release-please pushes with `GITHUB_TOKEN`, and the cleanup
  always pushes with the app token, so every check runs once. It needs
  more permissions on the job, a repository setting, a new author for the
  release pull request, and a push even when nothing changes, to save
  about a minute of `CodeQL`.
- Rejected: a separate workflow on `pull_request` for the release branch.
  Its own push starts it again.
- Rejected: a cleanup after the release. `main` is protected, so it needs a
  pull request per release.
- Rejected: `BEGIN_COMMIT_OVERRIDE` in the merged pull request bodies.
  release-please documents that it doesn't work with merge commits, and it
  replaces the message of every commit of the pull request.

The script is in Node, not in shell: it runs in CI, not on the host, and
it edits Markdown. Biome and TypeScript check it as they check `scripts/`
today.

## Design

- `scripts/clean-release-notes.js` reads Markdown on standard input and
  writes it on standard output. An entry is a list item that links to
  `https://github.com/ruy-ggarcia/meals/commit/SHA`, with the full SHA.
  The script asks Git, in the current directory, for the parents of each
  linked commit, and removes the entries of commits with more than one
  parent. It removes a heading that loses all its entries, with its blank
  lines, and leaves every other line unchanged. A commit that Git doesn't
  know fails the script, so it never guesses.
- In `.github/workflows/release.yml`, when the action reports a created or
  updated pull request, the job:
  1. Checks out the release branch with the app token and the full
     history, which includes `main`.
  1. Runs the script on `CHANGELOG.md`. If the file changes, it amends the
     single commit of the branch and pushes it with `--force-with-lease`.
  1. Reads the pull request body with `gh`, runs the script on it, and
     saves it with `gh pr edit --body-file` if it changes.
- The job keeps `permissions: {}`: every write uses the app token. The
  script uses only Node built-ins, so the job needs no `npm ci`.
- The README describes the cleanup next to the release workflow.

## Left to the builder

- The names of the steps and of the functions.
- The committer identity of the amended commit.
- How the tests split between the script's behavior on text and its
  checks against a real Git repository.
