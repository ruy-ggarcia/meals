#!/usr/bin/env bash
# Usage: scripts/image-smoke.sh IMAGE
#
# Runs IMAGE through deploy/compose.yaml, as the host does, and checks that
# it doesn't start without a data directory, becomes healthy, reports the
# version in package.json, keeps its data across a restart, and stops with
# exit code 0.
set -euo pipefail

image=${1:?Usage: scripts/image-smoke.sh IMAGE}
repo=$(dirname "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")")
version=$(jq -r .version "$repo/package.json")
work=$(mktemp -d)

export MEALS_GID MEALS_IMAGE=$image MEALS_PORT=127.0.0.1:0 MEALS_UID
MEALS_GID=$(id -g)
MEALS_UID=$(id -u)

compose() {
  docker compose --project-name meals-smoke --project-directory "$work" \
    --file "$repo/deploy/compose.yaml" "$@"
}

cleanup() {
  compose down >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

fail() {
  echo "Smoke test failed: $*" >&2
  compose logs app >&2 || true
  exit 1
}

# Prints the URL of PATH on the app's published port.
url() {
  echo "http://$(compose port app 3000)$1"
}

# Without data/, Compose must fail rather than create an empty one.
if compose up --detach >/dev/null 2>&1; then
  fail "the container started without a data directory"
fi
[[ ! -e $work/data ]] || fail "Compose created the data directory"
mkdir "$work/data" || fail "couldn't create the data directory"
compose up --detach --wait --wait-timeout 60 || fail "the container didn't become healthy"

reported=$(curl -fsS "$(url /api/health)" | jq -r .version) || fail "couldn't read /api/health"
[[ $reported == "$version" ]] || fail "/api/health reports version $reported, not $version"

curl -fsS -X POST -H 'Content-Type: application/json' -d '{"name":"Smoke test","unit":"g"}' \
  "$(url /api/ingredients)" >/dev/null || fail "couldn't add an ingredient"
compose restart app >/dev/null || fail "couldn't restart the container"
compose up --detach --wait --wait-timeout 60 ||
  fail "the container didn't become healthy after a restart"
curl -fsS "$(url /api/ingredients)" | jq -e '.ingredients | any(.name == "Smoke test")' >/dev/null ||
  fail "the ingredient didn't survive a restart"

container=$(compose ps --quiet app) || fail "couldn't find the container"
compose stop app >/dev/null || fail "couldn't stop the container"
code=$(docker inspect --format '{{.State.ExitCode}}' "$container") ||
  fail "couldn't inspect the container"
[[ $code == 0 ]] || fail "the container exited with code $code, not 0"

echo "Smoke test passed: $image reports version $version."
