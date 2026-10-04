# shellcheck shell=bash
# Shell functions shared by the meals-* scripts, which source this file.
# Log lines go to standard output and errors to standard error. Under
# systemd, both reach the journal.

MEALS_ROOT=${MEALS_ROOT:-/opt/server/meals}
# Before the cd below, so that a relative $0 still resolves.
# shellcheck disable=SC2034 # The scripts that source this file use it.
MEALS_SCRIPTS=$(dirname "$(readlink -f "$0")")
# sudo -u deployer keeps your working directory, which deployer might not be
# able to read. find and docker compose fail there.
cd "$MEALS_ROOT" || exit 1
# deployer has no home directory, so the Docker CLI keeps its settings here.
export DOCKER_CONFIG=${DOCKER_CONFIG:-$MEALS_ROOT/.docker}
# New files stay writable by the docker group, whoever runs the script.
umask 0002

log() {
  printf '%s\n' "$*"
}

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

# Takes the lock that every script shares, and waits while another script
# holds it. A script that another script runs inherits the lock instead.
take_lock() {
  if [[ ${MEALS_LOCKED:-} == 1 ]]; then
    return
  fi
  exec 9>>"$MEALS_ROOT/.lock"
  flock 9
  export MEALS_LOCKED=1
}

# Prints the value of the variable NAME in the env file FILE, or nothing,
# also when FILE doesn't exist.
env_get() {
  [[ -f $1 ]] || return 0
  sed -n "s/^$2=//p" "$1" | tail -n 1
}

# Prints the deployed version, or nothing before the first deployment.
deployed_version() {
  env_get "$MEALS_ROOT/.env" MEALS_VERSION
}

# Succeeds if every .json file under DIR parses. Fails if it can't read a
# directory under DIR, because it can't check the files there.
validate_data() {
  local dir=$1 file files
  mapfile -d '' files < <(find "$dir" -type f -name '*.json' -print0)
  # The process substitution hides the status of find, but wait returns it.
  if ! wait "$!"; then
    log "Couldn't read every file in $dir."
    return 1
  fi
  for file in "${files[@]}"; do
    # jq's errors stay visible: the parse error, or that jq is missing.
    if ! jq empty "$file" >/dev/null; then
      log "Invalid JSON: ${file#"$dir"/}"
      return 1
    fi
  done
}

# Extracts the backup ARCHIVE into DIR, so the data ends up in DIR/data, and
# succeeds if the archive is intact and every .json file in it parses.
extract_valid() {
  local archive=$1 dir=$2
  if ! gzip -t "$archive" 2>/dev/null; then
    log "The archive is damaged: $(basename "$archive")"
    return 1
  fi
  tar -C "$dir" -xzf "$archive" || return 1
  if [[ ! -d $dir/data ]]; then
    log "The archive has no data directory: $(basename "$archive")"
    return 1
  fi
  validate_data "$dir/data"
}

# Prints the file names of the backups, only of KIND if given, oldest first.
# Interrupted backups, which end in .partial, don't count.
list_backups() {
  find "$MEALS_ROOT/backups" -maxdepth 1 -type f -name "*-${1:-*}-v*.tar.gz" -printf '%f\n' |
    sort
}

# Runs docker compose on the deployed app, with MEALS_ROOT as the project
# directory, so Compose reads .env and mounts data/ from there.
compose() {
  docker compose --project-directory "$MEALS_ROOT" --file "$MEALS_ROOT/compose.yaml" "$@"
}

# Prints the version in the file name of the backup ARCHIVE.
backup_version() {
  local name
  name=$(basename "$1")
  [[ $name =~ -v([0-9]+\.[0-9]+\.[0-9]+)\.tar\.gz$ ]] || return 1
  printf '%s\n' "${BASH_REMATCH[1]}"
}

# Succeeds if version A is older than version B.
version_lt() {
  [[ $1 != "$2" && $(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n 1) == "$1" ]]
}

# Replaces data/ with STAGING/data. The app must be stopped. If the new data
# can't move in, data/ stays as it was, or, if the old data can't move back
# either, it stays in data.old, and the swap returns 2. Once the new data is
# in, the swap succeeds, and a failure to set its mode or to remove the old
# data only logs a line. Each step returns on failure, because callers run it
# in an `if` or before `||`, where set -e is off.
swap_data() {
  local staging=$1
  # Without data/, as after a crash during an earlier swap, data.old might be
  # the only copy of the data, so it stays.
  if [[ ! -d $MEALS_ROOT/data && -e $MEALS_ROOT/data.old ]]; then
    log "data/ is missing, so data.old stays as it is."
    return 1
  fi
  rm -rf "$MEALS_ROOT/data.old" || return 1
  mv "$MEALS_ROOT/data" "$MEALS_ROOT/data.old" || return 1
  if ! mv "$staging/data" "$MEALS_ROOT/data"; then
    if ! mv "$MEALS_ROOT/data.old" "$MEALS_ROOT/data"; then
      log "Couldn't move data.old back to data/. The data is in $MEALS_ROOT/data.old: move it back to $MEALS_ROOT/data before you start the app."
      return 2
    fi
    return 1
  fi
  chmod 2775 "$MEALS_ROOT/data" ||
    log "Couldn't set the mode of data/ to 2775. To set it, run sudo chmod 2775 $MEALS_ROOT/data."
  rm -rf "$MEALS_ROOT/data.old" || log "Couldn't remove the old data in $MEALS_ROOT/data.old."
}

# Starts the app, and succeeds if Compose sees it healthy within
# MEALS_VERIFY_TIMEOUT seconds and it reports VERSION.
start_and_verify() {
  local version=$1 address
  compose up --detach --wait --wait-timeout "${MEALS_VERIFY_TIMEOUT:-60}" || return 1
  # The address that Compose published the port on, whatever form MEALS_PORT
  # has. For a port on every address, such as 0.0.0.0:3000, the request goes
  # to the loopback address.
  address=$(compose port app 3000) || return 1
  address=${address/#0.0.0.0:/127.0.0.1:}
  address=${address/#\[::\]:/[::1]:}
  [[ -n $address ]] || return 1
  curl -fsS --max-time 5 "http://$address/api/health" |
    jq -e --arg version "$version" '.status == "ok" and .version == $version' >/dev/null
}

# Removes every file or directory whose name starts with PREFIX, other than
# KEEP, and logs that an interrupted WHAT left it. One that can't go only logs
# a line.
remove_stale() {
  local prefix=$1 what=$2 keep=${3:-} stale
  for stale in "$prefix"*; do
    [[ -e $stale && $stale != "$keep" ]] || continue
    if rm -rf "$stale"; then
      log "Removed $(basename "$stale"), which an interrupted $what left."
    else
      log "Couldn't remove $stale, which an interrupted $what left. To free the space, run sudo rm -rf $stale."
    fi
  done
}

# Prints the file name of the backup of KIND that isn't in BEFORE, the list
# that list_backups printed before that backup. The new backup is the one that
# wasn't there before, whatever the clock says. If the clock went back, its
# name sorts oldest, so with as many other backups of KIND as the retention
# keeps, the retention deletes it at once. Then there's no new backup, and
# this fails, as it does when the listing fails. Each step returns on failure,
# because callers run this before `||`, where set -e is off.
new_backup() {
  local kind=$1 before=$2 after new
  after=$(list_backups "$kind") || return 1
  new=$(comm -13 <(printf '%s\n' "$before") <(printf '%s\n' "$after") | tail -n 1) || return 1
  [[ -n $new ]] || return 1
  printf '%s\n' "$new"
}

# Starts VERSION again, after a step that failed before the data changed, and
# dies with "REASON, so STARTED", or, if VERSION doesn't start, with REASON and
# a message that says so.
start_again_and_die() {
  local version=$1 reason=$2 started=$3
  if compose up --detach; then
    die "$reason, so $started"
  fi
  die "$reason, so nothing changed, but version $version didn't start again. See docker compose logs in $MEALS_ROOT."
}
