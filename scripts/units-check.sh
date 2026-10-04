#!/usr/bin/env bash
# Usage: scripts/units-check.sh
#
# Runs systemd-analyze verify on the units in deploy/systemd. The units start
# the scripts in /opt/server/meals/scripts, so it verifies copies that start
# the scripts in this checkout instead. It fails on any error or warning about
# the units.
set -euo pipefail

repo=$(dirname "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

cp "$repo"/deploy/systemd/*.service "$repo"/deploy/systemd/*.timer "$work/"
sed -i "s|^ExecStart=/opt/server/meals/scripts/|ExecStart=$repo/scripts/|" "$work"/*.service

# With --recursive-errors=no, systemd-analyze verify exits 1 for an unknown key
# or a schedule that doesn't parse in these units. It prints other warnings
# and keeps the exit status 0, so any line about the units fails the check too.
# Errors in units that the units depend on, such as docker.service, don't count.
status=0
output=$(systemd-analyze verify --recursive-errors=no "$work"/*.service "$work"/*.timer 2>&1) ||
  status=$?
if [[ $status != 0 ]] || grep -q 'meals-' <<<"$output"; then
  printf '%s\n' "$output" >&2
  echo "Units check failed: systemd-analyze verify reported the problems above." >&2
  exit 1
fi
echo "Units check passed: $(find "$work" -type f | wc -l) units in deploy/systemd."
