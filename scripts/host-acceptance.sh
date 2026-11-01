#!/usr/bin/env bash
# Usage: sudo --preserve-env=GITHUB_ACTIONS,GITHUB_TOKEN scripts/host-acceptance.sh
#
# Installs the Meals host tools from this checkout for real, and checks the
# host with the published releases from GitHub and GHCR: the installation and
# the timers, a second installation, moving the data of an earlier
# installation in, a deployment by hand and the resume, a backup and a
# restore, the restore check, a deployment that can't pull, and the app after
# Docker restarts. Each check prints what it checked, and the first one that
# fails prints what it expected and what it found, and exits 1.
#
# It changes the machine for good: it creates the deployer user, installs
# /opt/server/meals and the timers, and edits /etc/hosts for a while. So it
# runs only as root on a GitHub Actions runner, a new virtual machine for each
# job, and never where /opt/server/meals exists. With GITHUB_TOKEN, it gives
# meals-deploy that token for the GitHub API.
set -euo pipefail

if [[ ${GITHUB_ACTIONS:-} != true ]]; then
  echo "Run the host acceptance test only on a GitHub Actions runner." >&2
  exit 1
fi
if [[ $EUID != 0 ]]; then
  echo "Run the host acceptance test as root." >&2
  exit 1
fi
if [[ -e /opt/server/meals ]]; then
  echo "/opt/server/meals already exists." >&2
  exit 1
fi

readonly ROOT=/opt/server/meals
# An older release whose image is public. It doesn't know measures, so the
# data has none.
readonly OLDER=0.2.0
readonly TIMERS=(meals-backup.timer meals-deploy.timer meals-restore-check.timer)
# Ends the lines that block GHCR in /etc/hosts, so the cleanup finds them.
readonly BLOCKED='# Blocked by the Meals host acceptance test'
# The IDs in the data of the earlier installation.
readonly INGREDIENT=5b0f4c1e-8d2a-4c39-9f6e-3a7d2e1b0c84
readonly RECIPE=9e2d7a63-1f4b-4e8c-a5d0-6c3b8f2e1a97
readonly WEEK=2026-09-28

repo=$(dirname "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")")
work=$(mktemp -d)
# Holds the curl settings with the token. It's outside $work, which only root
# can open, because meals-deploy reads it as deployer.
curl_home=$(mktemp -d /tmp/meals-curl.XXXXXX)

cleanup() {
  sed -i "/ $BLOCKED\$/d" /etc/hosts
  rm -rf "$curl_home" "$work"
}
trap cleanup EXIT

step() {
  printf '\n%s\n' "$*"
}

fail() {
  echo "Host acceptance test failed: $*" >&2
  echo "The journal of the meals-* units ends with the following lines:" >&2
  journalctl --no-pager --lines 40 --unit 'meals-*' >&2 || true
  docker compose --project-directory "$ROOT" logs --tail 30 app >&2 || true
  exit 1
}

# Prints that WHAT is EXPECTED if FOUND is EXPECTED, and fails with both
# otherwise.
check() {
  local what=$1 expected=$2 found=$3
  [[ $found == "$expected" ]] || fail "$what: expected \"$expected\", found \"$found\"."
  echo "Checked $what: $found"
}

# Like check, with PATTERN, a glob, in place of EXPECTED.
check_match() {
  local what=$1 pattern=$2 found=$3
  # shellcheck disable=SC2053 # The pattern is a glob on purpose.
  [[ $found == $pattern ]] || fail "$what: expected \"$pattern\", found \"$found\"."
  echo "Checked $what: $found"
}

# Runs COMMAND, and checks that it succeeds. WHAT names the command.
succeeds() {
  local what=$1 status=0
  shift
  "$@" || status=$?
  check "the exit status of $what" 0 "$status"
}

# Runs COMMAND every second until it succeeds, for up to TIMEOUT seconds, and
# fails if it never does. Callers check the result afterwards with check, so
# that a failure shows what it found.
wait_for() {
  local timeout=$1 deadline
  shift
  deadline=$((SECONDS + timeout))
  until "$@"; do
    ((SECONDS < deadline)) || return 1
    sleep 1
  done
}

# Prints "exists" if FILE exists, and "doesn't exist" otherwise.
presence() {
  if [[ -e $1 ]]; then echo exists; else echo "doesn't exist"; fi
}

# Prints "exists" if the Docker image IMAGE exists, and "doesn't exist"
# otherwise.
image_presence() {
  if docker image inspect "$1" >/dev/null 2>&1; then echo exists; else echo "doesn't exist"; fi
}

# Prints the status and the version that the health check reports, such as
# "ok 0.3.0", or "no answer".
health() {
  curl -sS --max-time 5 http://localhost:3000/api/health 2>/dev/null |
    jq -r '"\(.status) \(.version)"' 2>/dev/null || echo "no answer"
}

health_is() {
  [[ $(health) == "$1" ]]
}

# Sends METHOD to PATH on the app with the JSON BODY, if given, and prints
# the response.
api() {
  local method=$1 path=$2 body=${3:-} options
  options=(-fsS --max-time 10 -X "$method")
  if [[ -n $body ]]; then
    options+=(-H 'Content-Type: application/json' -d "$body")
  fi
  curl "${options[@]}" "http://localhost:3000$path"
}

# Prints the names of the recipes, as the app lists them.
recipes() {
  api GET /api/recipes | jq -r '[.recipes[].name] | join(", ")'
}

# Prints the GitHub API response for PATH in the repository, with the token
# if there is one.
github() {
  CURL_HOME=$curl_home curl -fsSL --max-time 20 -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/ruy-ggarcia/meals/$1"
}

# Runs meals-deploy with ARGS as deployer, as you do with sudo -u deployer,
# with the token if there is one.
meals_deploy() {
  sudo -u deployer env CURL_HOME="$curl_home" meals-deploy "$@"
}

# Succeeds if meals-deploy.service isn't running. A run of the timer that
# checks the hold right now would end without a deployment, and systemctl
# start would only wait for it.
deploy_idle() {
  [[ $(systemctl show --property ActiveState --value meals-deploy.service) != activating ]]
}

# Prints how many times the journal of meals-deploy.service reads "Deployed
# version VERSION."
deployments_of() {
  journalctl --no-pager --output cat --unit meals-deploy.service |
    grep -cxF "Deployed version $1." || true
}

deployments_are() {
  [[ $(deployments_of "$1") == "$2" ]]
}

# Prints the file names of the backups of KIND, oldest first, as the meals-*
# scripts sort them.
backups_of() {
  find "$ROOT/backups" -maxdepth 1 -type f -name "*-$1-v*.tar.gz" -printf '%f\n' | sort
}

# Prints the backups of KIND that aren't in BEFORE, a list of backups_of.
new_backups() {
  comm -13 <(printf '%s\n' "$2") <(backups_of "$1")
}

# Prints the line of meals-restore-check.service, among the last 5 in its
# journal, that says which backup it checked.
restore_check_line() {
  journalctl --no-pager --output cat --lines 5 --unit meals-restore-check.service |
    grep -F 'restores into version' || true
}

restore_check_is() {
  [[ $(restore_check_line) == "$1" ]]
}

# Prints whether TIMER is enabled, whether it's active, and whether it has a
# next run, such as "enabled active scheduled".
timer_state() {
  local enabled active next schedule=scheduled
  enabled=$(systemctl is-enabled "$1" 2>&1) || true
  active=$(systemctl is-active "$1" 2>&1) || true
  # The first column is the next run, or "-" if there's none.
  next=$(systemctl list-timers --all --no-legend "$1" | awk 'NR == 1 { print $1 }') || true
  [[ -n $next && $next != - ]] || schedule=unscheduled
  echo "$enabled $active $schedule"
}

timer_is() {
  [[ $(timer_state "$1") == "$2" ]]
}

check_timers() {
  local timer
  for timer in "${TIMERS[@]}"; do
    # A timer has no next run for a moment while its service runs.
    wait_for 30 timer_is "$timer" "enabled active scheduled" || true
    check "the state of $timer" "enabled active scheduled" "$(timer_state "$timer")"
  done
}

# Writes the data of an earlier installation into DIR: the files of a new
# host, with a recipe, an ingredient with no measures, and a week with a menu.
write_old_data() {
  local dir=$1
  mkdir -p "$dir/v2/weeks"
  cat >"$dir/v2/ingredients.json" <<EOF
{ "ingredients": [{ "id": "$INGREDIENT", "name": "Onion", "unit": "g", "archived": false }] }
EOF
  cat >"$dir/v2/recipes.json" <<EOF
{
  "recipes": [
    {
      "id": "$RECIPE",
      "name": "Lentil soup",
      "archived": false,
      "ingredients": [{ "ingredientId": "$INGREDIENT", "quantity": 150 }]
    }
  ]
}
EOF
  echo '{}' >"$dir/v2/weeks/2026-09-21.json"
  cat >"$dir/v2/weeks/$WEEK.json" <<EOF
{ "mon": { "dinner": { "items": [{ "recipeId": "$RECIPE", "servings": 2 }] } } }
EOF
  # As a checkout leaves it, without the setgid bit that the installer sets.
  chmod 0755 "$dir"
}

step "Installs the host tools on a host with no earlier installation."
succeeds install.sh "$repo/scripts/install.sh"
check "the primary group of deployer" docker "$(id -gn deployer)"
check "the mode and owner of /opt/server" "drwxrwsr-x root:docker" "$(stat -c '%A %U:%G' /opt/server)"
check "the mode and owner of $ROOT" "drwxrwsr-x deployer:docker" "$(stat -c '%A %U:%G' "$ROOT")"
check "the mode and owner of $ROOT/data" "drwxrwsr-x deployer:docker" "$(stat -c '%A %U:%G' "$ROOT/data")"
check "$ROOT/hold" exists "$(presence "$ROOT/hold")"

step "Checks that the three timers are enabled and scheduled."
check_timers

step "Installs again, and checks that .env and hold don't change."
cp "$ROOT/.env" "$work/env-before"
succeeds "install.sh, the second time" "$repo/scripts/install.sh"
check "$ROOT/.env" "$(tr '\n' ' ' <"$work/env-before")" "$(tr '\n' ' ' <"$ROOT/.env")"
check "$ROOT/hold" exists "$(presence "$ROOT/hold")"

step "Gives meals-deploy the job's token for the GitHub API, if there is one."
chown deployer:docker "$curl_home"
if [[ -n ${GITHUB_TOKEN:-} ]]; then
  # meals-deploy calls the GitHub API without a token, and runners share
  # addresses, so the limit on requests without a token could fail the run.
  # curl reads its settings from .curlrc in CURL_HOME, so the scripts stay as
  # they are.
  (umask 0077 && printf 'header = "Authorization: Bearer %s"\n' "$GITHUB_TOKEN" >"$curl_home/.curlrc")
  chown deployer:docker "$curl_home/.curlrc"
  mkdir -p /etc/systemd/system/meals-deploy.service.d
  printf '[Service]\nEnvironment=CURL_HOME=%s\n' "$curl_home" \
    >/etc/systemd/system/meals-deploy.service.d/github-token.conf
  systemctl daemon-reload
  echo "meals-deploy calls the GitHub API with the job's token."
else
  echo "There's no GITHUB_TOKEN, so meals-deploy calls the GitHub API without a token."
fi
latest=$(github releases/latest | jq -er .tag_name) || fail "couldn't get the latest release from GitHub."
latest=${latest#v}
[[ $latest != "$OLDER" ]] ||
  fail "the latest release: expected a release newer than $OLDER, found $latest."
echo "The latest release is $latest, and the older release is $OLDER."

step "Moves the data of an earlier installation in, and deploys the latest release."
# As in Move an existing installation in docs/deployment.md, with the data
# directory of a checkout in $work/checkout/data.
write_old_data "$work/checkout/data"
cp -a "$work/checkout/data/." "$ROOT/data/"
chown -R deployer:docker "$ROOT/data"
chmod 2775 "$ROOT/data"
succeeds "meals-deploy --resume" meals_deploy --resume
wait_for 60 deploy_idle || true
succeeds "systemctl start meals-deploy" systemctl start meals-deploy
check "the health check" "ok $latest" "$(health)"
check "the recipes" "Lentil soup" "$(recipes)"
check "the ingredients" "Onion in g with 0 measures" \
  "$(api GET /api/ingredients |
    jq -r '[.ingredients[] | "\(.name) in \(.unit) with \(.measures | length) measures"] | join(", ")')"
check "the week files" "2026-09-21.json $WEEK.json" \
  "$(find "$ROOT/data/v2/weeks" -type f -printf '%f\n' | sort | paste -sd ' ')"
check "the Monday dinner of the week of $WEEK" "2 servings of Lentil soup" \
  "$(api GET "/api/weeks/$WEEK" |
    jq -r --arg recipe "$RECIPE" '.mon.dinner.items | map("\(.servings) servings of \(if .recipeId == $recipe then "Lentil soup" else .recipeId end)") | join(", ")')"
check "the mode of $ROOT/data" drwxrwsr-x "$(stat -c %A "$ROOT/data")"
# The journal can lag behind the end of the service for a moment.
wait_for 10 deployments_are "$latest" 1 || true
check "the deployments of $latest in the journal of meals-deploy.service" 1 "$(deployments_of "$latest")"

step "Deploys $OLDER by hand, resumes, and lets meals-deploy.service deploy the latest release."
succeeds "meals-deploy $OLDER" meals_deploy "$OLDER"
check "the health check" "ok $OLDER" "$(health)"
check "$ROOT/hold" exists "$(presence "$ROOT/hold")"
check "the recipes in version $OLDER" "Lentil soup" "$(recipes)"
succeeds "meals-deploy --resume" meals_deploy --resume
check "$ROOT/hold" "doesn't exist" "$(presence "$ROOT/hold")"
wait_for 60 deploy_idle || true
succeeds "systemctl start meals-deploy" systemctl start meals-deploy
check "the health check" "ok $latest" "$(health)"
wait_for 10 deployments_are "$latest" 2 || true
check "the deployments of $latest in the journal of meals-deploy.service" 2 "$(deployments_of "$latest")"

step "Backs up through meals-backup.service, and restores that backup with meals-restore."
check "the recipe after the first rename" "Lentil stew" \
  "$(api PATCH "/api/recipes/$RECIPE" '{"name":"Lentil stew"}' | jq -r .name)"
before=$(backups_of daily)
succeeds "systemctl start meals-backup" systemctl start meals-backup
daily=$(new_backups daily "$before")
check_match "the new daily backup" "*-daily-v$latest.tar.gz" "$daily"
check "the recipe after the second rename" "Lentil and onion soup" \
  "$(api PATCH "/api/recipes/$RECIPE" '{"name":"Lentil and onion soup"}' | jq -r .name)"
before=$(backups_of pre-restore)
succeeds "meals-restore $daily" sudo -u deployer meals-restore "$daily"
check "the health check" "ok $latest" "$(health)"
check "the recipes after the restore" "Lentil stew" "$(recipes)"
check_match "the new pre-restore backup" "*-pre-restore-v$latest.tar.gz" "$(new_backups pre-restore "$before")"

step "Runs meals-restore-check.service, and checks its journal and that its container is gone."
newest=$(backups_of '*' | tail -n 1)
succeeds "systemctl start meals-restore-check" systemctl start meals-restore-check
# The health check, the recipes, the ingredients, and the two weeks.
expected="The backup $newest restores into version $latest: 5 requests succeeded."
wait_for 10 restore_check_is "$expected" || true
check "the journal of meals-restore-check.service" "$expected" "$(restore_check_line)"
containers=$(docker ps --all --quiet --filter label=com.docker.compose.project=meals-restore-check)
check "the containers of meals-restore-check" none "${containers:-none}"

step "Blocks GHCR, and checks that a deployment of $OLDER fails to pull and changes nothing."
older_image_url=$(github "releases/tags/v$OLDER" |
  jq -er '.assets[] | select(.name == "image.txt") | .browser_download_url') ||
  fail "couldn't get the image.txt of $OLDER from GitHub."
older_image=$(CURL_HOME=$curl_home curl -fsSL --max-time 20 "$older_image_url") ||
  fail "couldn't download the image.txt of $OLDER."
if [[ $(image_presence "$older_image") == exists ]]; then
  succeeds "docker image rm $older_image" docker image rm "$older_image"
fi
check "the image of $OLDER" "doesn't exist" "$(image_presence "$older_image")"
printf '127.0.0.1 ghcr.io %s\n::1 ghcr.io %s\n' "$BLOCKED" "$BLOCKED" >>/etc/hosts
status=0
output=$(meals_deploy "$OLDER" 2>&1) || status=$?
printf '%s\n' "$output"
check "the exit status of meals-deploy $OLDER with GHCR blocked" 1 "$status"
check_match "the error of meals-deploy $OLDER" "Error: Couldn't pull *. Nothing changed." \
  "$(grep '^Error:' <<<"$output" || true)"
check "the health check" "ok $latest" "$(health)"
check "$ROOT/hold" "doesn't exist" "$(presence "$ROOT/hold")"
check "the versions in $ROOT/failed" "no $OLDER" \
  "$(if grep -qxF "$OLDER" "$ROOT/failed" 2>/dev/null; then echo "$OLDER"; else echo "no $OLDER"; fi)"
sed -i "/ $BLOCKED\$/d" /etc/hosts
check "the lines that block GHCR in /etc/hosts" 0 "$(grep -cF "$BLOCKED" /etc/hosts || true)"

step "Restarts the Docker daemon, and checks that the app and the timers come back within 2 minutes."
# A GitHub-hosted runner can't reboot in the middle of a job, so a restart of
# the Docker daemon stands in for the reboot: the app has to come back
# through its restart policy, and the timers have to stay.
succeeds "systemctl restart docker" systemctl restart docker
wait_for 120 health_is "ok $latest" || true
check "the health check after the restart" "ok $latest" "$(health)"
check_timers

echo
echo "Host acceptance test passed: the host tools work with the releases $OLDER and $latest."
