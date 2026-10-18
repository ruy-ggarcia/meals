#!/usr/bin/env bash
# Usage: check-conventional.sh < SUBJECTS
#
# Checks that every line of the input, such as a pull request title or a
# commit subject, follows Conventional Commits: a known type, an optional
# lowercase scope, an optional "!", a colon and a space, and a description
# that doesn't start with a capital letter. Names each line that doesn't, and
# exits with 1 if there's any.
set -euo pipefail

types='build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test'
pattern="^($types)(\([a-z0-9][a-z0-9-]*\))?!?: [^A-Z ].*$"

status=0
# The second test also checks a last line without a newline.
while IFS= read -r subject || [[ -n $subject ]]; do
  if [[ ! $subject =~ $pattern ]]; then
    printf 'Not a Conventional Commits subject: %s\n' "$subject" >&2
    status=1
  fi
done
exit "$status"
