#!/usr/bin/env bash
# Usage: scripts/host-smoke.sh IMAGE
#
# Runs the meals-* scripts against real Docker, with IMAGE deployed in a
# temporary MEALS_ROOT laid out as install.sh lays out the host. It backs up
# some data, changes it, restores the backup, and checks the latest backup
# with meals-restore-check. It never touches /opt/server/meals, but don't run
# it on the host: it uses the Compose project of the weekly check,
# meals-restore-check, and removes that project when it exits.
set -euo pipefail

image=${1:?Usage: scripts/host-smoke.sh IMAGE}
repo=$(dirname "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")")
version=$(jq -r .version "$repo/package.json")
week=2026-09-28

compose() {
  docker compose --project-directory "$root" --file "$root/compose.yaml" "$@"
}

cleanup() {
  compose down >/dev/null 2>&1 || true
  # Only if meals-restore-check failed to remove them.
  compose --project-name meals-restore-check down >/dev/null 2>&1 || true
  rm -rf "$work"
}

work=$(mktemp -d)
root=$work/meals
trap cleanup EXIT

# The scripts read MEALS_ROOT. Compose takes the project name from
# COMPOSE_PROJECT_NAME before compose.yaml, so the app doesn't replace a
# meals project that already runs on this Docker. DOCKER_CONFIG keeps your
# Docker settings, which common.sh would otherwise look for in MEALS_ROOT.
export COMPOSE_PROJECT_NAME=meals-host-smoke DOCKER_CONFIG=${DOCKER_CONFIG:-$HOME/.docker}
export MEALS_ROOT=$root
# Variables in the environment override .env in Compose, and MEALS_LOCKED
# would skip the lock.
unset MEALS_GID MEALS_IMAGE MEALS_LOCKED MEALS_PORT MEALS_UID

fail() {
  echo "Host smoke test failed: $*" >&2
  compose logs app >&2 || true
  exit 1
}

# Sends METHOD to PATH on the app with the JSON BODY, if given, and prints
# the response.
api() {
  local method=$1 path=$2 body=${3:-} options
  options=(-fsS --max-time 10 -X "$method")
  if [[ -n $body ]]; then
    options+=(-H 'Content-Type: application/json' -d "$body")
  fi
  curl "${options[@]}" "http://$(compose port app 3000)$path"
}

# Prints the name of the recipe with the ID $recipe.
recipe_name() {
  api GET /api/recipes | jq -r --arg id "$recipe" '.recipes[] | select(.id == $id) | .name'
}

# Prints the servings of the recipe in the week's Monday dinner.
servings() {
  api GET "/api/weeks/$week" | jq -r '.mon.dinner.items[0].servings'
}

docker image inspect "$image" >/dev/null || fail "there's no image $image. To build meals:test, run npm run test:image."
# The host as install.sh lays it out, with IMAGE deployed as version $version.
install -d -m 2775 "$root" "$root/backups" "$root/data" "$root/scripts" "$root/scripts/lib"
install -m 0664 "$repo/deploy/compose.yaml" "$root/compose.yaml"
install -m 0664 "$repo"/scripts/lib/*.sh "$root/scripts/lib/"
install -m 0775 "$repo"/scripts/meals-* "$root/scripts/"
printf 'MEALS_GID=%s\nMEALS_IMAGE=%s\nMEALS_PORT=127.0.0.1:0\nMEALS_UID=%s\nMEALS_VERSION=%s\n' \
  "$(id -g)" "$image" "$(id -u)" "$version" >"$root/.env"

compose up --detach --wait --wait-timeout 60 || fail "the app didn't become healthy"
recipe=$(api POST /api/recipes '{"name":"Smoke soup"}' | jq -r .id) || fail "couldn't add a recipe"
api PUT "/api/weeks/$week/mon/dinner" "{\"items\":[{\"recipeId\":\"$recipe\",\"servings\":2}]}" \
  >/dev/null || fail "couldn't plan the recipe"

# The backup keeps the mode of data/, so with another mode, as data from an
# earlier installation might have, the check after the restore shows that
# meals-restore sets it.
chmod 0755 "$root/data"
"$root/scripts/meals-backup" daily || fail "meals-backup daily failed"
backup=$(find "$root/backups" -name "*-daily-v$version.tar.gz" -printf '%f\n')
[[ -n $backup ]] || fail "meals-backup didn't create a daily backup"
cp -a "$root/data" "$work/expected"

api PATCH "/api/recipes/$recipe" '{"name":"Smoke stew"}' >/dev/null ||
  fail "couldn't rename the recipe"
api PUT "/api/weeks/$week/mon/dinner" "{\"items\":[{\"recipeId\":\"$recipe\",\"servings\":3}]}" \
  >/dev/null || fail "couldn't change the servings"
[[ $(recipe_name) == "Smoke stew" ]] || fail "the recipe wasn't renamed"

"$root/scripts/meals-restore" "$backup" || fail "meals-restore failed"
[[ $(recipe_name) == "Smoke soup" ]] || fail "the API doesn't show the restored recipe name"
[[ $(servings) == 2 ]] || fail "the API doesn't show the restored servings"
diff -r "$work/expected" "$root/data" || fail "data/ differs from the backup"
[[ $(stat -c %a "$root/data") == 2775 ]] || fail "data/ has mode $(stat -c %a "$root/data"), not 2775"
[[ -n $(find "$root/backups" -name "*-pre-restore-v$version.tar.gz") ]] ||
  fail "meals-restore didn't create a pre-restore backup"
api GET /api/health | jq -e --arg version "$version" '.version == $version' >/dev/null ||
  fail "/api/health doesn't report version $version"

output=$("$root/scripts/meals-restore-check") || fail "meals-restore-check failed: $output"
printf '%s\n' "$output"
[[ $output == *"restores into version $version: 4 requests succeeded."* ]] ||
  fail "meals-restore-check didn't request the health check, the recipes, the ingredients, and the week"
[[ -z $(docker ps --all --quiet --filter label=com.docker.compose.project=meals-restore-check) ]] ||
  fail "meals-restore-check left containers"
[[ -z $(find "$root" -maxdepth 1 -name '.restore*') ]] ||
  fail "the scripts left directories in MEALS_ROOT: $(find "$root" -maxdepth 1 -name '.restore*')"

echo "Host smoke test passed: backup, restore, and restore check work with $image."
