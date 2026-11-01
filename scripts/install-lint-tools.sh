#!/usr/bin/env bash
# Usage: install-lint-tools.sh
#
# Installs the pinned versions of actionlint and hadolint into .tools/bin,
# which Git ignores. It downloads each release binary from GitHub, checks its
# SHA-256 checksum against the one written here, and skips the tools that are
# already installed with the right checksum. `npm run lint` runs it before the
# checks. Only Linux on
# x86-64 is supported. To update a tool, change its version and checksum.
set -euo pipefail

actionlint_version=1.7.12
# The checksum of the release archive, and of the actionlint binary inside it.
actionlint_sha256=8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8
actionlint_binary_sha256=c872d6db8c6bf83a8eaa704fc93999f027d55dffbc63b8a6abdccb47df5f4cd4
hadolint_version=2.15.1
hadolint_sha256=c7187db94eeeeca956519a6af171adc31453941a1e777961f6e680f697c8c507

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
bin="$root/.tools/bin"

if [[ $(uname -s) != Linux || $(uname -m) != x86_64 ]]; then
  printf 'install-lint-tools.sh supports only Linux on x86-64, not %s on %s.\n' \
    "$(uname -s)" "$(uname -m)" >&2
  printf 'Install actionlint %s and hadolint %s yourself, and put them in %s.\n' \
    "$actionlint_version" "$hadolint_version" "$bin" >&2
  exit 1
fi

work=$(mktemp -d)
staged="$bin/.staged.$$"
trap 'rm -rf "$work" "$staged"' EXIT

# download URL SHA256 FILE: downloads URL to FILE, and fails if the checksum
# of the file isn't SHA256.
download() {
  local url=$1 sha256=$2 file=$3
  curl --fail --location --silent --show-error --connect-timeout 10 \
    --retry 3 --retry-all-errors --output "$file" "$url"
  if ! printf '%s  %s\n' "$sha256" "$file" | sha256sum --check --status; then
    printf 'The checksum of %s is not %s.\n' "$url" "$sha256" >&2
    exit 1
  fi
}

# has_checksum SHA256 FILE: succeeds if FILE exists and its checksum is SHA256.
has_checksum() {
  printf '%s  %s\n' "$1" "$2" | sha256sum --check --status >/dev/null 2>&1
}

# install_binary SOURCE NAME: copies SOURCE to .tools/bin/NAME in one step, so
# a failed or concurrent run never leaves a half-written binary there.
install_binary() {
  install -m 755 "$1" "$staged"
  mv -f "$staged" "$bin/$2"
}

mkdir -p "$bin"

if ! has_checksum "$actionlint_binary_sha256" "$bin/actionlint"; then
  archive="actionlint_${actionlint_version}_linux_amd64.tar.gz"
  download "https://github.com/rhysd/actionlint/releases/download/v$actionlint_version/$archive" \
    "$actionlint_sha256" "$work/$archive"
  tar --extract --gzip --file "$work/$archive" --directory "$work" actionlint
  install_binary "$work/actionlint" actionlint
fi

if ! has_checksum "$hadolint_sha256" "$bin/hadolint"; then
  download "https://github.com/hadolint/hadolint/releases/download/v$hadolint_version/hadolint-linux-x86_64" \
    "$hadolint_sha256" "$work/hadolint"
  install_binary "$work/hadolint" hadolint
fi
