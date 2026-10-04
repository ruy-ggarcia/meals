# Releases and deployment design

Date: 2026-10-04

## Context and goal

Meals runs on one computer at home, and devices on the home network use it
from a browser. Today, production is a development checkout started with
`npm start`:

- It stops when the session that started it ends, doesn't start after a
  reboot, and nothing restarts it if it crashes.
- It shares `node_modules` with development, so a stale install breaks one
  or the other.
- Its data lives in `data/` inside the working tree, where `git clean -fdx`
  deletes it.
- Nothing builds a versioned, immutable artifact to deploy. There's no
  changelog, and the only tag, `v0.1.0`, predates most of the code while
  `package.json` still says `0.1.0`.
- Backups are a manual `cp -r`, and no one has tested a restore.
- The server ignores `SIGTERM`, has no health endpoint, doesn't report its
  version, and barely logs.
- The CI workflow references actions by mutable tags, has no job timeout,
  has no dependency updates, and doesn't build the image that production
  would run.

**Goal:** every change that reaches production is a release: a version
number, a changelog entry, a Git tag, and a container image identified by
its digest. The host polls for new releases and deploys each one on its own:
it backs up the data, starts the new image, checks that the expected
version is healthy, and rolls back the image and the data if it isn't. The
host also backs up the data every day and checks every week that the latest
backup restores into a working app. Production survives reboots and crashes,
and keeps its data outside any working tree.

### Out of scope

- Exposing Meals outside the home network.
- Copying backups off the host automatically. The documentation explains
  how to do it by hand.
- Alerts by email or chat. Failures show in `systemctl --failed` and in the
  journal.
- Metrics, tracing, and configurable log levels.
- Multi-architecture images. The host is `x86_64`.
- Image signing and build attestations.
- Linters for workflows and Dockerfiles, and commit message checks.
- A host tool that updates itself. Each release updates the app, and you
  reinstall the host tools when they change.

## Terms

These terms describe operations, not the meal planning domain, so they
stay out of `docs/glossary.md`. `docs/deployment.md` explains them where it
uses them.

| Term | Definition |
|------|------------|
| Backup | A compressed archive of the data directory, named after the time it was taken, its backup kind, and the version that wrote the data. Every backup has a version. |
| Deployed version | The release that the host runs. |
| Failed version | A release whose deployment was rolled back. The host doesn't deploy it again on its own. |
| Hold | A state of the host in which it doesn't deploy new releases on its own. |
| Host | The computer at home that runs the deployed version. |
| Release | A version of Meals: a Git tag `vX.Y.Z`, a GitHub Release with its changelog entry, and a container image identified by its digest. |
| Restore check | A weekly run of the deployed image against a copy of the latest backup, which proves that the backup restores into a working app. |

## Decisions

| Topic | Decision |
|-------|----------|
| Runtime | Docker, with Docker Compose. |
| How releases reach the host | The host polls GitHub every 5 minutes. Nothing outside the home network connects to the host. |
| Releases | release-please opens a release pull request from Conventional Commits. Merging it releases and, minutes later, deploys. |
| release-please credentials | A GitHub App, so the release pull request runs the required checks. |
| Image registry | GitHub Container Registry (GHCR), public, no mutable tags. The host deploys by digest. |
| Deployment root | `/opt/server`, owned by `root:docker` with mode `2775`. Meals lives in `/opt/server/meals`. |
| Host scheduler | System units and timers in `/etc/systemd/system`, run as the system user `deployer`, whose primary group is `docker`. |
| Backup location | `/opt/server/meals/backups/` on the host. |
| Backup versions | Every backup records the version that wrote its data. Before the first deployment, the host takes no backups. |
| Shell scripts | All of them live in `scripts/`. `deploy/` holds the other host files: the Compose file and the systemd units. |
| Dependency updates | Dependabot. |
| Version before the first release | `bootstrap-sha` is the commit of `v0.1.0`, so the first release is `v0.2.0`. |
| Port | `3000`, as today, so bookmarks keep working. |

## Server

### Health endpoint

`GET /api/health` reports whether the server can serve its data, and which
version it runs:

| Status | Meaning |
|--------|---------|
| `200`  | The body is `{ "status": "ok", "version": "VERSION" }`. The server can read and write the data directory. |
| `503`  | The body is `{ "status": "error", "version": "VERSION" }`. The server can't read or write the data directory. |

`VERSION` is the `version` field of `package.json`, read once at startup and
passed to `createApp`. The check is `fs.access(dataDir, R_OK | W_OK)` on
every request. It doesn't read any data file, so a request is cheap enough
for a health check every few seconds.

The API reference in `README.md` documents the endpoint.

### Graceful shutdown

`server/index.js` calls a new `start({ dataDir, logger, port, version })`
function, which listens and returns `{ port, stop }`. On `SIGTERM` or
`SIGINT`, `index.js` logs the signal and calls `stop()`, which does the
following:

1. Stops accepting connections with `server.close()`, and closes idle
   keep-alive connections.
1. Waits for the requests in progress to finish.
1. Waits for the write queue to drain. `createStores` returns an `idle()`
   function that enqueues an empty task and resolves when it runs, which is
   after every write before it.
1. Resolves, and `index.js` logs the stop and exits with code `0`.

If `stop()` hasn't resolved after 10 seconds, `index.js` logs a timeout and
exits with code `1`. The deadline is below the 15-second grace period of the
container, so Docker never needs `SIGKILL`.

### Logs

A logger in `server/logger.js`, with no dependencies, writes one JSON object
per line to standard output:

```json
{"time":"2026-10-04T01:30:00.000Z","level":"info","msg":"request","method":"PUT","path":"/api/weeks/2026-09-28/mon/lunch","status":200,"ms":4}
```

Every entry has `time`, `level` (`info` or `error`), and `msg`. The server
logs the following:

| `msg` | Level | Fields |
|-------|-------|--------|
| `server started` | `info` | `version`, `port`, `dataDir` |
| `request` | `info` | `method`, `path`, `status`, `ms`. Only for paths under `/api`. |
| `request failed` | `error` | `method`, `path`, `error` (the stack). For every `500`. It replaces `console.error`. |
| `server stopping` | `info` | `signal` |
| `server stopped` | `info` | |
| `shutdown timed out` | `error` | |

`createApp` and `start` take the logger as a parameter. Tests pass a logger
that collects the entries, so `npm test` prints nothing.

The `Meals listening on …` line in `README.md` becomes the
`server started` entry.

## Container image

The `Dockerfile` has two stages:

1. `deps`: copies `package.json` and `package-lock.json`, and runs
   `npm ci --omit=dev`.
1. The final stage copies `node_modules` from `deps`, and `package.json`,
   `public/`, and `server/` from the build context.

Both stages start from `node:22-alpine`, pinned by tag and digest. The final
stage does the following:

- Sets `NODE_ENV=production`, `DATA_DIR=/data`, and `PORT=3000`, and exposes
  port `3000`.
- Runs as the `node` user. Compose overrides the user on the host.
- Starts with `/bin/sh -c "umask 0002 && exec node server/index.js"`.
  `exec` replaces the shell, so Node receives the signals. The umask makes
  new data files writable by the `docker` group, so its members can inspect
  and restore data by hand.
- Declares a `HEALTHCHECK` that runs `node server/healthcheck.js` every 30
  seconds, every second during the first 10 seconds, with a 3-second
  timeout. The script requests `/api/health` on `127.0.0.1` and exits with
  `0` only for `200`, so the image needs no `curl` or `wget`.
- Carries the OCI labels for the version, the revision, and the source,
  which `docker/metadata-action` generates. The source label links the GHCR
  package to the repository.

`.dockerignore` keeps everything else out of the build context. In
particular, it excludes `data/`, so real data never ends up in an image.

### Image smoke test

`scripts/image-smoke.sh IMAGE` checks an image as production would run it:

1. Starts `IMAGE` with the options of `deploy/compose.yaml`, such as
   `init`, `read_only`, and `cap_drop`, a temporary data directory, the UID
   and GID of the current user, and the port published on `127.0.0.1`.
1. Waits for Docker to report the container as `healthy`.
1. Checks that `/api/health` returns the `version` of `package.json`.
1. Adds an ingredient, restarts the container, and checks that the
   ingredient is still there.
1. Runs `docker stop`, and checks that the container exits with code `0`
   within the grace period, not `137`.
1. Removes the container and the data directory, whatever the result.

`npm run test:image` builds the image as `meals:test` and runs the smoke
test. It needs Docker, so it isn't part of `npm test`.

## Continuous integration

`.github/workflows/ci.yml` changes as follows:

- Every action is referenced by its full commit SHA, followed by a comment
  with its version, such as `# v7.0.1`.
- Every job has `timeout-minutes: 10`.
- A new job, `image`, runs next to `ci` on every pull request and every push
  to `main`. It builds the image with Docker Buildx and the GitHub Actions
  cache, and runs `scripts/image-smoke.sh` on it.

`image` joins `ci` as a required status check of `main`.

### Dependabot

`.github/dependabot.yml` checks for updates every week, and groups minor and
patch updates into one pull request per ecosystem:

| Ecosystem | Commit prefix | Notes |
|-----------|---------------|-------|
| `docker` | `fix(deps)` | Ignores major updates of `node`. A new major version of Node.js changes the image and the CI workflow together, by hand. |
| `github-actions` | `ci(deps)` | Keeps the version comments next to the SHAs. |
| `npm` | `fix(deps)` for production dependencies, `build(deps-dev)` for development dependencies. | |

The prefixes decide what reaches production: `fix` makes release-please
propose a patch release, and `build` and `ci` don't release anything.

## Releases

### release-please

release-please runs in manifest mode:

- `release-please-config.json` sets `release-type: node`,
  `bump-minor-pre-major: true`, and `bootstrap-sha` to the commit of
  `v0.1.0`.
- `.release-please-manifest.json` holds the current version, `0.1.0`.

Before version `1.0.0`, `feat` commits and breaking changes bump the minor
version, and `fix` commits bump the patch version. The changelog has the
sections Features, Bug Fixes, Performance Improvements, and Reverts.
Commits of other types don't appear and don't release anything.

`CHANGELOG.md` starts with an entry for `0.1.0`, written from the message of
the `v0.1.0` tag.

The release pull request stays open and collects each change merged to
`main`. Merging it is the decision to deploy.

### Release workflow

`.github/workflows/release.yml` runs on every push to `main`, one run at a
time, without canceling a run in progress. It has two jobs, each with
`timeout-minutes: 10`:

1. `release-please`:
   1. Creates a token for the GitHub App with
      `actions/create-github-app-token`, from the `RELEASE_APP_ID` variable
      and the `RELEASE_APP_PRIVATE_KEY` secret.
   1. Runs `googleapis/release-please-action` with that token. It creates
      or updates the release pull request. When that pull request has just
      been merged, it creates the tag `vX.Y.Z` and the GitHub Release.
   1. Outputs whether it created a release, and its tag and version.
1. `publish`, only when `release-please` created a release, with the
   permissions `contents: write` and `packages: write`:
   1. Checks out the tag, and fails if the tag isn't `v` followed by the
      `version` of `package.json`.
   1. Builds the image and runs `scripts/image-smoke.sh` on it.
   1. Pushes it to GHCR as `ghcr.io/ruy-ggarcia/meals:X.Y.Z`. It pushes no
      other tag.
   1. Uploads `image.txt` to the GitHub Release. The file holds one line, the
      image reference by digest: `ghcr.io/ruy-ggarcia/meals@sha256:DIGEST`.

A release is deployable only once it has `image.txt`, and `image.txt` exists
only for an image that passed the smoke test.

## Host

### Repository files

The repository keeps the host files in two directories:

```none
deploy/
  systemd/                   # The .service and .timer units
  compose.yaml
scripts/                     # Every shell script
  lib/                       # Shell functions shared by the scripts
  image-smoke.sh             # The image smoke test
  install.sh                 # Installs the host tools
  meals-backup
  meals-deploy
  meals-restore
  meals-restore-check
```

### Layout

The host has the following directories and files:

```none
/opt/server/                 # root:docker, 2775
  meals/                     # deployer:docker, 2775
    backups/                 # Backups
    bin/                     # meals-backup, meals-deploy, meals-restore, meals-restore-check
    data/                    # The data directory, mounted at /data
    lib/                     # Shell functions shared by the scripts
    .env                     # The deployed version and its settings
    .env.previous            # The previous .env, for the rollback
    .lock                    # The lock that the scripts share
    compose.yaml
    failed                   # Failed versions, one per line
    hold                     # Present while the host is on hold
```

`.env` holds the following variables:

| Variable | Description |
|----------|-------------|
| `MEALS_GID` | The group that the container runs as: `docker`. |
| `MEALS_IMAGE` | The deployed image, by digest. Empty before the first deployment. |
| `MEALS_PORT` | The host port: `3000`. |
| `MEALS_UID` | The user that the container runs as: `deployer`. |
| `MEALS_VERSION` | The deployed version, such as `0.2.0`. Empty before the first deployment. |

The scripts read the root from `MEALS_ROOT`, which defaults to
`/opt/server/meals`. Tests point it at a temporary directory.

### Compose file

`deploy/compose.yaml` declares the project `meals` with one service, `app`:

- `image: ${MEALS_IMAGE}`.
- `init: true`, `restart: unless-stopped`, and `stop_grace_period: 15s`.
- `user: "${MEALS_UID}:${MEALS_GID}"`.
- `read_only: true`, `cap_drop: [ALL]`, and
  `security_opt: [no-new-privileges:true]`.
- `ports: ["${MEALS_PORT}:3000"]`.
- `volumes: ["./data:/data"]`.

Because the Docker service starts at boot and the container restarts unless
you stop it, Meals survives reboots and crashes without a unit of its own.

### Installation

`scripts/install.sh` installs or updates the host tools. You run it with
`sudo` from a checkout of a release tag. It's idempotent, and does the
following:

1. Fails unless it runs as root and the `docker` group exists.
1. Creates the system user `deployer`, with `docker` as its primary group,
   no home directory, and `/usr/sbin/nologin` as its shell, unless it exists.
1. Creates `/opt/server` with owner `root:docker` and mode `2775`, and
   `/opt/server/meals` and its directories with owner `deployer:docker` and
   mode `2775`.
1. Copies `deploy/compose.yaml` to `compose.yaml`, the `meals-*` scripts
   to `bin/`, and `scripts/lib/` to `lib/`, replacing the old copies.
1. Creates `.env` with empty `MEALS_IMAGE` and `MEALS_VERSION` when it
   doesn't exist. **When it creates `.env`, it also creates `hold`**, so the
   timer doesn't deploy into an empty data directory before you move your
   data in.
1. Links each script in `bin/` from `/usr/local/bin`.
1. Copies the units in `deploy/systemd/` to `/etc/systemd/system`, reloads
   systemd, and enables
   and starts the three timers.

### Units

Each timer starts a `Type=oneshot` service with `User=deployer` and
`Group=docker`. The services write to the journal.

| Timer | Schedule | Service runs |
|-------|----------|--------------|
| `meals-backup.timer` | Every day at 03:30, with `Persistent=true`. | `meals-backup daily` |
| `meals-deploy.timer` | 2 minutes after boot, and then 5 minutes after each run. | `meals-deploy` |
| `meals-restore-check.timer` | Every Sunday at 04:00, with `Persistent=true`. | `meals-restore-check` |

### Lock

Every script takes an exclusive `flock` on `.lock` before it changes
anything, and waits for it. A script that another script calls, such as
`meals-restore` during a rollback, inherits the lock instead of waiting for
it.

## Deployment

### Automatic deployment

`meals-deploy`, without arguments, does the following:

1. Takes the lock.
1. Exits with `0` if `hold` exists.
1. Requests `https://api.github.com/repos/ruy-ggarcia/meals/releases/latest`
   without a token. The latest release excludes drafts and prereleases.
1. Exits with `0`, and logs why, if any of the following is true:
   - The release is the deployed version.
   - The release is older than the deployed version, compared with
     `sort -V`. The host never downgrades on its own.
   - The release is in `failed`.
   - The release has no `image.txt` yet.
1. Downloads `image.txt`, and fails unless it's exactly
   `ghcr.io/ruy-ggarcia/meals@sha256:` followed by 64 lowercase hexadecimal
   digits.
1. Deploys that version, as the following section describes.

### Deploying a version

To deploy version `V` with image `I`, `meals-deploy` does the following:

1. Pulls `I`. If the pull fails, it fails without changing anything and
   without adding `V` to `failed`, so the next run tries again.
1. Stops the container, if one runs, with `docker compose stop`.
1. Takes a `pre-deploy` backup, if a version is deployed. The first
   deployment takes none, because no version has written the data yet.
1. Copies `.env` to `.env.previous`, and writes a new `.env` with
   `MEALS_IMAGE=I` and `MEALS_VERSION=V`, atomically.
1. Runs `docker compose up -d`.
1. Verifies the deployment: within 60 seconds, Docker reports the container
   as `healthy`, and `http://127.0.0.1:MEALS_PORT/api/health` returns
   `status` `ok` and `version` `V`.
1. If the verification passes, removes the `ghcr.io/ruy-ggarcia/meals`
   images other than the ones in `.env` and `.env.previous`, and exits with
   `0`. It doesn't touch images of other projects.
1. If the verification fails, rolls back:
   1. Logs the container's last log lines.
   1. Moves `.env.previous` back to `.env`.
   1. If a version was deployed before, runs `meals-restore` with the
      `pre-deploy` backup, which stops the new container, restores the data,
      and starts and verifies the previous version. After a failed first
      deployment, it stops the new container, leaves the data as it is, and
      starts nothing.
   1. Adds `V` to `failed`, and exits with `1`, so the service shows in
      `systemctl --failed`.

   If the rollback fails too, `meals-deploy` still adds `V` to `failed` and
   exits with `1`, and the journal shows both failures.

Each deployment stops Meals for a few seconds, so that the `pre-deploy`
backup is consistent.

### Manual operations

| Command | Effect |
|---------|--------|
| `sudo systemctl start meals-deploy` | Deploys the latest release now, as the timer would. |
| `sudo -u deployer meals-deploy VERSION` | Deploys release `VERSION`, even if it's older or failed, and creates `hold`. Use it to go back to an earlier release. |
| `sudo -u deployer meals-deploy --resume` | Deletes `hold`, so the timer deploys the latest release again. |

`meals-deploy VERSION` takes the image from the `image.txt` of that release,
and fails if the release doesn't exist or has no `image.txt`.

## Backups

### Taking a backup

`meals-backup KIND` takes a backup of kind `KIND`:

1. Takes the lock.
1. Exits with `0`, and logs why, if no version is deployed. Only a deployed
   version writes the data directory, so there's no version to record yet.
1. Archives the whole data directory, both `v2/` and the files of earlier
   versions, as
   `backups/YYYY-MM-DDTHHMMSSZ-KIND-vVERSION.tar.gz`, where `VERSION` is
   `MEALS_VERSION`, such as `2026-10-04T013000Z-daily-v0.2.0.tar.gz`. It
   writes the archive as `.partial`, and renames it when it's complete.
1. Validates the archive: `gzip -t` passes, and every `.json` file in it
   parses with `jq`. If the validation fails, it deletes the archive and
   fails, so you learn about a damaged data file when it happens.
1. Deletes the oldest backups of kind `KIND` beyond the retention:

   | Kind | Backups kept |
   |------|--------------|
   | `daily` | 14 |
   | `pre-deploy` | 10 |
   | `pre-restore` | 10 |

The `daily` backup runs while Meals serves requests. Each data file is
replaced atomically, so each file in the archive is complete. A change made
during the backup might be in one file and not in another, and the app
already tolerates a menu item or a recipe ingredient whose target is
missing.

### Restoring a backup

`meals-restore BACKUP` restores a backup, given as a path or as a file name
in `backups/`:

1. Takes the lock.
1. Fails without changing anything if no version is deployed. To restore a
   backup on a new host, first deploy the backup's version with
   `meals-deploy VERSION`.
1. Extracts the archive into a temporary directory next to `data/`, and
   validates it as `meals-backup` does. It fails without changing anything
   if the validation fails.
1. Fails without changing anything if the backup's version is newer than
   the deployed version, because its data might be in a format that the
   deployed version doesn't read. The message tells you to deploy that
   version first.
1. Stops the container.
1. Takes a `pre-restore` backup.
1. Renames `data/` to `data.old/`, renames the temporary directory to
   `data/`, and deletes `data.old/`.
1. Starts the container and verifies it as a deployment does.

### Restore check

`meals-restore-check` proves that the latest backup restores into a working
app:

1. Takes the lock.
1. Exits with `0`, and logs why, if no version is deployed or there's no
   backup.
1. Extracts the latest backup into a temporary directory.
1. Starts `MEALS_IMAGE` as a separate container, `meals-restore-check`, with
   the temporary directory as its data directory and port `3000` published
   on a random port of `127.0.0.1`.
1. Waits up to 60 seconds for the container to be `healthy`.
1. Requests `/api/health`, `/api/recipes`, `/api/ingredients`, and
   `/api/weeks/WEEK` for each week file in the backup, and fails unless each
   returns `200`.
1. Removes the container and the temporary directory, whatever the result.

## Moving an existing installation

`docs/deployment.md` explains how to move an installation that runs from a
checkout with `npm start` to the host layout. Before you start, the first
release must have its `image.txt`, and the GHCR package must be public.

1. From a checkout of the release tag, run `sudo scripts/install.sh`. The
   host is on hold.
1. Stop the `npm start` server.
1. Copy the whole data directory of the checkout to
   `/opt/server/meals/data/`, and change its owner to `deployer:docker`.
1. Run `sudo -u deployer meals-deploy --resume`, and then
   `sudo systemctl start meals-deploy`. As the first deployment, it takes no
   backup: the data directory of the checkout is the copy to go back to.
1. Check that `/api/health` returns the release's version, and that the
   meal plan, the recipe book, and the ingredient catalog look as before.
1. Take the first backup with `sudo systemctl start meals-backup`.
1. Move the old data directory out of the working tree, for example into a
   dated archive.

If the first deployment fails, copy the data directory of the checkout to
`/opt/server/meals/data/` again before you try another release.

From then on, the checkout's `data/` holds development data only. To run a
development server next to production, run `PORT=3001 npm start`.

## Documentation

- `README.md` keeps using the app and developing it:
  - "Before you begin" adds ShellCheck.
  - "Start the server" becomes a development section. It mentions
    `PORT=3001` and running `npm ci` after you pull changes.
  - "Configure the server" and "Back up and restore data" point to
    `docs/deployment.md`, and keep only what a developer needs.
  - "Continuous integration" describes the `image` job, the release
    workflow, and Dependabot.
  - The project structure lists the new files.
  - The API reference documents `GET /api/health`.
- `docs/deployment.md` is new. It explains the following:
  - The one-time setup on GitHub.
  - How releases work and how to release.
  - How to install the host tools.
  - How deployments, holds, and rollbacks work, and the manual commands.
  - Backups, restores, and the restore check.
  - How to copy backups off the host, and how to restore one on a new host.
  - How to move an existing installation.
  - Where to find the logs.
- `docs/manual-test-plan.md` adds the checks in
  [Manual tests](#manual-tests).

### One-time setup on GitHub

`docs/deployment.md` lists these steps:

1. Create a GitHub App with no webhook, with read and write access to
   contents, issues, and pull requests, and install it on this repository
   only.
1. Save its ID as the repository variable `RELEASE_APP_ID`, and a private
   key as the repository secret `RELEASE_APP_PRIVATE_KEY`.
1. After the first `publish` run, make the `meals` package on GHCR public.
1. Add `image` to the required status checks of `main`.

## Testing

Every change follows test-driven development, and `npm test` prints nothing
when it passes.

### Server

- `GET /api/health` returns `200` with the version of `package.json`, and
  `503` when the data directory has mode `0500`.
- `stop()` resolves only after a request in progress finishes and after a
  queued write finishes.
- The shutdown deadline exits with code `1`, tested with mock timers.
- `node server/index.js`, started as a child process with a temporary data
  directory and `PORT=0`, logs `server started` with its port, and on
  `SIGTERM` logs `server stopped` and exits with code `0`.
- The logger writes one JSON object per line with `time`, `level`, and
  `msg`. The app logs requests under `/api` but not static files, and logs a
  `500` with its stack.

### Host scripts

`test/backup.test.js`, `test/deploy.test.js`, `test/restore-check.test.js`,
and `test/restore.test.js` run the real scripts with `MEALS_ROOT` set to a
temporary directory. Stub `curl` and `docker` commands come first in `PATH`:
they record their calls and return prepared responses. `flock`, `gzip`,
`jq`, and `tar` are the real commands.

- `meals-backup`:
  - Names the archive after the time, the kind, and the deployed version.
  - Takes no backup when no version is deployed.
  - Fails on invalid JSON, and leaves no archive or `.partial` file.
  - Keeps the retention of each kind without touching the other kinds.
- `meals-deploy`:
  - Does nothing on hold, when the latest release is the deployed version,
    is older, is a failed version, or has no `image.txt`.
  - Fails on an `image.txt` that isn't a digest reference.
  - Changes nothing, and doesn't add the version to `failed`, when the pull
    fails.
  - On success, writes `.env` and `.env.previous`, and takes a `pre-deploy`
    backup before it starts the new version.
  - The first deployment takes no backup. When it fails, it leaves the data
    as it is, empties `.env` again, and starts nothing.
  - When the verification fails, restores the data and `.env`, adds the
    version to `failed`, and exits with `1`.
  - `meals-deploy VERSION` deploys an older version and creates `hold`, and
    `--resume` deletes `hold`.
- `meals-restore`:
  - A backup and a restore give back identical data.
  - Fails without changing anything when no version is deployed, on a
    damaged archive, on invalid JSON, and on a backup from a newer version.
  - Takes a `pre-restore` backup.
- `meals-restore-check`:
  - Checks the latest backup and requests each week in it.
  - Removes the container and the temporary directory when a request fails.

`npm run lint` also runs ShellCheck on the shell scripts.

### Image

`scripts/image-smoke.sh` runs in the `image` and `publish` jobs, and locally
with `npm run test:image`.

### Manual tests

`docs/manual-test-plan.md` adds the checks that need a real host:

- `install.sh` creates the user, the directories with their owners, modes,
  and SGID bit, and the timers, and a second run changes nothing.
- Meals and the timers come back after a reboot.
- The timer deploys a new release within 5 minutes.
- A deployment that can't pull its image changes nothing, and a manual
  deployment of an older version followed by `--resume` returns to the
  latest release.
- Moving an existing installation keeps every week, recipe, and
  ingredient.

GitHub validates the release-please and Dependabot configuration, and the
first release pull request shows that they work.
