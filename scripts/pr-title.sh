#!/usr/bin/env bash
# Usage: pr-title.sh TITLE
#
# Prints the Conventional Commits subject TITLE, such as
# "fix(deps): bump the npm group with 3 updates", in the pull request title
# style of this repository: "Fix: Bump the npm group with 3 updates". Prints
# any other TITLE as it is.
set -euo pipefail

title=$1
if [[ $title =~ ^([a-z]+)(\([^\)]*\))?!?:\ (.+)$ ]]; then
  type=${BASH_REMATCH[1]}
  subject=${BASH_REMATCH[3]}
  case $type in
    ci) label=CI ;;
    *) label=${type^} ;;
  esac
  printf '%s: %s\n' "$label" "${subject^}"
else
  printf '%s\n' "$title"
fi
