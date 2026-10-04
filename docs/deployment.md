# Deploy Meals

Meals runs in a Docker container on one computer at home, the *host*. Every
change reaches the host as a *release*: a version number, a changelog entry,
a Git tag, and a container image identified by its digest.

## How it works

1. You merge pull requests into `main`, and release-please keeps a *release
   pull request* open. It bumps the version and adds the changes to
   `CHANGELOG.md`.
1. You merge the release pull request. The release workflow tags the
   release, builds the image, runs the smoke test on it, and pushes it to
   GitHub Container Registry. Then it attaches `image.txt`, the image
   reference by digest, to the GitHub Release.
1. Within 5 minutes, `meals-deploy` on the host finds the release, backs up
   the data, starts the new version, and checks its health. If the check
   fails, it *rolls back* to the previous version and its data.

Every day, `meals-backup` backs up the data, and every week,
`meals-restore-check` checks that the latest backup restores into a working
app. See [Backups](#backups).

## Set up GitHub

To set up GitHub, do the following once, before the first release:

1. Create a GitHub App for release-please:
   1. In GitHub, go to **Settings > Developer settings > GitHub Apps**, and
      click **New GitHub App**.
   1. Enter a name, such as `meals-release`, and the repository's URL as the
      homepage URL.
   1. Clear **Webhook > Active**.
   1. Under **Repository permissions**, set **Contents**, **Issues**, and
      **Pull requests** to **Read and write**.
   1. Under **Where can this GitHub App be installed?**, select **Only on
      this account**, and click **Create GitHub App**.
   1. Copy the **Client ID**. Then click **Generate a private key**, which
      downloads a `.pem` file.
   1. Click **Install App**, and install the app on the `meals` repository
      only.
1. Save the app's client ID and private key in the repository:

   ```bash
   gh variable set RELEASE_APP_CLIENT_ID --body CLIENT_ID
   gh secret set RELEASE_APP_PRIVATE_KEY < PEM_FILE
   ```

   Replace `CLIENT_ID` with the client ID and `PEM_FILE` with the path of the
   `.pem` file. Then delete the `.pem` file.
1. Require the `image` check before a pull request can merge into `main`:

   ```bash
   gh api --method POST \
     repos/ruy-ggarcia/meals/branches/main/protection/required_status_checks/contexts \
     -f 'contexts[]=image'
   ```

After the first release, make the image public, so the host can pull it
without credentials:

1. In GitHub, open the `meals` package from the repository's **Packages**
   list.
1. Click **Package settings**, and under **Danger Zone**, click **Change
   visibility**. Select **Public**, and confirm.

## Release a version

The version follows [Semantic Versioning](https://semver.org), and the
commit types since the last release decide the next version:

| Commits since the last release | Before `1.0.0` | From `1.0.0` on |
|--------------------------------|----------------|-----------------|
| A breaking change (`feat!:`, or a `BREAKING CHANGE:` footer) | Minor version | Major version |
| `feat` | Minor version | Minor version |
| `fix` | Patch version | Patch version |
| Only `build`, `ci`, `docs`, `refactor`, or `test` | No release | No release |

Dependabot commits updates of the production dependencies and the base
image as `fix(deps)`, so they reach the host in the next release. It
commits updates of the development dependencies as `build(deps-dev)`, and
of the GitHub Actions as `ci(deps)`, which release nothing.

To release a version, do the following:

1. Open the pull request titled `chore(main): release X.Y.Z`, and check the
   version and the changelog.
1. When its checks pass, merge it.
1. A few minutes later, check that the `publish` job attached `image.txt`
   to the release. The output of the following command must list
   `image.txt`:

   ```bash
   gh release view vX.Y.Z
   ```

The host deploys the release within 5 minutes after `image.txt` appears.
If the `publish` job fails, the release has no `image.txt`, and the host
doesn't deploy it. Fix the problem in a pull request, and release the fix as
the next version.

## Install the host tools

The host needs Docker Engine with the Compose plugin, `curl`, `flock`,
`gzip`, `jq`, and `tar`. On Ubuntu, usually only `jq` is missing. To install
it, run `sudo apt install jq`.

To install the host tools, or to update them to a release, do the
following:

1. Get a checkout of the release tag:

   ```bash
   git clone https://github.com/ruy-ggarcia/meals.git
   cd meals
   git checkout vX.Y.Z
   ```

1. Run the installer:

   ```bash
   sudo scripts/install.sh
   ```

The installer creates the following:

- The system user `deployer`, whose primary group is `docker`. It has no
  home directory and can't log in.
- `/opt/server`, owned by `root:docker` with mode `2775`, and
  `/opt/server/meals`, owned by `deployer:docker`:

  ```none
  /opt/server/meals/
    .docker/        # Docker CLI settings of the scripts
    backups/        # Backups
    data/           # The data directory, mounted at /data in the container
    scripts/        # The meals-* scripts and their shared functions
    .env            # The deployed version and its settings
    compose.yaml    # The app service
  ```

- The commands `meals-backup`, `meals-deploy`, `meals-restore`, and
  `meals-restore-check` in `/usr/local/bin`.
- The timers `meals-backup.timer`, `meals-deploy.timer`, and
  `meals-restore-check.timer`, enabled and started. Each timer runs the
  service of the same name. So that a hung step can't keep the lock that the
  scripts share, systemd stops `meals-backup.service` after 30 minutes, and
  `meals-deploy.service` or `meals-restore-check.service` after 15 minutes.
  A stopped service shows in `systemctl --failed`.

When you run the installer again, it replaces the scripts, `compose.yaml`,
and the units, and resets the directory owners and modes. It keeps `.env`,
`hold`, the data, and the backups. It removes the scripts and links of
commands that the release renamed or dropped, and prints `Removed the old
script NAME.` for each.

The first installation also puts the host *on hold*, so it deploys nothing
until you move your data in. To start without data, run
`sudo -u deployer meals-deploy --resume`. To keep the data of an earlier
installation, see
[Move an existing installation](#move-an-existing-installation).

A release updates the app, but not the host tools. When a release changes
`deploy/` or `scripts/`, run the installer again from that release.

## Deployments

`meals-deploy.timer` runs `meals-deploy` 2 minutes after boot, and then 5
minutes after each run. It deploys the latest release, unless one of the
following is true:

- The host is on hold.
- The release is the deployed version, or older.
- The release is a *failed version*: a version whose deployment was rolled
  back. `/opt/server/meals/failed` lists them.
- The release doesn't have `image.txt` yet.

If the latest release is the deployed version but isn't running, for
example after an interrupted deployment, `meals-deploy` starts it and checks
its health. If the check fails, the script prints `Version X.Y.Z didn't
start healthy.`, and the service fails. If the latest release is a failed
version, `meals-deploy.service` fails on every run, so it stays in
`systemctl --failed` until a newer release or a hold.

A deployment does the following:

1. Pulls the image by digest. If the pull fails, nothing changes, and the
   next run tries again.
1. Checks that every JSON file in the data directory parses, and that
   `deployer` can open every directory in it. If the check fails, the
   script logs `Invalid JSON:` and the file name, also for a JSON file that
   `deployer` can't read, or `Couldn't read every file in` and the
   directory. Then it fails with `The data failed validation`, and the app
   keeps running. Each later run fails the same way until you fix the data.
   The check skips other files. If `deployer` can't read one, the
   `pre-deploy` backup fails instead.
1. Stops the app. If the stop fails, the script prints `Couldn't stop
   version X.Y.Z, so nothing changed.`
1. Takes a `pre-deploy` backup. If the backup fails, for example because
   the disk is full, or if any later step before the start fails, the
   script starts the previous version again, and nothing changes. Its
   `Error:` line says whether the previous version runs again, and if it
   doesn't, points to the Compose logs.
1. Starts the new version, and waits up to 60 seconds for it to be healthy
   and to report its version.
1. If the check passes, removes the images other than the new and the
   previous one. If a removal fails, the script logs a `Couldn't remove`
   line and goes on.
1. If the check fails, rolls back: stops the new version, restores the data
   from the `pre-deploy` backup, starts the previous version, and adds the
   new version to `failed`, so the timer doesn't deploy it again. The
   script ends with `Version X.Y.Z failed.` If the new version doesn't
   stop, the rollback leaves the data as it is, because that version might
   still write to it. If any step of the rollback fails, the script logs
   `The rollback failed too.` and points to the Compose logs.

The first deployment has no previous version, so it checks no data, stops
nothing, and takes no backup. If its check fails, the rollback only stops
the new version, and the script adds the version to `failed`.

The app stops for a few seconds during each deployment.

### Deploy a version by hand

The following commands control deployments:

| Command | Effect |
|---------|--------|
| `sudo systemctl start meals-deploy` | Deploys the latest release now, as the timer does. |
| `sudo -u deployer meals-deploy VERSION` | Deploys release `VERSION`, such as `0.2.0`, even if it's older or failed, and puts the host on hold, so the timer keeps that version. |
| `sudo -u deployer meals-deploy --resume` | Ends the hold, so the timer deploys the latest release again. |

A deployment by hand puts the host on hold once the `pre-deploy` backup
succeeds, or at once on a first deployment. A failed check keeps the hold.
If the deployment fails before the new version starts, the script ends a
hold that it created, and logs `Ended the hold`.

To go back to an earlier release, deploy it by hand. When a newer release
fixes the problem, run `sudo -u deployer meals-deploy --resume`.

To keep the app stopped, for example while you repair the host, put the host
on hold first. Otherwise the timer starts the deployed version again. To put
the host on hold, run the following command:

```bash
sudo -u deployer touch /opt/server/meals/hold
```

## Backups

A backup is a `.tar.gz` archive of the whole data directory in
`/opt/server/meals/backups/`. Its name holds the time in UTC, the backup
kind, and the version that wrote the data, for example
`2026-10-04T033000Z-daily-v0.2.0.tar.gz`.

| Kind | When | Backups kept |
|------|------|--------------|
| `daily` | Every day at 03:30, or at the next boot if the host was off. | 14 |
| `pre-deploy` | Before each deployment. | 10 |
| `pre-restore` | Before each restore. | 10 |

`meals-backup` checks each backup before it keeps it: the archive must be
intact, and every JSON file in it must parse. If a data file is damaged, or
if `deployer` can't read a file, the backup fails. A failed `daily` backup
shows `meals-backup.service` in `systemctl --failed`. A `pre-restore` backup
only checks the archive, so you can restore over damaged data and still undo
the restore.

Before the first deployment, `meals-backup` logs `No version is deployed`
and exits without a backup and without an error.

A crash or a power loss during a backup leaves a `.partial` file in
`backups/`. After each backup that succeeds, `meals-backup` deletes the
`.partial` files that are more than a day old.

To take a backup now, run `sudo systemctl start meals-backup`.

### Restore a backup

To restore a backup, run `meals-restore` with its file name in `backups/`,
or with the absolute path of an archive elsewhere. `deployer` must be able
to read the file, so first copy an archive from your home directory into
`backups/`. For example:

```bash
sudo -u deployer meals-restore 2026-10-04T033000Z-daily-v0.2.0.tar.gz
```

`meals-restore` checks the backup before it changes anything, stops the app,
takes a `pre-restore` backup, replaces the data directory, and starts the
app again. To undo a restore, restore that `pre-restore` backup. If the app
isn't healthy after the restore, the error names it.

`meals-restore` refuses a backup from a version newer than the deployed
one, because that version might store data in a format that the deployed
version doesn't read. To restore it, first deploy its version with
`meals-deploy VERSION`.

### Fix a failed restore

If a restore can't replace the data, it leaves `data/` as it was and the app
stopped. It prints the command that starts the app again:

```bash
cd /opt/server/meals && sudo -u deployer docker compose --project-directory /opt/server/meals --file /opt/server/meals/compose.yaml up --detach
```

The command changes to `/opt/server/meals` first, because Docker Compose
fails in a directory that `deployer` can't read, such as your home
directory.

If a crash during a restore or a rollback left `data.old` and no `data/`,
`data.old` might be the only copy of the data. Docker Compose doesn't create
a missing `data/`, so the app doesn't start. Depending on what runs, you see
one of the following messages:

- When the deployed version starts, Docker Compose reports `bind source
  path does not exist`, and `meals-deploy` prints `Version X.Y.Z didn't
  start healthy.`
- A deployment logs `Couldn't read every file in` and fails with `The data
  failed validation`.
- A restore fails in its `pre-restore` backup with `Couldn't archive the
  data`, and then prints `The pre-restore backup failed`.
- If `data/` goes missing while a restore or a rollback runs, the script
  prints `data/ is missing, so data.old stays as it is.` and changes
  nothing.

Before you restore a backup or start the app, move `data.old` back to
`data`:

```bash
sudo -u deployer mv /opt/server/meals/data.old /opt/server/meals/data
```

If a restore prints `Couldn't move data.old back to data/`, it ends with
`The restore failed, so the data is in /opt/server/meals/data.old`. Run the
same command before you start the app.

If a restore logs `Couldn't set the mode of data/` or `Couldn't remove the
old data`, the restore still succeeded. To fix the mode, run
`sudo chmod 2775 /opt/server/meals/data`. To free the space, run
`sudo rm -rf /opt/server/meals/data.old`.

A restore removes the `.restore.*` directories that an interrupted restore
or rollback left, and logs `Removed NAME, which an interrupted restore
left.` If it can't remove one, for example because the archive had a
read-only directory, it logs `Couldn't remove` with the command that
removes it, and goes on.

### Restore on a new host

To restore a backup on a new host, do the following:

1. Install the host tools, as in
   [Install the host tools](#install-the-host-tools).
1. Copy the backup to `/opt/server/meals/backups/`.
1. Deploy the backup's version, which is in its name:

   ```bash
   sudo -u deployer meals-deploy VERSION
   ```

1. Restore the backup, as in [Restore a backup](#restore-a-backup).
1. When you're ready for new releases, run
   `sudo -u deployer meals-deploy --resume`.

### Copy backups off the host

The backups live on the host's disk, so they don't survive a disk failure.
To keep copies elsewhere, copy `/opt/server/meals/backups/` regularly to
another device, for example with `rsync`:

```bash
rsync -a /opt/server/meals/backups/ nas:/backups/meals/
```

### Restore check

Every Sunday at 04:00, `meals-restore-check` starts the deployed image on a
copy of the latest backup, as the separate Compose project
`meals-restore-check`. It requests the health check, the recipe book, the
ingredient catalog, and each week in the backup. If a request fails,
`meals-restore-check.service` shows in `systemctl --failed`. To run the
check now, run `sudo systemctl start meals-restore-check`.

Each check first removes the containers and `.restore-check.*` directories
that an interrupted check left, even when there's no backup to check. If it
can't remove a directory, it logs `Couldn't remove` with the command that
removes it, and goes on.

## Move an existing installation

If you ran Meals from a checkout with `npm start`, you can move its data to
the host. Before you start, the first release must have `image.txt`, and its
image must be public.

To move the installation, do the following:

1. Install the host tools, as in
   [Install the host tools](#install-the-host-tools). The host is on hold.
1. Stop the `npm start` server.
1. Copy the data directory of the checkout to the host, give it to
   `deployer`, and set the mode that the installer set, which the copy
   replaces:

   ```bash
   sudo cp -a data/. /opt/server/meals/data/
   sudo chown -R deployer:docker /opt/server/meals/data
   sudo chmod 2775 /opt/server/meals/data
   ```

1. Deploy the latest release:

   ```bash
   sudo -u deployer meals-deploy --resume
   sudo systemctl start meals-deploy
   ```

   As the first deployment, it takes no backup. The data directory of the
   checkout is the copy to go back to.
1. Check that `curl http://localhost:3000/api/health` returns the release's
   version, and that the meal plan, the recipe book, and the ingredient
   catalog look as before.
1. Take the first backup:

   ```bash
   sudo systemctl start meals-backup
   ```

1. Move the data directory of the checkout out of the working tree, for
   example into an archive in your home directory:

   ```bash
   tar -czf ~/meals-data-before-move.tar.gz data && rm -r data
   ```

If the first deployment fails, copy the data directory of the checkout to
`/opt/server/meals/data/` again before you try another release.

## Logs

The units log to the journal, and the app logs one JSON object per line. A
script that you run by hand prints to your terminal instead of the journal.
The `docker` commands need membership in the `docker` group, or `sudo`:

| To see | Run |
|--------|-----|
| The app | `docker compose --project-directory /opt/server/meals logs app` |
| The backups | `journalctl -u meals-backup` |
| The deployments by the timer | `journalctl -u meals-deploy` |
| The failed services | `systemctl --failed` |
| The restore checks | `journalctl -u meals-restore-check` |
| The timers and their next run | `systemctl list-timers 'meals-*'` |

The app logs a failed health check as `health check failed` with the error
code, such as `EACCES`, and a failure to start as `server failed to start`.
To list only the app's errors, run the following command:

```bash
docker compose --project-directory /opt/server/meals logs --no-log-prefix app \
  | jq -c 'select(.level == "error")'
```
