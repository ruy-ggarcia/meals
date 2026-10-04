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
